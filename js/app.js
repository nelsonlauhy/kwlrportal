// Simple view router
const views = {
  home: document.getElementById("view-home"),
  directory: document.getElementById("view-directory"),
  agents: document.getElementById("view-agents"),
  events: document.getElementById("view-events")
};

const appEl = document.getElementById("app");
const navEl = document.getElementById("appNav");
const landingEl = document.getElementById("landing");
const navUserEl = document.getElementById("navUser");

document.getElementById("btnLogin").addEventListener("click", () => window._auth.signIn());
document.getElementById("btnLogout").addEventListener("click", () => window._auth.signOut());

function showView(name) {
  for (const key in views) {
    views[key].classList.toggle("d-none", key !== name);
  }
}

function requireAuthGuard(routeName) {
  if (!window._auth.getActiveAccount()) {
    // Not signed in → send back to landing
    location.hash = "";
    return false;
  }
  return true;
}

function route() {
  const hash = (location.hash || "#home").replace("#", "");
  switch (hash) {
    case "directory":
      if (!requireAuthGuard("directory")) return;
      showView("directory");
      break;
    case "agents":
      if (!requireAuthGuard("agents")) return;
      showView("agents");
      break;
    case "events":
      if (!requireAuthGuard("events")) return;
      showView("events");
      break;
    default:
      if (!requireAuthGuard("home")) return;
      showView("home");
      break;
  }
}

function updateAuthUI() {
  const acct = window._auth.getActiveAccount();

  if (acct) {
    // Signed in: show app + navbar, hide landing
    landingEl.classList.add("d-none");
    appEl.classList.remove("d-none");
    navEl.classList.remove("d-none");

    // Show basic profile name/email from ID token claims (no Graph call yet)
    const name = acct.name || "(signed in)";
    const email = acct.username || "";
    navUserEl.textContent = `${name} ${email ? "· " + email : ""}`;

    route(); // render current hash view
  } else {
    // Signed out: show landing
    navEl.classList.add("d-none");
    appEl.classList.add("d-none");
    landingEl.classList.remove("d-none");
    showView("home");
  }
}

// Initial route + listener
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", updateAuthUI);
