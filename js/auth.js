// =====================
// MSAL CONFIG
// =====================
const msalConfig = {
  auth: {
    clientId: "7b8fff80-564a-40cd-a295-557ebb2c9a11",
    authority: "https://login.microsoftonline.com/9f6c51b3-4040-49cf-a898-30bb9f2cfc92",
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

// =====================
// SAFETY: ensure MSAL loaded
// =====================
if (!window.msal || !window.msal.PublicClientApplication) {
  console.error("MSAL library not loaded. Check script order and network.");
  window._auth = {
    msalInstance: null,
    signIn: () => alert("MSAL not loaded. Please check script order."),
    signOut: () => {},
    getActiveAccount: () => null
  };
} else {
  // =====================
  // INIT
  // =====================
  const msalInstance = new msal.PublicClientApplication(msalConfig);

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
      // Let app.js refresh UI if it registered the function
      if (typeof window.updateAuthUI === "function") {
        window.updateAuthUI();
      }
    })
    .catch((error) => {
      console.error("MSAL redirect error:", error);
    });

  // =====================
  // ACTIONS
  // =====================
  async function signIn() {
    try {
      await msalInstance.loginRedirect(loginRequest);
    } catch (e) {
      console.error("Login error:", e);
      alert("Sign-in failed. Please try again.");
    }
  }

  async function signOut() {
    try {
      await msalInstance.logoutRedirect({
        account: msalInstance.getActiveAccount(),
        postLogoutRedirectUri: window.location.origin
      });
    } catch (e) {
      console.error("Logout error:", e);
      alert("Logout failed. Please try again.");
    }
  }

  function getActiveAccount() {
    return msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null;
  }

  // Expose for app.js
  window._auth = { msalInstance, signIn, signOut, getActiveAccount };
}
