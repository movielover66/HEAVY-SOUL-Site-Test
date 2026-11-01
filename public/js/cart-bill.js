// Heavy Soul — cart page: the bill prints out of a billing machine (animation + printer sound).
// Sound is made with the browser's Web Audio (no audio files). Browsers only allow sound after the
// person has touched the page, so the very first print can be silent on some phones; every print
// after a tap (changing quantity, removing an item, the speaker button) has sound.
(function () {
  var bill = document.querySelector('.cv-bill');
  if (!bill) return;
  var lcd = document.getElementById('cvLcd'), snd = document.getElementById('cvSnd');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var muted = false;
  try { muted = localStorage.getItem('hs_cart_mute') === '1'; } catch (e) {}
  var ctx = null, noise = null, timer = null, lastSig = null, started = false;

  /* ---------------- sound ---------------- */
  function audio() {
    if (ctx) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    return ctx;
  }
  function unlock() { var c = audio(); if (c && c.state === 'suspended') c.resume(); }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { passive: true, capture: true });
  });
  function noiseBuf(c) {
    if (noise) return noise;
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }
  function tick(c, out, t) {            // one "chunk" of paper feeding
    var s = c.createBufferSource(); s.buffer = noiseBuf(c);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.26, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    s.connect(lp); lp.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + 0.06);
  }
  function ding(c, out, t) {            // "bill ready"
    [988, 1480].forEach(function (f, i) {
      var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(i ? 0.05 : 0.1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.75);
    });
  }
  function sound(d, n) {
    var c = audio();
    if (!c || c.state !== 'running') return;
    var t = c.currentTime + 0.02, out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination);
    // motor hum
    var o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t); o.frequency.linearRampToValueAtTime(92, t + 0.25);
    o.frequency.setValueAtTime(92, t + d - 0.25); o.frequency.linearRampToValueAtTime(58, t + d);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    var og = c.createGain();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.05, t + 0.12);
    og.gain.setValueAtTime(0.05, t + d - 0.15); og.gain.linearRampToValueAtTime(0, t + d);
    o.connect(lp); lp.connect(og); og.connect(out); o.start(t); o.stop(t + d + 0.05);
    // print-head buzz (noise switched on and off ~30 times a second)
    var nz = c.createBufferSource(); nz.buffer = noiseBuf(c); nz.loop = true;
    var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.9;
    var ng = c.createGain(); ng.gain.setValueAtTime(0, t);
    for (var k = 0; k < Math.floor(d * 30); k++) { var s = t + k / 30; ng.gain.setValueAtTime(0.085, s); ng.gain.setValueAtTime(0, s + 0.011); }
    nz.connect(bp); bp.connect(ng); ng.connect(out); nz.start(t); nz.stop(t + d);
    // one chunk per paper step, then the ding
    for (var i = 0; i < n; i++) tick(c, out, t + (i + 1) * d / n);
    ding(c, out, t + d + 0.04);
  }

  /* ---------------- printing ---------------- */
  function done() { bill.classList.remove('printing'); if (lcd) lcd.textContent = 'BILL READY'; }
  function print(fast) {
    started = true;
    if (reduce) { bill.classList.remove('pre', 'printing'); return; }
    var d = fast ? 1.4 : 2.4, n = fast ? 14 : 24;
    bill.style.setProperty('--bill-dur', d + 's'); bill.style.setProperty('--bill-steps', n);
    bill.classList.remove('pre', 'printing'); void bill.offsetWidth; bill.classList.add('printing');
    if (lcd) lcd.textContent = 'PRINTING…';
    clearTimeout(timer); timer = setTimeout(done, d * 1000 + 40);
    if (!muted) sound(d, n);
  }
  function sig() {
    var a = document.getElementById('cartTotal'), b = document.getElementById('cartMrpLabel');
    return (a ? a.textContent : '') + '|' + (b ? b.textContent : '');
  }

  // First print: when the bill is actually on screen (on a phone it sits below the items)
  function firstPrint() {
    if (started) return;
    if (!bill.offsetParent) { bill.classList.remove('pre'); return; }   // cart empty / hidden
    lastSig = sig(); print(false);
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); firstPrint(); }
    }, { threshold: 0.3 });
    io.observe(bill);
  } else firstPrint();

  // Print a fresh bill whenever the amounts change (quantity changed, item removed)
  new MutationObserver(function () {
    var s = sig();
    if (!started || s === lastSig) { if (!started) lastSig = s; return; }
    lastSig = s; print(true);
  }).observe(bill, { childList: true, subtree: true, characterData: true });

  /* ---------------- speaker button ---------------- */
  function paintSnd() {
    if (!snd) return;
    snd.setAttribute('aria-pressed', String(!muted));
    snd.setAttribute('aria-label', muted ? 'Printing sound is off. Tap to turn it on' : 'Printing sound is on. Tap to turn it off');
  }
  paintSnd();
  if (snd) snd.addEventListener('click', function () {
    muted = !muted;
    try { localStorage.setItem('hs_cart_mute', muted ? '1' : '0'); } catch (e) {}
    paintSnd();
    if (!muted) { unlock(); setTimeout(function () { print(true); }, 80); }   // play it once so they can hear it
  });
})();
