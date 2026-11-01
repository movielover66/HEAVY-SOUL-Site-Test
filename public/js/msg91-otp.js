// MSG91 OTP verification helper — Heavy Soul
// Loads the widget script once, then exposes hsSendOtp / hsVerifyOtp / hsRetryOtp
// so any form on the site (signup, login, checkout) can trigger phone
// verification on a button click instead of auto-firing on page load.

const HS_OTP_CONFIG = {
  widgetId: "36686f6a6c4a353434333739",
  tokenAuth: "557778T3SArOkpa1fj6a803ce9P1",
  exposeMethods: true, // gives us hsSendOtp/hsVerifyOtp/hsRetryOtp instead of the default popup
  success: (data) => {
    // data.message is the verified access token — send this to your
    // backend (Apps Script) for final server-side verification before
    // trusting the phone number.
    window.dispatchEvent(new CustomEvent("hs:otpVerified", { detail: data }));
  },
  failure: (error) => {
    // The widget calls this for EVERY failure — a failed first SEND too. The
    // forms treat "hs:otpFailed" as "wrong code entered", so only forward it
    // while we are actually verifying. Send failures are reported through
    // hsSendOtp()'s own promise (and its silent retry) instead.
    if (hsOtpMode !== "verify") {
      console.warn("MSG91 widget failure ignored (not verifying):", error);
      return;
    }
    window.dispatchEvent(new CustomEvent("hs:otpFailed", { detail: error }));
  }
};

let hsOtpMode = null; // "send" | "verify"

let hsOtpScriptLoaded = false;
let hsOtpScriptLoading = null;

// MSG91's widget sets window.sendOtp/verifyOtp/retryOtp up asynchronously
// AFTER initSendOTP() runs (it does its own internal setup/network calls) —
// calling resolve() immediately after initSendOTP() was the bug: the first
// "Send OTP" tap could fire before those methods existed yet, while a
// resend (moments later) worked because the async setup had finished by
// then. This polls for window.sendOtp to actually exist before resolving.
function hsWaitForOtpMethods(timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (typeof window.sendOtp === "function") {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("OTP widget did not become ready in time"));
        return;
      }
      setTimeout(check, 100);
    })();
  });
}

function hsLoadOtpScript() {
  if (hsOtpScriptLoaded) return Promise.resolve();
  if (hsOtpScriptLoading) return hsOtpScriptLoading;

  hsOtpScriptLoading = new Promise((resolve, reject) => {
    const urls = [
      "https://verify.msg91.com/otp-provider.js",
      "https://verify.phone91.com/otp-provider.js"
    ];
    let i = 0;
    function attempt() {
      const s = document.createElement("script");
      s.src = urls[i];
      s.async = true;
      s.onload = () => {
        if (typeof window.initSendOTP === "function") {
          window.initSendOTP(HS_OTP_CONFIG);
          hsWaitForOtpMethods(8000)
            .then(() => {
              hsOtpScriptLoaded = true;
              resolve();
            })
            .catch(reject);
        } else {
          reject(new Error("initSendOTP not available after script load"));
        }
      };
      s.onerror = () => {
        i++;
        if (i < urls.length) attempt();
        else reject(new Error("Could not load MSG91 OTP script"));
      };
      document.head.appendChild(s);
    }
    attempt();
  });

  return hsOtpScriptLoading;
}

// MSG91's widget sometimes fails the very FIRST sendOtp() call right after
// initializing on a page load (its own internal handshake with MSG91's
// server hasn't settled yet), even though window.sendOtp already exists.
// The second call on the same page always works. Rather than surface that
// first failure to the user as an error, we retry once, silently, before
// giving up — this only kicks in for the first send of the page load.
let hsOtpWarmedUp = false;

function hsAttemptSendOtp_(identifier) {
  hsOtpMode = "send";
  return new Promise((resolve, reject) => {
    window.sendOtp(
      identifier,
      () => { console.log("OTP sent to", identifier); resolve(); },
      (err) => { console.warn("Failed to send OTP", err); reject(err); }
    );
  });
}

// Call this when the user taps "Send OTP" after typing their phone number.
// identifier should be in the format the widget expects, e.g. "91XXXXXXXXXX".
async function hsSendOtp(identifier) {
  await hsLoadOtpScript();
  if (typeof window.sendOtp !== "function") {
    // Belt-and-suspenders: shouldn't happen now that hsLoadOtpScript waits
    // for window.sendOtp, but give it one more short chance before failing.
    try {
      await hsWaitForOtpMethods(3000);
    } catch (e) {
      console.error("MSG91 widget loaded but window.sendOtp is not available — check widgetId/tokenAuth/exposeMethods in HS_OTP_CONFIG.");
      throw new Error("OTP widget not ready (sendOtp unavailable)");
    }
  }

  try {
    await hsAttemptSendOtp_(identifier);
    hsOtpWarmedUp = true;
  } catch (err) {
    if (hsOtpWarmedUp) throw err; // a real failure after warm-up — surface it
    // First-ever send on this page load — wait a beat and retry silently.
    await new Promise((r) => setTimeout(r, 1200));
    await hsAttemptSendOtp_(identifier);
    hsOtpWarmedUp = true;
  }
}

// Call this when the user submits the 4/6-digit code they received.
async function hsVerifyOtp(otp) {
  await hsLoadOtpScript();
  if (typeof window.verifyOtp !== "function") {
    console.error("MSG91 widget loaded but window.verifyOtp is not available.");
    throw new Error("OTP widget not ready (verifyOtp unavailable)");
  }
  hsOtpMode = "verify";
  window.verifyOtp(otp);
  // result comes back via the success/failure callbacks in
  // HS_OTP_CONFIG, which dispatch hs:otpVerified / hs:otpFailed —
  // listen for those events wherever you call this from.
}

// Call this if the user taps "Resend OTP".
async function hsRetryOtp(channel) {
  await hsLoadOtpScript();
  hsOtpMode = "send";
  if (typeof window.retryOtp === "function") {
    window.retryOtp(channel); // e.g. "text" or "voice", optional
  }
}

// Pre-warm: on pages that have a "Send OTP" button, load + initialise the
// MSG91 widget quietly in the background shortly after the page loads. This
// does NOT send any SMS. It means the widget's first-time handshake is already
// finished by the time the customer has typed their number and taps
// "Send OTP", which removes the slow / failing FIRST send.
window.addEventListener("load", function () {
  setTimeout(function () {
    if (document.querySelector("#uAuthSendOtpBtn, #uOtpLoginSendBtn, #uResetSendOtpBtn, #authSendOtpBtn")) {
      hsLoadOtpScript().catch(function (e) { console.warn("OTP pre-warm failed (will retry on tap):", e); });
    }
  }, 800);
});
