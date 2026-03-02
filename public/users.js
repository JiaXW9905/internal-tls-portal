const usersTableBody = document.querySelector("#users-table tbody");
const usersMessage = document.getElementById("users-message");
const logoutBtn = document.getElementById("logout-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const navRequests = document.getElementById("nav-requests");
const navAdmin = document.getElementById("nav-admin");
const navOverview = document.getElementById("nav-overview");
const navUsers = document.getElementById("nav-users");
const navSettings = document.getElementById("nav-settings");

const ROLE_LABELS = {
  admin: "管理员",
  service: "服务",
  dev: "研发",
  product: "产品"
};

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  if (res.status === 403) {
    usersMessage.textContent = "需要管理员权限。";
    usersMessage.className = "error";
    return null;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return res.json();
}

function buildRoleSelect(currentRole) {
  const select = document.createElement("select");
  ["admin", "service", "dev", "product"].forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = ROLE_LABELS[role] || role;
    if (role === currentRole) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  return select;
}

function renderUsers(users) {
  usersTableBody.innerHTML = "";
  if (!users.length) {
    usersTableBody.innerHTML =
      "<tr><td colspan=\"5\" class=\"muted\">暂无用户。</td></tr>";
    return;
  }
  users.forEach((user) => {
    const row = document.createElement("tr");
    const verifiedLabel = user.email_verified ? "已验证" : "未验证";
    const currentRole = user.role || (user.is_admin ? "admin" : "service");
    const actions = document.createElement("td");
    actions.className = "table-actions col-actions";
    
    // Role selection is now direct in the role column
    const roleTd = document.createElement("td");
    const roleSelect = buildRoleSelect(currentRole);
    roleSelect.className = "role-select";
    let selectedRole = currentRole;
    
    roleSelect.addEventListener("change", async () => {
      const nextRole = roleSelect.value;
      if (nextRole === selectedRole) return;
      
      const confirmed = await Modal.confirm(
        "修改角色",
        `确认将用户 ${user.name}（${user.email}）角色从「${ROLE_LABELS[selectedRole]}」修改为「${ROLE_LABELS[nextRole]}」吗？`
      );
      
      if (!confirmed) {
        roleSelect.value = selectedRole;
        return;
      }
      
      usersMessage.textContent = "正在更新角色...";
      usersMessage.className = "muted";
      try {
        await fetchJson(`/api/admin/users/${user.id}/role`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ role: nextRole })
        });
        usersMessage.textContent = "角色已更新。";
        usersMessage.className = "success";
        selectedRole = nextRole;
        await loadUsers();
      } catch (err) {
        roleSelect.value = selectedRole;
        usersMessage.textContent = err.message;
        usersMessage.className = "error";
      }
    });
    roleTd.appendChild(roleSelect);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑用户";
    editBtn.className = "btn-primary";
    editBtn.style.marginRight = "8px";
    editBtn.addEventListener("click", async () => {
      // 构建编辑弹框内容
      const editContent = document.createElement("div");
      editContent.style.cssText = "text-align: left; min-width: 400px;";
      
      // 姓名输入
      const nameGroup = document.createElement("div");
      nameGroup.style.cssText = "margin-bottom: 16px;";
      nameGroup.innerHTML = `
        <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #374151;">姓名</label>
        <input type="text" id="edit-name" value="${user.name}" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;">
      `;
      
      // 邮箱输入
      const emailGroup = document.createElement("div");
      emailGroup.style.cssText = "margin-bottom: 16px;";
      emailGroup.innerHTML = `
        <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #374151;">邮箱</label>
        <input type="email" id="edit-email" value="${user.email}" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <div id="email-error" style="color: #dc2626; font-size: 12px; margin-top: 4px; display: none;"></div>
      `;
      
      // 角色选择
      const roleGroup = document.createElement("div");
      roleGroup.style.cssText = "margin-bottom: 16px;";
      const roleSelect = document.createElement("select");
      roleSelect.id = "edit-role";
      roleSelect.style.cssText = "width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;";
      ["admin", "service", "dev", "product"].forEach(role => {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = ROLE_LABELS[role] || role;
        if (role === currentRole) option.selected = true;
        roleSelect.appendChild(option);
      });
      roleGroup.innerHTML = `<label style="display: block; margin-bottom: 6px; font-weight: 500; color: #374151;">角色</label>`;
      roleGroup.appendChild(roleSelect);
      
      // 密码重置
      const pwdGroup = document.createElement("div");
      pwdGroup.style.cssText = "margin-bottom: 16px;";
      pwdGroup.innerHTML = `
        <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #374151;">新密码（留空则不修改）</label>
        <div style="display: flex; gap: 8px;">
          <input type="password" id="edit-password" placeholder="输入新密码或留空" style="flex: 1; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;">
          <button type="button" id="generate-pwd" style="padding: 8px 16px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; white-space: nowrap;">生成随机密码</button>
        </div>
        <div id="pwd-display" style="margin-top: 8px; font-size: 13px; color: #2563eb; display: none;"></div>
      `;
      
      editContent.appendChild(nameGroup);
      editContent.appendChild(emailGroup);
      editContent.appendChild(roleGroup);
      editContent.appendChild(pwdGroup);
      
      // 弹框按钮
      const buttons = [
        { text: "取消", value: null, primary: false },
        { text: "保存修改", value: "save", primary: true }
      ];
      
      const result = await Modal.custom(`编辑用户: ${user.name}`, editContent, buttons);
      
      if (result !== "save") return;
      
      // 获取表单值
      const nameInput = document.getElementById("edit-name");
      const emailInput = document.getElementById("edit-email");
      const roleInput = document.getElementById("edit-role");
      const passwordInput = document.getElementById("edit-password");
      
      const newName = nameInput.value.trim();
      const newEmail = emailInput.value.trim();
      const newRole = roleInput.value;
      const newPassword = passwordInput.value.trim();
      
      // 验证
      if (!newName) {
        usersMessage.textContent = "姓名不能为空。";
        usersMessage.className = "error";
        return;
      }
      
      if (!newEmail || (!newEmail.endsWith("@shengwang.cn") && !newEmail.endsWith("@agora.io"))) {
        usersMessage.textContent = "邮箱格式无效，必须使用 @shengwang.cn 或 @agora.io 域名。";
        usersMessage.className = "error";
        return;
      }
      
      usersMessage.textContent = "正在保存修改...";
      usersMessage.className = "muted";
      
      try {
        const payload = {
          name: newName,
          email: newEmail,
          role: newRole
        };
        if (newPassword) {
          payload.password = newPassword;
        }
        
        await fetchJson(`/api/admin/users/${user.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        
        usersMessage.textContent = "用户信息已更新。";
        usersMessage.className = "success";
        await loadUsers();
      } catch (err) {
        usersMessage.textContent = err.message;
        usersMessage.className = "error";
      }
    });
    actions.appendChild(editBtn);
    
    // 生成随机密码按钮事件（需要在弹框打开后绑定）
    setTimeout(() => {
      const generateBtn = document.getElementById("generate-pwd");
      if (generateBtn) {
        generateBtn.addEventListener("click", () => {
          const randomPwd = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
          const pwdInput = document.getElementById("edit-password");
          const pwdDisplay = document.getElementById("pwd-display");
          if (pwdInput && pwdDisplay) {
            pwdInput.value = randomPwd;
            pwdDisplay.textContent = `生成的密码: ${randomPwd}`;
            pwdDisplay.style.display = "block";
          }
        });
      }
    }, 100);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "删除用户";
    deleteBtn.className = "btn-danger"; // New style
    deleteBtn.addEventListener("click", async () => {
      const confirmed = await Modal.confirm(
        "删除用户",
        `确认删除用户 ${user.name}（${user.email}）吗？该用户的申请记录也将被删除。`,
        { danger: true, confirmText: "确认删除" }
      );
      
      if (!confirmed) return;
      
      usersMessage.textContent = "正在删除用户...";
      usersMessage.className = "muted";
      try {
        await fetchJson(`/api/admin/users/${user.id}`, {
          method: "DELETE"
        });
        usersMessage.textContent = "用户已删除。";
        usersMessage.className = "success";
        await loadUsers();
      } catch (err) {
        usersMessage.textContent = err.message;
        usersMessage.className = "error";
      }
    });
    actions.appendChild(deleteBtn);

    if (!user.email_verified) {
      const verifyBtn = document.createElement("button");
      verifyBtn.type = "button";
      verifyBtn.textContent = "标记为已验证";
      verifyBtn.addEventListener("click", async () => {
        usersMessage.textContent = "正在更新验证状态...";
        usersMessage.className = "muted";
        try {
          await fetchJson(`/api/admin/users/${user.id}/verify`, {
            method: "POST"
          });
          usersMessage.textContent = "用户已验证。";
          usersMessage.className = "success";
          await loadUsers();
        } catch (err) {
          usersMessage.textContent = err.message;
          usersMessage.className = "error";
        }
      });
      actions.appendChild(verifyBtn);
    }

    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.email}</td>
      <td>${verifiedLabel}</td>
    `;
    row.appendChild(roleTd);
    row.appendChild(actions);
    usersTableBody.appendChild(row);
  });
}

async function loadUsers() {
  usersMessage.textContent = "加载用户中...";
  usersMessage.className = "muted";
  try {
    const users = await fetchJson("/api/admin/users");
    if (!users) return;
    renderUsers(users);
    usersMessage.textContent = "";
  } catch (err) {
    usersMessage.textContent = err.message;
    usersMessage.className = "error";
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
    if (navRequests) navRequests.style.display = "inline-block";
    if (navAdmin) navAdmin.style.display = "inline-block";
    if (navOverview) navOverview.style.display = "inline-block";
    if (navUsers) navUsers.style.display = "inline-block";
    if (role === "admin" && navSettings) navSettings.style.display = "inline-block";
    loadUsers();
  } catch (err) {
    usersMessage.textContent = err.message;
    usersMessage.className = "error";
  }
}

init();
