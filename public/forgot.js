const resetForm = document.getElementById("reset-form");
const resetMessage = document.getElementById("reset-message");
const sendCodeBtn = document.getElementById("send-code");
const emailInput = document.getElementById("email");

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return res.json();
}

async function sendResetCode(email) {
  return fetchJson("/api/auth/send-reset-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
}

async function resetPassword(payload) {
  return fetchJson("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

sendCodeBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) {
    resetMessage.textContent = "请先填写邮箱。";
    resetMessage.className = "error";
    return;
  }
  resetMessage.textContent = "正在发送验证码...";
  resetMessage.className = "muted";
  try {
    const result = await sendResetCode(email);
    let msg = `验证码已发送，有效期 ${result.expiresInMinutes} 分钟。`;
    if (result.devCode) {
      msg += ` 开发验证码：${result.devCode}`;
    }
    resetMessage.textContent = msg;
    resetMessage.className = "success";
  } catch (err) {
    resetMessage.textContent = err.message;
    resetMessage.className = "error";
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetMessage.textContent = "正在重置密码...";
  resetMessage.className = "muted";
  const formData = new FormData(resetForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await resetPassword(payload);
    resetMessage.textContent = "密码已重置，请返回登录。";
    resetMessage.className = "success";
  } catch (err) {
    resetMessage.textContent = err.message;
    resetMessage.className = "error";
  }
});

