// --- MSAL CONFIG (yours) ---
const msalConfig = {
  auth: {
    clientId: "17f20b04-4113-4a8a-baaf-5dc56b284dac",
    authority: "https://login.microsoftonline.com/9f6c51b3-4040-49cf-a898-30bb9f2cfc92",
    redirectUri: window.location.origin
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false
  }
};

// Optional: scopes if you’ll call Graph later (e.g., read profile/email)
const loginRequest = {
  scopes: ["User.Read", "email", "openid", "profile"]
};

const msalInstance = new msal.PublicClientApplication(msalConfig);

// Handle redirect response if returning from login
msalInstance.handleRedirectPromise().then((response) => {
  if (response && response.account) {
    msalInstance.setActiveAccount(response.account);
  } else {
    const account = msalInstance.getAllAccounts()[0];
    if (account) msalInstance.setActiveAccount(account);
  }
  updateAuthUI();
}).catch((error) => {
  console.error("MSAL redirect error:", error);
});

async function signIn() {
  try {
    // Use redirect for best compatibility with third-party cookies disabled
    await msalInstance.loginRedirect(loginRequest);
  } catch (e) {
    console.error("Login error:", e);
  }
}

async function signOut() {
  const account = msalInstance.getActiveAccount();
  try {
    await msalInstance.logoutRedirect({
      account,
      postLogoutRedirectUri: window.location.origin
    });
  } catch (e) {
    console.error("Logout error:", e);
  }
}

function getActiveAccount() {
  return msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null;
}

// Expose to app.js
window._auth = { msalInstance, signIn, signOut, getActiveAccount };
