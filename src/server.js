const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { initDb } = require("./db");
const changelogData = require("./changelog-data");
const { RBACManager } = require("./rbac-manager");
const { createRBACMiddleware } = require("./rbac-middleware");
const { createRTCDeploymentRoutes } = require("./routes/rtc-deployment");

const app = express();
const port = process.env.PORT || 52344;
const uploadsDir = path.join(__dirname, "..", "uploads");
const certUploadsDir = path.join(uploadsDir, "certs");

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(certUploadsDir)) {
    fs.mkdirSync(certUploadsDir, { recursive: true });
  }
}

ensureUploadsDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const requestId = String(req.params.id || "unknown");
    const token = crypto.randomBytes(8).toString("hex");
    const dir = path.join(certUploadsDir, requestId, token);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const original = path.basename(file.originalname || "certificate.zip");
    cb(null, original);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".zip") {
      return cb(new Error("Only .zip files are allowed"));
    }
    return cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Changelog: always available, no DB dependency
app.get("/api/changelog", (req, res) => {
  return res.json({ content: changelogData });
});

initDb()
  .then((db) => {
    // 初始化RBAC管理器
    const rbacManager = new RBACManager(db);
    const {
      requirePermission,
      requireServiceAccess,
      requireRole,
      requireAdmin,
      attachUserPermissions,
      debugPermissions
    } = createRBACMiddleware(rbacManager);

    const adminEmail =
      (process.env.ADMIN_EMAIL || "").trim().toLowerCase() || null;
    const defaultAdminEmail = "wangjiaxin@shengwang.cn";
    const verificationMinutes = Number(process.env.VERIFICATION_TTL_MINUTES) || 10;
    const ROLE_ADMIN = "admin";
    const ROLE_DEV = "dev";
    const ROLE_SERVICE = "service";
    const ROLE_PRODUCT = "product";
    const REQUEST_STATUS_PENDING = "pending";
    const REQUEST_STATUS_ISSUED = "issued";
    const REQUEST_STATUS_REVOKED = "revoked";
    const REQUEST_STATUS_WITHDRAWN = "withdrawn";
    const REQUEST_STATUS_UPDATED = "updated";
    const CERT_STATUS_ACTIVE = "active";
    const CERT_STATUS_REVOKED = "revoked";

    // --- Email & Settings Helpers ---

    async function getSettings() {
      const rows = await db.all("SELECT key, value FROM system_settings");
      const settings = {};
      rows.forEach((r) => {
        try {
          settings[r.key] = JSON.parse(r.value);
        } catch {
          settings[r.key] = r.value;
        }
      });
      return settings;
    }

    async function saveSetting(key, value) {
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
        key,
        valStr,
        now,
        valStr,
        now
      );
    }

    // Cached SMTP transporter — recreated only when config changes
    let _smtpTransporter = null;
    let _smtpConfigKey = "";

    async function sendMail(to, subject, text, html) {
      const settings = await getSettings();
      if (!settings.smtp_host || !settings.smtp_user) {
        console.log("[Mail] SMTP not configured. Skipped sending:", subject);
        return false;
      }

      try {
        const configKey = `${settings.smtp_host}:${settings.smtp_port}:${settings.smtp_user}:${settings.smtp_secure}`;
        if (!_smtpTransporter || configKey !== _smtpConfigKey) {
          _smtpTransporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: Number(settings.smtp_port) || 465,
            secure: settings.smtp_secure !== false,
            pool: true,
            maxConnections: 3,
            auth: {
              user: settings.smtp_user,
              pass: settings.smtp_pass
            }
          });
          _smtpConfigKey = configKey;
        }

        const mailOptions = {
          from: settings.smtp_from || settings.smtp_user,
          to,
          subject,
          text
        };
        if (html) {
          mailOptions.html = html;
        }

        await _smtpTransporter.sendMail(mailOptions);
        console.log("[Mail] Sent to:", to, "| Subject:", subject);
        return true;
      } catch (err) {
        console.error("[Mail] Failed to send:", err);
        // Reset cached transporter on failure so next call rebuilds it
        _smtpTransporter = null;
        _smtpConfigKey = "";
        return false;
      }
    }

    // --- Dynamic Cron Job ---
    
    // Check every minute
    cron.schedule("* * * * *", async () => {
      const settings = await getSettings();
      const now = new Date();
      const currentDay = now.getDay(); // 0-6
      const currentHour = now.getHours().toString().padStart(2, "0");
      const currentMinute = now.getMinutes().toString().padStart(2, "0");
      const currentTime = `${currentHour}:${currentMinute}`;

      // Helper to check schedule
      const isScheduled = (conf) => {
        if (!conf || !conf.enabled) return false;
        if (conf.time !== currentTime) return false;
        if (conf.frequency === "daily") return true;
        if (conf.frequency === "weekly" && conf.dayOfWeek === currentDay) return true;
        if (conf.frequency === "monthly" && now.getDate() === 1) return true;
        return false;
      };

      // 1. Dev Reminder
      if (isScheduled(settings.notify_dev)) {
        console.log("[Cron] Running Dev Reminder...");
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        const start = new Date(now);
        // Look back 7 days mostly
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);

        const pending = await db.all(
          `SELECT * FROM requests WHERE status = ? AND created_at >= ?`,
          REQUEST_STATUS_PENDING, start.toISOString()
        );

        if (pending.length > 0) {
          const devs = await db.all("SELECT email FROM users WHERE role = ?", [ROLE_DEV]);
          if (devs.length > 0) {
            const devEmails = devs.map((d) => d.email).join(",");
            const subject = `[TLS Portal] Pending Requests Reminder`;
            const text = `Dear R&D Team,\n\nThere are ${pending.length} pending requests created recently. Please process them.\n\nLogin: ${process.env.APP_URL || "http://localhost:52344"}`;
            await sendMail(devEmails, subject, text);
          }
        }
      }

      // 2. Service Notification
      if (isScheduled(settings.notify_service)) {
        console.log("[Cron] Running Service Notification...");
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        const issued = await db.all(
          `SELECT * FROM requests WHERE status = ? AND issued_at >= ?`,
          REQUEST_STATUS_ISSUED, start.toISOString()
        );

        if (issued.length > 0) {
          const byUser = {};
          issued.forEach((req) => {
            if (!byUser[req.requester_email]) byUser[req.requester_email] = [];
            byUser[req.requester_email].push(req);
          });
          for (const [email, reqs] of Object.entries(byUser)) {
            const subject = `[TLS Portal] Your Certificates are Ready`;
            const list = reqs.map(r => `- ${r.customer_name} (${r.product_sku})`).join("\n");
            const text = `Hello,\n\nThe following certificates have been processed:\n\n${list}\n\nPlease login to download them: ${process.env.APP_URL || "http://localhost:52344"}`;
            await sendMail(email, subject, text);
          }
        }
      }

      // 3. Expiration Warning
      if (isScheduled(settings.notify_exp)) {
        console.log("[Cron] Running Expiration Warning...");
        await sendExpirationNotifications(settings);
      }
    });

    // 过期预警通知发送函数
    async function sendExpirationNotifications(settings) {
      if (!settings.key_personnel_emails) {
        console.log("[Exp Notify] No key personnel emails configured.");
        return;
      }

      const expDays = Number(settings.notify_exp_days) || 60;
      const now = new Date();
      const cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() + expDays);
      
      // 查询符合条件的证书：
      // 1. request.status = 'issued'
      // 2. request.request_type != 'delete'
      // 3. request 没有被撤回 (status != 'withdrawn')
      // 4. 使用 request_certificates 表的 expire_at 字段
      const expiringCerts = await db.all(
        `SELECT 
          r.id, r.customer_name, r.vid, r.product_sku, r.requester_email, r.requester_name,
          COALESCE(c.expire_at, datetime(c.created_at, '+730 days')) AS expire_at, c.original_filename
         FROM requests r
         JOIN request_certificates c ON c.request_id = r.id
         WHERE r.status = ? 
           AND r.request_type != 'delete'
           AND date(COALESCE(c.expire_at, datetime(c.created_at, '+730 days'))) <= date(?)
           AND (c.status IS NULL OR c.status != 'revoked')
         ORDER BY c.expire_at ASC`,
        [REQUEST_STATUS_ISSUED, cutoffDate.toISOString()]
      );

      if (expiringCerts.length === 0) {
        console.log("[Exp Notify] No expiring certificates found.");
        return;
      }

      console.log(`[Exp Notify] Found ${expiringCerts.length} expiring certificates.`);

      // 1. 发送汇总邮件给关键人员
      await sendKeyPersonnelNotification(settings.key_personnel_emails, expiringCerts, expDays);

      // 2. 按申请人分组，发送个体邮件
      const byApplicant = {};
      expiringCerts.forEach(cert => {
        if (cert.requester_email) {
          if (!byApplicant[cert.requester_email]) {
            byApplicant[cert.requester_email] = [];
          }
          byApplicant[cert.requester_email].push(cert);
        }
      });

      for (const [email, certs] of Object.entries(byApplicant)) {
        await sendApplicantNotification(email, certs, expDays);
      }
    }

    // 计算剩余天数
    function getRemainingDays(expireAt) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const expire = new Date(expireAt);
      expire.setHours(0, 0, 0, 0);
      const diffTime = expire - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    }

    // 获取天数颜色样式
    function getDaysStyle(days) {
      if (days <= 0) return 'color: #dc2626; font-weight: bold;'; // 已过期 - 红色加粗
      if (days <= 30) return 'color: #dc2626; font-weight: bold;'; // ≤30天 - 红色
      if (days <= 60) return 'color: #d97706; font-weight: 600;'; // 31-60天 - 黄色/橙色
      return 'color: #16a34a;'; // >60天 - 绿色
    }

    // 获取天数标签
    function getDaysLabel(days) {
      if (days < 0) return `已过期 ${Math.abs(days)} 天`;
      if (days === 0) return '今天过期';
      return `剩余 ${days} 天`;
    }

    // 格式化日期为 yyyy/mm/dd
    function formatDateCN(dateStr) {
      const d = new Date(dateStr);
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    // 生成证书表格 HTML
    function generateCertTable(certs, expDays) {
      const rows = certs.map(cert => {
        const days = getRemainingDays(cert.expire_at);
        const daysStyle = getDaysStyle(days);
        const daysLabel = getDaysLabel(days);
        
        return `
          <tr>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: left;">${cert.customer_name}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${cert.vid}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${cert.product_sku}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: left;">${cert.requester_name || '-'}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${formatDateCN(cert.expire_at)}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; ${daysStyle}">${daysLabel}</td>
          </tr>
        `;
      }).join('');

      return `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
          <thead>
            <tr style="background-color: #f8fafc;">
              <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: left; font-weight: 600;">客户名称</th>
              <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: 600;">VID</th>
              <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: 600;">产品</th>
              <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: left; font-weight: 600;">申请人</th>
              <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: 600;">过期时间</th>
              <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: 600;">剩余天数</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    }

    // 发送关键人员通知
    async function sendKeyPersonnelNotification(keyPersonnelEmails, certs, expDays) {
      const subject = `【TLS证书门户】证书过期预警通知 - ${certs.length} 条证书需要关注`;
      
      const expiredCount = certs.filter(c => getRemainingDays(c.expire_at) <= 0).length;
      const warningText = expiredCount > 0 
        ? `<p style="color: #dc2626; font-weight: bold;">⚠️ 警告：有 ${expiredCount} 条证书已过期，请立即处理！</p>` 
        : '';

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">证书过期预警通知</h2>
          <p style="color: #475569; font-size: 14px;">您好，系统中存在即将过期或已过期的证书，请及时处理。</p>
          ${warningText}
          <p style="color: #64748b; font-size: 13px; margin-top: 16px;">
            <strong>通知说明：</strong><br>
            • 本次通知阈值：${expDays} 天<br>
            • 证书总数：${certs.length} 条<br>
            • 查询时间：${formatDateCN(new Date())}
          </p>
          ${generateCertTable(certs, expDays)}
          <div style="margin-top: 24px; padding: 16px; background-color: #f8fafc; border-radius: 8px; font-size: 13px; color: #64748b;">
            <p style="margin: 0;"><strong>颜色说明：</strong></p>
            <p style="margin: 4px 0;"><span style="color: #dc2626;">■</span> 红色：已过期或剩余 ≤30 天（紧急）</p>
            <p style="margin: 4px 0;"><span style="color: #d97706;">■</span> 黄色：剩余 31-60 天（警告）</p>
            <p style="margin: 4px 0;"><span style="color: #16a34a;">■</span> 绿色：剩余 >60 天（正常）</p>
          </div>
          <p style="margin-top: 24px; font-size: 13px; color: #94a3b8;">
            此邮件由 TLS 证书门户系统自动发送，请勿回复。<br>
            如需查看证书详情，请登录系统：<a href="${process.env.APP_URL || 'http://localhost:52344'}" style="color: #2563eb;">${process.env.APP_URL || 'http://localhost:52344'}</a>
          </p>
        </div>
      `;

      const text = `证书过期预警通知\n\n系统中存在 ${certs.length} 条即将过期或已过期的证书，请及时处理。\n\n查询时间：${formatDateCN(new Date())}\n
${certs.map(c => {
        const days = getRemainingDays(c.expire_at);
        return `- ${c.customer_name} (VID: ${c.vid}) - 过期时间: ${formatDateCN(c.expire_at)} - ${getDaysLabel(days)}`;
      }).join('\n')}\n\n请登录系统查看详情。`;

      const ok = await sendMail(keyPersonnelEmails, subject, text, html);
      if (ok) {
        console.log(`[Exp Notify] Key personnel notification sent to: ${keyPersonnelEmails}`);
      } else {
        console.error(`[Exp Notify] Key personnel notification failed: ${keyPersonnelEmails}`);
      }
    }

    // 发送申请人通知
    async function sendApplicantNotification(email, certs, expDays) {
      const subject = `【TLS证书门户】您申请的证书即将过期 - ${certs.length} 条证书需要关注`;
      
      const expiredCount = certs.filter(c => getRemainingDays(c.expire_at) <= 0).length;
      const warningText = expiredCount > 0 
        ? `<p style="color: #dc2626; font-weight: bold;">⚠️ 警告：您有 ${expiredCount} 条证书已过期，请立即处理！</p>` 
        : '';

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">您申请的证书过期提醒</h2>
          <p style="color: #475569; font-size: 14px;">您好，您申请的以下证书即将过期或已过期，请及时处理。</p>
          ${warningText}
          <p style="color: #64748b; font-size: 13px; margin-top: 16px;">
            <strong>通知说明：</strong><br>
            • 本次通知阈值：${expDays} 天<br>
            • 涉及证书数：${certs.length} 条<br>
            • 查询时间：${formatDateCN(new Date())}
          </p>
          ${generateCertTable(certs, expDays)}
          <div style="margin-top: 24px; padding: 16px; background-color: #f8fafc; border-radius: 8px; font-size: 13px; color: #64748b;">
            <p style="margin: 0;"><strong>颜色说明：</strong></p>
            <p style="margin: 4px 0;"><span style="color: #dc2626;">■</span> 红色：已过期或剩余 ≤30 天（紧急）</p>
            <p style="margin: 4px 0;"><span style="color: #d97706;">■</span> 黄色：剩余 31-60 天（警告）</p>
            <p style="margin: 4px 0;"><span style="color: #16a34a;">■</span> 绿色：剩余 >60 天（正常）</p>
          </div>
          <p style="margin-top: 24px; font-size: 13px; color: #94a3b8;">
            此邮件由 TLS 证书门户系统自动发送，请勿回复。<br>
            如需查看证书详情，请登录系统：<a href="${process.env.APP_URL || 'http://localhost:52344'}" style="color: #2563eb;">${process.env.APP_URL || 'http://localhost:52344'}</a>
          </p>
        </div>
      `;

      const text = `您申请的证书过期提醒\n\n您有 ${certs.length} 条证书即将过期或已过期，请及时处理。\n\n查询时间：${formatDateCN(new Date())}\n
${certs.map(c => {
        const days = getRemainingDays(c.expire_at);
        return `- ${c.customer_name} (VID: ${c.vid}) - 过期时间: ${formatDateCN(c.expire_at)} - ${getDaysLabel(days)}`;
      }).join('\n')}\n\n请登录系统查看详情。`;

      const ok = await sendMail(email, subject, text, html);
      if (ok) {
        console.log(`[Exp Notify] Applicant notification sent to: ${email}`);
      } else {
        console.error(`[Exp Notify] Applicant notification failed: ${email}`);
      }
    }

    // --- Auth Middleware & Helpers ---

    function requireAuth(req, res, next) {
      if (!req.session.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return next();
    }

    function getRole(user) {
      if (!user) return null;
      if (user.role) return user.role;
      return user.isAdmin ? ROLE_ADMIN : ROLE_SERVICE;
    }

    function isAdminLikeRole(role) {
      const text = String(role || "").toLowerCase();
      return text === ROLE_ADMIN || text.endsWith("-admin") || text.includes("admin");
    }

    // requireAdmin 和 requireRole 现在由 RBAC 中间件提供
    // 原有实现已被注释，使用 createRBACMiddleware 返回的版本
    /*
    function requireAdmin(req, res, next) {
      if (!req.session.user || getRole(req.session.user) !== ROLE_ADMIN) {
        return res.status(403).json({ error: "Admin only" });
      }
      return next();
    }

    */
    // requireRole 现在也由 RBAC 中间件提供
    /*
    function requireRole(roles) {
      return (req, res, next) => {
        if (!req.session.user) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        const role = getRole(req.session.user);
        if (!roles.includes(role)) {
          return res.status(403).json({ error: "Forbidden" });
        }
        return next();
      };
    }
    */

    function isAllowedEmail(email) {
      return email.toLowerCase().endsWith("@shengwang.cn");
    }

    function generateVerificationCode() {
      return Math.floor(100000 + Math.random() * 900000).toString();
    }

    function nowIso() {
      return new Date().toISOString();
    }

    function expiresAt(minutes) {
      return new Date(Date.now() + minutes * 60 * 1000).toISOString();
    }

    // In Docker, NODE_ENV is often forced to "production" even for test env.
    // Use ENV_TYPE to control whether devCode is returned to the browser.
    // - ENV_TYPE=prod  => do NOT expose devCode
    // - ENV_TYPE=dev   => expose devCode
    // If ENV_TYPE is unset, fall back to NODE_ENV for backward compatibility.
    function shouldExposeDevCode() {
      const envType = String(process.env.ENV_TYPE || "").toLowerCase();
      if (envType) return envType !== "prod";
      return process.env.NODE_ENV !== "production";
    }

    // ============================================
    // Portal APIs - 门户相关接口
    // ============================================

    /**
     * 获取用户可访问的服务列表
     */
    app.get("/api/portal/services", requireAuth, async (req, res) => {
      try {
        const userId = req.session.user.id;
        const services = await rbacManager.getUserServices(userId);
        return res.json(services);
      } catch (err) {
        console.error("[Portal] Failed to get user services:", err);
        return res.status(500).json({ error: "Failed to load services" });
      }
    });

    /**
     * 获取用户在某个服务的权限和角色
     */
    app.get("/api/portal/services/:serviceId/permissions", requireAuth, async (req, res) => {
      try {
        const userId = req.session.user.id;
        const { serviceId } = req.params;
        
        const permissions = await rbacManager.getUserServicePermissions(userId, serviceId);
        const roles = await rbacManager.getUserServiceRoles(userId, serviceId);
        
        return res.json({ 
          permissions: permissions.map(p => ({
            code: p.code,
            name: p.name,
            action: p.action,
            resourceType: p.resource_type
          })),
          roles: roles.map(r => ({
            code: r.code,
            name: r.name,
            description: r.description
          }))
        });
      } catch (err) {
        console.error("[Portal] Failed to get user permissions:", err);
        return res.status(500).json({ error: "Failed to load permissions" });
      }
    });

    /**
     * 获取所有服务列表（管理员）
     */
    app.get("/api/portal/admin/services", requireAdmin, async (req, res) => {
      try {
        const services = await rbacManager.getAllServices(false);
        return res.json(services);
      } catch (err) {
        console.error("[Portal] Failed to get all services:", err);
        return res.status(500).json({ error: "Failed to load services" });
      }
    });

    /**
     * 获取服务的所有角色
     */
    app.get("/api/portal/services/:serviceId/roles", requireAdmin, async (req, res) => {
      try {
        const { serviceId } = req.params;
        const roles = await rbacManager.getServiceRoles(serviceId);
        return res.json(roles);
      } catch (err) {
        console.error("[Portal] Failed to get service roles:", err);
        return res.status(500).json({ error: "Failed to load roles" });
      }
    });

    /**
     * 授予用户角色
     */
    app.post("/api/portal/users/:userId/roles", requireAdmin, async (req, res) => {
      try {
        const userId = parseInt(req.params.userId);
        const { roleCode, expiresAt, reason } = req.body;
        const operatorId = req.session.user.id;
        
        if (!roleCode) {
          return res.status(400).json({ error: "Role code is required" });
        }
        
        const roleId = await rbacManager.getRoleIdByCode(roleCode);
        if (!roleId) {
          return res.status(404).json({ error: "Role not found" });
        }
        
        await rbacManager.grantRole(userId, roleId, operatorId, expiresAt, reason);
        return res.json({ ok: true });
      } catch (err) {
        console.error("[Portal] Failed to grant role:", err);
        return res.status(500).json({ error: "Failed to grant role" });
      }
    });

    /**
     * 撤销用户角色
     */
    app.delete("/api/portal/users/:userId/roles/:roleCode", requireAdmin, async (req, res) => {
      try {
        const userId = parseInt(req.params.userId);
        const { roleCode } = req.params;
        const { reason } = req.body;
        const operatorId = req.session.user.id;
        
        const roleId = await rbacManager.getRoleIdByCode(roleCode);
        if (!roleId) {
          return res.status(404).json({ error: "Role not found" });
        }
        
        await rbacManager.revokeRole(userId, roleId, operatorId, reason);
        return res.json({ ok: true });
      } catch (err) {
        console.error("[Portal] Failed to revoke role:", err);
        return res.status(500).json({ error: "Failed to revoke role" });
      }
    });

    /**
     * 获取用户权限变更历史
     */
    app.get("/api/portal/users/:userId/permission-history", requireAdmin, async (req, res) => {
      try {
        const userId = parseInt(req.params.userId);
        const limit = parseInt(req.query.limit) || 50;
        
        const history = await rbacManager.getUserPermissionHistory(userId, limit);
        return res.json(history);
      } catch (err) {
        console.error("[Portal] Failed to get permission history:", err);
        return res.status(500).json({ error: "Failed to load history" });
      }
    });

    // ============================================
    // RTC Deployment Service APIs
    // ============================================
    
    createRTCDeploymentRoutes(app, db, rbacManager, requirePermission, requireAuth);

    // --- Auth Routes ---

    app.post("/api/auth/send-code", async (req, res) => {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Missing email" });
      }
      if (!isAllowedEmail(email)) {
        return res.status(400).json({ error: "Email must be @shengwang.cn" });
      }

      const normalizedEmail = email.toLowerCase();
      const code = generateVerificationCode();
      const now = nowIso();
      const exp = expiresAt(verificationMinutes);

      await db.run("DELETE FROM email_verifications WHERE email = ?", [normalizedEmail]);
      await db.run(
        `INSERT INTO email_verifications (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)`,
        normalizedEmail, code, exp, now
      );

      const payload = { ok: true, expiresInMinutes: verificationMinutes };
      if (shouldExposeDevCode()) {
        payload.devCode = code;
      }
      console.log(`[verify] ${normalizedEmail} code: ${code} (exp: ${exp})`);

      // 发送验证码邮件
      const subject = `[TLS Portal] 您的注册验证码`;
      const text = `您好，\n\n您的注册验证码为：${code}\n该验证码在 ${verificationMinutes} 分钟内有效。\n\n如非本人操作，请忽略此邮件。`;
      await sendMail(normalizedEmail, subject, text);

      return res.json(payload);
    });

    app.post("/api/auth/send-reset-code", async (req, res) => {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Missing email" });
      }
      if (!isAllowedEmail(email)) {
        return res.status(400).json({ error: "Email must be @shengwang.cn" });
      }
      const normalizedEmail = email.toLowerCase();
      const user = await db.get("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const code = generateVerificationCode();
      const now = nowIso();
      const exp = expiresAt(verificationMinutes);

      await db.run("DELETE FROM password_resets WHERE email = ?", [normalizedEmail]);
      await db.run(
        `INSERT INTO password_resets (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)`,
        normalizedEmail, code, exp, now
      );

      const payload = { ok: true, expiresInMinutes: verificationMinutes };
      if (shouldExposeDevCode()) {
        payload.devCode = code;
      }
      console.log(`[reset] ${normalizedEmail} code: ${code} (exp: ${exp})`);

      // 发送验证码邮件
      const subject = `[TLS Portal] 您的密码重置验证码`;
      const text = `您好，\n\n您正在申请重置密码，验证码为：${code}\n该验证码在 ${verificationMinutes} 分钟内有效。\n\n如非本人操作，请忽略此邮件。`;
      await sendMail(normalizedEmail, subject, text);

      return res.json(payload);
    });

    app.post("/api/auth/reset-password", async (req, res) => {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const normalizedEmail = email.toLowerCase();
      const reset = await db.get("SELECT * FROM password_resets WHERE email = ?", [normalizedEmail]);
      if (!reset || reset.code !== code) {
        return res.status(400).json({ error: "Invalid verification code" });
      }
      if (new Date(reset.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: "Verification code expired" });
      }
      const hash = await bcrypt.hash(String(newPassword), 10);
      await db.run("UPDATE users SET password_hash = ? WHERE email = ?", [hash, normalizedEmail]);
      await db.run("DELETE FROM password_resets WHERE email = ?", [normalizedEmail]);
      return res.json({ ok: true });
    });

    app.post("/api/auth/register", async (req, res) => {
      const { name, email, password, code } = req.body;
      if (!name || !email || !code) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!isAllowedEmail(email)) {
        return res.status(400).json({ error: "Email must be @shengwang.cn" });
      }

      const normalizedEmail = email.toLowerCase();
      const existingEmail = await db.get("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
      if (existingEmail) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const existingName = await db.get("SELECT id FROM users WHERE name = ?", [name]);
      if (existingName) {
        return res.status(400).json({ error: "Name already registered" });
      }

      const verification = await db.get(
        "SELECT * FROM email_verifications WHERE email = ?",
        [normalizedEmail]
      );
      if (!verification || verification.code !== code) {
        return res.status(400).json({ error: "Invalid verification code" });
      }
      if (new Date(verification.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: "Verification code expired" });
      }

      const isAdmin =
        normalizedEmail === (adminEmail || defaultAdminEmail) ||
        normalizedEmail === defaultAdminEmail
          ? 1
          : 0;
      const initialPassword = (password && String(password).trim()) || "123456";
      const finalPassword = isAdmin ? initialPassword : "123456";
      const hash = await bcrypt.hash(finalPassword, 10);
      const now = nowIso();
      const role = isAdmin ? ROLE_ADMIN : ROLE_SERVICE;

      const result = await db.run(
        `INSERT INTO users (email, name, password_hash, is_admin, role, email_verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        normalizedEmail, name, hash, isAdmin, role, 1, now
      );

      await db.run("DELETE FROM email_verifications WHERE email = ?", [email.toLowerCase()]);

      req.session.user = {
        id: result.lastID,
        email: normalizedEmail,
        name,
        role,
        isAdmin: !!isAdmin,
        emailVerified: true
      };

      return res.json({ ok: true });
    });

    app.post("/api/auth/login", async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const user = await db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
      if (!user) {
        return res.status(400).json({ error: "Invalid credentials" });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(400).json({ error: "Invalid credentials" });
      }
      if (!user.email_verified) {
        return res.status(400).json({ error: "Email not verified" });
      }
      const role = user.role || (user.is_admin ? ROLE_ADMIN : ROLE_SERVICE);
      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role,
        isAdmin: role === ROLE_ADMIN,
        emailVerified: !!user.email_verified
      };
      return res.json({ ok: true });
    });

    app.post("/api/auth/logout", (req, res) => {
      req.session.destroy(() => {
        res.json({ ok: true });
      });
    });

    app.post("/api/account/change-password", requireAuth, async (req, res) => {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const user = await db.get("SELECT * FROM users WHERE id = ?", [req.session.user.id]);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const valid = await bcrypt.compare(String(currentPassword), user.password_hash);
      if (!valid) {
        return res.status(400).json({ error: "Invalid current password" });
      }
      const hash = await bcrypt.hash(String(newPassword), 10);
      await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user.id]);
      return res.json({ ok: true });
    });

    app.get("/api/me", requireAuth, (req, res) => {
      const role = getRole(req.session.user);
      return res.json({ ...req.session.user, role, isAdmin: role === ROLE_ADMIN });
    });

    // --- Admin Settings Routes ---

    app.get("/api/admin/settings", requireAdmin, async (req, res) => {
      const settings = await getSettings();
      // settings.smtp_pass = settings.smtp_pass ? "******" : "";
      return res.json(settings);
    });

    app.post("/api/admin/settings", requireAdmin, async (req, res) => {
      const {
        smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from,
        key_personnel_emails, notify_exp_days,
        notify_dev, notify_service, notify_exp
      } = req.body;

      await saveSetting("smtp_host", smtp_host);
      await saveSetting("smtp_port", smtp_port);
      await saveSetting("smtp_user", smtp_user);
      if (smtp_pass && smtp_pass !== "******") {
        await saveSetting("smtp_pass", smtp_pass);
      }
      await saveSetting("smtp_secure", smtp_secure);
      await saveSetting("smtp_from", smtp_from);
      await saveSetting("key_personnel_emails", key_personnel_emails);
      await saveSetting("notify_exp_days", notify_exp_days);
      
      // Save full objects for notifications
      await saveSetting("notify_dev", notify_dev);
      await saveSetting("notify_service", notify_service);
      await saveSetting("notify_exp", notify_exp);

      return res.json({ ok: true });
    });

    // --- Admin User Routes ---

    app.get("/api/admin/users", requireAdmin, async (req, res) => {
      const rows = await db.all(
        `SELECT id, email, name, is_admin, role, email_verified, created_at FROM users ORDER BY created_at DESC`
      );
      return res.json(rows);
    });

    app.post("/api/admin/users/:id/role", requireAdmin, async (req, res) => {
      const { role } = req.body;
      if (![ROLE_ADMIN, ROLE_DEV, ROLE_SERVICE, ROLE_PRODUCT].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      const target = await db.get("SELECT id, role, is_admin FROM users WHERE id = ?", [req.params.id]);
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }
      if (target.role === ROLE_ADMIN && role !== ROLE_ADMIN) {
        const adminCountRow = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin' OR is_admin = 1");
        if ((adminCountRow ? adminCountRow.count : 0) <= 1) {
          return res.status(400).json({ error: "At least one admin required" });
        }
      }
      const isAdmin = role === ROLE_ADMIN ? 1 : 0;
      await db.run("UPDATE users SET role = ?, is_admin = ? WHERE id = ?", [role, isAdmin, target.id]);
      return res.json({ ok: true, role });
    });

    app.post("/api/admin/users/:id/verify", requireAdmin, async (req, res) => {
      const target = await db.get("SELECT id FROM users WHERE id = ?", [req.params.id]);
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }
      await db.run("UPDATE users SET email_verified = 1 WHERE id = ?", [target.id]);
      return res.json({ ok: true });
    });

    app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
      const target = await db.get("SELECT id FROM users WHERE id = ?", [req.params.id]);
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }
      const newPassword = String(req.body?.newPassword || "123456").trim();
      if (!newPassword) {
        return res.status(400).json({ error: "New password is required" });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, target.id]);
      return res.json({ ok: true });
    });

    app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
      const target = await db.get("SELECT id, email FROM users WHERE id = ?", [req.params.id]);
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { name, email, role, password } = req.body;
      const updates = [];
      const params = [];
      
      // 验证并更新姓名
      if (name !== undefined) {
        if (!name.trim()) {
          return res.status(400).json({ error: "Name cannot be empty" });
        }
        updates.push("name = ?");
        params.push(name.trim());
      }
      
      // 验证并更新邮箱
      if (email !== undefined) {
        const trimmedEmail = email.trim();
        if (!trimmedEmail.endsWith("@shengwang.cn") && !trimmedEmail.endsWith("@agora.io")) {
          return res.status(400).json({ error: "Email must be @shengwang.cn or @agora.io" });
        }
        // 检查邮箱是否已被其他用户使用
        const existing = await db.get("SELECT id FROM users WHERE email = ? AND id != ?", [trimmedEmail, req.params.id]);
        if (existing) {
          return res.status(400).json({ error: "Email already in use by another user" });
        }
        updates.push("email = ?");
        params.push(trimmedEmail);
      }
      
      // 验证并更新角色
      if (role !== undefined) {
        if (![ROLE_ADMIN, ROLE_DEV, ROLE_SERVICE, ROLE_PRODUCT].includes(role)) {
          return res.status(400).json({ error: "Invalid role" });
        }
        updates.push("role = ?");
        params.push(role);
        // 同步更新 is_admin 字段
        updates.push("is_admin = ?");
        params.push(role === ROLE_ADMIN ? 1 : 0);
      }
      
      // 更新密码（如提供）
      if (password) {
        const newHash = await bcrypt.hash(password, 10);
        updates.push("password_hash = ?");
        params.push(newHash);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      
      params.push(req.params.id);
      const sql = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
      await db.run(sql, params);
      
      return res.json({ ok: true });
    });

    app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
      const target = await db.get("SELECT id, email, role, is_admin FROM users WHERE id = ?", [req.params.id]);
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }
      if (target.id === req.session.user.id) {
        return res.status(400).json({ error: "Cannot delete current admin account" });
      }
      const isTargetAdmin = target.role === ROLE_ADMIN || target.is_admin === 1;
      if (isTargetAdmin) {
        const adminCountRow = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin' OR is_admin = 1");
        if ((adminCountRow ? adminCountRow.count : 0) <= 1) {
          return res.status(400).json({ error: "At least one admin required" });
        }
      }

      await db.run("BEGIN");
      try {
        await db.run(
          `DELETE FROM request_certificates WHERE request_id IN (SELECT id FROM requests WHERE requester_email = ?)`,
          [target.email]
        );
        await db.run("DELETE FROM requests WHERE requester_email = ?", [target.email]);
        await db.run("DELETE FROM email_verifications WHERE email = ?", [target.email]);
        await db.run("DELETE FROM password_resets WHERE email = ?", [target.email]);
        await db.run("DELETE FROM users WHERE id = ?", [target.id]);
        await db.run("COMMIT");
      } catch (err) {
        await db.run("ROLLBACK");
        throw err;
      }
      return res.json({ ok: true });
    });

    // ============================================
    // TLS Service API Namespace (新API路由)
    // ============================================
    // 注意：为了向后兼容，我们暂时保持旧路由不变
    // 新的 /api/tls/* 路由将在后续版本中逐步添加
    // 当前版本使用路由重定向实现兼容

    // --- Request Routes ---

    async function fetchRequestsWithActiveCert(
      whereClause,
      params,
      limitOffset = "",
      orderByClause = "ORDER BY datetime(r.created_at) DESC, r.id DESC"
    ) {
      // ORDER BY 必须在 LIMIT/OFFSET 之前
      return db.all(
        `
          SELECT
            r.*,
            c.id AS cert_id,
            c.status AS cert_status,
            c.file_rel_path AS cert_file_rel_path,
            c.original_filename AS cert_original_filename,
            c.zip_password AS cert_zip_password,
            c.created_at AS cert_created_at,
            c.expire_at AS cert_expire_at,
            c.revoked_at AS cert_revoked_at,
            c.created_by_email AS cert_created_by_email
          FROM requests r
          LEFT JOIN request_certificates c
            ON c.id = (
              SELECT id
              FROM request_certificates
              WHERE request_id = r.id AND status = '${CERT_STATUS_ACTIVE}'
              ORDER BY datetime(created_at) DESC, id DESC
              LIMIT 1
            )
          ${whereClause}
          ${orderByClause}
          ${limitOffset}
        `,
        params
      );
    }

    app.post(
      "/api/requests",
      requireRole([ROLE_ADMIN, ROLE_SERVICE, ROLE_PRODUCT]),
      async (req, res) => {
        const { customerName, productSku, vid, requesterName, requestType, sourceRequestId } = req.body;
        if (!customerName || !productSku || !vid) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        const finalRequesterName = requesterName || req.session.user.name;
        if (!finalRequesterName) {
          return res.status(400).json({ error: "Missing requester name" });
        }
        const finalRequestType = requestType || "new";
        const finalSourceRequestId = sourceRequestId ? Number(sourceRequestId) : null;
        const now = nowIso();

        if (finalRequestType === "delete" && Number.isInteger(finalSourceRequestId)) {
          const target = await db.get("SELECT * FROM requests WHERE id = ?", [finalSourceRequestId]);
          if (!target) {
            return res.status(400).json({ error: "Target request not found" });
          }
          const targetRequesterEmpty = !(target.requester_email || "").trim();
          const submitterIsPrivileged = isAdminLikeRole(getRole(req.session.user));
          if (!targetRequesterEmpty || !submitterIsPrivileged) {
            // 普通用户只能删除自己的；管理员只能对空申请人记录跳过校验
            if (target.requester_email !== req.session.user.email) {
              return res.status(403).json({ error: "Forbidden target request scope" });
            }
          }
          if (target.status !== REQUEST_STATUS_ISSUED) {
            return res.status(400).json({ error: "Target request is not in issued status" });
          }
        }

        // 同 VID 新申请触发：将旧已签发证书请求置为“已更新”
        await db.run(
          `UPDATE requests
           SET status = ?
           WHERE vid = ?
             AND status = ?
             AND request_type != 'delete'`,
          REQUEST_STATUS_UPDATED,
          vid,
          REQUEST_STATUS_ISSUED
        );

        const result = await db.run(
          `INSERT INTO requests
            (customer_name, product_sku, vid, requester_name, requester_email, status, request_type, source_request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          customerName, productSku, vid, finalRequesterName, req.session.user.email,
          REQUEST_STATUS_PENDING, finalRequestType, Number.isInteger(finalSourceRequestId) ? finalSourceRequestId : null, now
        );

        // Respond immediately; notify devs in background (non-blocking)
        res.json({ id: result.lastID });

        db.all("SELECT email FROM users WHERE role = ?", [ROLE_DEV]).then((devs) => {
          if (devs && devs.length > 0) {
            const devEmails = devs.map((d) => d.email).join(",");
            const subject = `[TLS Portal] 证书申请新通知 - VID: ${vid}`;
            const text = `研发团队您好：\n\n系统收到了一份新的证书申请。\n申请人：${finalRequesterName} (${req.session.user.email})\nVID：${vid}\n\n请尽快登录系统进行审核与签发操作：\n${process.env.APP_URL || "http://localhost:52344"}`;
            sendMail(devEmails, subject, text).catch((mailErr) => {
              console.error("[Mail] Failed to notify devs for new request:", mailErr);
            });
          }
        }).catch((dbErr) => {
          console.error("[Mail] Failed to query devs for notification:", dbErr);
        });
        return;
      }
    );

    app.get("/api/requests", requireAuth, async (req, res) => {
      const { email, status } = req.query;
      const clauses = [];
      const params = [];
      const role = getRole(req.session.user);

      // 所有角色（包括管理员）默认只能看到自己相关的数据
      if (role === ROLE_ADMIN || role === ROLE_DEV) {
        if (role === ROLE_DEV) {
          clauses.push("r.status != ?");
          params.push(REQUEST_STATUS_WITHDRAWN);
        }
        // 收口：不允许通过 email 参数绕过可见范围
        if (email && email !== req.session.user.email) {
          return res.status(403).json({ error: "Forbidden: email filter out of scope" });
        }
        // 默认只查询与自己相关的数据（自己提交的或自己签发的）
        clauses.push("(r.requester_email = ? OR c.created_by_email = ?)");
        params.push(req.session.user.email, req.session.user.email);
        if (status) {
          clauses.push("r.status = ?");
          params.push(status);
        } else {
          clauses.push("r.status != ?");
          params.push(REQUEST_STATUS_UPDATED);
        }
      } else {
        // 其他角色只能看到自己的申请
        clauses.push("r.requester_email = ?");
        params.push(req.session.user.email);
        if (status) {
          clauses.push("r.status = ?");
          params.push(status);
        } else {
          clauses.push("r.status != ?");
          params.push(REQUEST_STATUS_UPDATED);
        }
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await fetchRequestsWithActiveCert(where, params);
      return res.json(rows);
    });

    app.get(
      "/api/my-certificates",
      requireRole([ROLE_ADMIN, ROLE_DEV, ROLE_SERVICE, ROLE_PRODUCT]),
      async (req, res) => {
        const role = getRole(req.session.user);
        const isAdminScope = isAdminLikeRole(role);
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
        const offset = (page - 1) * pageSize;
        const q = (req.query.q || "").trim();
        const status = (req.query.status || "issued").trim();
        const requestType = (req.query.requestType || "").trim();
        const expiringWithin = Number(req.query.expiringWithin) || 0;

        const baseClauses = [
          "c.id IS NOT NULL"
        ];
        const baseParams = [];

        if (!isAdminScope) {
          baseClauses.push("r.requester_email = ?");
          baseParams.push(req.session.user.email);
        }

        const clauses = [...baseClauses];
        const params = [...baseParams];

        if (status && status !== "all") {
          const statuses = String(status).split(",").map((s) => s.trim()).filter(Boolean);
          if (statuses.length) {
            clauses.push(`r.status IN (${statuses.map(() => "?").join(", ")})`);
            params.push(...statuses);
          }
        }

        if (requestType && requestType !== "all") {
          clauses.push("r.request_type = ?");
          params.push(requestType);
        }

        if (q) {
          clauses.push("(r.customer_name LIKE ? OR r.product_sku LIKE ? OR r.vid LIKE ? OR r.requester_name LIKE ? OR r.requester_email LIKE ?)");
          const like = `%${q}%`;
          params.push(like, like, like, like, like);
        }

        if (expiringWithin > 0) {
          clauses.push(
            `COALESCE(c.expire_at, datetime(c.created_at, '+730 days')) <= datetime('now', '+${expiringWithin} days')` +
            ` AND COALESCE(c.expire_at, datetime(c.created_at, '+730 days')) >= datetime('now')`
          );
        }

        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const whereForScopeTotal = baseClauses.length ? `WHERE ${baseClauses.join(" AND ")}` : "";
        const certJoinSql = `
          FROM requests r
          LEFT JOIN request_certificates c
            ON c.id = (
              SELECT id
              FROM request_certificates
              WHERE request_id = r.id AND status = '${CERT_STATUS_ACTIVE}'
              ORDER BY datetime(created_at) DESC, id DESC
              LIMIT 1
            )
        `;

        const countRow = await db.get(
          `SELECT COUNT(*) as count ${certJoinSql} ${where}`,
          params
        );
        const scopeTotalRow = await db.get(
          `SELECT COUNT(*) as count ${certJoinSql} ${whereForScopeTotal}`,
          baseParams
        );

        const rows = await fetchRequestsWithActiveCert(
          where,
          [...params, pageSize, offset],
          " LIMIT ? OFFSET ?",
          "ORDER BY datetime(r.issued_at) DESC, r.id DESC"
        );

        return res.json({
          items: rows,
          total: countRow ? countRow.count : 0,
          scopeTotal: scopeTotalRow ? scopeTotalRow.count : 0,
          page,
          pageSize,
          isAdminScope
        });
      }
    );

    app.post("/api/requests/:id/withdraw", requireAuth, async (req, res) => {
      const row = await db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "Request not found" });
      if (row.requester_email !== req.session.user.email) return res.status(403).json({ error: "Forbidden" });
      if (row.status !== REQUEST_STATUS_PENDING) return res.status(400).json({ error: "Not pending" });
      
      await db.run("UPDATE requests SET status = ? WHERE id = ?", [REQUEST_STATUS_WITHDRAWN, row.id]);
      return res.json({ ok: true });
    });

    app.get("/api/requests/:id", requireAuth, async (req, res) => {
      const row = await db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "Request not found" });
      const role = getRole(req.session.user);
      if (role !== ROLE_ADMIN && role !== ROLE_DEV && row.requester_email !== req.session.user.email) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.json(row);
    });

    app.post(
      "/api/requests/:id/issue",
      requireRole([ROLE_ADMIN, ROLE_DEV]),
      upload.single("zipFile"),
      async (req, res) => {
        const { zipPassword } = req.body;
        if (!req.file || !zipPassword) return res.status(400).json({ error: "Missing file/password" });
        const row = await db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
        if (!row) return res.status(404).json({ error: "Request not found" });

        const now = nowIso();
        const expireAt = new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString();
        // Revoke old active
        await db.run(
          `UPDATE request_certificates SET status = ?, revoked_at = ?, revoked_by_email = ? WHERE request_id = ? AND status = ?`,
          CERT_STATUS_REVOKED, now, req.session.user.email, req.params.id, CERT_STATUS_ACTIVE
        );

        const relPath = path.relative(uploadsDir, req.file.path);
        const originalFilename = path.basename(req.file.originalname || req.file.filename);

        await db.run(
          `INSERT INTO request_certificates (request_id, status, file_rel_path, original_filename, zip_password, created_at, created_by_email, expire_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          req.params.id, CERT_STATUS_ACTIVE, relPath, originalFilename, zipPassword, now, req.session.user.email, expireAt
        );

        await db.run("UPDATE requests SET status = ?, issued_at = ? WHERE id = ?", [REQUEST_STATUS_ISSUED, now, req.params.id]);

        // Respond immediately; send notification in background (non-blocking)
        res.json({ ok: true });

        if (row.requester_email) {
          const subject = `[TLS Portal] 证书已签发 - VID: ${row.vid}`;
          const text = `您好，${row.requester_name}：\n\n您申请的证书（VID: ${row.vid}）已经由研发团队完成签发并上传。\n\n出于安全考虑，证书文件与解压密码不在邮件中发送，请登录系统获取：\n${process.env.APP_URL || "http://localhost:52344"}`;
          sendMail(row.requester_email, subject, text).catch((mailErr) => {
            console.error("[Mail] Failed to notify applicant for issued certificate:", mailErr);
          });
        }
        return;
      }
    );

    app.post(
      "/api/requests/:id/revoke",
      requireRole([ROLE_ADMIN, ROLE_DEV]),
      async (req, res) => {
        const row = await db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
        if (!row) return res.status(404).json({ error: "Request not found" });
        
        const active = await db.get(
          `SELECT * FROM request_certificates WHERE request_id = ? AND status = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
          [req.params.id, CERT_STATUS_ACTIVE]
        );
        if (!active) return res.status(400).json({ error: "No active certificate" });

        // 后端强校验：证书签发超过7天不允许撤销（避免仅前端限制被绕过）
        const role = getRole(req.session.user);
        const issuedAtValue = active.created_at || row.issued_at;
        const issuedAt = issuedAtValue ? new Date(issuedAtValue).getTime() : NaN;
        const requesterName = (row.requester_name || "").trim();
        const requesterEmail = (row.requester_email || "").trim();
        const isPrivilegedNoRequesterBypass =
          (isAdminLikeRole(role) || role === ROLE_DEV) && (!requesterName || !requesterEmail);
        if (!Number.isNaN(issuedAt)) {
          const nowMs = Date.now();
          const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
          if (!isPrivilegedNoRequesterBypass && nowMs - issuedAt > sevenDaysMs) {
            return res.status(400).json({ error: "证书签发超过7天，不允许撤销" });
          }
        }

        const now = nowIso();
        await db.run(
          `UPDATE request_certificates SET status = ?, revoked_at = ?, revoked_by_email = ? WHERE id = ?`,
          CERT_STATUS_REVOKED, now, req.session.user.email, active.id
        );
        await db.run("UPDATE requests SET status = ? WHERE id = ?", [REQUEST_STATUS_REVOKED, req.params.id]);
        return res.json({ ok: true });
      }
    );

    app.post(
      "/api/requests/:id/process-delete",
      requireRole([ROLE_ADMIN, ROLE_DEV]),
      async (req, res) => {
        const row = await db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
        if (!row) return res.status(404).json({ error: "Request not found" });
        if (row.status !== REQUEST_STATUS_PENDING) {
          return res.status(400).json({ error: "Only pending delete request can be processed" });
        }
        if (row.request_type !== "delete") {
          return res.status(400).json({ error: "Request type is not delete" });
        }

        let targetRequestId = Number(row.source_request_id);
        let targetRequest = Number.isInteger(targetRequestId)
          ? await db.get("SELECT * FROM requests WHERE id = ?", [targetRequestId])
          : null;

        // 兼容历史删除申请（没有 source_request_id）：
        // 如果同一申请人 + 同一VID 仅存在唯一已签发目标，则自动补齐目标，避免老单无法处理。
        if (!targetRequest) {
          const candidates = await db.all(
            `SELECT *
             FROM requests
             WHERE requester_email = ?
               AND vid = ?
               AND status = ?
               AND request_type != 'delete'
             ORDER BY datetime(issued_at) DESC, id DESC`,
            [row.requester_email, row.vid, REQUEST_STATUS_ISSUED]
          );
          if (candidates.length === 1) {
            targetRequest = candidates[0];
            targetRequestId = targetRequest.id;
          } else if (candidates.length === 0) {
            return res.status(400).json({ error: "Target request not found" });
          } else {
            return res.status(400).json({ error: "Multiple target requests found, please resubmit delete from My Certificates" });
          }
        }
        if (targetRequest.vid !== row.vid) {
          return res.status(400).json({ error: "Target request vid mismatch" });
        }

        // 仅撤销目标申请对应的活跃证书（不影响同VID其他申请）
        // 这样删除/注销只作用于被指定的证书申请
        // NOTE: 旧的无目标ID删除申请将被拦截，避免误伤其他记录。
        // 同时将目标申请状态流转为已撤销。
        
        const now = nowIso();
        // 撤销目标申请上的活跃证书
        try {
          await db.run("BEGIN");
          await db.run(
            `UPDATE request_certificates
             SET status = ?, revoked_at = ?, revoked_by_email = ?
             WHERE request_id = ? AND status = ?`,
            CERT_STATUS_REVOKED,
            now,
            req.session.user.email,
            targetRequestId,
            CERT_STATUS_ACTIVE
          );

          // 仅更新目标申请状态，不再批量更新同VID记录
          await db.run(
            `UPDATE requests
             SET status = ?
             WHERE id = ? AND status = ?`,
            REQUEST_STATUS_REVOKED,
            targetRequestId,
            REQUEST_STATUS_ISSUED
          );

          // 删除申请单流转为已完成
          await db.run(
            "UPDATE requests SET status = ?, issued_at = ? WHERE id = ?",
            [REQUEST_STATUS_ISSUED, now, row.id]
          );
          await db.run("COMMIT");
        } catch (err) {
          await db.run("ROLLBACK");
          throw err;
        }
        return res.json({ ok: true });
      }
    );

    app.get("/api/requests/:id/download", async (req, res) => {
      if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
      const row = await db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "Request not found" });
      const role = getRole(req.session.user);
      if (role !== ROLE_ADMIN && role !== ROLE_DEV && row.requester_email !== req.session.user.email) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const cert = await db.get(
        `SELECT * FROM request_certificates WHERE request_id = ? AND status = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
        [req.params.id, CERT_STATUS_ACTIVE]
      );
      if (!cert) return res.status(400).json({ error: "Certificate not issued" });
      const fullPath = path.join(uploadsDir, cert.file_rel_path);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File missing" });
      return res.download(fullPath, cert.original_filename);
    });

    // --- Overview Routes ---

    function buildOverviewQuery(req) {
      const { status, q, start, end } = req.query;
      const expiring = req.query.expiring === "1" || req.query.expiring === "true";
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
      const offset = (page - 1) * pageSize;
      const clauses = [];
      const params = [];

      let finalStatus = status;
      if (!finalStatus) finalStatus = REQUEST_STATUS_ISSUED;
      if (expiring && !finalStatus) finalStatus = "issued";
      if (finalStatus) {
        const statuses = String(finalStatus).split(",").map(s => s.trim()).filter(Boolean);
        if (statuses.length) {
          clauses.push(`r.status IN (${statuses.map(() => "?").join(", ")})`);
          params.push(...statuses);
        }
      }
      if (q) {
        clauses.push("(r.customer_name LIKE ? OR r.product_sku LIKE ? OR r.vid LIKE ? OR r.requester_name LIKE ? OR r.requester_email LIKE ?)");
        const like = `%${q}%`;
        params.push(like, like, like, like, like);
      }
      if (start) {
        clauses.push("date(r.issued_at) >= date(?)");
        params.push(start);
      }
      if (end) {
        clauses.push("date(r.issued_at) <= date(?)");
        params.push(end);
      }
      if (expiring) {
        const nowIso = new Date().toISOString();
        const cutoffIso = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
        clauses.push("r.issued_at IS NOT NULL AND datetime(r.issued_at, '+730 days') <= ? AND datetime(r.issued_at, '+730 days') >= ?");
        params.push(cutoffIso, nowIso);
      }
      return { clauses, params, page, pageSize, offset };
    }

    function getOverviewOrderByClause() {
      // 证书总览默认按过期时间升序；无过期时间的数据排在最后。
      return `ORDER BY
        CASE WHEN c.expire_at IS NULL THEN 1 ELSE 0 END ASC,
        datetime(c.expire_at) ASC,
        datetime(r.created_at) DESC,
        r.id DESC`;
    }

    app.get("/api/overview", requireRole([ROLE_ADMIN, ROLE_DEV, ROLE_PRODUCT]), async (req, res) => {
      const { clauses, params, page, pageSize, offset } = buildOverviewQuery(req);
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const orderByClause = getOverviewOrderByClause();

      // Use fetchRequestsWithActiveCert for consistent data with certificate info
      const countQuery = `SELECT COUNT(*) as count FROM requests r ${where}`;
      const countRow = await db.get(countQuery, params);

      // Get paginated rows with certificate info (LIMIT/OFFSET 必须在 ORDER BY 之后)
      const rows = await fetchRequestsWithActiveCert(
        where,
        [...params, pageSize, offset],
        " LIMIT ? OFFSET ?",
        orderByClause
      );

      return res.json({ items: rows, total: countRow ? countRow.count : 0, page, pageSize });
    });

    app.get("/api/overview/export", requireRole([ROLE_ADMIN, ROLE_DEV, ROLE_PRODUCT]), async (req, res) => {
      const { clauses, params } = buildOverviewQuery(req);
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const orderByClause = getOverviewOrderByClause();
      // Use fetchRequestsWithActiveCert for consistent data with certificate info
      const rows = await fetchRequestsWithActiveCert(where, params, "", orderByClause);
      
      const escapeCsv = (value) => {
        if (value === null || value === undefined) return "";
        const str = String(value);
        if (/[",\n]/.test(str)) return `"${str.replace(/"/g, "\"\"")}"`;
        return str;
      };
      
      const headers = ["customer_name", "product_sku", "vid", "requester_name", "requester_email", "status", "request_type", "created_at", "issued_at", "zip_password"];
      const lines = [headers.join(",")];
      rows.forEach(row => {
        lines.push(headers.map(key => escapeCsv(row[key])).join(","));
      });
      
      const filename = `overview-${Date.now()}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(lines.join("\n"));
    });

    // --- Page Routes ---

    app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "login.html")));
    app.get("/register", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "register.html")));
    app.get("/forgot", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "forgot.html")));
    app.get("/account", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "account.html"));
    });
    app.get("/admin", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      const role = getRole(req.session.user);
      if (role === ROLE_SERVICE) return res.redirect("/");
      if (role !== ROLE_ADMIN && role !== ROLE_DEV) return res.status(403).send("Forbidden");
      res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
    });
    app.get("/users", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      const role = getRole(req.session.user);
      if (role !== ROLE_ADMIN) return res.status(403).send("Admin only");
      res.sendFile(path.join(__dirname, "..", "public", "users.html"));
    });
    app.get("/overview", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      const role = getRole(req.session.user);
      if (role === ROLE_SERVICE) return res.redirect("/");
      if (role !== ROLE_ADMIN && role !== ROLE_DEV && role !== ROLE_PRODUCT) return res.status(403).send("Forbidden");
      res.sendFile(path.join(__dirname, "..", "public", "overview.html"));
    });
    app.get("/settings", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      const role = getRole(req.session.user);
      if (role !== ROLE_ADMIN) return res.status(403).send("Admin only");
      res.sendFile(path.join(__dirname, "..", "public", "settings.html"));
    });
    // Portal Home - 必须在 / 路由之前定义
    app.get("/portal", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "portal-home.html"));
    });

    // RTC Deployment Service Pages（同时匹配有无trailing slash）
    app.get(["/rtc-deployment", "/rtc-deployment/"], (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "rtc-deployment", "projects.html"));
    });
    app.get("/rtc-deployment/create", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "rtc-deployment", "create.html"));
    });
    app.get("/rtc-deployment/calculator", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "rtc-deployment", "calculator.html"));
    });
    app.get("/rtc-deployment/architect", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "rtc-deployment", "architect.html"));
    });
    app.get("/rtc-deployment/detail", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      res.sendFile(path.join(__dirname, "..", "public", "rtc-deployment", "detail.html"));
    });

    app.get("/", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      
      // 默认重定向到门户首页
      return res.redirect("/portal");
    });

    // TLS服务路由（保持向后兼容）
    app.get("/tls", (req, res) => {
      if (!req.session.user) return res.redirect("/login");
      const role = getRole(req.session.user);
      if (role === ROLE_DEV) return res.redirect("/admin");
      res.sendFile(path.join(__dirname, "..", "public", "index.html"));
    });

    app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
