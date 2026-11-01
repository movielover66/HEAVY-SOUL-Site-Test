/* HEAVY SOUL — success page logic.
   Keeps the original behaviour (order id, track link, Purchase event)
   and adds the jokes, parcel-poking and confetti timing. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- order id / track link / analytics (same as before) ---------- */
  var params = new URLSearchParams(window.location.search);
  var orderId = (params.get('order') || '').trim();
  var orderValue = Number(params.get('value')) || 0;
  var idEl = $('orderId'), ticket = $('orderTicket');

  if (orderId) {
    idEl.textContent = orderId;                                  // textContent: no HTML injection
    $('trackLink').href = 'track.html?order=' + encodeURIComponent(orderId);
    var key = 'hs_purchase_' + orderId, fired = false;
    try { fired = sessionStorage.getItem(key) === '1'; } catch (e) {}
    if (!fired && window.trackEvent) {                           // don't double-count on refresh
      window.trackEvent('Purchase', { order_id: orderId, value: orderValue, currency: 'INR' });
      try { sessionStorage.setItem(key, '1'); } catch (e) {}
    }
  } else {
    idEl.textContent = 'Being generated…';
    $('copyBtn').hidden = true;
  }

  /* ---------- copy button ---------- */
  var copyMsg = $('copyMsg'), copyTimer;
  function copied(ok) {
    copyMsg.textContent = ok ? 'Copied. Screenshot-er jhamela nai.' : 'Press and hold the ID to copy it.';
    var b = $('copyBtn'); b.classList.remove('ok-done'); void b.offsetWidth; b.classList.add('ok-done');
    clearTimeout(copyTimer); copyTimer = setTimeout(function () { copyMsg.textContent = ''; }, 2600);
  }
  $('copyBtn').addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(orderId).then(function () { copied(true); }, function () { copied(false); });
    } else {
      var t = document.createElement('textarea'); t.value = orderId; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      t.remove(); copied(ok);
    }
  });

  /* ---------- jokes ---------- */
  var JOKES = [
    'Your hoodie is doing stretches before the trip.',
    'Packing in progress. Parcel has opinions.',
    'Ekdom set. Ekhon chill koro.',
    'No refunds on flexing.',
    'Courier has been told: handle with soul.',
    'Plot twist: you already look better.',
    'Screenshot this. Future you says thanks.',
    'Loading swag… 99%. Always 99%.'
  ];
  var POKES = [
    'Oi! Ami to box!',
    'Easy, tiger. Delivery isn\'t instant.',
    'Stop poking. I\'m fragile (emotionally).',
    'Haha — that tickles!',
    'Careful, there\'s a hoodie in here.',
    'Okay, that\'s enough poking for today.'
  ];
  var bubble = $('bubble'), lastPoke = 0, ji = 0, pi = 0, pokes = 0;

  function say(text) {
    bubble.textContent = text;
    bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
  }
  if (!reduce) {
    setInterval(function () {
      if (document.hidden || Date.now() - lastPoke < 4500) return;
      ji = (ji + 1) % JOKES.length; say(JOKES[ji]);
    }, 3800);
  }

  /* ---------- poke the parcel ---------- */
  var poke = document.getElementById('pokeG');
  $('pokeBtn').addEventListener('click', function (ev) {
    pokes++; lastPoke = Date.now();
    $('pokeCount').textContent = pokes;
    poke.classList.remove('go'); void poke.getBoundingClientRect(); poke.classList.add('go');

    var r = $('pokeBtn').getBoundingClientRect();
    if (pokes === 7) {
      say('Okay okay, we get it. You\'re excited.');
      if (window.HSConfetti) { HSConfetti.rain(2400); }
    } else if (pokes === 15) {
      say('15 pokes. Dedicated. Respect.');
      if (window.HSConfetti) { HSConfetti.cannons(); }
    } else {
      say(POKES[pi++ % POKES.length]);
      if (window.HSConfetti) { HSConfetti.burst({ x: r.left + r.width / 2, y: r.top + r.height / 3, count: 16, power: 9 }); }
    }
  });

  /* ---------- the big moment ---------- */
  if (!reduce && window.HSConfetti) {
    setTimeout(function () {
      var r = $('okStage').getBoundingClientRect();
      HSConfetti.burst({ x: r.left + r.width * .55, y: r.top + r.height * .62, count: 90, power: 15 });
    }, 2900);
    setTimeout(function () { HSConfetti.cannons(); }, 3300);
  }
})();
