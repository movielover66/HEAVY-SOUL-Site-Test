/* Heavy Soul — OTP popup ("load the plates").
   Loads AFTER js/msg91-otp.js and js/auth-unified.js. It does not edit them: it wraps a few of their
   global helpers so the three existing OTP boxes (sign-up, log-in-with-OTP, reset) open one popup instead.
   - 4 round weight plates, typed by hand or filled automatically (WebOTP on Android Chrome, one-time-code on iOS)
   - wrong code: plates turn red and drop; right code: plates lift and the scene celebrates
   - the original (now hidden) inputs still get the digits, so all existing verify logic keeps working. */
(function () {
  "use strict";
  if (!document.getElementById("uAuthStep-entry")) return;
  var LEN = typeof AUTH_OTP_LENGTH === "number" ? AUTH_OTP_LENGTH : 4;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var CTX = {
    signup: { block: "uAuthOtpBlock", input: "uAuthOtpInput", resend: "uAuthSendOtpBtn" },
    reset:  { block: "uResetOtpField", input: "uResetOtpInput", resend: "uResetSendOtpBtn" },
    login:  { block: "uOtpLoginBlock", input: "uOtpLoginInput", resend: "uOtpLoginSendBtn" }
  };
  var BY_BLOCK = {}, BY_INPUT = {};
  Object.keys(CTX).forEach(function (k) { BY_BLOCK[CTX[k].block] = k; BY_INPUT[CTX[k].input] = k; });
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- build the popup ---------- */
  var plates = "";
  for (var i = 0; i < LEN; i++) plates += '<div class="hso-plate" data-i="' + i + '"><span></span></div>';
  var root = document.createElement("div");
  root.className = "hso"; root.id = "hsOtp"; root.hidden = true;
  root.innerHTML =
    '<div class="hso-back" data-close></div>' +
    '<div class="hso-card" role="dialog" aria-modal="true" aria-labelledby="hsoTitle" data-state="ready">' +
      '<button type="button" class="hso-x" data-close aria-label="Close">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="hso-ico" aria-hidden="true">' +
        '<svg class="i-phone" viewBox="0 0 64 64" width="64" height="64"><circle class="wave w1" cx="32" cy="32" r="14"/><circle class="wave w2" cx="32" cy="32" r="14"/>' +
          '<rect x="21" y="12" width="22" height="40" rx="8" fill="#0E0C0B"/><rect x="24.5" y="17" width="15" height="25" rx="4" fill="#EFE8DA"/>' +
          '<circle cx="28" cy="29" r="2" fill="#0E0C0B"/><circle cx="32" cy="29" r="2" fill="#0E0C0B"/><circle cx="36" cy="29" r="2" fill="#0E0C0B"/></svg>' +
        '<svg class="i-ok" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="26" fill="#2E9E5B"/><path d="M19 33l9 9 17-19" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg>' +
        '<svg class="i-no" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="26" fill="#C42B38"/><path d="M22 22l20 20M42 22L22 42" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>' +
      '</div>' +
      '<h3 class="hso-title" id="hsoTitle">Load your code</h3>' +
      '<p class="hso-sub">We texted <b id="hsoDigits">4 digits</b> to <b id="hsoPhone">your phone</b></p>' +
      '<div class="hso-rig" id="hsoRig"><i class="hso-rod"></i><div class="hso-plates">' + plates + '</div>' +
        '<input id="hsoInput" class="hso-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="' + LEN + '" aria-label="' + LEN + '-digit code" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<p class="hso-msg" id="hsoMsg" aria-live="polite"></p>' +
      '<div class="hso-foot"><button type="button" class="hso-resend" id="hsoResend">Resend code</button>' +
        '<span class="hso-auto" id="hsoAuto"></span></div>' +
      '<div class="hso-conf" aria-hidden="true">' + new Array(14).join("<i></i>") + '</div>' +
    '</div>';
  document.body.appendChild(root);

  var card = root.querySelector(".hso-card"), inp = $("hsoInput"), rig = $("hsoRig"), msgEl = $("hsoMsg");
  var plateEls = [].slice.call(root.querySelectorAll(".hso-plate"));
  var ctx = null, isOpen = false, state = "ready", prevLen = 0, lastFocus = null;
  var closeTimer = null, failTimer = null, ac = null, pending = {};

  function setState(s) { state = s; card.setAttribute("data-state", s); }
  function maskPhone() {
    var p = (typeof _otpPhone !== "undefined" && _otpPhone) ? String(_otpPhone) : "";
    return p.length >= 10 ? "+91 " + p.slice(0, 2) + "\u2022\u2022\u2022\u2022\u2022" + p.slice(-2) : "your phone";
  }
  function setMsg(t, err) { msgEl.textContent = t || ""; msgEl.className = "hso-msg" + (err ? " err" : ""); }

  function render(v, animateLast) {
    plateEls.forEach(function (el, i) {
      var ch = v.charAt(i), had = el.classList.contains("fill");
      el.firstChild.textContent = ch;
      el.classList.toggle("fill", !!ch);
      el.classList.toggle("act", i === v.length && state === "ready");
      if (ch && (!had || (animateLast && i === v.length - 1))) {
        el.classList.remove("load"); void el.offsetWidth; el.classList.add("load");
      }
    });
    prevLen = v.length;
  }
  function resetPlates() {
    clearTimeout(failTimer);
    inp.value = ""; inp.disabled = false; prevLen = 0;
    plateEls.forEach(function (el) { el.classList.remove("fill", "load", "act"); el.firstChild.textContent = ""; });
    setState("ready"); render("");
  }

  /* ---------- WebOTP (Android Chrome) ---------- */
  function stopWebOtp() { if (ac) { try { ac.abort(); } catch (e) {} ac = null; } }
  function startWebOtp() {
    stopWebOtp();
    var auto = $("hsoAuto");
    if (!("OTPCredential" in window) || !navigator.credentials) { auto.textContent = "Type the digits, we check them automatically."; return; }
    auto.textContent = "Waiting for your SMS\u2026";
    try {
      ac = new AbortController();
      navigator.credentials.get({ otp: { transport: ["sms"] }, signal: ac.signal }).then(function (c) {
        var d = c && c.code ? String(c.code).replace(/\D/g, "").slice(0, LEN) : "";
        if (d.length === LEN && isOpen && state === "ready") { card.setAttribute("data-auto", "1"); inp.value = d; inp.dispatchEvent(new Event("input", { bubbles: true })); }
      }).catch(function () { auto.textContent = "Type the digits, we check them automatically."; });
    } catch (e) {}
  }

  /* ---------- open / close ---------- */
  function openFor(c) {
    var fresh = !isOpen || ctx !== c;
    clearTimeout(closeTimer);
    ctx = c; pending[c] = true; removeChips();
    $("hsoPhone").textContent = maskPhone();
    $("hsoDigits").textContent = LEN + " digits";
    if (!isOpen) { lastFocus = document.activeElement; }
    root.hidden = false; isOpen = true;
    document.documentElement.classList.add("hso-lock");
    if (fresh || state !== "ready") { resetPlates(); setMsg(""); card.removeAttribute("data-auto"); card.removeAttribute("data-sending"); }
    else { resetPlates(); card.removeAttribute("data-sending"); }
    requestAnimationFrame(function () { root.classList.add("show"); try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } });
    if (window.HSScene) HSScene.mood("otp");
    startWebOtp(); mirrorResend();
  }
  function close(dismissed) {
    if (!isOpen) return;
    clearTimeout(closeTimer); clearTimeout(failTimer); stopWebOtp();
    root.classList.remove("show");
    document.documentElement.classList.remove("hso-lock");
    isOpen = false;
    setTimeout(function () { if (!isOpen) root.hidden = true; }, reduce ? 0 : 260);
    if (dismissed && ctx && pending[ctx]) showChip(ctx);
    if (window.HSScene && state !== "ok") HSScene.mood("idle");
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }
  root.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) close(true); });
  document.addEventListener("keydown", function (e) {
    if (!isOpen) return;
    if (e.key === "Escape") { close(true); return; }
    if (e.key === "Tab") {
      var f = [].slice.call(card.querySelectorAll("button:not([disabled]), input:not([disabled])")).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  rig.addEventListener("click", function () { if (!inp.disabled) inp.focus(); });

  /* ---------- typing ---------- */
  inp.addEventListener("input", function () {
    var v = inp.value.replace(/\D/g, "").slice(0, LEN);
    inp.value = v;
    if (state !== "ready") return;
    render(v, true);
    var real = ctx && $(CTX[ctx].input);
    if (!real) return;
    if (v.length === LEN) { setState("verifying"); setMsg("Checking your code\u2026"); inp.disabled = true; }
    real.value = v;
    real.dispatchEvent(new Event("input", { bubbles: true }));
  });

  /* ---------- results ---------- */
  function success() {
    if (!isOpen || state === "ok") return;
    clearTimeout(failTimer); stopWebOtp();
    setState("ok"); setMsg("Code verified.");
    $("hsoTitle").textContent = "You're in";
    if (window.HSScene) HSScene.mood("ok", 2200);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () { pending[ctx] = false; removeChips(); close(false); $("hsoTitle").textContent = "Load your code"; }, reduce ? 300 : 1250);
  }
  function fail(text) {
    if (!isOpen) return;
    clearTimeout(closeTimer); clearTimeout(failTimer);
    setState("bad"); inp.disabled = true;
    plateEls.forEach(function (el) { el.classList.remove("act"); });
    $("hsoTitle").textContent = "Wrong code";
    setMsg(text || "That code didn't match. Try again.", true);
    if (window.HSScene) HSScene.mood("bad", 1700);
    failTimer = setTimeout(function () {
      resetPlates(); $("hsoTitle").textContent = "Load your code";
      try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
    }, reduce ? 200 : 1150);
  }

  /* ---------- resend mirrors the original (timer-driven) button ---------- */
  var rbtn = $("hsoResend");
  function mirrorResend() {
    if (!ctx) return;
    var b = $(CTX[ctx].resend); if (!b) return;
    var t = (b.textContent || "").trim(), m = t.match(/\((\d+)s\)/);
    rbtn.textContent = m ? "Resend in " + m[1] + "s" : /sending/i.test(t) ? "Sending\u2026" : /limit/i.test(t) ? "Resend limit reached" : "Resend code";
    rbtn.disabled = !!b.disabled || !!m || /sending|limit/i.test(t);
  }
  rbtn.addEventListener("click", function () {
    var b = ctx && $(CTX[ctx].resend);
    if (b && !b.disabled) { card.setAttribute("data-sending", "1"); setMsg("Sending a new code\u2026"); b.click(); }
  });
  Object.keys(CTX).forEach(function (k) {
    var b = $(CTX[k].resend);
    if (b) new MutationObserver(function () { if (isOpen && ctx === k) mirrorResend(); }).observe(b, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    // network error path: the original re-enables its input without a "bad" clear
    var real = $(CTX[k].input);
    if (real) new MutationObserver(function () {
      if (isOpen && ctx === k && state === "verifying" && !real.disabled) { setState("ready"); inp.disabled = false; setMsg("Could not verify. Please try again.", true); render(inp.value); inp.focus(); }
    }).observe(real, { attributes: true, attributeFilter: ["disabled"] });
  });

  /* ---------- "Enter the code" chip if the popup was dismissed ---------- */
  function removeChips() { [].forEach.call(document.querySelectorAll(".hso-chip"), function (c) { c.remove(); }); }
  function showChip(c) {
    removeChips();
    var block = $(CTX[c].block); if (!block || !block.parentNode) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "hso-chip"; b.textContent = "Enter the code we sent";
    b.addEventListener("click", function () { openFor(c); });
    block.parentNode.insertBefore(b, block);
  }

  /* ---------- hook the existing helpers (they are plain global functions) ---------- */
  var oSetBlock = window.uSetBlock_;
  window.uSetBlock_ = function (id, show) {
    var r = oSetBlock.apply(this, arguments);
    var c = BY_BLOCK[id];
    if (c) {
      if (show) openFor(c);
      else { pending[c] = false; if (isOpen && ctx === c) { if (state === "verifying") success(); else close(false); } removeChips(); }
    }
    return r;
  };
  var oClear = window.uOtpClear_;
  window.uOtpClear_ = function (inputId, boxesId, wrapId, bad) {
    var r = oClear.apply(this, arguments);
    var c = BY_INPUT[inputId];
    if (c && bad) { if (!isOpen) { ctx = c; openFor(c); } fail(); }
    return r;
  };
  var oMsg = window.uShowMsg_, flashT = null;
  window.uShowMsg_ = function (text, isError) {
    var r = oMsg.apply(this, arguments);
    if (isOpen && text && state !== "ok" && state !== "verifying") setMsg(text, !!isError);
    else if (!isOpen && text && isError && window.HSScene) {
      HSScene.mood("bad"); clearTimeout(flashT); flashT = setTimeout(function () { HSScene.mood("idle"); }, 1500);
    }
    return r;
  };
  var oStep = window.uShowStep_;
  window.uShowStep_ = function (step) {
    var r = oStep.apply(this, arguments);
    if (window.HSScene) {
      HSScene.mode(step === "signup" ? "signup" : "login");
      if (step === "done") { if (isOpen) { pending = {}; close(false); } HSScene.mood("ok", 1900); }
    }
    return r;
  };
  if (typeof window.hsSendOtp === "function") {
    var oSend = window.hsSendOtp;
    window.hsSendOtp = async function () {
      if (window.HSScene) HSScene.mood("sending");
      try { return await oSend.apply(this, arguments); }
      catch (e) { if (window.HSScene) { HSScene.mood("bad"); setTimeout(function () { HSScene.mood(isOpen ? "otp" : "idle"); }, 1500); } throw e; }
    };
  }
  window.addEventListener("hs:otpVerified", function () { if (isOpen) success(); });

  window.HSOtpPopup = { open: openFor, close: close, success: success, fail: fail, _state: function () { return state; } };
})();
