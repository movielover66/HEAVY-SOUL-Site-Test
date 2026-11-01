// Heavy Soul — swipe-to-checkout bar on the cart page (phones).
// Drag the arrow to the right to continue. Releasing early springs it back.
// Keyboard: focus the arrow and press Enter / Space.
(function () {
  var sw = document.getElementById('cvSwipe'), th = document.getElementById('cvThumb');
  if (!sw || !th) return;
  var max = 0, x = 0, startX = 0, dragging = false, done = false, resetTimer;

  function measure() { max = Math.max(0, sw.clientWidth - th.offsetWidth - 8); }
  function set(v) {
    x = Math.max(0, Math.min(max, v));
    sw.style.setProperty('--sw', x + 'px');
    sw.style.setProperty('--p', max ? (x / max).toFixed(3) : 0);
  }
  function reset(animate) {
    clearTimeout(resetTimer);
    dragging = false; done = false;
    sw.classList.remove('dragging', 'done');
    sw.classList.toggle('snap', !!animate);
    set(0);
  }
  function go() {
    if (typeof requireAuthThenGo === 'function') requireAuthThenGo('checkout.html');
    else location.href = 'checkout.html';
  }
  function complete() {
    if (done) return;
    done = true; measure();
    sw.classList.add('snap', 'done');
    set(max);
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    go();
    // If the login sheet opened (or the page stays), put the slider back so it can be used again.
    resetTimer = setTimeout(function () { reset(true); }, 1600);
  }

  th.addEventListener('pointerdown', function (e) {
    if (done) return;
    measure();
    dragging = true; startX = e.clientX - x;
    try { th.setPointerCapture(e.pointerId); } catch (err) {}
    sw.classList.remove('snap'); sw.classList.add('dragging');
  });
  th.addEventListener('pointermove', function (e) { if (dragging) set(e.clientX - startX); });
  function end() {
    if (!dragging) return;
    dragging = false; sw.classList.remove('dragging');
    if (x >= max * 0.85 && max > 0) complete();
    else { sw.classList.add('snap'); set(0); }
  }
  th.addEventListener('pointerup', end);
  th.addEventListener('pointercancel', end);

  // Keyboard / screen-reader users
  th.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); complete(); }
  });

  // A plain tap (without dragging) teaches the gesture
  sw.addEventListener('click', function () {
    if (x > 4 || done) return;
    if (typeof showToast === 'function') showToast('Swipe the arrow to the right to checkout');
  });

  // Coming back with the browser's Back button, or resizing the phone
  window.addEventListener('pageshow', function () { reset(false); });
  window.addEventListener('resize', function () { if (!done && !dragging) { measure(); set(0); } });
})();
