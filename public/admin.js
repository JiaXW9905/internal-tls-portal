const pendingList = document.getElementById("pending-list");
const issuedTableBody = document.querySelector("#issued-table tbody");
const pendingMessage = document.getElementById("pending-message");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const navSettings = document.getElementById("nav-settings");
const requestsLink = document.getElementById("nav-requests");
const adminLink = document.getElementById("nav-admin");
const overviewLink = document.getElementById("nav-overview");
const usersLink = document.getElementById("nav-users");

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  if (res.status === 403) {
    pendingMessage.textContent = "需要管理员或研发权限。";
    pendingMessage.className = "error";
    return null;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return res.json();
}

function requestCard(item, isPending) {
  const card = document.createElement("div");
  card.className = "request-card";
  card.innerHTML = `
    <h3>${item.customer_name}</h3>
    <div class="muted">SKU：${item.product_sku}</div>
    <div class="muted">VID：${item.vid}</div>
    <div class="muted">申请人：${item.requester_name}（${item.requester_email}）</div>
    <div class="muted">创建时间：${new Date(item.created_at).toLocaleString()}</div>
    <div class="status ${item.status}">${item.status}</div>
  `;

  if (isPending) {
    const form = document.createElement("form");
    form.innerHTML = `
      <label>证书 ZIP 文件</label>
      <input type="file" name="zipFile" accept=".zip" required />
      <label>ZIP 密码</label>
      <input type="text" name="zipPassword" required />
      <button type="submit">上传并签发</button>
      <div class="muted"></div>
    `;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const statusEl = form.querySelector(".muted");
      statusEl.textContent = "上传中...";

      const formData = new FormData(form);
      try {
        const res = await fetch(`/api/requests/${item.id}/issue`, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "签发失败");
        }

        statusEl.textContent = "已签发。";
        await loadAll();
      } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "error";
      }
    });
    card.appendChild(form);
  } else {
    const pwd = document.createElement("div");
    pwd.className = "muted";
    pwd.textContent = `解压密码：${item.zip_password || "-"}`;
    card.appendChild(pwd);
  }

  return card;
}

function renderList(container, items, isPending) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = "<p class=\"muted\">暂无数据。</p>";
    return;
  }
  items.forEach((item) => {
    container.appendChild(requestCard(item, isPending));
  });
}

function renderIssuedTable(items) {
  issuedTableBody.innerHTML = "";
  if (!items.length) {
    issuedTableBody.innerHTML =
      "<tr><td colspan=\"6\" class=\"muted\">暂无数据。</td></tr>";
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("tr");

    // 判断操作列显示内容
    let actionContent = "<span class=\"muted\">-</span>";
    const hasActiveCert = item.cert_id && item.cert_status === "active";

    // Check if certificate was issued more than 7 days ago
    let canRevoke = false;
    if (hasActiveCert && item.cert_created_at) {
      const issuedAt = new Date(item.cert_created_at);
      const now = new Date();
      const daysSinceIssued = (now - issuedAt) / (1000 * 60 * 60 * 24);
      canRevoke = daysSinceIssued <= 7;
    }

    if (item.request_type === "delete") {
      actionContent = "<span class=\"muted\">证书已删除</span>";
    } else if (!hasActiveCert) {
      actionContent = "<span class=\"muted\">证书文件缺失</span>";
    } else if (!canRevoke) {
      // 超过7天，显示"-"，不显示任何文字提示
      actionContent = "<span class=\"muted\">-</span>";
    } else {
      // 有活跃证书且未超过7天，显示撤销按钮
      const revokeBtn = document.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.textContent = "证书撤销";
      revokeBtn.addEventListener("click", async () => {
        const confirmed = await Modal.confirm(
          "证书撤销",
          "确认撤销该证书吗？此操作不可逆。",
          { danger: true, confirmText: "确认撤销" }
        );
        if (!confirmed) return;

        pendingMessage.textContent = "撤销中...";
        pendingMessage.className = "muted";
        try {
          await fetchJson(`/api/requests/${item.id}/revoke`, { method: "POST" });
          pendingMessage.textContent = "已证书撤销。";
          pendingMessage.className = "success";
          await loadAll();
        } catch (err) {
          pendingMessage.textContent = err.message;
          pendingMessage.className = "error";
        }
      });
      actionContent = "";
      const actionTd = document.createElement("td");
      actionTd.className = "table-actions col-actions";
      actionTd.appendChild(revokeBtn);

      row.innerHTML = `
        <td>${item.customer_name}</td>
        <td>${item.product_sku}</td>
        <td>${item.vid}</td>
        <td>${item.requester_name}（${item.requester_email}）</td>
        <td>${item.issued_at ? new Date(item.issued_at).toLocaleString() : "-"}</td>
        <td>${item.cert_zip_password || "-"}</td>
      `;
      row.appendChild(actionTd);
      issuedTableBody.appendChild(row);
      return;
    }

    row.innerHTML = `
      <td>${item.customer_name}</td>
      <td>${item.product_sku}</td>
      <td>${item.vid}</td>
      <td>${item.requester_name}（${item.requester_email}）</td>
      <td>${item.issued_at ? new Date(item.issued_at).toLocaleString() : "-"}</td>
      <td>${item.cert_zip_password || "-"}</td>
      <td class="table-actions col-actions">${actionContent}</td>
    `;
    issuedTableBody.appendChild(row);
  });
}

async function loadAll() {
  pendingMessage.textContent = "加载中...";
  try {
    const [pending, issued] = await Promise.all([
      fetchJson("/api/requests?status=pending"),
      fetchJson("/api/requests?status=issued")
    ]);
    if (!pending || !issued) return;
    renderList(pendingList, pending, true);
    renderIssuedTable(issued);
    pendingMessage.textContent = "";
  } catch (err) {
    pendingMessage.textContent = err.message;
    pendingMessage.className = "error";
  }
}

// --- Settings Logic ---
// Settings moved to separate page

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
    if (role === "service") {
      window.location.href = "/";
      return;
    }
    if (role === "product") {
      window.location.href = "/overview";
      return;
    }
    if (requestsLink) requestsLink.style.display = "inline-block";
    if (adminLink) adminLink.style.display = "inline-block";
    if (overviewLink) overviewLink.style.display = "inline-block";
    if (role === "admin" && usersLink) {
      usersLink.style.display = "inline-block";
    }
    if (role === "admin" && navSettings) {
      navSettings.style.display = "inline-block";
    }
    if (role === "dev" || role === "product") {
      if (requestsLink) requestsLink.style.display = "none";
      if (usersLink) usersLink.style.display = "none";
    }
    loadAll();
  } catch (err) {
    pendingMessage.textContent = err.message;
    pendingMessage.className = "error";
  }
}

init();
