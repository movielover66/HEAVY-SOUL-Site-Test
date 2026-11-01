// ============================================================
// HEAVY SOUL — AUTH (Firebase Auth, free Spark plan)
// Loaded on every page after config.js + the Firebase SDK
// <script> tags. Handles signup, login, logout, and keeps the
// header account icon in sync with the logged-in state.
// ============================================================

if (window.firebase && SITE_CONFIG.FIREBASE_CONFIG.apiKey !== "PASTE_API_KEY_HERE") {
  firebase.initializeApp(SITE_CONFIG.FIREBASE_CONFIG);
}

function authReady() {
  return window.firebase && firebase.apps.length > 0;
}

// ---- signup ----
async function authSignUp(name, email, password) {
  if (!authReady()) throw new Error("Auth not configured yet.");
  const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
  if (name) await cred.user.updateProfile({ displayName: name });
  return cred.user;
}

// ---- login ----
async function authLogIn(email, password) {
  if (!authReady()) throw new Error("Auth not configured yet.");
  const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
  return cred.user;
}

// ---- sign in with a token minted by our Worker (phone login, OTP login, signup) ----
async function authSignInWithCustomToken(token) {
  if (!authReady()) throw new Error("Auth not configured yet.");
  const cred = await firebase.auth().signInWithCustomToken(token);
  return cred.user;
}

// ---- google sign-in (popup) ----
async function authGoogleSignIn() {
  if (!authReady()) throw new Error("Auth not configured yet.");
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await firebase.auth().signInWithPopup(provider);
  return cred.user;
}

// ---- logout ----
async function authLogOut() {
  if (!authReady()) return;
  await firebase.auth().signOut();
  window.location.href = "index.html";
}

// ---- forgot password (email accounts) ----
async function authSendPasswordReset(email) {
  if (!authReady()) throw new Error("Auth not configured yet.");
  // Send users to our own branded reset page instead of Firebase's
  // generic firebaseapp.com page.
  const actionCodeSettings = {
    url: window.location.origin + "/reset-password.html"
  };
  await firebase.auth().sendPasswordResetEmail(email, actionCodeSettings);
}

// ---- check whether an account already exists for an email, and how ----
// Returns an array of sign-in provider ids, e.g. ["password"],
// ["google.com"], or [] if no account exists at all. This is the
// single source of truth for "does this account exist" — no separate
// Firestore index to keep in sync.
async function authFetchSignInMethods(email) {
  if (!authReady()) throw new Error("Auth not configured yet.");
  return firebase.auth().fetchSignInMethodsForEmail(email);
}

// ---- friendly error text ----
function authErrorMessage(err) {
  const map = {
    "auth/email-already-in-use": "An account already exists with this email. Please log in instead.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password is too weak. Use 8+ characters.",
    "auth/network-request-failed": "Network problem. Check your connection and try again.",
    "auth/user-disabled": "This account has been disabled. Please contact us.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email/phone or password.",
    "auth/too-many-requests": "Too many attempts. Please try again in a little while."
  };
  return map[err.code] || (err.message || "Something went wrong. Please try again.");
}

// ---- keep header account icon + menu link in sync ----
function renderAccountState(user) {
  const el = document.getElementById("accountBtn");
  if (el) {
    if (user) {
      el.title = user.displayName || "My Account";
      el.classList.add("logged-in");
    } else {
      el.title = "Login / Signup";
      el.classList.remove("logged-in");
    }
  }
  ["navLoginLink", "navLoginLinkMobile"].forEach(function (id) {
    const link = document.getElementById(id);
    if (!link) return;
    link.textContent = user ? "My Account" : "Login / Signup";
  });
}

document.addEventListener("DOMContentLoaded", function () {
  if (!authReady()) return;
  firebase.auth().onAuthStateChanged(renderAccountState);
});
