const requestForm = document.getElementById("request-form");
const requestMessage = document.getElementById("request-message");
const lookupMessage = document.getElementById("lookup-message");
const requestsTableBody = document.querySelector("#requests-table tbody");
const loadRequestsBtn = document.getElementById("load-requests");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const requestsLink = document.getElementById("nav-requests");
const adminLink = document.getElementById("nav-admin");
const overviewLink = document.getElementById("nav-overview");
const usersLink = document.getElementById("nav-users");
const navSettings = document.getElementById("nav-settings");

const STATUS_LABELS = {
  pending: "待处理",
  issued: "已签发",
  revoked: "已撤销",
  withdrawn: "已撤回",
  updated: "已更新"
};

const TYPE_LABELS = {
  new: "新办",
  update: "续期",
  renew: "续期",
  delete: "删除"
};

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

function renderRequests(items) {
  requestsTableBody.innerHTML = "";
  if (!items.length) {
    requestsTableBody.innerHTML =
      "<tr><td colspan=\"6\" class=\"muted\">未找到申请记录。</td></tr>";
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");
    const actions = document.createElement("td");
    actions.className = "table-actions col-actions";
    if (item.status === "issued" && item.cert_id) {
      const hasCertFile = item.cert_file_rel_path && item.cert_file_rel_path.trim() !== "";
      const link = document.createElement("a");
      if (hasCertFile) {
        link.href = `/api/requests/${item.id}/download`;
        link.className = "";
      } else {
        // 没有证书文件，按钮置为不可用状态
        link.href = "javascript:void(0)";
        link.className = "disabled-link";
        link.style.opacity = "0.5";
        link.style.cursor = "not-allowed";
        link.style.pointerEvents = "none";
      }
      link.textContent = "下载 ZIP";
      const pwd = document.createElement("span");
      pwd.className = "muted";
      pwd.style.marginLeft = "8px";
      pwd.textContent = `解压密码：${item.cert_zip_password || "-"}`;
      actions.appendChild(link);
      actions.appendChild(pwd);
    } else if (item.status === "revoked") {
      actions.innerHTML = "<span class=\"muted\">申请证书已撤销</span>";
    } else if (item.status === "withdrawn") {
      actions.innerHTML = "<span class=\"muted\">申请已工单撤回</span>";
    } else if (item.status === "issued") {
      // 已签发的申请不能撤回
      if (item.request_type === "delete") {
        actions.innerHTML = "<span class=\"muted\">证书已删除</span>";
      } else if (!item.cert_file_rel_path) {
        actions.innerHTML = "<span class=\"muted\">证书文件缺失</span>";
      } else {
        actions.innerHTML = "<span class=\"muted\">-</span>";
      }
    } else if (item.status === "pending") {
      // 只有待处理状态的申请才能撤回
      const withdrawBtn = document.createElement("button");
      withdrawBtn.type = "button";
      withdrawBtn.textContent = "工单撤回";
      withdrawBtn.addEventListener("click", async () => {
        const confirmed = await Modal.confirm(
          "工单撤回",
          "确认撤回该申请吗？撤回后研发将看不到这条申请。"
        );
        if (!confirmed) return;
        
        lookupMessage.textContent = "撤回中...";
        lookupMessage.className = "muted";
        try {
          await fetchJson(`/api/requests/${item.id}/withdraw`, { method: "POST" });
          lookupMessage.textContent = "已工单撤回申请。";
          lookupMessage.className = "success";
          await loadRequests();
        } catch (err) {
          lookupMessage.textContent = err.message;
          lookupMessage.className = "error";
        }
      });
      actions.appendChild(withdrawBtn);
    } else {
      actions.innerHTML = "<span class=\"muted\">-</span>";
    }

    row.innerHTML = `
      <td>${item.customer_name}</td>
      <td>${item.product_sku}</td>
      <td>${item.vid}</td>
      <td>${TYPE_LABELS[item.request_type] || "新办"}</td>
      <td>${new Date(item.created_at).toLocaleString()}</td>
      <td><span class="status ${item.status}">${STATUS_LABELS[item.status] || item.status}</span></td>
    `;
    row.appendChild(actions);
    requestsTableBody.appendChild(row);
  });
}

async function loadRequests() {
  lookupMessage.textContent = "加载中...";
  requestsTableBody.innerHTML = "";
  try {
    const data = await fetchJson("/api/requests");
    if (!data) return;
    renderRequests(data);
    lookupMessage.textContent = "";
  } catch (err) {
    lookupMessage.textContent = err.message;
    lookupMessage.className = "error";
  }
}

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  requestMessage.textContent = "提交中...";
  const formData = new FormData(requestForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await fetchJson("/api/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!result) return;
    requestMessage.textContent = `申请已提交。编号：${result.id}`;
    requestMessage.className = "success";
    requestForm.reset();
  } catch (err) {
    requestMessage.textContent = err.message;
    requestMessage.className = "error";
  }
});

loadRequestsBtn.addEventListener("click", () => {
  loadRequests();
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
    initUserMenu(me);
    const role = me.role || (me.isAdmin ? "admin" : "service");
    if (requestsLink) {
      requestsLink.style.display = "inline-block";
    }
    if ((role === "admin" || role === "dev") && adminLink) {
      adminLink.style.display = "inline-block";
    }
    if ((role === "admin" || role === "dev" || role === "product") && overviewLink) {
      overviewLink.style.display = "inline-block";
    }
    if (role === "admin" && usersLink) {
      usersLink.style.display = "inline-block";
    }
    if (role === "admin" && navSettings) {
      navSettings.style.display = "inline-block";
    }
    if (role === "dev") {
      if (requestsLink) {
        requestsLink.style.display = "none";
      }
      if (usersLink) {
        usersLink.style.display = "none";
      }
    }
    if (role === "dev") {
      window.location.href = "/admin";
      return;
    }
    loadRequests();
  } catch (err) {
    lookupMessage.textContent = err.message;
    lookupMessage.className = "error";
  }
}

init();
