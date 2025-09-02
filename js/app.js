// Simple view router
const views = {
  home: document.getElementById("view-home"),
  directory: document.getElementById("view-directory"),
  agents: document.getElementById("view-agents"),
  events: document.getElementById("view-events"),
};

const appEl = document.getElementById("app");
const landingEl = document.getElementById("landing");

// 🔧 以函數動態取得 navbar 元素（因為 partial 係之後先注入）
function getNavEls() {
  return {
    navEl: document.getElementById("appNav"),
    navUserEl: document.getElementById("navUser"),
  };
}

// 事件：登入／登出
document.getElementById("btnLogin")?.addEventListener("click", () => window._auth.signIn());

// 🔧 用事件委派處理登出（因為 #btnLogout 係 partial 注入後先出現）
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "btnLogout") {
    sessionStorage.removeItem("kwlr_auto_login_done");
    window._auth.signOut();
  }
});

function showView(name) {
  for (const key in views) {
    views[key].classList.toggle("d-none", key !== name);
  }
}

function requireAuthGuard() {
  return !!(window._auth && window._auth.getActiveAccount && window._auth.getActiveAccount());
}

function route() {
  const hash = (location.hash || "#home").replace("#", "");
  if (!requireAuthGuard()) {
    location.hash = "";
    return;
  }
  switch (hash) {
    case "directory":
      showView("directory");
      break;
    case "agents":
      showView("agents");
      break;
    case "events":
      showView("events");
      break;
    default:
      showView("home");
      break;
  }
}

function updateAuthUI() {
  const acct = window._auth && window._auth.getActiveAccount ? window._auth.getActiveAccount() : null;
  const { navEl, navUserEl } = getNavEls(); // 🔧 每次即時取（確保 partial 已注入）

  if (acct) {
    // Signed in
    landingEl.classList.add("d-none");
    appEl.classList.remove("d-none");
    if (navEl) navEl.classList.remove("d-none"); // 🔧 只有存在時先移除 d-none

    const name = acct.name || "(signed in)";
    const email = acct.username || "";
    if (navUserEl) navUserEl.textContent = `${name}${email ? " · " + email : ""}`;

    route();
  } else {
    // Signed out
    if (navEl) navEl.classList.add("d-none");
    appEl.classList.add("d-none");
    landingEl.classList.remove("d-none");
    showView("home");
  }
}

// 🔧 讓 auth.js 可以安全呼叫
window.updateAuthUI = updateAuthUI;

// 路由事件
window.addEventListener("hashchange", route);

// 初始：DOM Ready 時更新一次（如果 partial 未 ready，下面仲有一槍）
document.addEventListener("DOMContentLoaded", updateAuthUI);

// 🔧 partials 載入完成後再更新一次（關鍵！）
document.addEventListener("partials:loaded", updateAuthUI);
