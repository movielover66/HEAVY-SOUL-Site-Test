/* HEAVY SOUL — customer support chat.
   Soul (bot) answers first; a person from the team can take over. Talks to /api/support/*.
   Live updates by polling (2 s while a person is involved), typing indicators both ways. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LS_SESSION = 'hs_chat_session', LS_RECENT = 'hs_chat_recent';
  var MAX_PHOTOS = 4, MAX_BYTES = 3 * 1024 * 1024, TARGET_BYTES = 2.4 * 1024 * 1024;
  var BOT_SVG = document.querySelector('.ch-av-in.bot').innerHTML;

  var S = { id: '', phone: '', name: '', count: 0, mode: 'bot', status: 'open', busy: false, revealing: false, pending: [], lastKey: 0, timer: 0, lastFrom: '', lastAt: 0, lastDay: '', unread: 0, agentJoined: false, closed: false };

  /* ---------- helpers ---------- */
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} return null; }
  function digits(v) { return String(v || '').replace(/\D/g, '').slice(-10); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(text) { return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }
  function hm(iso) { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function dayLabel(iso) {
    var d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected reply from the server.' }; }); })
      .catch(function () { return { ok: false, offline: true, error: 'No connection. Please check your internet.' }; });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toast(msg) { if (typeof showToast === 'function') showToast(msg); else sys(msg); }
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- views ---------- */
  var profile = null;   // set when the visitor is logged in and we already know their name + number
  function showStart() {
    clearTimeout(S.timer); S.id = ''; $('chatView').hidden = true; $('bootView').hidden = true;
    if (profile) { quickStart(); return; }
    $('startView').hidden = false;
    $('sName').value = $('sName').value || (store('hs_chat_last') || {}).name || ''; $('sPhone').value = $('sPhone').value || (store('hs_chat_last') || {}).phone || '';
    renderRecent(); window.scrollTo(0, 0);
  }
  function showChat() { $('startView').hidden = true; $('bootView').hidden = true; $('chatView').hidden = false; document.body.classList.add('in-chat'); }

  /* ---------- rendering ---------- */
  function list() { return $('chList'); }
  function nearBottom() { var b = $('chBody'); return b.scrollHeight - b.scrollTop - b.clientHeight < 140; }
  function toBottom(force) { var b = $('chBody'); if (force || nearBottom()) b.scrollTop = b.scrollHeight; }
  function sys(text, cls) { var d = document.createElement('div'); d.className = 'ch-sys' + (cls ? ' ' + cls : ''); d.textContent = text; list().appendChild(d); S.lastFrom = 'system'; toBottom(true); return d; }

  function avatarHtml(kind) { return kind === 'bot' ? BOT_SVG : 'HS'; }
  function renderMsg(m, opts) {
    opts = opts || {};
    var wasNear = nearBottom();
    var day = new Date(m.at).toDateString();
    if (day !== S.lastDay) { var dd = document.createElement('div'); dd.className = 'ch-day'; dd.textContent = dayLabel(m.at); list().appendChild(dd); S.lastDay = day; S.lastFrom = ''; }
    if (m.from === 'system') {
      var s = sys(m.text, /joined/i.test(m.text) ? 'join' : ''); return s;
    }
    var me = m.from === 'customer', kind = m.from === 'bot' ? 'bot' : (me ? 'me' : 'agent');
    var t = new Date(m.at).getTime(), first = S.lastFrom !== m.from || (t - S.lastAt) > 5 * 60000;
    var row = document.createElement('div'); row.className = 'ch-row ' + (me ? 'me' : '') + (first ? ' first' : '') + (opts.pending ? ' pending' : '');
    var html = '';
    if (!me) html += '<span class="ch-mini ' + (kind === 'agent' ? 'agent' : '') + '">' + avatarHtml(kind) + '</span>';
    html += '<div class="ch-col">';
    if (!me && first) html += '<div class="ch-name">' + (kind === 'bot' ? 'Soul' : 'Heavy Soul Support') + '</div>';
    var inner = '';
    if (m.text) inner += fmt(m.text);
    if (m.link) inner += '<div><a class="ch-link" href="' + esc(m.link.href) + '"' + (/^https?:/.test(m.link.href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(m.link.label) + ' →</a></div>';
    if (inner || !(m.files && m.files.length)) html += '<div class="ch-bub ' + kind + '">' + inner + '</div>';
    if (m.files && m.files.length) {
      html += '<div class="ch-imgs ' + (m.files.length === 1 ? 'one' : '') + '">' + m.files.map(function (f, i) {
        if (f.expired) return '<div class="ch-img gone">Photo removed<br>(chat closed over 7 days ago)</div>';
        var src = f.local || ('/api/support/file/' + f.key);
        return '<button type="button" class="ch-img" data-src="' + esc(src) + '"><img src="' + esc(src) + '" alt="' + esc(f.name || 'photo') + '" loading="lazy" onerror="this.parentNode.className=\'ch-img gone\';this.parentNode.textContent=\'Photo not available\'"></button>';
      }).join('') + '</div>';
    }
    html += '<div class="ch-time">' + (opts.pending ? 'Sending…' : hm(m.at)) + '</div></div>';
    row.innerHTML = html; list().appendChild(row);
    S.lastFrom = m.from; S.lastAt = t;
    if (me || wasNear) toBottom(true);
    return row;
  }
  function setChips(msgs) {
    var box = $('chChips'); box.innerHTML = '';
    var last = msgs[msgs.length - 1];
    if (!last || last.from !== 'bot' || !last.chips || !last.chips.length || S.closed) return;
    last.chips.forEach(function (c, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ch-chip'; b.style.setProperty('--i', i); b.textContent = c;
      b.onclick = function () { send(c); }; box.appendChild(b);
    });
    toBottom(false);
  }
  function setTyping(on, who) {
    var el = $('chTyping'); el.hidden = !on;
    if (on) { $('chTypingText').textContent = (who === 'bot' ? 'Soul is typing…' : 'Heavy Soul Support is typing…'); toBottom(false); }
  }
  function header() {
    var human = S.mode === 'human', av = $('chAv');
    $('chName').textContent = human ? 'Heavy Soul Support' : 'Soul';
    var inner = av.querySelector('.ch-av-in');
    inner.className = 'ch-av-in ' + (human ? 'agent' : 'bot'); inner.innerHTML = human ? 'HS' : BOT_SVG;
    var waiting = human && !S.agentJoined;
    av.classList.toggle('wait', waiting);
    $('chSub').innerHTML = '<i class="dot' + (waiting ? ' wait' : '') + '"></i> ' + (S.closed ? 'Chat closed' : human ? (waiting ? 'Waiting for a team member to join' : 'Team member · replies here') : 'Heavy Soul assistant');
    var ban = $('chBanner');
    if (waiting && !S.closed) { ban.hidden = false; ban.textContent = 'Our team has been notified. We usually reply within 24 hours on business days. You can leave this page and come back with your Chat ID, your messages will be here.'; }
    else ban.hidden = true;
    $('chIdText').textContent = S.id;
    $('chForm').hidden = S.closed; $('chClosed').hidden = !S.closed; if (S.closed) $('chChips').innerHTML = '';
    $('rateBox').hidden = !!S.rating || !S.closed; $('rateThanks').hidden = !S.rating;
  }

  /* ---------- ingest server messages ---------- */
  var all = [];
  async function ingest(t, o) {
    o = o || {};
    S.mode = t.mode || S.mode; S.status = t.status; S.closed = t.status === 'closed'; if (t.rating) S.rating = t.rating;
    var from = t.from || 0, msgs = t.messages.slice(Math.max(0, S.count - from));
    S.count = Math.max(S.count, t.total);
    if (msgs.some(function (m) { return m.from === 'system' && /joined/i.test(m.text); }) || msgs.some(function (m) { return m.from === 'support'; })) S.agentJoined = true;
    if (o.full && all.some(function (m) { return m.from === 'support'; })) S.agentJoined = true;
    if (msgs.length) S.revealing = true;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i]; all.push(m);
      if (o.reveal && m.from === 'bot' && !reduce) { setTyping(true, 'bot'); await sleep(Math.min(1700, 420 + (m.text || '').length * 11)); setTyping(false); }
      renderMsg(m);
      if (m.from === 'support' && document.hidden) notify();
    }
    S.revealing = false;
    if (msgs.length) setChips(all);
    header();
    if (S.closed) clearTimeout(S.timer);
  }
  function notify() { S.unread++; document.title = '(' + S.unread + ') New message · Heavy Soul'; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { S.unread = 0; document.title = 'Chat Support — Heavy Soul'; schedule(300); } });

  /* ---------- polling ---------- */
  function delay() {
    if (document.hidden) return 15000;
    if (S.mode === 'human') return 2000;
    return 4500;
  }
  function schedule(ms) { clearTimeout(S.timer); if (S.id && !S.closed) S.timer = setTimeout(poll, ms == null ? delay() : ms); }
  async function poll() {
    if (!S.id) return;
    if (S.busy || S.revealing) { schedule(); return; }
    var typing = Date.now() - S.lastKey < 4000;
    var d = await post('/api/support/chat/poll', { ticketId: S.id, phone: S.phone, count: S.count, typing: typing });
    if (!S.id) return;
    if (d.ok) {
      await ingest(d.ticket, { reveal: false });
      if (!S.revealing) setTyping(!!d.agentTyping, 'agent');
    }
    schedule();
  }

  /* ---------- sending ---------- */
  async function send(textArg) {
    if (S.busy || S.closed) return;
    var text = String(textArg != null ? textArg : $('chText').value).trim();
    var ready = S.pending.filter(function (f) { return f.file; });
    if (S.pending.some(function (f) { return f.uploading; })) { toast('Please wait, your photo is still uploading.'); return; }
    if (!text && !ready.length) return;
    S.busy = true; setTyping(false);
    $('chText').value = ''; autosize(); $('chChips').innerHTML = '';
    var files = ready.map(function (f) { return f.file; });
    var tmp = renderMsg({ from: 'customer', text: text, at: new Date().toISOString(), files: ready.map(function (f) { return { local: f.url, name: f.file.name }; }) }, { pending: true });
    clearPending(false);
    var d = await post('/api/support/chat/send', { ticketId: S.id, phone: S.phone, text: text, files: files, count: S.count });
    if (tmp && tmp.parentNode) { tmp.parentNode.removeChild(tmp); S.lastFrom = ''; }
    if (!d.ok) {
      if (d.closed) { S.closed = true; header(); sys('This chat was closed.'); }
      else { sys(d.error || 'Could not send. Please try again.'); if (text) $('chText').value = text; }
    } else {
      await ingest(d.ticket, { reveal: true });
    }
    S.busy = false; $('chSend').disabled = false; schedule(S.mode === 'human' ? 1500 : 4000);
  }
  function autosize() { var t = $('chText'); t.style.height = 'auto'; t.style.height = Math.min(130, t.scrollHeight) + 'px'; }

  /* ---------- photos ---------- */
  function readBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { rej(new Error('bad image')); }; im.src = u; });
  }
  async function shrink(file) {
    var okType = /^image\/(jpeg|png|webp)$/.test(file.type);
    if (okType && file.size <= 1024 * 1024) return file;
    var bmp = await readBitmap(file), w = bmp.width, h = bmp.height, max = 1600, k = Math.min(1, max / Math.max(w, h)), q = 0.86, blob;
    w = Math.round(w * k); h = Math.round(h * k);
    for (var i = 0; i < 6; i++) {
      var c = document.createElement('canvas'); c.width = w; c.height = h; var cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
      blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', q); });
      if (blob && blob.size <= TARGET_BYTES) break;
      q = Math.max(0.5, q - 0.1); if (i % 2) { w = Math.round(w * 0.85); h = Math.round(h * 0.85); }
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error('too big');
    return blob;
  }
  function renderPending() {
    var box = $('chFiles'); box.hidden = !S.pending.length; box.innerHTML = '';
    S.pending.forEach(function (f) {
      var d = document.createElement('div'); d.className = 'cf' + (f.file ? ' ok' : '') + (f.bad ? ' bad' : '');
      d.innerHTML = '<img src="' + esc(f.url) + '" alt=""><span class="sp"></span><button type="button" aria-label="Remove photo">×</button>';
      d.querySelector('button').onclick = function () { S.pending = S.pending.filter(function (x) { return x !== f; }); renderPending(); };
      box.appendChild(d);
    });
  }
  function clearPending() { S.pending = []; renderPending(); }
  async function addFiles(fl) {
    var files = Array.prototype.slice.call(fl || []);
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (S.pending.length >= MAX_PHOTOS) { toast('You can attach up to ' + MAX_PHOTOS + ' photos at a time.'); break; }
      if (!/^image\//.test(f.type)) { toast('Only photos can be attached (JPG, PNG or WebP).'); continue; }
      var item = { url: URL.createObjectURL(f), uploading: true }; S.pending.push(item); renderPending();
      try {
        var blob = await shrink(f);
        var r = await fetch('/api/support/upload', { method: 'POST', headers: { 'X-Ticket': S.id, 'X-Phone': S.phone, 'X-File-Name': encodeURIComponent(f.name || 'photo'), 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
        var d = await r.json().catch(function () { return { ok: false, error: 'Upload failed.' }; });
        if (!d.ok) throw new Error(d.error || 'Upload failed.');
        item.file = d.file; item.uploading = false;
      } catch (e) {
        item.uploading = false; item.bad = true; toast(e && e.message && !/bad image|too big/.test(e.message) ? e.message : 'That photo could not be used. Try a JPG or PNG under 3 MB.');
        S.pending = S.pending.filter(function (x) { return x !== item; });
      }
      renderPending();
    }
  }

  /* ---------- start / resume / new ---------- */
  function remember(t, phone, name) {
    store(LS_SESSION, { id: t.ticketId, phone: phone, name: name });
    var rec = (store(LS_RECENT) || []).filter(function (x) { return x.id !== t.ticketId; }); rec.unshift({ id: t.ticketId, phone: phone, name: name, at: new Date().toISOString() }); store(LS_RECENT, rec.slice(0, 5));
    store('hs_chat_last', { name: name, phone: phone });
  }
  function resetState() { S.rating = 0; picked = 0; if ($('rateStars')) { paintStars(0); $('rateMore').hidden = true; $('rateNote').value = ''; } S.count = 0; S.mode = 'bot'; S.lastFrom = ''; S.lastAt = 0; S.lastDay = ''; S.agentJoined = false; S.closed = false; S.busy = false; all = []; list().innerHTML = ''; $('chChips').innerHTML = ''; clearPending(); setTyping(false); $('chText').value = ''; }
  async function begin(t, phone, name, o) {
    resetState(); S.id = t.ticketId; S.phone = phone; S.name = name; showChat(); header();
    await ingest(t, o || { reveal: false, full: true }); toBottom(true); schedule(); setTimeout(function () { $('chText').focus(); }, 50);
  }
  var starting = false;
  async function quickStart() {
    if (starting || !profile) return; starting = true; $('startView').hidden = true; $('bootView').hidden = false;
    var d = await post('/api/support/chat/start', { name: profile.name, phone: profile.phone, orderId: q.get('order') || '', website: '' });
    starting = false;
    if (!d.ok) { profile = null; $('bootView').hidden = true; $('startView').hidden = false; $('sErr').textContent = d.error || 'Could not start the chat.'; return; }
    remember(d.ticket, profile.phone, profile.name);
    if (window.trackEvent) window.trackEvent('SupportChatStart', {});
    begin(d.ticket, profile.phone, profile.name, { reveal: true });
  }
  // logged-in visitors: reuse the name / number we already have (Firestore profile, else the login itself)
  async function loadProfile() {
    try {
      if (typeof currentUserAsync !== 'function') return null;
      var user = await Promise.race([currentUserAsync(), sleep(3500).then(function () { return null; })]);
      if (!user) return null;
      var a = null; try { a = await Promise.race([loadUserAddress(), sleep(3000).then(function () { return null; })]); } catch (e) {}
      a = a || {};
      var name = String(a.name || user.displayName || '').trim(), phone = digits(a.phone || user.phoneNumber || '').slice(-10);
      return { name: name, phone: phone, ok: name.length >= 2 && phone.length === 10 };
    } catch (e) { return null; }
  }
  $('startForm').addEventListener('submit', async function (e) {
    e.preventDefault(); var err = $('sErr'), btn = $('sGo'); err.textContent = '';
    var name = $('sName').value.trim(), phone = digits($('sPhone').value);
    if (name.length < 2) { err.textContent = 'Please enter your name.'; return; }
    if (phone.length !== 10) { err.textContent = 'Please enter a valid 10-digit mobile number.'; return; }
    btn.classList.add('busy'); btn.querySelector('span').textContent = 'Starting…';
    var d = await post('/api/support/chat/start', { name: name, phone: phone, orderId: q.get('order') || '', website: $('sHp').value });
    btn.classList.remove('busy'); btn.querySelector('span').textContent = 'Start chat';
    if (!d.ok) { err.textContent = d.error || 'Could not start the chat.'; return; }
    remember(d.ticket, phone, name);
    if (window.trackEvent) window.trackEvent('SupportChatStart', {});
    begin(d.ticket, phone, name, { reveal: true });
  });
  async function resume(id, phone) {
    $('rErr').textContent = '';
    var d = await post('/api/support/chat/poll', { ticketId: id, phone: phone, count: 0 });
    if (!d.ok) { $('rErr').textContent = d.error || 'Could not open that chat.'; $('resumeForm').hidden = false; $('rId').value = id; $('rPhone').value = phone; return false; }
    var name = d.ticket.name || (store(LS_SESSION) || {}).name || '';
    remember(d.ticket, phone, name); await begin(d.ticket, phone, name, { reveal: false, full: true }); return true;
  }
  $('resumeToggle').onclick = function () { $('resumeForm').hidden = !$('resumeForm').hidden; if (!$('resumeForm').hidden) $('rId').focus(); };
  $('resumeForm').addEventListener('submit', function (e) { e.preventDefault(); resume($('rId').value.trim().toUpperCase(), digits($('rPhone').value)); });
  function renderRecent() {
    var rec = store(LS_RECENT) || [], box = $('recent'); box.hidden = !rec.length; box.innerHTML = '';
    rec.forEach(function (r) {
      var b = document.createElement('button'); b.type = 'button';
      b.innerHTML = '<span>' + esc(r.name || 'Chat') + ' <small>· ' + esc(dayLabel(r.at)) + '</small></span><code>' + esc(r.id) + '</code>';
      b.onclick = function () { resume(r.id, r.phone); }; box.appendChild(b);
    });
  }
  function newChat() {
    if (!S.closed && S.id && !confirm('Start a new chat? You can come back to this one any time with its Chat ID (' + S.id + ').')) return;
    store(LS_SESSION, null); showStart();
  }
  $('chNew').onclick = newChat; $('chNew2').onclick = function () { store(LS_SESSION, null); showStart(); };
  $('chId').onclick = function () { try { navigator.clipboard.writeText(S.id); toast('Chat ID copied'); } catch (e) { toast(S.id); } };

  /* ---------- rating after close ---------- */
  var picked = 0;
  function paintStars(n) { Array.prototype.forEach.call($('rateStars').children, function (b) { b.classList.toggle('on', Number(b.dataset.v) <= n); }); }
  async function sendRating() {
    if (!picked) return; var btn = $('rateSend'); btn.disabled = true;
    var d = await post('/api/support/chat/rate', { ticketId: S.id, phone: S.phone, rating: picked, note: $('rateNote').value, count: S.count });
    btn.disabled = false;
    if (d.ok) { S.rating = picked; header(); } else toast(d.error || 'Could not send feedback.');
  }
  $('rateStars').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; picked = Number(b.dataset.v); paintStars(picked); if (picked >= 4) sendRating(); else $('rateMore').hidden = false; });
  $('rateSend').onclick = sendRating;

  /* ---------- composer events ---------- */
  $('chForm').addEventListener('submit', function (e) { e.preventDefault(); send(); });
  $('chText').addEventListener('input', function () { S.lastKey = Date.now(); autosize(); });
  $('chText').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('chAttach').onclick = function () { $('chPick').click(); };
  $('chPick').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  $('chText').addEventListener('paste', function (e) {
    var fl = []; Array.prototype.forEach.call((e.clipboardData && e.clipboardData.files) || [], function (f) { fl.push(f); });
    if (fl.length) { e.preventDefault(); addFiles(fl); }
  });
  var chat = $('chatView');
  ['dragenter', 'dragover'].forEach(function (ev) { chat.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1) { e.preventDefault(); chat.classList.add('drag'); } }); });
  ['dragleave', 'drop'].forEach(function (ev) { chat.addEventListener(ev, function (e) { if (ev === 'drop') { e.preventDefault(); addFiles(e.dataTransfer.files); } chat.classList.remove('drag'); }); });
  list().addEventListener('click', function (e) { var b = e.target.closest('.ch-img[data-src]'); if (!b) return; var lb = $('lb'); lb.querySelector('img').src = b.dataset.src; lb.hidden = false; });
  $('lb').addEventListener('click', function () { this.hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('lb').hidden = true; });

  /* ---------- boot ---------- */
  var q = new URLSearchParams(location.search);
  (async function boot() {
    var tk = (q.get('ticket') || q.get('chat') || '').toUpperCase(), sess = store(LS_SESSION), rec = store(LS_RECENT) || [];
    if (tk) {
      var hit = rec.filter(function (r) { return r.id === tk; })[0];
      if (hit && await resume(tk, hit.phone)) return;
      $('bootView').hidden = true; $('startView').hidden = false; $('resumeForm').hidden = false; $('rId').value = tk; renderRecent(); return;
    }
    if (sess && sess.id) { if (await resume(sess.id, sess.phone)) return; store(LS_SESSION, null); }
    var p = await loadProfile();
    if (p) {
      $('sLogin').hidden = true;
      if (p.ok) { profile = { name: p.name, phone: p.phone }; quickStart(); return; }
      $('sName').value = p.name; $('sPhone').value = p.phone;      // logged in but one detail missing: ask only for that
    }
    showStart();
  })();
})();
