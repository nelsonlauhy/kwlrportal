// =====================
// MSAL CONFIG (unchanged)
// =====================
const msalConfig = {
  auth: {
    clientId: "7b8fff80-564a-40cd-a295-557ebb2c9a11",
    authority: "https://login.microsoftonline.com/9f6c51b3-4040-49cf-a898-30bb9f2cfc92",
    // Use origin to work across pages in same origin (index.html, events-admin.html, etc.)
    redirectUri: window.location.origin
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false
  }
};

// Scopes for Graph / OIDC
const loginRequest = {
  scopes: ["User.Read", "email", "openid", "profile"]
};

// A tiny helper: safe console once
function logOnce(key, msg) {
  if (!window.__kwlr_logs) window.__kwlr_logs = new Set();
  if (!window.__kwlr_logs.has(key)) {
    window.__kwlr_logs.add(key);
    console.log(msg);
  }
}

// Expose a promise the app can await
let _authReadyResolve;
window._authReady = new Promise((res) => (_authReadyResolve = res));

// =====================
// SAFETY: ensure MSAL loaded
// =====================
if (!window.msal || !window.msal.PublicClientApplication) {
  console.error("MSAL library not loaded. Check script order and network.");
  window._auth = {
    msalInstance: null,
    // Popup-style API expected by other pages
    signIn: () => alert("MSAL not loaded. Please check script order."),
    signOut: () => {},
    getActiveAccount: () => null,
    getAllAccounts: () => [],
    setActiveAccount: () => {}
  };
  // Resolve so pages won't hang forever (but they'll hit guard 403)
  if (_authReadyResolve) _authReadyResolve();
} else {
  // =====================
  // INIT
  // =====================
  const msalInstance = new msal.PublicClientApplication(msalConfig);

  // Normalized wrappers so every page can rely on the same shape
  const wrappers = {
    getActiveAccount: () => msalInstance.getActiveAccount() || null,
    getAllAccounts: () => msalInstance.getAllAccounts() || [],
    setActiveAccount: (acc) => {
      if (acc) msalInstance.setActiveAccount(acc);
    },
    // Prefer POPUP for same-page flows; fallback to redirect if popup blocked
    signIn: async (scopes = loginRequest.scopes) => {
      try {
        const resp = await msalInstance.loginPopup({ scopes });
        if (resp && resp.account) msalInstance.setActiveAccount(resp.account);
        return resp;
      } catch (err) {
        // Popup blocked? try redirect
        console.warn("[MSAL] loginPopup failed, falling back to loginRedirect:", err && err.message);
        await msalInstance.loginRedirect({ scopes });
        // flow continues after redirect
      }
    },
    signOut: async () => {
      try {
        await msalInstance.logoutRedirect({
          account: msalInstance.getActiveAccount(),
          postLogoutRedirectUri: window.location.origin
        });
      } catch (e) {
        console.error("Logout error:", e);
        alert("Logout failed. Please try again.");
      }
    },
    // Optional helper many pages find useful
    acquireTokenSilent: async (scopes = loginRequest.scopes) => {
      const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
      if (!account) throw new Error("No active account");
      try {
        const resp = await msalInstance.acquireTokenSilent({ account, scopes });
        return resp && resp.accessToken;
      } catch (err) {
        console.warn("[MSAL] acquireTokenSilent failed; trying popup:", err && err.message);
        const resp = await msalInstance.acquireTokenPopup({ account, scopes });
        return resp && resp.accessToken;
      }
    }
  };

  // Handle redirect result (after login/logout)
  msalInstance
    .handleRedirectPromise()
    .then((response) => {
      if (response && response.account) {
        msalInstance.setActiveAccount(response.account);
      } else {
        const existing = msalInstance.getAllAccounts()[0];
        if (existing) msalInstance.setActiveAccount(existing);
      }

      // Expose unified _auth
      window._auth = { msalInstance, ...wrappers };

      // Inform any UI hook
      if (typeof window.updateAuthUI === "function") {
        try { window.updateAuthUI(); } catch (_) {}
      }

      logOnce("msal-init", "[MSAL] Initialized. Accounts: " + msalInstance.getAllAccounts().length);
      if (_authReadyResolve) _authReadyResolve();
    })
    .catch((error) => {
      console.error("MSAL redirect error:", error);
      // Even on error, expose the API so callers can attempt popup
      window._auth = { msalInstance, ...wrappers };
      if (_authReadyResolve) _authReadyResolve();
    });

  // In case no redirect happens at all (first load without any auth):
  // expose the API early so pages can call signIn()/getAllAccounts()
  window._auth = { msalInstance, ...wrappers };
}

