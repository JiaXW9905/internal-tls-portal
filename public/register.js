const registerForm = document.getElementById("register-form");
const registerMessage = document.getElementById("register-message");
const sendCodeBtn = document.getElementById("send-code");
const emailInput = document.getElementById("email");

async function register(payload) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "注册失败");
  }
  return res.json();
}

async function sendCode(email) {
  const res = await fetch("/api/auth/send-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "验证码发送失败");
  }
  return res.json();
}

sendCodeBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) {
    registerMessage.textContent = "请先填写邮箱。";
    registerMessage.className = "error";
    return;
  }
  registerMessage.textContent = "正在发送验证码...";
  registerMessage.className = "muted";
  try {
    const result = await sendCode(email);
    let msg = `验证码已发送，有效期 ${result.expiresInMinutes} 分钟。`;
    if (result.devCode) {
      msg += ` 开发验证码：${result.devCode}`;
    }
    registerMessage.textContent = msg;
    registerMessage.className = "success";
  } catch (err) {
    registerMessage.textContent = err.message;
    registerMessage.className = "error";
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerMessage.textContent = "正在创建账号...";
  const formData = new FormData(registerForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    await register(payload);
    window.location.href = "/";
  } catch (err) {
    registerMessage.textContent = err.message;
    registerMessage.className = "error";
  }
});
