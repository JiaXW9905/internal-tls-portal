const changeForm = document.getElementById("change-password-form");
const messageEl = document.getElementById("change-password-message");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");

const navAdmin = document.getElementById("nav-admin");
const navOverview = document.getElementById("nav-overview");
const navUsers = document.getElementById("nav-users");

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return res.json();
}

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

changeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "保存中...";
  messageEl.className = "muted";
  const formData = new FormData(changeForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await fetchJson("/api/account/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    messageEl.textContent = "密码已更新。";
    messageEl.className = "success";
    changeForm.reset();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.className = "error";
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
    if ((role === "admin" || role === "dev") && navAdmin) {
      navAdmin.style.display = "inline-block";
    }
    if (role !== "service" && navOverview) {
      navOverview.style.display = "inline-block";
    }
    if (role === "admin" && navUsers) {
      navUsers.style.display = "inline-block";
    }
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.className = "error";
  }
}

init();

