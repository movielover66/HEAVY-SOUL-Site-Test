/* HEAVY SOUL — payment page extras (design only; payment.js still owns the money logic).
   - fills the "Delivering to" recap and delivery estimate
   - shows the advance / balance amounts on the method cards
   - drives the countdown ring and the mobile pay bar */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* recap */
  var info = null; try { info = JSON.parse(localStorage.getItem('shippingInfo') || 'null'); } catch (e) {}
  if (info && $('recapTxt')) {
    $('recapTxt').innerHTML = '<b>' + esc(info.name) + '</b> · +91 ' + esc(info.phone) + (info.altPhone ? ' · Alt +91 ' + esc(info.altPhone) : '') +
      '<br>' + esc(info.address) + ', ' + esc([info.city, info.state].filter(Boolean).join(', ')) + ' – ' + esc(info.pin) +
      (info.email ? '<br><span style="color:var(--hs-text-faint)">' + esc(info.email) + '</span>' : '');
  }
  if ($('estText') && window.HSAddr) $('estText').textContent = HSAddr.estimate();

  /* amounts on the two method cards (same maths as payment.js) */
  try {
    var cart = JSON.parse(localStorage.getItem('cart') || '[]'), sub = 0, custom = 0, collQty = 0, qty = 0;
    cart.forEach(function (i) { var q = i.qty || 1, l = i.price * q; sub += l; qty += q; if (i.orderType === 'custom') custom += l; else collQty += q; });
    var adv = 0;
    if (custom > 0) adv += Math.round(custom * SITE_CONFIG.CUSTOM_ADVANCE_PERCENT);
    if (collQty > 0) adv += SITE_CONFIG.COD_FLAT_ADVANCE * collQty;
    adv = Math.min(adv, sub);
    var bal = sub + SITE_CONFIG.COD_HANDLING_PER_ITEM * qty - adv;
    $('mPrepaidAmt').textContent = '₹' + sub + ' today';
    $('mCodAmt').textContent = '₹' + adv + ' now · ₹' + bal + ' on delivery';
  } catch (e) {}

  /* countdown ring + "low time" state */
  var arc = $('ringArc'), box = $('timerBox');
  function ring() {
    var dl = Number(localStorage.getItem('paymentDeadline')), win = (SITE_CONFIG.PAYMENT_WINDOW_MINUTES || 10) * 60000;
    if (!dl || !arc) return;
    var left = Math.max(0, dl - Date.now());
    arc.style.strokeDashoffset = String(126 * (1 - Math.min(1, left / win)));
    if (box) box.classList.toggle('low', left < 120000 && left > 0);
  }
  ring(); setInterval(ring, 1000);

  /* mobile pay bar mirrors the main pay button (payment.js disables / relabels #payBtn) */
  var main = $('payBtn'), bar = $('payBtnBar');
  function mirror() {
    if (!main || !bar) return;
    bar.disabled = main.disabled;
    var l = bar.querySelector('.lbl'); if (l) l.textContent = main.disabled ? main.textContent : 'Pay securely';
  }
  if (main && bar && window.MutationObserver) new MutationObserver(mirror).observe(main, { attributes: true, childList: true, characterData: true, subtree: true });
})();
