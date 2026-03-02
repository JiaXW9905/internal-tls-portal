const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");

async function login(payload) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "登录失败");
  }
  return res.json();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "正在登录...";
  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    await login(payload);
    window.location.href = "/";
  } catch (err) {
    loginMessage.textContent = err.message;
    loginMessage.className = "error";
  }
});
