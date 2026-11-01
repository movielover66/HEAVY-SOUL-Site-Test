/* HEAVY SOUL — live refund card.
   HSRefund.mount(element, orderId) fills `element` with the refund status
   read live from the payment gateway (via /api/refund-status).
   track.js calls it every time a cancelled order is rendered, so the card
   refreshes with the page's own auto-refresh. */
(function (global) {
  'use strict';
  var cache = {};                 // orderId -> { html, at }
  var FRESH_MS = 45000;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function day(iso) { return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function dt(iso) { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function wa() {
    var n = (global.SITE_CONFIG && SITE_CONFIG.WHATSAPP_NUMBER) || '';
    return n ? 'https://wa.me/' + n : '#';
  }
  var METHOD = { upi: 'your UPI account', card: 'your card', netbanking: 'your bank account', wallet: 'your wallet', emi: 'your card', '': 'your original payment method' };

  function head(live, note) {
    return '<div class="rf-h"><h2>Refund status</h2><span class="rf-live">' + (live ? '<i></i>Live from payment gateway' : 'Refund') + '</span></div>' + (note || '');
  }
  function shell(inner) { return '<section class="rf-card">' + inner + '</section>'; }

  function step(state, title, sub) {
    return '<li class="' + state + '"><i></i><div><b>' + esc(title) + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div></li>';
  }

  function refundBlock(r, now) {
    var by = new Date(r.expectedBy).getTime(), from = new Date(r.expectedFrom).getTime();
    var badge, s2 = 'done', s3, s4, sub3, sub4, banner = '';
    var method = METHOD[r.method] || METHOD[''];
    if (r.status === 'failed') {
      badge = '<em class="rf-b bad">Failed</em>'; s3 = 'bad'; s4 = '';
      sub3 = 'The gateway could not complete this refund.'; sub4 = 'We\'ll re-issue it — message us and we\'ll sort it out.';
      banner = '<p class="rf-alert bad">This refund failed at the gateway. Please <a href="' + wa() + '" target="_blank" rel="noopener">message us on WhatsApp</a> with your Order ID — we\'ll fix it.</p>';
    } else if (r.status === 'pending') {
      badge = '<em class="rf-b wait">Initiated</em>'; s3 = 'now'; s4 = '';
      sub3 = 'Waiting for the payment gateway to process it.'; sub4 = 'After processing';
    } else {
      s3 = 'done';
      if (r.speed === 'instant') {
        var late = now > by;
        badge = '<em class="rf-b ok">' + (late ? 'Completed' : 'Sent') + '</em>'; s4 = late ? 'done' : 'now';
        sub3 = 'Instant refund sent to ' + esc(method) + '.';
        sub4 = late ? 'It should already be in ' + esc(method) + '.' : 'Usually within minutes — latest by ' + dt(r.expectedBy);
      } else if (now >= by) {
        badge = '<em class="rf-b ok">Completed</em>'; s4 = 'done';
        sub3 = 'Processed and sent to your bank.'; sub4 = 'Should be in ' + esc(method) + ' by now.';
        banner = '<p class="rf-alert">Not seeing it yet? Banks sometimes take a little longer. Show your bank the ARN below, or <a href="' + wa() + '" target="_blank" rel="noopener">message us</a>.</p>';
      } else {
        badge = '<em class="rf-b ok">On its way</em>'; s4 = 'now';
        sub3 = 'Processed — sent to your bank.';
        sub4 = 'Expected ' + (now < from ? day(r.expectedFrom) + ' – ' : 'by ') + day(r.expectedBy) + ' (estimate)';
      }
    }
    return '<div class="rf-one">' +
      '<div class="rf-top"><div><small>Refund amount</small><strong>' + inr(r.amount) + '</strong></div>' + badge + '</div>' +
      '<ol class="rf-steps">' +
        step('done', 'Order cancelled', '') +
        step(s2, 'Refund initiated', dt(r.createdAt)) +
        step(s3, 'Processed by payment gateway', sub3) +
        step(s4, 'Credited to ' + method, sub4) +
      '</ol>' + banner +
      '<dl class="rf-meta">' +
        (r.arn ? '<div><dt>Bank reference (ARN)</dt><dd><code>' + esc(r.arn) + '</code> <button type="button" class="rf-copy" data-copy="' + esc(r.arn) + '">Copy</button></dd></div>' : '') +
        '<div><dt>Refund ID</dt><dd><code>' + esc(r.ref) + '</code></dd></div>' +
        '<div><dt>Type</dt><dd>' + (r.speed === 'instant' ? 'Instant' : 'Standard (5–7 working days)') + '</dd></div>' +
      '</dl></div>';
  }

  function build(d) {
    var now = Date.now(), foot = '<p class="rf-foot">Checked ' + dt(d.checkedAt) + '. Exact credit time depends on your bank — dates above are estimates. Money returns to the same payment method you paid with.</p>';
    if (!d.found) {
      return shell(head(false) + '<p class="rf-msg">We couldn\'t find an online payment for this order, so there is nothing to refund. If you paid some other way, please <a href="' + wa() + '" target="_blank" rel="noopener">message us on WhatsApp</a>.</p>');
    }
    if (!d.refunds.length) {
      return shell(head(true) +
        '<div class="rf-top"><div><small>You paid online</small><strong>' + inr(d.paidAmount) + '</strong></div><em class="rf-b wait">Not started yet</em></div>' +
        '<ol class="rf-steps">' + step('done', 'Order cancelled', '') + step('now', 'Refund initiated', 'No refund has been created yet — this card updates by itself the moment one is.') +
        step('', 'Processed by payment gateway', '') + step('', 'Credited to your account', '') + '</ol>' + foot);
    }
    var multi = d.refunds.length > 1;
    var tot = '<p class="rf-total">' + inr(d.refundedAmount + d.pendingAmount) + ' of ' + inr(d.paidAmount) + ' refunded' + (multi ? ' in ' + d.refunds.length + ' parts' : '') + '</p>';
    return shell(head(true) + tot + d.refunds.map(function (r) { return refundBlock(r, now); }).join('') + foot);
  }

  function mount(el, orderId) {
    if (!el || !orderId) return;
    var c = cache[orderId];
    if (c) el.innerHTML = c.html;
    else el.innerHTML = shell(head(true) + '<div class="rf-skel"><i></i><i></i><i></i></div>');
    if (c && Date.now() - c.at < FRESH_MS) return;

    fetch('/api/refund-status?orderId=' + encodeURIComponent(orderId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error('x');
        var html = build(d);
        cache[orderId] = { html: html, at: Date.now() };
        if (document.body.contains(el)) el.innerHTML = html;
      })
      .catch(function () {
        if (c || !document.body.contains(el)) return;     // keep the last good card
        el.innerHTML = shell(head(false) + '<p class="rf-msg">Couldn\'t check the refund status right now. <button type="button" class="rf-retry">Try again</button></p>');
        var b = el.querySelector('.rf-retry'); if (b) b.onclick = function () { delete cache[orderId]; mount(el, orderId); };
      });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.rf-copy');
    if (!b) return;
    try { navigator.clipboard.writeText(b.dataset.copy || ''); } catch (err) {}
    b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500);
  });

  global.HSRefund = { mount: mount };
})(window);
