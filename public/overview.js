const pendingTableBody = document.querySelector("#pending-table tbody");
const issuedTableBody = document.querySelector("#issued-table tbody");
const pendingPagination = document.getElementById("pending-pagination");
const issuedPagination = document.getElementById("issued-pagination");
const pendingMessage = document.getElementById("pending-message");
const issuedMessage = document.getElementById("issued-message");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const navRequests = document.getElementById("nav-requests");
const navAdmin = document.getElementById("nav-admin");
const navOverview = document.getElementById("nav-overview");
const navUsers = document.getElementById("nav-users");
const navSettings = document.getElementById("nav-settings");

const STATUS_LABELS = {
  pending: "待处理",
  issued: "已签发",
  revoked: "证书已撤销",
  withdrawn: "已工单撤回",
  updated: "已更新",
  deleted: "证书已删除"
};

const TYPE_LABELS = {
  new: "新办",
  delete: "删除",
  renew: "续期",
  update: "续期"
};

let pendingData = [];
let issuedData = [];
let issuedTotal = 0;
let pendingPage = 1;
let issuedPage = 1;
const pageSize = 10;

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

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function formatExpiry(item) {
  // 优先使用数据库中的 expire_at
  if (item.cert_expire_at) {
    return formatDate(item.cert_expire_at);
  }
  // 否则计算2年有效期（365*2=730天）
  if (item.cert_created_at) {
    const d = new Date(item.cert_created_at);
    d.setDate(d.getDate() + 365 * 2); // 730天
    return formatDate(d.toISOString());
  }
  return "-";
}

function getDaysUntilExpiry(expireAt) {
  if (!expireAt) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expire = new Date(expireAt);
  expire.setHours(0, 0, 0, 0);
  const diff = expire - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function renderPendingTable(data) {
  pendingTableBody.innerHTML = "";
  if (!data.length) {
    pendingTableBody.innerHTML = '<tr><td colspan="8" class="muted">暂无待处理申请。</td></tr>';
    return;
  }
  data.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.customer_name}</td>
      <td>${item.product_sku}</td>
      <td>${item.vid}</td>
      <td>${TYPE_LABELS[item.request_type] || item.request_type}</td>
      <td>${item.requester_name}</td>
      <td>${formatDate(item.created_at)}</td>
      <td><span class="status ${item.status}">${STATUS_LABELS[item.status] || item.status}</span></td>
      <td class="col-actions">-</td>
    `;
    pendingTableBody.appendChild(row);
  });
}

function renderIssuedTable(data) {
  issuedTableBody.innerHTML = "";
  if (!data.length) {
    issuedTableBody.innerHTML = '<tr><td colspan="9" class="muted">暂无已签发证书。</td></tr>';
    return;
  }
  data.forEach((item) => {
    const row = document.createElement("tr");

    // 判断是否为删除类型工单且已签发
    const isDeletedType = item.request_type === "delete" && item.status === "issued";
    const isRevoked = item.status === "revoked";

    // 计算过期时间和剩余天数
    const expiry = formatExpiry(item);
    // 使用计算出的过期时间或数据库中的过期时间
    const expireAt = item.cert_expire_at || (item.cert_created_at ? 
      new Date(new Date(item.cert_created_at).getTime() + 365 * 2 * 24 * 60 * 60 * 1000).toISOString() : null);
    const daysUntil = getDaysUntilExpiry(expireAt);
    let expiryClass = "";
    if (daysUntil !== null) {
      if (daysUntil <= 30) expiryClass = "style=\"color: #dc2626; font-weight: bold;\"";
      else if (daysUntil <= 60) expiryClass = "style=\"color: #d97706;\"";
    }
    
    // 操作列显示逻辑
    let actionContent = "-";
    if (isDeletedType) {
      actionContent = "<span class=\"muted\">证书已删除</span>";
    } else if (isRevoked) {
      actionContent = "<span class=\"muted\">申请证书已撤销</span>";
    } else if (item.status === "issued") {
      if (!item.cert_file_rel_path) {
        actionContent = "<span class=\"muted\">证书文件缺失</span>";
      } else {
        actionContent = `<a href="/api/requests/${item.id}/download" class="btn-primary" style="padding: 4px 12px; font-size: 12px;">下载证书</a>`;
      }
    }
    
    row.innerHTML = `
      <td>${item.customer_name}</td>
      <td>${item.product_sku}</td>
      <td>${item.vid}</td>
      <td>${TYPE_LABELS[item.request_type] || item.request_type}</td>
      <td>${item.requester_name}</td>
      <td>${formatDate(item.issued_at)}</td>
      <td ${expiryClass}>${expiry}</td>
      <td><span class="status ${item.status}">${STATUS_LABELS[item.status] || item.status}</span></td>
      <td class="col-actions">${actionContent}</td>
    `;
    issuedTableBody.appendChild(row);
  });
}

function renderPagination(container, currentPage, totalItems, onPageChange) {
  // 使用传入的总数（后端返回的 total）
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }
  
  let html = '<div class="pagination-controls">';
  
  // 上一页
  html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage - 1})">上一页</button>`;
  
  // 页码
  html += `<span class="page-info">第 ${currentPage} / ${totalPages} 页</span>`;
  
  // 页码输入
  html += `<input type="number" min="1" max="${totalPages}" value="${currentPage}" onchange="${onPageChange}(this.value)" style="width: 60px; text-align: center;" />`;
  
  // 下一页
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="${onPageChange}(${currentPage + 1})">下一页</button>`;
  
  html += '</div>';
  container.innerHTML = html;
}

function displayPendingPage(page) {
  pendingPage = page;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageData = pendingData.slice(start, end);
  renderPendingTable(pageData);
  renderPagination(pendingPagination, page, pendingData.length, "displayPendingPage");
}

function displayIssuedPage(page) {
  const targetPage = Math.max(1, Number(page) || 1);
  loadIssued(targetPage);
}

async function loadPending() {
  pendingMessage.textContent = "加载中...";
  try {
    const data = await fetchJson("/api/requests?status=pending");
    if (!data) return;
    pendingData = data;
    displayPendingPage(1);
    pendingMessage.textContent = "";
  } catch (err) {
    pendingMessage.textContent = err.message;
    pendingMessage.className = "error";
  }
}

async function loadIssued(page = 1) {
  issuedMessage.textContent = "加载中...";
  try {
    const params = new URLSearchParams();
    // 使用后端分页，避免总数与当前页数据不一致
    params.set("pageSize", String(pageSize));
    params.set("page", String(page));

    const statusVal = document.getElementById("issued-status").value;
    if (statusVal) params.set("status", statusVal);

    const search = document.getElementById("issued-search").value.trim();
    if (search) params.set("q", search);

    const startDate = document.getElementById("issued-start").value;
    const endDate = document.getElementById("issued-end").value;
    if (startDate) params.set("start", startDate);
    if (endDate) params.set("end", endDate);

    const expiring = document.getElementById("issued-expiring").checked;
    if (expiring) params.set("expiring", "true");

    const data = await fetchJson(`/api/overview?${params.toString()}`);
    if (!data) return;
    issuedData = data.items || [];
    issuedTotal = data.total || issuedData.length;
    issuedPage = page;
    renderIssuedTable(issuedData);
    renderPagination(issuedPagination, issuedPage, issuedTotal, "displayIssuedPage");
    issuedMessage.textContent = `共 ${issuedTotal} 条记录`;
    issuedMessage.className = "muted";
  } catch (err) {
    issuedMessage.textContent = err.message;
    issuedMessage.className = "error";
  }
}

async function exportIssued() {
  try {
    const params = new URLSearchParams();
    const statusVal = document.getElementById("issued-status").value;
    if (statusVal) params.set("status", statusVal);
    const search = document.getElementById("issued-search").value.trim();
    if (search) params.set("q", search);
    
    const startDate = document.getElementById("issued-start").value;
    const endDate = document.getElementById("issued-end").value;
    if (startDate) params.set("start", startDate);
    if (endDate) params.set("end", endDate);
    
    const expiring = document.getElementById("issued-expiring").checked;
    if (expiring) params.set("expiring", "true");
    
    window.open(`/api/overview/export?${params.toString()}`, "_blank");
  } catch (err) {
    issuedMessage.textContent = err.message;
    issuedMessage.className = "error";
  }
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

async function init() {
  try {
    const me = await fetchJson("/api/me");
    if (!me) return;
    initUserMenu(me);
    
    const role = me.role || (me.isAdmin ? "admin" : "service");
    if (navRequests) navRequests.style.display = "inline-block";
    if (navAdmin) navAdmin.style.display = "inline-block";
    if (navOverview) navOverview.style.display = "inline-block";
    if (navUsers) navUsers.style.display = "inline-block";
    if (role === "admin" && navSettings) navSettings.style.display = "inline-block";
    
    loadPending();
    loadIssued(1);
    
    // 事件绑定
    document.getElementById("pending-search-btn").addEventListener("click", () => {
      const search = document.getElementById("pending-search").value.toLowerCase();
      if (!search) {
        displayPendingPage(1);
        return;
      }
      const filtered = pendingData.filter(item => 
        item.customer_name?.toLowerCase().includes(search) ||
        item.product_sku?.toLowerCase().includes(search) ||
        item.vid?.toLowerCase().includes(search) ||
        item.requester_name?.toLowerCase().includes(search)
      );
      pendingData = filtered;
      displayPendingPage(1);
    });
    
    document.getElementById("issued-search-btn").addEventListener("click", () => loadIssued(1));
    document.getElementById("issued-export-btn").addEventListener("click", exportIssued);
    
  } catch (err) {
    issuedMessage.textContent = err.message;
    issuedMessage.className = "error";
  }
}

logoutBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/api/auth/logout", { method: "POST" });
  } catch (err) {
    // ignore
  } finally {
    window.location.href = "/login";
  }
});

init();
