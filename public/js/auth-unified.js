// ============================================================
// HEAVY SOUL — UNIFIED LOGIN / SIGNUP
// Include on account.html AFTER config.js, auth.js, msg91-otp.js and the
// Firebase app/auth/firestore compat SDKs. The step markup lives in
// account.html; css/auth.css styles it.
//
// HOW ACCOUNTS WORK NOW
//  • New signup collects name + email + mobile + password. The mobile is
//    verified with an MSG91 OTP, then the WORKER (/api/signup) creates one
//    Firebase account that holds both the real email and the phone number.
//    The browser cannot skip the OTP any more.
//  • Log in with EMAIL + password  → Firebase directly.
//  • Log in with MOBILE + password → Worker (/api/login-phone) → custom token.
//  • Log in with MOBILE + SMS OTP  → Worker (/api/login-otp)   → custom token.
//  • Google sign-in is unchanged.
//  • Old phone-only accounts (synthetic <phone>@phone.heavysoul.in) keep
//    working: the Worker finds them by phone.
//  • Forgot password: email → Firebase reset link; mobile → OTP → Worker.
//
// SMART "ALREADY A USER" CHECK
// accountIndex/{key} is a public, data-free marker (uid, provider, linked)
// so the page can say "account found" BEFORE login. Keys:
//    email  → the lowercased email
//    mobile → "phone_<10 digits>"
//
// Firestore rules (Firebase Console → Firestore → Rules):
//   match /accountIndex/{id} {
//     allow get: if true;
//     allow list: if false;
//     allow create: if request.auth != null
//                   && request.auth.uid == request.resource.data.uid;
//     allow update, delete: if false;
//   }
//   match /users/{uid} {
//     allow get, create, update: if request.auth != null && request.auth.uid == uid;
//   }
// ============================================================

const AUTH_RESEND_LIMIT = 3;
const AUTH_RESEND_SECONDS = 30;
// OTP code length = the number of boxes. Must match the length set in the MSG91
// widget (dashboard). Currently 4 digits. Change both together to use 6.
const AUTH_OTP_LENGTH = 4;
const AUTH_OTP_MIN = 4;
const U_OTP_BTN = { uAuthOtpInput: "uAuthVerifyOtpBtn", uResetOtpInput: "uResetVerifyOtpBtn", uOtpLoginInput: "uOtpLoginVerifyBtn" };
const AUTH_MAX_FAILS = 5;       // wrong passwords before a short lock (courtesy only —
const AUTH_LOCK_SECONDS = 30;   // Firebase enforces the real limit server-side)

const U_STEPS = ["entry", "login", "otplogin", "signup", "forgotsent", "reset", "done"];

let _authIdentifierType = null; // 'email' | 'phone'
let _authIdentifierKey = null;  // lowercased email, or 'phone_<10digits>'
let _authIdentifierRaw = "";
let _authIndexData = null;      // data from accountIndex for the typed identifier

let _failCount = 0;
let _lockUntil = 0;
let _lockTimer = null;

// per-flow OTP state
let _otpCtx = null;             // 'signup' | 'reset' | 'login'
let _otpToken = null;           // MSG91 access token returned by the widget
let _otpPhone = null;           // 10-digit phone the token was issued for
let _otpResend = { signup: 0, reset: 0, login: 0 };
let _otpTimers = {};
let _signupVerifiedPhone = null;

let _detectTimer = null;
let _dupTimer = null;
let _detectSeq = 0;
let _shakeN = 0;

// ---------- small helpers ----------
function uEl(id) { return document.getElementById(id); }

function normalizeIdentifier_(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  // Email first: a typed email can contain 10 digits and must not be read as a phone.
  if (value.indexOf("@") > -1) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
      ? { type: "email", key: value.toLowerCase(), email: value.toLowerCase() }
      : null;
  }
  const digits = value.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (/^[6-9]\d{9}$/.test(last10) && digits.length <= 12 && /^[\d\s+\-()]+$/.test(value)) {
    return { type: "phone", key: "phone_" + last10, phone: last10 };
  }
  return null;
}

function uCleanPhone_(raw) {
  const p = normalizeIdentifier_(raw);
  return p && p.type === "phone" ? p.phone : null;
}

function uMask_(parsed) {
  if (parsed.type === "email") {
    const parts = parsed.email.split("@");
    return parts[0].charAt(0) + "•••@" + parts[1];
  }
  return "+91 " + parsed.phone.slice(0, 2) + "•••••" + parsed.phone.slice(-3);
}

function uShowMsg_(text, isError) {
  const el = uEl("uAuthMsg");
  if (!el) return;
  el.textContent = text || "";
  el.className = "u-auth-msg" + (text ? " show" : "") + (text && isError ? " error" : "");
  if (text && isError) {
    _shakeN++;
    el.classList.add(_shakeN % 2 ? "shk1" : "shk2");
  }
}

function uShowStep_(step) {
  U_STEPS.forEach(function (s) {
    const el = uEl("uAuthStep-" + s);
    if (!el) return;
    const on = s === step;
    el.classList.toggle("is-active", on);
    if (on) {
      el.classList.remove("enter");
      void el.offsetWidth; // restart the entrance animation
      el.classList.add("enter");
    }
  });
  const tabs = uEl("uAuthTabs");
  if (tabs) {
    const showTabs = step === "entry" || step === "signup";
    tabs.style.display = showTabs ? "flex" : "none";
    const signup = step === "signup";
    uEl("uTabLogin").classList.toggle("on", !signup);
    uEl("uTabSignup").classList.toggle("on", signup);
    uEl("uTabLogin").setAttribute("aria-pressed", String(!signup));
    uEl("uTabSignup").setAttribute("aria-pressed", String(signup));
  }
  uShowMsg_("");
  const first = document.querySelector("#uAuthStep-" + step + " input:not([type=checkbox]):not([readonly]):not(.otp-input)");
  if (first && window.innerWidth > 860) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
}

let _busyCount = 0;
function uBusy_(id, on, label) {
  const b = uEl(id);
  if (!b) return;
  const was = b.dataset.busy === "1";
  if (on && !was) { b.dataset.busy = "1"; b.dataset.label = b.textContent; _busyCount++; }
  if (!on && was) { b.dataset.busy = "0"; _busyCount = Math.max(0, _busyCount - 1); }
  b.classList.toggle("is-loading", !!on);
  b.disabled = !!on;
  if (on && label) b.textContent = label;
  if (!on && was && b.dataset.label) b.textContent = b.dataset.label;
  const panel = document.querySelector(".auth-panel");
  if (panel) panel.classList.toggle("is-busy", _busyCount > 0);
}

// Keep the account page from swapping the form for "My account" while the
// success animation is still playing.
function uHold_() { window.__hsAuthHold = true; }
function uRelease_() { window.__hsAuthHold = false; window.dispatchEvent(new CustomEvent("hs:authRelease")); }
function uSuccess_(title, sub, after, keepHold) {
  uEl("uDoneTitle").textContent = title;
  uEl("uDoneSub").textContent = sub || "";
  uShowStep_("done");
  setTimeout(function () {
    if (!keepHold) uRelease_();
    if (after) after();
  }, 1500);
}

function uTogglePw(inputId, btn) {
  const el = uEl(inputId);
  const show = el.type === "password";
  el.type = show ? "text" : "password";
  btn.classList.toggle("shown", show);
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
}

async function uPost_(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = {}; }
  return { ok: res.ok, status: res.status, data: data || {} };
}

// Only allow going back to a page on this site (blocks ?redirect=https://evil.com).
function uAuthSuccess_() {
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  if (redirect && /^[A-Za-z0-9_\-]+\.html(\?[^\s]*)?$/.test(redirect)) {
    window.location.href = redirect;
  }
}

// "Does this account exist?" — asked to the Worker, which checks Firebase
// Authentication itself. That finds EVERY real user (old phone-only accounts,
// accounts made before the index existed, accounts added from the Firebase
// console), not only the ones that have a Firestore accountIndex marker.
// If the Worker cannot be reached we fall back to the index marker.
const _acctCache = {};
async function uLookupAccount_(key) {
  if (Object.prototype.hasOwnProperty.call(_acctCache, key)) return _acctCache[key];
  let result;
  try {
    const isPhone = key.indexOf("phone_") === 0;
    const r = await uPost_("/api/account-check", { type: isPhone ? "phone" : "email", value: isPhone ? key.slice(6) : key });
    if (!r.ok || typeof r.data.exists !== "boolean") throw new Error("account-check failed");
    result = r.data.exists ? { provider: r.data.provider || "password", linked: r.data.linked || [] } : null;
  } catch (e) {
    result = await uLookupIndex_(key);
  }
  _acctCache[key] = result;
  return result;
}

async function uLookupIndex_(key) {
  const doc = await firebase.firestore().collection("accountIndex").doc(key).get();
  return doc.exists ? (doc.data() || {}) : null;
}

// ---------- password strength ----------
function uStrength_(pw) {
  pw = pw || "";
  const r = {
    len: pw.length >= 8,
    "case": /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    num: /\d/.test(pw),
    sym: /[^A-Za-z0-9]/.test(pw)
  };
  const classes = (/[a-z]/.test(pw) ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) + r.num + r.sym;
  const score = pw ? (pw.length >= 8 ? Math.max(1, Math.min(4, classes)) : Math.min(1, classes)) : 0;
  const ok = pw.length >= 8 && classes >= 3; // same rule as the Worker
  return { rules: r, score: score, ok: ok, label: !pw ? "Not set" : ["Too weak", "Weak", "Fair", "Strong", "Very strong"][score] };
}

function uBindStrength_(inputId, meterId, labelId, rulesId) {
  const input = uEl(inputId);
  if (!input) return;
  input.addEventListener("input", function () {
    const s = uStrength_(input.value);
    uEl(meterId).setAttribute("data-s", String(s.score));
    uEl(labelId).textContent = s.label;
    document.querySelectorAll("#" + rulesId + " li").forEach(function (li) {
      li.classList.toggle("ok", !!s.rules[li.getAttribute("data-r")]);
    });
  });
}

// ---------- OTP boxes (one real input on top: paste + SMS autofill work) ----------
function uRenderBoxes_(inputId, boxesId, wrapId, bad) {
  const v = uEl(inputId).value;
  const wrap = uEl(wrapId);
  if (wrap) wrap.classList.toggle("bad", !!bad);
  let html = "";
  for (let i = 0; i < AUTH_OTP_LENGTH; i++) {
    const ch = v.charAt(i);
    html += '<div class="otp-box' + (ch ? " fill" : "") + (i === v.length ? " act" : "") + '">' + (ch || "") + "</div>";
  }
  uEl(boxesId).innerHTML = html;
  const vb = uEl(U_OTP_BTN[inputId]);
  if (vb && vb.dataset.busy !== "1") vb.disabled = v.length < AUTH_OTP_MIN;
}

function uBindOtp_(inputId, boxesId, wrapId, onComplete) {
  const input = uEl(inputId);
  if (!input) return;
  uRenderBoxes_(inputId, boxesId, wrapId);
  input.addEventListener("input", function () {
    input.value = input.value.replace(/\D/g, "").slice(0, AUTH_OTP_LENGTH);
    uRenderBoxes_(inputId, boxesId, wrapId);
    if (input.value.length === AUTH_OTP_LENGTH) onComplete();
  });
}

function uOtpClear_(inputId, boxesId, wrapId, bad) {
  const input = uEl(inputId);
  input.value = "";
  input.disabled = false;
  uRenderBoxes_(inputId, boxesId, wrapId, bad);
}

function uStartTimer_(ctx, btnId, idleLabel) {
  const btn = uEl(btnId);
  let seconds = AUTH_RESEND_SECONDS;
  btn.disabled = true;
  btn.textContent = "Resend OTP (" + seconds + "s)";
  clearInterval(_otpTimers[ctx]);
  _otpTimers[ctx] = setInterval(function () {
    seconds--;
    if (seconds > 0) { btn.textContent = "Resend OTP (" + seconds + "s)"; return; }
    clearInterval(_otpTimers[ctx]);
    const limit = _otpResend[ctx] >= AUTH_RESEND_LIMIT;
    btn.disabled = limit;
    btn.textContent = limit ? "Resend limit reached" : "Resend OTP";
  }, 1000);
}

function uSetBlock_(id, show) {
  const el = uEl(id);
  if (el) el.style.display = show ? "flex" : "none";
}

// ---------- startup ----------
document.addEventListener("DOMContentLoaded", function () {
  if (!uEl("uAuthStep-entry")) return;

  uBindStrength_("uAuthSignupPassword", "uSignupMeter", "uSignupMeterLabel", "uSignupRules");
  uBindStrength_("uResetNewPassword", "uResetMeter", "uResetMeterLabel", "uResetRules");

  uBindOtp_("uAuthOtpInput", "uSignupOtpBoxes", "uSignupOtpWrap", function () { uHandleVerifyOtp(); });
  uBindOtp_("uResetOtpInput", "uResetOtpBoxes", "uResetOtpWrap", function () { uHandleResetVerifyOtp(); });
  uBindOtp_("uOtpLoginInput", "uOtpLoginBoxes", "uOtpLoginWrap", function () { uOtpLoginVerify(); });

  // live "do we know you?" detector
  // The "do we know you?" check now runs silently on Continue only.

  // signup: live duplicate hints + reset OTP verification if the number changes
  uEl("uAuthSignupEmail").addEventListener("input", function () { clearTimeout(_dupTimer); _dupTimer = setTimeout(uSignupDupCheck_, 450); });
  uEl("uAuthSignupPhone").addEventListener("input", function () {
    const el = uEl("uAuthSignupPhone");
    el.value = el.value.replace(/[^\d\s+\-]/g, "");
    if (_signupVerifiedPhone && uCleanPhone_(el.value) !== _signupVerifiedPhone) uSignupUnverify_();
    clearTimeout(_dupTimer); _dupTimer = setTimeout(uSignupDupCheck_, 450);
  });
  ["uOtpLoginPhone", "uResetPhone"].forEach(function (id) {
    uEl(id).addEventListener("input", function () { const e = uEl(id); e.value = e.value.replace(/[^\d\s+\-]/g, ""); });
  });

  uBackToEntry();
});

// ---------- tabs / navigation ----------
function uResetIdentifier_() {
  _authIdentifierType = null; _authIdentifierKey = null; _authIdentifierRaw = ""; _authIndexData = null;
}

function uBackToEntry() {
  uResetIdentifier_();
  _otpCtx = null; _otpToken = null; _otpPhone = null;
  Object.keys(_otpTimers).forEach(function (k) { clearInterval(_otpTimers[k]); });
  _otpResend = { signup: 0, reset: 0, login: 0 };
  uEl("uAuthIdentifier").value = "";
  uEl("uAuthLoginPassword").value = "";
  uDetectHide_();
  uShowStep_("entry");
}

function uSwitchTab(which) {
  if (which === "signup") {
    uPrepareSignup_("", "");
  } else {
    uBackToEntry();
  }
}

// ---------- smart detector ----------
function uDetectHide_() {
  const chip = uEl("uAuthDetect");
  if (chip) { chip.className = "u-chip"; }
}
function uDetectShow_(cls, text) {
  const chip = uEl("uAuthDetect");
  chip.className = "u-chip show " + (cls || "");
  uEl("uAuthDetectText").textContent = text;
}

async function uDetect_() {
  const raw = uEl("uAuthIdentifier").value.trim();
  if (!raw) { uDetectHide_(); return; }
  const parsed = normalizeIdentifier_(raw);
  if (!parsed) {
    if (raw.indexOf("@") > -1) uDetectShow_("", "Email · keep typing");
    else if (/^[\d\s+\-()]+$/.test(raw)) uDetectShow_("", "Mobile number · keep typing");
    else uDetectShow_("", "Enter an email or a 10-digit mobile number");
    return;
  }
  const seq = ++_detectSeq;
  uDetectShow_("", "Checking…");
  try {
    const data = await uLookupAccount_(parsed.key);
    if (seq !== _detectSeq) return; // a newer keystroke won
    if (data) uDetectShow_("found", "Account found · press Continue to log in");
    else uDetectShow_("new", (parsed.type === "email" ? "Email" : "Mobile number") + " recognised · no account yet");
  } catch (e) {
    if (seq === _detectSeq) uDetectHide_();
  }
}

// ---------- Google ----------
async function uHandleGoogle() {
  try {
    uShowMsg_("Opening Google sign-in…");
    uHold_();
    const user = await authGoogleSignIn();
    const googleKey = String(user.email || "").toLowerCase();
    const db = firebase.firestore();
    // Only create records that do not exist yet — an existing index doc
    // cannot be overwritten under the Firestore rules (and must not be).
    const existingIndex = await uLookupIndex_(googleKey);
    const userDoc = await db.collection("users").doc(user.uid).get();
    if (!userDoc.exists) {
      await db.collection("users").doc(user.uid).set({
        name: user.displayName || "", email: user.email || "", provider: "google",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    if (!existingIndex) {
      await db.collection("accountIndex").doc(googleKey).set({ uid: user.uid, provider: "google" });
    }
    uShowMsg_("");
    if (typeof renderAccountState === "function") renderAccountState(user);
    uSuccess_("Welcome, " + (user.displayName || "").split(" ")[0] + ".", "Signed in with Google.", uAuthSuccess_);
  } catch (err) {
    uRelease_();
    uShowMsg_(authErrorMessage ? authErrorMessage(err) : String(err), true);
  }
}

// ---------- entry → login or signup ----------
async function uHandleContinue() {
  const raw = uEl("uAuthIdentifier").value;
  const parsed = normalizeIdentifier_(raw);
  if (!parsed) {
    uShowMsg_("Please enter a valid email or 10-digit mobile number.", true);
    return;
  }
  _authIdentifierType = parsed.type;
  _authIdentifierKey = parsed.key;
  _authIdentifierRaw = raw.trim();
  uBusy_("uAuthContinueBtn", true, "Checking…");
  try {
    const data = await uLookupAccount_(parsed.key);
    uBusy_("uAuthContinueBtn", false);
    _authIndexData = data;
    if (data) {
      if (data.provider === "google") {
        uShowMsg_("This account uses Google sign-in. Please use “Continue with Google” above.", true);
        return;
      }
      uOpenLoginStep_(parsed, data);
    } else {
      uPrepareSignup_(parsed.type === "email" ? parsed.email : "", parsed.type === "phone" ? parsed.phone : "");
      uShowMsg_("No account found for " + uMask_(parsed) + ". Create one below. It takes a minute.");
    }
  } catch (err) {
    uBusy_("uAuthContinueBtn", false);
    uShowMsg_("Something went wrong. Please try again.", true);
  }
}

function uOpenLoginStep_(parsed, data) {
  _authIdentifierType = parsed.type;
  _authIdentifierKey = parsed.key;
  _authIndexData = data || null;
  uEl("uAuthLoginLabel").textContent = uMask_(parsed);
  uEl("uAuthLoginPassword").value = "";
  const linked = data && Array.isArray(data.linked) && data.linked.length > 1;
  uEl("uAuthLinked").classList.toggle("show", !!linked);
  uShowStep_("login");
  uUpdateLockUi_();
}

// ---------- login (password) ----------
function uUpdateLockUi_() {
  const btn = uEl("uAuthLoginBtn");
  if (!btn) return;
  clearInterval(_lockTimer);
  function tick() {
    const left = Math.ceil((_lockUntil - Date.now()) / 1000);
    if (left > 0) {
      btn.disabled = true;
      btn.textContent = "Locked · try again in " + left + "s";
    } else {
      clearInterval(_lockTimer);
      btn.disabled = false;
      btn.textContent = "Log in";
      if (_lockUntil) { _lockUntil = 0; _failCount = 0; uShowMsg_(""); }
    }
  }
  if (_lockUntil > Date.now()) { tick(); _lockTimer = setInterval(tick, 500); }
  else { btn.disabled = false; btn.textContent = "Log in"; }
}

function uRegisterFail_(serverLocked) {
  _failCount++;
  if (serverLocked || _failCount >= AUTH_MAX_FAILS) {
    _lockUntil = Date.now() + AUTH_LOCK_SECONDS * 1000;
    uUpdateLockUi_();
    uShowMsg_("Too many wrong attempts. Please wait a moment, or log in with a mobile OTP.", true);
  }
}

async function uHandleLogin() {
  if (_lockUntil > Date.now()) return;
  const password = uEl("uAuthLoginPassword").value;
  if (!password) { uShowMsg_("Please enter your password.", true); return; }

  uBusy_("uAuthLoginBtn", true, "Logging in…");
  uShowMsg_("");
  uHold_();
  try {
    const remember = uEl("uAuthRemember").checked;
    await firebase.auth().setPersistence(remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);

    let user;
    if (_authIdentifierType === "phone") {
      const r = await uPost_("/api/login-phone", { phone: _authIdentifierKey.replace("phone_", ""), password: password });
      if (!r.ok || !r.data.customToken) {
        uBusy_("uAuthLoginBtn", false);
        uRelease_();
        uRegisterFail_(r.status === 429);
        if (_lockUntil <= Date.now()) {
          const left = AUTH_MAX_FAILS - _failCount;
          uShowMsg_((r.data.error || "Incorrect mobile number or password.") + (left > 0 && r.status === 401 ? " " + left + " " + (left === 1 ? "attempt" : "attempts") + " left." : ""), true);
        }
        return;
      }
      user = await authSignInWithCustomToken(r.data.customToken);
    } else {
      user = await authLogIn(_authIdentifierKey, password);
    }
    uBusy_("uAuthLoginBtn", false);
    _failCount = 0;
    uShowMsg_("");
    if (typeof renderAccountState === "function") renderAccountState(user);
    uSuccess_("Welcome back.", "Signed in securely.", uAuthSuccess_);
  } catch (err) {
    uBusy_("uAuthLoginBtn", false);
    uRelease_();
    const tooMany = err && err.code === "auth/too-many-requests";
    uRegisterFail_(tooMany);
    if (_lockUntil <= Date.now()) {
      const left = AUTH_MAX_FAILS - _failCount;
      const base = authErrorMessage ? authErrorMessage(err) : String(err);
      uShowMsg_(base + (left > 0 && left < AUTH_MAX_FAILS ? " " + left + " " + (left === 1 ? "attempt" : "attempts") + " left." : ""), true);
    }
  }
}

// ---------- login with SMS OTP ----------
function uStartOtpLogin() {
  uEl("uOtpLoginPhone").value = _authIdentifierType === "phone" ? _authIdentifierKey.replace("phone_", "") : "";
  uEl("uOtpLoginPhone").readOnly = false;
  uSetBlock_("uOtpLoginBlock", false);
  uEl("uOtpLoginSendBtn").style.display = "";
  _otpResend.login = 0;
  uShowStep_("otplogin");
}

async function uOtpLoginSend() {
  const phone = uCleanPhone_(uEl("uOtpLoginPhone").value);
  if (!phone) { uShowMsg_("Please enter a valid 10-digit mobile number.", true); return; }
  if (_otpResend.login >= AUTH_RESEND_LIMIT) return;
  _otpCtx = "login";
  _otpPhone = phone;
  uBusy_("uOtpLoginSendBtn", true, "Sending…");
  try {
    const data = await uLookupAccount_("phone_" + phone);
    if (!data) {
      uBusy_("uOtpLoginSendBtn", false);
      uShowMsg_("No account uses this number yet. Sign up instead, or use the email you registered with.", true);
      return;
    }
    await hsSendOtp("91" + phone);
    _otpResend.login++;
    uBusy_("uOtpLoginSendBtn", false);
    uEl("uOtpLoginPhone").readOnly = true;
    uSetBlock_("uOtpLoginBlock", true);
    uOtpClear_("uOtpLoginInput", "uOtpLoginBoxes", "uOtpLoginWrap");
    uEl("uOtpLoginInput").focus();
    uShowMsg_("OTP sent to +91 " + phone.slice(0, 2) + "•••••" + phone.slice(-3) + ".");
    uStartTimer_("login", "uOtpLoginSendBtn");
    uEl("uOtpLoginSendBtn").style.display = "";
  } catch (err) {
    uBusy_("uOtpLoginSendBtn", false);
    uShowMsg_("Could not send OTP. Please try again.", true);
  }
}

async function uOtpLoginVerify() {
  const otp = uEl("uOtpLoginInput").value.trim();
  if (otp.length < AUTH_OTP_MIN) { uShowMsg_("Please enter the code we sent you.", true); return; }
  _otpCtx = "login";
  uShowMsg_("");
  uBusy_("uOtpLoginVerifyBtn", true, "Verifying…");
  uEl("uOtpLoginInput").disabled = true;
  try {
    await hsVerifyOtp(otp);
  } catch (err) {
    uBusy_("uOtpLoginVerifyBtn", false);
    uEl("uOtpLoginInput").disabled = false;
    uShowMsg_("Could not verify. Please try again.", true);
  }
}

async function uFinishOtpLogin_() {
  try {
    const r = await uPost_("/api/login-otp", { accessToken: _otpToken, phone: _otpPhone });
    uBusy_("uOtpLoginVerifyBtn", false);
    if (!r.ok || !r.data.customToken) {
      uRelease_();
      uOtpClear_("uOtpLoginInput", "uOtpLoginBoxes", "uOtpLoginWrap", true);
      uShowMsg_(r.data.error || "Could not log you in. Please try again.", true);
      return;
    }
    await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const user = await authSignInWithCustomToken(r.data.customToken);
    uBusy_("uOtpLoginVerifyBtn", false);
    uShowMsg_("");
    if (typeof renderAccountState === "function") renderAccountState(user);
    uSuccess_("Welcome back.", "Signed in with your mobile OTP.", uAuthSuccess_);
  } catch (err) {
    uBusy_("uOtpLoginVerifyBtn", false);
    uRelease_();
    uShowMsg_(authErrorMessage ? authErrorMessage(err) : String(err), true);
  }
}

// ---------- forgot password ----------
async function uHandleForgot() {
  if (_authIdentifierType === "phone") {
    uPrepareReset_(_authIdentifierKey.replace("phone_", ""));
    return;
  }
  const email = _authIdentifierKey;
  try {
    await authSendPasswordReset(email);
  } catch (err) {
    // Same screen whether or not the account exists (no account probing here).
    if (err && err.code === "auth/too-many-requests") {
      uShowMsg_(authErrorMessage(err), true);
      return;
    }
  }
  uEl("uSentTo").textContent = email;
  uShowStep_("forgotsent");
}

function uResetViaPhone() { uPrepareReset_(""); }

function uPrepareReset_(phone) {
  _otpResend.reset = 0;
  _otpToken = null;
  uEl("uResetPhone").value = phone || "";
  uEl("uResetPhone").readOnly = false;
  uSetBlock_("uResetOtpField", false);
  uSetBlock_("uResetPasswordField", false);
  uEl("uResetVerified").classList.remove("show");
  uEl("uResetSendOtpBtn").style.display = "";
  uEl("uResetSendOtpBtn").disabled = false;
  uEl("uResetSendOtpBtn").textContent = "Send OTP";
  uEl("uResetNewPassword").value = "";
  uEl("uResetMeter").setAttribute("data-s", "0");
  uEl("uResetMeterLabel").textContent = "Not set";
  document.querySelectorAll("#uResetRules li").forEach(function (li) { li.classList.remove("ok"); });
  uShowStep_("reset");
}

async function uHandleResetSendOtp() {
  if (_otpResend.reset >= AUTH_RESEND_LIMIT) return;
  const phone = uCleanPhone_(uEl("uResetPhone").value);
  if (!phone) { uShowMsg_("Please enter a valid 10-digit mobile number.", true); return; }
  _otpCtx = "reset";
  _otpPhone = phone;
  uBusy_("uResetSendOtpBtn", true, "Sending…");
  try {
    await hsSendOtp("91" + phone);
    _otpResend.reset++;
    uBusy_("uResetSendOtpBtn", false);
    uEl("uResetPhone").readOnly = true;
    uSetBlock_("uResetOtpField", true);
    uOtpClear_("uResetOtpInput", "uResetOtpBoxes", "uResetOtpWrap");
    uEl("uResetOtpInput").focus();
    uShowMsg_("OTP sent.");
    uStartTimer_("reset", "uResetSendOtpBtn");
  } catch (err) {
    uBusy_("uResetSendOtpBtn", false);
    uShowMsg_("Could not send OTP. Please try again.", true);
  }
}

async function uHandleResetVerifyOtp() {
  const otp = uEl("uResetOtpInput").value.trim();
  if (otp.length < AUTH_OTP_MIN) { uShowMsg_("Please enter the code we sent you.", true); return; }
  _otpCtx = "reset";
  uShowMsg_("");
  uBusy_("uResetVerifyOtpBtn", true, "Verifying…");
  uEl("uResetOtpInput").disabled = true;
  try {
    await hsVerifyOtp(otp);
  } catch (err) {
    uBusy_("uResetVerifyOtpBtn", false);
    uEl("uResetOtpInput").disabled = false;
    uShowMsg_("Could not verify. Please try again.", true);
  }
}

async function uHandleResetSubmit() {
  const newPassword = uEl("uResetNewPassword").value;
  if (!uStrength_(newPassword).ok) { uShowMsg_("Use 8+ characters and mix at least 3 of: lowercase, uppercase, number, symbol.", true); return; }
  if (!_otpToken) { uShowMsg_("Please verify the OTP first.", true); return; }
  uBusy_("uResetSubmitBtn", true);
  try {
    const r = await uPost_("/api/phone-forgot-password", { accessToken: _otpToken, phone: _otpPhone, newPassword: newPassword });
    uBusy_("uResetSubmitBtn", false);
    if (r.data.success) {
      const phone = _otpPhone;
      uSuccess_("Password updated.", "Taking you to log in…", function () {
        uBackToEntry();
        uEl("uAuthIdentifier").value = phone;
      }, true);
    } else {
      uShowMsg_(r.data.error || "Something went wrong. Please try again.", true);
    }
  } catch (err) {
    uBusy_("uResetSubmitBtn", false);
    uShowMsg_("Something went wrong. Please try again.", true);
  }
}

// ---------- signup ----------
function uPrepareSignup_(email, phone) {
  _signupVerifiedPhone = null;
  _otpToken = null;
  _otpResend.signup = 0;
  clearInterval(_otpTimers.signup);
  uEl("uAuthSignupName").value = "";
  uEl("uAuthSignupEmail").value = email || "";
  uEl("uAuthSignupPhone").value = phone || "";
  uEl("uAuthSignupPhone").readOnly = false;
  uEl("uAuthSignupPassword").value = "";
  uEl("uSignupMeter").setAttribute("data-s", "0");
  uEl("uSignupMeterLabel").textContent = "Not set";
  document.querySelectorAll("#uSignupRules li").forEach(function (li) { li.classList.remove("ok"); });
  uSetBlock_("uAuthOtpBlock", false);
  uEl("uSignupVerified").classList.remove("show");
  uEl("uSignupEmailHint").classList.remove("show");
  uEl("uSignupPhoneHint").classList.remove("show");
  const sendBtn = uEl("uAuthSendOtpBtn");
  sendBtn.style.display = "";
  sendBtn.disabled = false;
  sendBtn.textContent = "Send OTP to verify";
  uEl("uAuthCreateBtn").disabled = true;
  uShowStep_("signup");
  uSignupDupCheck_();
}

function uSignupUnverify_() {
  _signupVerifiedPhone = null;
  _otpToken = null;
  uEl("uSignupVerified").classList.remove("show");
  uEl("uAuthCreateBtn").disabled = true;
  uSetBlock_("uAuthOtpBlock", false);
  const b = uEl("uAuthSendOtpBtn");
  b.style.display = "";
  b.disabled = false;
  b.textContent = "Send OTP to verify";
  uEl("uAuthSignupPhone").readOnly = false;
}

async function uSignupDupCheck_() {
  try {
    const e = normalizeIdentifier_(uEl("uAuthSignupEmail").value);
    const p = normalizeIdentifier_(uEl("uAuthSignupPhone").value);
    const eDup = e && e.type === "email" ? await uLookupAccount_(e.key) : null;
    const pDup = p && p.type === "phone" ? await uLookupAccount_(p.key) : null;
    uEl("uSignupEmailHint").classList.toggle("show", !!eDup);
    uEl("uSignupPhoneHint").classList.toggle("show", !!pDup);
  } catch (err) { /* hints are a convenience; the Worker is the real check */ }
}

function uSignupGoLogin(which) {
  const e = normalizeIdentifier_(uEl("uAuthSignupEmail").value);
  const p = normalizeIdentifier_(uEl("uAuthSignupPhone").value);
  const parsed = which === "email" ? e : p;
  if (!parsed) return;
  uLookupAccount_(parsed.key).then(function (data) {
    if (data && data.provider === "google") { uShowMsg_("This account uses Google sign-in. Please use “Continue with Google”.", true); return; }
    uOpenLoginStep_(parsed, data);
    uShowMsg_("Welcome back. This " + (which === "email" ? "email" : "number") + " already has an account.");
  }).catch(function () { uShowMsg_("Something went wrong. Please try again.", true); });
}

async function uHandleSendOtp() {
  if (_otpResend.signup >= AUTH_RESEND_LIMIT) return;
  const phone = uCleanPhone_(uEl("uAuthSignupPhone").value);
  if (!phone) { uShowMsg_("Please enter a valid 10-digit mobile number.", true); return; }
  _otpCtx = "signup";
  _otpPhone = phone;
  uBusy_("uAuthSendOtpBtn", true, "Sending…");
  try {
    const dup = await uLookupAccount_("phone_" + phone);
    if (dup) {
      uBusy_("uAuthSendOtpBtn", false);
      uEl("uSignupPhoneHint").classList.add("show");
      uShowMsg_("This number is already registered. Please log in instead.", true);
      return;
    }
    await hsSendOtp("91" + phone);
    _otpResend.signup++;
    uBusy_("uAuthSendOtpBtn", false);
    uSetBlock_("uAuthOtpBlock", true);
    uOtpClear_("uAuthOtpInput", "uSignupOtpBoxes", "uSignupOtpWrap");
    uEl("uAuthOtpInput").focus();
    uShowMsg_("OTP sent.");
    uStartTimer_("signup", "uAuthSendOtpBtn");
  } catch (err) {
    uBusy_("uAuthSendOtpBtn", false);
    uShowMsg_("Could not send OTP. Please try again.", true);
  }
}

async function uHandleVerifyOtp() {
  const otp = uEl("uAuthOtpInput").value.trim();
  if (otp.length < AUTH_OTP_MIN) { uShowMsg_("Please enter the code we sent you.", true); return; }
  _otpCtx = "signup";
  uShowMsg_("");
  uBusy_("uAuthVerifyOtpBtn", true, "Verifying…");
  uEl("uAuthOtpInput").disabled = true;
  try {
    await hsVerifyOtp(otp);
  } catch (err) {
    uBusy_("uAuthVerifyOtpBtn", false);
    uEl("uAuthOtpInput").disabled = false;
    uShowMsg_("Could not verify. Please try again.", true);
  }
}

// MSG91 widget results (context decides which form they belong to)
window.addEventListener("hs:otpVerified", function (e) {
  _otpToken = (e.detail && e.detail.message) || null;
  uShowMsg_("");
  if (_otpCtx === "reset") {
    uBusy_("uResetVerifyOtpBtn", false);
    clearInterval(_otpTimers.reset);
    uSetBlock_("uResetOtpField", false);
    uEl("uResetSendOtpBtn").style.display = "none";
    uEl("uResetVerified").classList.add("show");
    uSetBlock_("uResetPasswordField", true);
    uEl("uResetNewPassword").focus();
    return;
  }
  if (_otpCtx === "login") {
    uHold_();
    const b = uEl("uOtpLoginVerifyBtn");
    if (b) b.textContent = "Logging in…";
    uFinishOtpLogin_();
    return;
  }
  // signup
  uBusy_("uAuthVerifyOtpBtn", false);
  _signupVerifiedPhone = _otpPhone;
  clearInterval(_otpTimers.signup);
  uSetBlock_("uAuthOtpBlock", false);
  uEl("uAuthSendOtpBtn").style.display = "none";
  uEl("uSignupVerified").classList.add("show");
  uEl("uAuthCreateBtn").disabled = false;
});

window.addEventListener("hs:otpFailed", function () {
  if (_otpCtx === "reset") {
    uBusy_("uResetVerifyOtpBtn", false);
    uOtpClear_("uResetOtpInput", "uResetOtpBoxes", "uResetOtpWrap", true);
    uEl("uResetOtpInput").focus();
  } else if (_otpCtx === "login") {
    uBusy_("uOtpLoginVerifyBtn", false);
    uOtpClear_("uOtpLoginInput", "uOtpLoginBoxes", "uOtpLoginWrap", true);
    uEl("uOtpLoginInput").focus();
  } else {
    uBusy_("uAuthVerifyOtpBtn", false);
    uOtpClear_("uAuthOtpInput", "uSignupOtpBoxes", "uSignupOtpWrap", true);
    uEl("uAuthOtpInput").focus();
  }
  uShowMsg_("Incorrect OTP. Please try again.", true);
});

async function uHandleSignup() {
  const name = uEl("uAuthSignupName").value.trim();
  const email = normalizeIdentifier_(uEl("uAuthSignupEmail").value);
  const phone = uCleanPhone_(uEl("uAuthSignupPhone").value);
  const password = uEl("uAuthSignupPassword").value;

  if (name.length < 2) { uShowMsg_("Please enter your name.", true); return; }
  if (!email || email.type !== "email") { uShowMsg_("Please enter a valid email address.", true); return; }
  if (!phone) { uShowMsg_("Please enter a valid 10-digit mobile number.", true); return; }
  if (!_otpToken || _signupVerifiedPhone !== phone) { uShowMsg_("Please verify your mobile number with the OTP first.", true); return; }
  if (!uStrength_(password).ok) { uShowMsg_("Use 8+ characters and mix at least 3 of: lowercase, uppercase, number, symbol.", true); return; }

  uBusy_("uAuthCreateBtn", true, "Creating your account…");
  uShowMsg_("");
  uHold_();
  try {
    const r = await uPost_("/api/signup", { name: name, email: email.email, phone: phone, password: password, accessToken: _otpToken });
    if (!r.ok || !r.data.customToken) {
      uBusy_("uAuthCreateBtn", false);
      uRelease_();
      if (r.data.code === "email-exists") { uEl("uSignupEmailHint").classList.add("show"); }
      if (r.data.code === "phone-exists") { uEl("uSignupPhoneHint").classList.add("show"); }
      uShowMsg_(r.data.error || "Could not create the account. Please try again.", true);
      return;
    }
    const user = await authSignInWithCustomToken(r.data.customToken);
    Object.keys(_acctCache).forEach(function (k) { delete _acctCache[k]; });
    await uCreateAccountRecords_(user.uid, name, email.email, phone);
    try { await user.sendEmailVerification(); } catch (e) { /* best effort */ }
    uBusy_("uAuthCreateBtn", false);
    if (typeof renderAccountState === "function") renderAccountState(user);
    window.dispatchEvent(new CustomEvent("hs:profileSaved"));
    uSuccess_("You're in, " + name.split(" ")[0] + ".", "Account created. Your email and mobile are linked.", uAuthSuccess_);
  } catch (err) {
    uBusy_("uAuthCreateBtn", false);
    uRelease_();
    uShowMsg_(authErrorMessage ? authErrorMessage(err) : String(err), true);
  }
}

// Profile (private) + two public, data-free index markers — one for the
// email and one for the mobile — so either can be used to log in later.
async function uCreateAccountRecords_(uid, name, email, phone) {
  const db = firebase.firestore();
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const profile = { name: name, email: email, phone: phone, phoneVerified: true, provider: "password", updatedAt: ts };
  const marker = { uid: uid, provider: "password", linked: ["email", "phone"] };

  const batch = db.batch();
  batch.set(db.collection("users").doc(uid), profile, { merge: true });
  batch.set(db.collection("accountIndex").doc(email), marker);
  batch.set(db.collection("accountIndex").doc("phone_" + phone), marker);
  try {
    await batch.commit();
  } catch (err) {
    // Account already exists on the server side, so never leave the person
    // stuck: save the profile on its own, and each marker separately.
    await db.collection("users").doc(uid).set(profile, { merge: true });
    try { await db.collection("accountIndex").doc(email).set(marker); } catch (e) {}
    try { await db.collection("accountIndex").doc("phone_" + phone).set(marker); } catch (e) {}
  }
}

// ============================================================
// CHECKOUT AUTH PROTECTION HELPER
// ============================================================
window.requireAuthThenGo = function (destinationUrl) {
  const currentUser = firebase && firebase.auth && firebase.auth().currentUser;

  if (currentUser) {
    window.location.href = destinationUrl;
  } else {
    window.location.href = 'account.html?redirect=' + encodeURIComponent(destinationUrl);
  }
};
