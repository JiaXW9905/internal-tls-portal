const form = document.getElementById("settings-form");
const message = document.getElementById("message");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const navSettings = document.getElementById("nav-settings");
const navRequests = document.getElementById("nav-requests");
const navAdmin = document.getElementById("nav-admin");
const navOverview = document.getElementById("nav-overview");
const navUsers = document.getElementById("nav-users");

// 邮箱标签相关元素
const emailTagsContainer = document.getElementById("email-tags-container");
const emailTagsList = document.getElementById("email-tags-list");
const emailTagInput = document.getElementById("email-tag-input");
const emailHiddenInput = document.getElementById("key-personnel-emails-hidden");
const emailErrorMsg = document.getElementById("email-error-msg");

let emailTags = []; // 存储当前邮箱标签

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  if (res.status === 403) {
    window.location.href = "/";
    return null;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return res.json();
}

function setFieldValue(name, value) {
  const el = form.elements[name];
  if (!el) return;
  if (el.type === "checkbox") {
    el.checked = !!value;
  } else {
    el.value = value || "";
  }
}

function getFieldValue(name) {
  const el = form.elements[name];
  if (!el) return undefined;
  if (el.type === "checkbox") {
    return el.checked;
  }
  return el.value;
}

// 邮箱标签功能
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && (email.endsWith("@shengwang.cn") || email.endsWith("@agora.io"));
}

function createEmailTag(email) {
  const tag = document.createElement("div");
  tag.className = "email-tag" + (isValidEmail(email) ? "" : " invalid");
  tag.innerHTML = `
    <span>${email}</span>
    <span class="remove" data-email="${email}">×</span>
  `;
  
  // 绑定删除事件
  const removeBtn = tag.querySelector(".remove");
  removeBtn.addEventListener("click", () => {
    removeEmailTag(email);
  });
  
  return tag;
}

function renderEmailTags() {
  emailTagsList.innerHTML = "";
  emailTags.forEach(email => {
    emailTagsList.appendChild(createEmailTag(email));
  });
  // 更新隐藏输入框的值
  emailHiddenInput.value = emailTags.join(",");
}

function addEmailTag(email) {
  email = email.trim();
  if (!email) return;
  
  // 检查是否已存在
  if (emailTags.includes(email)) {
    showEmailError("该邮箱已添加");
    return;
  }
  
  // 验证邮箱格式
  if (!isValidEmail(email)) {
    showEmailError("邮箱格式无效，必须使用 @shengwang.cn 或 @agora.io 域名");
    // 仍然添加，但标记为无效
  }
  
  emailTags.push(email);
  renderEmailTags();
  emailTagInput.value = "";
  hideEmailError();
}

function removeEmailTag(email) {
  emailTags = emailTags.filter(e => e !== email);
  renderEmailTags();
}

function showEmailError(msg) {
  emailErrorMsg.textContent = msg;
  emailErrorMsg.style.display = "block";
}

function hideEmailError() {
  emailErrorMsg.style.display = "none";
}

function initEmailTags() {
  if (!emailTagInput) return;
  
  // 输入框回车或逗号添加
  emailTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const value = emailTagInput.value.trim();
      if (value) {
        // 支持逗号分隔批量添加
        const emails = value.split(",").map(e => e.trim()).filter(e => e);
        emails.forEach(email => addEmailTag(email));
      }
    }
    if (e.key === "Backspace" && !emailTagInput.value && emailTags.length > 0) {
      // 删除最后一个标签
      removeEmailTag(emailTags[emailTags.length - 1]);
    }
  });
  
  // 失去焦点时添加
  emailTagInput.addEventListener("blur", () => {
    const value = emailTagInput.value.trim();
    if (value) {
      const emails = value.split(",").map(e => e.trim()).filter(e => e);
      emails.forEach(email => addEmailTag(email));
    }
  });
  
  // 点击容器聚焦输入框
  emailTagsContainer.addEventListener("click", (e) => {
    if (e.target === emailTagsContainer || e.target === emailTagsList) {
      emailTagInput.focus();
    }
  });
}

function setEmailTagsFromString(emailsString) {
  emailTags = [];
  if (emailsString) {
    emailTags = emailsString.split(",").map(e => e.trim()).filter(e => e);
  }
  renderEmailTags();
}

async function loadSettings() {
  try {
    const settings = await fetchJson("/api/admin/settings");
    if (!settings) return;

    // SMTP
    setFieldValue("smtp_host", settings.smtp_host);
    setFieldValue("smtp_port", settings.smtp_port);
    setFieldValue("smtp_user", settings.smtp_user);
    setFieldValue("smtp_secure", settings.smtp_secure !== false ? "true" : "false");
    setFieldValue("smtp_from", settings.smtp_from);

    // Notifications
    const dev = settings.notify_dev || {};
    setFieldValue("notify_dev_enabled", dev.enabled);
    setFieldValue("notify_dev_freq", dev.frequency || "weekly");
    setFieldValue("notify_dev_day", dev.dayOfWeek !== undefined ? dev.dayOfWeek : "3");
    setFieldValue("notify_dev_time", dev.time || "10:00");

    const svc = settings.notify_service || {};
    setFieldValue("notify_service_enabled", svc.enabled);
    setFieldValue("notify_service_freq", svc.frequency || "weekly");
    setFieldValue("notify_service_day", svc.dayOfWeek !== undefined ? svc.dayOfWeek : "3");
    setFieldValue("notify_service_time", svc.time || "18:00");

    const exp = settings.notify_exp || {};
    setFieldValue("notify_exp_enabled", exp.enabled);
    setFieldValue("notify_exp_freq", exp.frequency || "weekly");
    setFieldValue("notify_exp_day", exp.dayOfWeek !== undefined ? exp.dayOfWeek : "1");
    setFieldValue("notify_exp_time", exp.time || "09:00");
    setFieldValue("notify_exp_days", settings.notify_exp_days || "60");
    
    // 设置邮箱标签
    setEmailTagsFromString(settings.key_personnel_emails);

  } catch (err) {
    message.textContent = err.message;
    message.className = "error";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "保存中...";
  message.className = "muted";

  const payload = {
    smtp_host: getFieldValue("smtp_host"),
    smtp_port: getFieldValue("smtp_port"),
    smtp_user: getFieldValue("smtp_user"),
    smtp_pass: getFieldValue("smtp_pass"),
    smtp_secure: getFieldValue("smtp_secure") === "true",
    smtp_from: getFieldValue("smtp_from"),
    
    notify_dev: {
      enabled: getFieldValue("notify_dev_enabled"),
      frequency: getFieldValue("notify_dev_freq"),
      dayOfWeek: parseInt(getFieldValue("notify_dev_day")),
      time: getFieldValue("notify_dev_time")
    },
    notify_service: {
      enabled: getFieldValue("notify_service_enabled"),
      frequency: getFieldValue("notify_service_freq"),
      dayOfWeek: parseInt(getFieldValue("notify_service_day")),
      time: getFieldValue("notify_service_time")
    },
    notify_exp: {
      enabled: getFieldValue("notify_exp_enabled"),
      frequency: getFieldValue("notify_exp_freq"),
      dayOfWeek: parseInt(getFieldValue("notify_exp_day")),
      time: getFieldValue("notify_exp_time")
    },
    key_personnel_emails: emailHiddenInput.value,
    notify_exp_days: getFieldValue("notify_exp_days")
  };

  try {
    await fetchJson("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    message.textContent = "设置已保存。";
    message.className = "success";
  } catch (err) {
    message.textContent = err.message;
    message.className = "error";
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/api/auth/logout", { method: "POST" });
  } catch (err) {
    // ignore
  } finally {
    window.location.href = "/login";
  }
});

function initUserMenu(me) {
  if (!userMenu || !userMenuBtn) return;
  userMenuBtn.textContent = `${me.name}（${me.email}）`;
  userMenuBtn.addEventListener("click", () => {
    userMenu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!userMenu.contains(e.target)) {
      userMenu.classList.remove("open");
    }
  });
}

async function init() {
  try {
    const me = await fetchJson("/api/me");
    if (!me) return;
    
    // 渲染侧边栏导航
    if (typeof renderSidebarNav === 'function') {
      renderSidebarNav('sidebar-nav', window.location.pathname, me);
    }
    initUserMenu(me);
    
    const role = me.role || (me.isAdmin ? "admin" : "service");
    if (role !== "admin") {
      window.location.href = "/";
      return;
    }

    if (navRequests) navRequests.style.display = "inline-block";
    if (navAdmin) navAdmin.style.display = "inline-block";
    if (navOverview) navOverview.style.display = "inline-block";
    if (navUsers) navUsers.style.display = "inline-block";
    if (navSettings) navSettings.style.display = "inline-block";

    initEmailTags();
    loadSettings();
  } catch (err) {
    message.textContent = err.message;
    message.className = "error";
  }
}

init();
