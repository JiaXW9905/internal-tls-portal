const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { RBACManager } = require("./rbac-manager");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "app.db");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

async function initDb() {
  ensureDataDir();
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'service',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      product_sku TEXT NOT NULL,
      vid TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      status TEXT NOT NULL,
      zip_path TEXT,
      zip_password TEXT,
      created_at TEXT NOT NULL,
      issued_at TEXT
    );

    CREATE TABLE IF NOT EXISTS request_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      file_rel_path TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      zip_password TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      expire_at TEXT,
      revoked_at TEXT,
      revoked_by_email TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_request_certificates_request_id ON request_certificates(request_id);
    CREATE INDEX IF NOT EXISTS idx_request_certificates_request_status ON request_certificates(request_id, status);

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const requestColumns = await db.all("PRAGMA table_info(requests)");
  const hasRequestType = requestColumns.some((col) => col.name === "request_type");
  if (!hasRequestType) {
    await db.exec(
      "ALTER TABLE requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'new'"
    );
  }

  const hasSourceRequestId = requestColumns.some((col) => col.name === "source_request_id");
  if (!hasSourceRequestId) {
    await db.exec(
      "ALTER TABLE requests ADD COLUMN source_request_id INTEGER"
    );
  }

  const userColumns = await db.all("PRAGMA table_info(users)");
  const hasEmailVerified = userColumns.some((col) => col.name === "email_verified");
  if (!hasEmailVerified) {
    await db.exec(
      "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0"
    );
    await db.run("UPDATE users SET email_verified = 1 WHERE email_verified IS NULL");
  }

  const hasRole = userColumns.some((col) => col.name === "role");
  if (!hasRole) {
    await db.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'service'"
    );
    await db.run("UPDATE users SET role = 'admin' WHERE is_admin = 1");
  }

  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_unique ON users(name)"
  );

  const certColumns = await db.all("PRAGMA table_info(request_certificates)");
  const hasExpireAt = certColumns.some((col) => col.name === "expire_at");
  if (!hasExpireAt) {
    await db.exec(
      "ALTER TABLE request_certificates ADD COLUMN expire_at TEXT"
    );
  }
  await db.run(
    "UPDATE request_certificates SET expire_at = datetime(created_at, '+730 days') WHERE expire_at IS NULL"
  );

  await cleanupDuplicateUsers(db);
  await migrateLegacyCertificates(db);
  await markLegacyExpiredCertificatesAsUpdated(db);

  // 初始化RBAC系统
  await initRBACSystem(db);

  return db;
}

async function initRBACSystem(db) {
  console.log("[RBAC] Checking RBAC system initialization...");
  
  // 检查RBAC表是否已存在
  const tableCheck = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='portal_services'"
  );
  
  if (!tableCheck) {
    console.log("[RBAC] RBAC tables not found. Initializing...");
    const rbacManager = new RBACManager(db);
    
    try {
      // 初始化RBAC表结构和TLS服务权限
      await rbacManager.initialize();
      
      // 从旧的role字段迁移到RBAC体系
      await rbacManager.migrateFromLegacyRoles();
      
      console.log("[RBAC] RBAC system initialized successfully.");
    } catch (err) {
      console.error("[RBAC] Failed to initialize RBAC system:", err);
      throw err;
    }
  } else {
    console.log("[RBAC] RBAC tables already exist. Skipping initialization.");
    
    // 检查是否需要迁移未迁移的用户
    const rbacManager = new RBACManager(db);
    const unmigrated = await db.get(
      `SELECT COUNT(*) as count FROM users u
       WHERE u.role IS NOT NULL 
       AND NOT EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = u.id AND r.service_id = 'tls-cert'
       )`
    );
    
    if (unmigrated && unmigrated.count > 0) {
      console.log(`[RBAC] Found ${unmigrated.count} unmigrated users. Migrating...`);
      await rbacManager.migrateFromLegacyRoles();
    }
    
    // 检查并初始化RTC服务
    await initRTCDeploymentService(db);
  }
}

async function initRTCDeploymentService(db) {
  console.log("[RTC] Checking RTC Deployment service initialization...");
  
  // 检查RTC服务是否已注册
  const rtcService = await db.get(
    "SELECT id FROM portal_services WHERE id = 'rtc-deployment'"
  );
  
  if (!rtcService) {
    console.log("[RTC] RTC Deployment service not found. Initializing...");
    
    try {
      // 读取并执行RTC服务初始化脚本
      const fs = require('fs');
      const path = require('path');
      const initSQL = fs.readFileSync(
        path.join(__dirname, 'migrations', '003-rtc-deployment-service.sql'),
        'utf-8'
      );
      
      await db.exec(initSQL);
      console.log("[RTC] RTC Deployment service initialized successfully.");
    } catch (err) {
      console.error("[RTC] Failed to initialize RTC service:", err);
      // 不抛出错误，允许系统继续运行
    }
  } else {
    console.log("[RTC] RTC Deployment service already exists.");
  }

  // 确保已有用户获得默认RTC角色（避免新服务访问被拒绝）
  await ensureRTCDeploymentDefaultRoles(db);

  // 增量迁移：为 rtc_deployment_projects 增加 network_security 列
  const projCols = await db.all("PRAGMA table_info(rtc_deployment_projects)");
  const hasNetSec = projCols.some((c) => c.name === "network_security");
  if (!hasNetSec) {
    await db.exec("ALTER TABLE rtc_deployment_projects ADD COLUMN network_security TEXT");
    console.log("[RTC] Added network_security column to rtc_deployment_projects.");
  }

  const hasAppId = projCols.some((c) => c.name === "appid");
  if (!hasAppId) {
    await db.exec("ALTER TABLE rtc_deployment_projects ADD COLUMN appid TEXT");
    console.log("[RTC] Added appid column to rtc_deployment_projects.");
  }

  const hasAppCert = projCols.some((c) => c.name === "app_cert");
  if (!hasAppCert) {
    await db.exec("ALTER TABLE rtc_deployment_projects ADD COLUMN app_cert TEXT");
    console.log("[RTC] Added app_cert column to rtc_deployment_projects.");
  }

  // 增量迁移：为 rtc_ai_architectures 增加版本管理与布局字段
  const archCols = await db.all("PRAGMA table_info(rtc_ai_architectures)");
  const hasSourceType = archCols.some((c) => c.name === "source_type");
  if (!hasSourceType) {
    await db.exec("ALTER TABLE rtc_ai_architectures ADD COLUMN source_type TEXT DEFAULT 'ai_generated'");
    await db.run("UPDATE rtc_ai_architectures SET source_type = 'ai_generated' WHERE source_type IS NULL");
    console.log("[RTC] Added source_type column to rtc_ai_architectures.");
  }

  const hasParentArch = archCols.some((c) => c.name === "parent_architecture_id");
  if (!hasParentArch) {
    await db.exec("ALTER TABLE rtc_ai_architectures ADD COLUMN parent_architecture_id INTEGER");
    console.log("[RTC] Added parent_architecture_id column to rtc_ai_architectures.");
  }

  const hasLayoutJson = archCols.some((c) => c.name === "layout_json");
  if (!hasLayoutJson) {
    await db.exec("ALTER TABLE rtc_ai_architectures ADD COLUMN layout_json TEXT");
    console.log("[RTC] Added layout_json column to rtc_ai_architectures.");
  }
}

async function ensureRTCDeploymentDefaultRoles(db) {
  const roleMapping = {
    admin: 'rtc-sa',
    dev: 'rtc-engineer',
    product: 'rtc-viewer',
    service: 'rtc-viewer'
  };

  const roles = await db.all(
    "SELECT id, code FROM roles WHERE service_id = 'rtc-deployment'"
  );
  if (!roles.length) return;

  const roleIdByCode = new Map(roles.map((role) => [role.code, role.id]));
  const users = await db.all(
    "SELECT id, role FROM users WHERE role IS NOT NULL"
  );
  const now = new Date().toISOString();
  let grantedCount = 0;

  for (const user of users) {
    const roleCode = roleMapping[user.role];
    if (!roleCode) continue;
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) continue;

    const result = await db.run(
      "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_at) VALUES (?, ?, ?)",
      user.id,
      roleId,
      now
    );

    if (result && result.changes > 0) {
      grantedCount += 1;
    }
  }

  if (grantedCount > 0) {
    console.log(`[RTC] Default RTC roles granted to ${grantedCount} users.`);
  }
}

async function migrateLegacyCertificates(db) {
  // Migrate existing issued certificates stored directly on requests table.
  // For legacy rows, original_filename is unknown; we use zip_path.
  const legacyRows = await db.all(
    `
      SELECT r.*
      FROM requests r
      LEFT JOIN (
        SELECT request_id, COUNT(*) AS c
        FROM request_certificates
        GROUP BY request_id
      ) rc ON rc.request_id = r.id
      WHERE r.zip_path IS NOT NULL
        AND (rc.c IS NULL OR rc.c = 0)
    `
  );
  if (!legacyRows.length) return;

  console.log(`[migrate] Migrating legacy certificates: ${legacyRows.length}`);
  const now = new Date().toISOString();
  await db.run("BEGIN");
  try {
    for (const row of legacyRows) {
      await db.run(
        `
          INSERT INTO request_certificates
            (request_id, status, file_rel_path, original_filename, zip_password, created_at, created_by_email)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        row.id,
        "active",
        row.zip_path,
        row.zip_path,
        row.zip_password || "",
        row.issued_at || now,
        "legacy"
      );
      if (row.status !== "issued") {
        await db.run("UPDATE requests SET status = ? WHERE id = ?", ["issued", row.id]);
      }
    }
    await db.run("COMMIT");
  } catch (err) {
    await db.run("ROLLBACK");
    throw err;
  }
}

async function markLegacyExpiredCertificatesAsUpdated(db) {
  // 需求：2026-03-02 之前到期的证书，关联请求状态置为 updated
  const cutoffDate = "2026-03-02";
  const result = await db.run(
    `
      UPDATE requests
      SET status = 'updated'
      WHERE status = 'issued'
        AND EXISTS (
          SELECT 1
          FROM request_certificates c
          WHERE c.request_id = requests.id
            AND date(
              COALESCE(
                c.expire_at,
                datetime(c.created_at, '+730 days'),
                datetime(requests.issued_at, '+730 days')
              )
            ) <= date(?)
            AND (c.status IS NULL OR c.status != 'revoked')
        )
    `,
    [cutoffDate]
  );
  if (result && result.changes) {
    console.log(
      `[migrate] Marked requests as updated by cutoff(${cutoffDate}): ${result.changes}`
    );
  }
}

function isTestEnvironment() {
  const envType = (process.env.ENV_TYPE || "").toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || "").toLowerCase();
  return envType === "dev" || nodeEnv === "test" || nodeEnv === "development";
}

async function confirmCleanupInNonTest() {
  if (isTestEnvironment()) {
    return true;
  }
  if (!process.stdin.isTTY) {
    console.warn(
      "[cleanup] Non-test environment without TTY. Skipping duplicate cleanup."
    );
    return false;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const answer = await new Promise((resolve) => {
    rl.question(
      "Duplicate user cleanup in non-test environment. Type YES to proceed: ",
      resolve
    );
  });
  rl.close();
  return String(answer).trim().toUpperCase() === "YES";
}

async function cleanupDuplicateUsers(db) {
  const idsToDelete = new Set();
  const emailsToDelete = new Set();

  const duplicateNames = await db.all(
    "SELECT name FROM users GROUP BY name HAVING COUNT(*) > 1"
  );
  for (const row of duplicateNames) {
    const users = await db.all(
      "SELECT id, email FROM users WHERE name = ? ORDER BY datetime(created_at) ASC, id ASC",
      [row.name]
    );
    users.slice(1).forEach((user) => {
      idsToDelete.add(user.id);
      emailsToDelete.add(user.email);
    });
  }

  const duplicateEmails = await db.all(
    "SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1"
  );
  for (const row of duplicateEmails) {
    const users = await db.all(
      "SELECT id, email FROM users WHERE email = ? ORDER BY datetime(created_at) ASC, id ASC",
      [row.email]
    );
    users.slice(1).forEach((user) => {
      idsToDelete.add(user.id);
      emailsToDelete.add(user.email);
    });
  }

  if (!idsToDelete.size) {
    console.log("[cleanup] No duplicate users detected.");
    return;
  }

  const confirmed = await confirmCleanupInNonTest();
  if (!confirmed) {
    console.warn(
      `[cleanup] Duplicate users found (count: ${idsToDelete.size}). Cleanup skipped.`
    );
    return;
  }

  const ids = Array.from(idsToDelete);
  const emails = Array.from(emailsToDelete);
  const idPlaceholders = ids.map(() => "?").join(", ");
  const emailPlaceholders = emails.map(() => "?").join(", ");

  await db.run("BEGIN");
  try {
    if (emails.length) {
      await db.run(
        `DELETE FROM requests WHERE requester_email IN (${emailPlaceholders})`,
        emails
      );
      await db.run(
        `DELETE FROM email_verifications WHERE email IN (${emailPlaceholders})`,
        emails
      );
    }
    await db.run(`DELETE FROM users WHERE id IN (${idPlaceholders})`, ids);
    await db.run("COMMIT");
    console.log(
      `[cleanup] Removed duplicate users: ${ids.length}, affected emails: ${emails.length}.`
    );
  } catch (err) {
    await db.run("ROLLBACK");
    throw err;
  }
}

module.exports = {
  initDb
};
