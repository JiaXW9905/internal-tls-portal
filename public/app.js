const requestForm = document.getElementById("request-form");
const requestMessage = document.getElementById("request-message");
const lookupMessage = document.getElementById("lookup-message");
const requestsTableBody = document.querySelector("#requests-table tbody");
const loadRequestsBtn = document.getElementById("load-requests");
const myCertsTableBody = document.querySelector("#my-certs-table tbody");
const myCertsSummary = document.getElementById("my-certs-summary");
const myCertsPagination = document.getElementById("my-certs-pagination");
const myCertsMessage = document.getElementById("my-certs-message");
const myCertsSearchInput = document.getElementById("my-certs-search");
const myCertsStatusSelect = document.getElementById("my-certs-status");
const myCertsExpirySelect = document.getElementById("my-certs-expiry");
const myCertsSearchBtn = document.getElementById("my-certs-search-btn");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const requestsLink = document.getElementById("nav-requests");
const adminLink = document.getElementById("nav-admin");
const overviewLink = document.getElementById("nav-overview");
const usersLink = document.getElementById("nav-users");
const navSettings = document.getElementById("nav-settings");
const MY_CERTS_PAGE_SIZE = 10;
let myCertsPage = 1;
let currentUser = null;

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

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function getExpiryDisplay(item) {
  if (item.cert_expire_at) return formatDate(item.cert_expire_at);
  if (item.cert_created_at) {
    const d = new Date(item.cert_created_at);
    if (Number.isNaN(d.getTime())) return "-";
    d.setDate(d.getDate() + 365 * 2);
    return formatDate(d.toISOString());
  }
  return "-";
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

function renderMyCertsPagination(currentPage, totalItems) {
  const totalPages = Math.ceil(totalItems / MY_CERTS_PAGE_SIZE);
  if (totalPages <= 1) {
    myCertsPagination.innerHTML = "";
    return;
  }

  myCertsPagination.innerHTML = `
    <div class="pagination-controls">
      <button ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">上一页</button>
      <span class="page-info">第 ${currentPage} / ${totalPages} 页</span>
      <button ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">下一页</button>
    </div>
  `;

  myCertsPagination.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.page);
      if (target > 0) {
        loadMyCertificates(target);
      }
    });
  });
}

function renderMyCertsTable(items) {
  myCertsTableBody.innerHTML = "";
  if (!items.length) {
    myCertsTableBody.innerHTML = "<tr><td colspan=\"7\" class=\"muted\">暂无证书记录。</td></tr>";
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");

    const isCurrentUserPrivileged = currentUser && (
      Boolean(currentUser.isAdmin) ||
      String(currentUser.role || "").toLowerCase() === "admin" ||
      String(currentUser.role || "").toLowerCase().includes("admin")
    );
    const itemRequesterEmpty = !(item.requester_email || "").trim();
    const isItemIssuedWithCert = item.status === "issued" && item.request_type !== "delete" && item.cert_id;

    const canActOnCert =
      currentUser &&
      isItemIssuedWithCert &&
      (
        (currentUser.role !== "dev" && item.requester_email === currentUser.email) ||
        (isCurrentUserPrivileged && itemRequesterEmpty)
      );

    const canSubmitDelete = canActOnCert;
    const canSubmitRenew = canActOnCert;

    let actionContent = "<span class=\"muted\">-</span>";
    if (canActOnCert) {
      actionContent = `
        <button type="button" class="btn-renew-request">申请续期</button>
        <button type="button" class="btn-delete-request">申请删除/注销</button>
      `.trim();
    } else if (isCurrentUserPrivileged && !itemRequesterEmpty && item.requester_email !== (currentUser.email || "")) {
      actionContent = "<span class=\"muted\">仅申请人可发起</span>";
    }

    row.innerHTML = `
      <td>${item.customer_name}</td>
      <td>${item.product_sku}</td>
      <td>${item.vid}</td>
      <td>${item.requester_email}</td>
      <td>${getExpiryDisplay(item)}</td>
      <td><span class="status ${item.status}">${STATUS_LABELS[item.status] || item.status}</span></td>
      <td class="table-actions col-actions">${actionContent}</td>
    `;

    const renewBtn = row.querySelector(".btn-renew-request");
    if (renewBtn) {
      renewBtn.addEventListener("click", async () => {
        const confirmed = await Modal.confirm(
          "申请续期",
          "确认提交该证书的更新/续期申请吗？",
          { confirmText: "确认提交" }
        );
        if (!confirmed) return;

        myCertsMessage.textContent = "提交中...";
        myCertsMessage.className = "muted";
        try {
          await fetchJson("/api/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerName: item.customer_name,
              productSku: item.product_sku,
              vid: item.vid,
              requesterName: item.requester_name || (currentUser ? currentUser.name : ""),
              requestType: "renew",
              sourceRequestId: item.id
            })
          });
          myCertsMessage.textContent = "续期申请已提交。";
          myCertsMessage.className = "success";
          await loadRequests();
          await loadMyCertificates(1);
        } catch (err) {
          myCertsMessage.textContent = err.message;
          myCertsMessage.className = "error";
        }
      });
    }

    const deleteBtn = row.querySelector(".btn-delete-request");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        const confirmed = await Modal.confirm(
          "申请删除/注销",
          "确认提交该证书的删除/注销申请吗？",
          { confirmText: "确认提交", danger: true }
        );
        if (!confirmed) return;

        myCertsMessage.textContent = "提交中...";
        myCertsMessage.className = "muted";
        try {
          await fetchJson("/api/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerName: item.customer_name,
              productSku: item.product_sku,
              vid: item.vid,
              requesterName: item.requester_name || (currentUser ? currentUser.name : ""),
              requestType: "delete",
              sourceRequestId: item.id
            })
          });
          myCertsMessage.textContent = "删除/注销申请已提交。";
          myCertsMessage.className = "success";
          await loadRequests();
          await loadMyCertificates(1);
        } catch (err) {
          myCertsMessage.textContent = err.message;
          myCertsMessage.className = "error";
        }
      });
    }

    myCertsTableBody.appendChild(row);
  });
}

async function loadMyCertificates(page = 1) {
  myCertsMessage.textContent = "加载中...";
  myCertsMessage.className = "muted";
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(MY_CERTS_PAGE_SIZE));

  const q = myCertsSearchInput.value.trim();
  if (q) params.set("q", q);
  const status = myCertsStatusSelect.value;
  if (status) params.set("status", status);
  const expiry = myCertsExpirySelect.value;
  if (expiry && expiry !== "all") params.set("expiringWithin", expiry);

  try {
    const data = await fetchJson(`/api/my-certificates?${params.toString()}`);
    if (!data) return;
    myCertsPage = page;
    renderMyCertsTable(data.items || []);
    renderMyCertsPagination(myCertsPage, data.total || 0);
    const summaryPrefix = data.isAdminScope ? "可查看证书合计" : "我的证书合计";
    myCertsSummary.textContent = `${summaryPrefix} ${data.scopeTotal || 0} 条，当前筛选命中 ${data.total || 0} 条`;
    myCertsMessage.textContent = "";
  } catch (err) {
    myCertsMessage.textContent = err.message;
    myCertsMessage.className = "error";
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
    currentUser = me;
    
    // 渲染侧边栏导航
    if (typeof renderSidebarNav === 'function') {
      renderSidebarNav('sidebar-nav', window.location.pathname, me);
    }
    
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
    loadMyCertificates(1);
  } catch (err) {
    lookupMessage.textContent = err.message;
    lookupMessage.className = "error";
  }
}

myCertsSearchBtn.addEventListener("click", () => loadMyCertificates(1));
myCertsSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadMyCertificates(1);
});
myCertsStatusSelect.addEventListener("change", () => loadMyCertificates(1));
myCertsExpirySelect.addEventListener("change", () => loadMyCertificates(1));

init();
