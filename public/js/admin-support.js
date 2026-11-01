/* HEAVY SOUL — admin live support console. Uses the admin password already saved by admin.html. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'hs_admin_pw', pw = '', tickets = [], filter = 'need', sel = '', cur = null, count = 0, customerTyping = false;
  var section = 'chats', CATS = { delivery: 'Delivery problem', damaged: 'Damaged / wrong item', payment: 'Payment problem', refund: 'Refund', cancel: 'Cancellation', exchange: 'Size / exchange', other: 'Other' }, tbSig = '', AUTO = 3 * 24 * 3600 * 1000, listTimer = 0, pollTimer = 0, lastTyping = 0, sound = false, prevNeed = -1, busy = false, pending = [];
  var LABEL = { open: 'Open', in_progress: 'In progress', waiting_customer: 'Waiting customer', resolved: 'Resolved', closed: 'Closed' };
  var MACROS = [
    ['Greeting', 'Hi {name}! This is Heavy Soul support. I\'m looking into this now.'],
    ['Need photo', 'Could you please send a clear photo of the issue (and the parcel label if you have it) using the paperclip?'],
    ['Need order ID', 'Could you share your Order ID (it looks like HS-20261022-448) so I can check it for you?'],
    ['Chasing courier', 'I\'ve contacted the courier about {order} and will update you here as soon as I hear back. Thank you for your patience!'],
    ['Delay sorry', 'So sorry for the delay with {order}. Handmade orders can take a little longer, and courier delays happen. I\'m keeping an eye on it for you.'],
    ['Exchange (our mistake)', 'Sorry about the mix-up! Since the error was on our side we\'ll exchange it free of cost. Please send a photo of the item showing the size label and we\'ll arrange it.'],
    ['Refund timeline', 'Your refund has been initiated. It usually reaches your bank within 5–7 working days, depending on your bank.'],
    ['Resolved', 'Glad we could sort this out, {name}! I\'m closing this chat now. Message us any time if you need anything else.']
  ];
  var custom = []; try { custom = JSON.parse(localStorage.getItem('hs_admin_macros') || '[]'); } catch (e) {}
  function fillMacro(t) { return t.replace(/\{name\}/g, String((cur && cur.name) || 'there').split(' ')[0]).replace(/\{order\}/g, (cur && cur.orderId) || 'your order'); }
  try { sound = localStorage.getItem('hs_admin_snd') === '1'; } catch (e) {}

  function post(path, body) {
    body.adminPassword = pw;
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'No connection.' }; });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function tm(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function authFail() { try { localStorage.removeItem(KEY); } catch (e) {} clearInterval(listTimer); clearInterval(pollTimer); $('app').hidden = true; $('login').hidden = false; $('loginErr').textContent = 'Wrong or expired password.'; }
  function closesIn(t) {
    if (!t || t.status === 'closed') return '';
    var ms = Date.parse(t.updatedAt || t.createdAt) + AUTO - Date.now(); if (isNaN(ms)) return '';
    if (ms <= 0) return 'closing soon';
    var h = Math.floor(ms / 36e5), d = Math.floor(h / 24); return d ? d + 'd ' + (h % 24) + 'h' : h ? h + 'h' : Math.max(1, Math.floor(ms / 6e4)) + 'm';
  }
  function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function isNeed(t) { return t.status !== 'closed' && (t.needsHuman || (t.mode === 'human' && t.lastFrom === 'customer')); }
  function isLive(t) { return t.status !== 'closed' && t.mode === 'human'; }

  function enter() {
    $('login').hidden = true; $('app').hidden = false; snd();
    loadList(); clearInterval(listTimer); listTimer = setInterval(function () { if (!document.hidden) loadList(); }, 8000);
    clearInterval(pollTimer); pollTimer = setInterval(function () { if (!document.hidden && sel) poll(false); }, 2200);
  }
  function loadList() {
    return post('/api/support/admin/list', {}).then(function (d) {
      if (!d.ok) { if (/authoris/i.test(d.error || '')) authFail(); return; }
      tickets = d.tickets || []; if (d.autoCloseMs) AUTO = d.autoCloseMs; if (d.categories) CATS = d.categories;
      var n = tickets.filter(isNeed).length;
      if (prevNeed >= 0 && n > prevNeed) { if (sound) beep(); try { if (window.Notification && Notification.permission === 'granted') new Notification('Heavy Soul support', { body: n + ' chat' + (n > 1 ? 's' : '') + ' waiting for a reply' }); } catch (e) {} }
      prevNeed = n; document.title = (n ? '(' + n + ') ' : '') + 'Live support — Heavy Soul admin';
      drawStats(); drawTabs(); if (section === 'reports') drawReport(); else { drawChips(); drawList(); }
    });
  }
  var isT = function (t) { return !!t.isTicket; };
  var openT = function (t) { return isT(t) && t.status !== 'closed' && t.status !== 'resolved'; };
  function overdue(t) { return openT(t) && !t.firstReplyAt && t.dueAt && Date.parse(t.dueAt) < Date.now(); }
  function slaText(t) {
    if (!openT(t)) return '';
    if (t.firstReplyAt) return 'replied';
    var ms = Date.parse(t.dueAt) - Date.now(); if (isNaN(ms)) return '';
    var h = Math.floor(Math.abs(ms) / 36e5), m = Math.floor(Math.abs(ms) % 36e5 / 6e4), txt = h ? h + 'h' : m + 'm';
    return ms < 0 ? 'overdue ' + txt : 'reply due in ' + txt;
  }
  var DEFS = {
    chats: [['need', 'Needs reply', function (t) { return !isT(t) && isNeed(t); }, 1], ['live', 'Live', function (t) { return !isT(t) && isLive(t); }], ['bot', 'With bot', function (t) { return !isT(t) && t.status !== 'closed' && t.mode !== 'human'; }], ['closed', 'Closed', function (t) { return !isT(t) && t.status === 'closed'; }]],
    tickets: [['open', 'Open', openT], ['overdue', 'Overdue', overdue, 1], ['high', 'High priority', function (t) { return openT(t) && t.priority === 'high'; }], ['waiting', 'Waiting customer', function (t) { return openT(t) && t.status === 'waiting_customer'; }], ['done', 'Resolved / closed', function (t) { return isT(t) && !openT(t); }], ['low', 'Low rated', function (t) { return isT(t) && t.lowRating; }, 1]]
  };
  function drawStats() {
    var need = tickets.filter(isNeed).length, open = tickets.filter(openT).length, od = tickets.filter(overdue).length;
    var rs = tickets.filter(function (t) { return t.firstReplyAt; }).slice(0, 60).map(function (t) { return Date.parse(t.firstReplyAt) - Date.parse(t.escalatedAt || t.createdAt); }).filter(function (x) { return x >= 0; });
    var avg = rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : 0, h = Math.floor(avg / 36e5), m = Math.round(avg % 36e5 / 6e4);
    var today = new Date().toDateString(), nt = tickets.filter(function (t) { return new Date(t.createdAt).toDateString() === today; }).length;
    var cards = [['Needs reply', need, need ? 'hot' : ''], ['Open tickets', open, ''], ['Overdue', od, od ? 'hot' : ''], ['Avg first reply', rs.length ? (h ? h + 'h ' : '') + m + 'm' : '—', ''], ['Chats today', nt, '']];
    var box = $('stats'); box.textContent = '';
    cards.forEach(function (c) { var d = el('div', 'st ' + c[2]); d.appendChild(el('b', '', c[1])); d.appendChild(el('span', '', c[0])); box.appendChild(d); });
  }
  function drawTabs() {
    var box = $('tabs'); box.textContent = '';
    [['chats', 'Live chats', function (t) { return !isT(t) && isNeed(t); }], ['tickets', 'Tickets', function (t) { return isT(t) && (isNeed(t) || overdue(t)); }], ['reports', 'Reports', function () { return 0; }]].forEach(function (d) {
      var n = tickets.filter(d[2]).length, b = el('button', section === d[0] ? 'on' : ''); b.type = 'button'; b.appendChild(document.createTextNode(d[1]));
      if (n) b.appendChild(el('i', '', n)); b.onclick = function () { section = d[0]; if (DEFS[section]) filter = DEFS[section][0][0]; drawTabs(); showSection(); }; box.appendChild(b);
    });
  }
  function showSection() {
    var rp = section === 'reports'; $('report').hidden = !rp; $('chips').hidden = rp; document.querySelector('.adm-grid').hidden = rp;
    if (rp) drawReport(); else { drawChips(); drawList(); }
  }
  function bars(rows, max) { var w = el('div', 'rp-bars'); rows.forEach(function (r) { var d = el('div', 'rp-row'); d.appendChild(el('span', 'rp-l', r[0])); var tr = el('div', 'rp-t'); var f = el('i'); f.style.width = Math.max(2, Math.round(r[1] / (max || 1) * 100)) + '%'; tr.appendChild(f); d.appendChild(tr); d.appendChild(el('b', '', r[1])); w.appendChild(d); }); return w; }
  function drawReport() {
    var box = $('report'); box.textContent = '';
    var chatsAll = tickets, total = chatsAll.length;
    var botOnly = chatsAll.filter(function (t) { return !t.escalatedAt && t.mode !== 'human' && (t.total || 0) > 2; }).length;
    var rated = chatsAll.filter(function (t) { return t.rating; }), avg = rated.length ? rated.reduce(function (a, t) { return a + t.rating; }, 0) / rated.length : 0;
    var grid = el('div', 'rp-grid');
    [['Chats (recent 150)', total], ['Solved by bot alone', total ? Math.round(botOnly / total * 100) + '%' : '—'], ['Average rating', rated.length ? avg.toFixed(1) + ' / 5 (' + rated.length + ')' : '—'], ['Low ratings', rated.filter(function (t) { return t.rating <= 2; }).length]].forEach(function (c) { var d = el('div', 'st'); d.appendChild(el('b', '', c[1])); d.appendChild(el('span', '', c[0])); grid.appendChild(d); });
    box.appendChild(grid);
    var cols = el('div', 'rp-cols');
    var c1 = el('section', 'sd-card'); c1.appendChild(el('h4', '', 'Tickets by category'));
    var cc = {}; tickets.filter(isT).forEach(function (t) { var k = CATS[t.category] || 'Other'; cc[k] = (cc[k] || 0) + 1; });
    var cr = Object.keys(cc).map(function (k) { return [k, cc[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    c1.appendChild(cr.length ? bars(cr, cr[0][1]) : el('div', 'sd-muted', 'No tickets yet.')); cols.appendChild(c1);
    var c2 = el('section', 'sd-card'); c2.appendChild(el('h4', '', 'Chats per day (last 7 days)'));
    var days = []; for (var i = 6; i >= 0; i--) { var d0 = new Date(Date.now() - i * 864e5); days.push([d0.toDateString(), d0.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }), 0]); }
    tickets.forEach(function (t) { var k = new Date(t.createdAt).toDateString(); days.forEach(function (d) { if (d[0] === k) d[2]++; }); });
    var mx = Math.max.apply(null, days.map(function (d) { return d[2]; }).concat([1])); c2.appendChild(bars(days.map(function (d) { return [d[1], d[2]]; }), mx)); cols.appendChild(c2);
    var c3 = el('section', 'sd-card'); c3.appendChild(el('h4', '', 'Questions the bot could not answer (teach it these)'));
    var mm = {}; tickets.forEach(function (t) { (t.missed || []).forEach(function (q) { var k = q.toLowerCase().trim(); mm[k] = (mm[k] || 0) + 1; }); });
    var mr = Object.keys(mm).sort(function (a, b) { return mm[b] - mm[a]; }).slice(0, 12);
    if (!mr.length) c3.appendChild(el('div', 'sd-muted', 'Nothing missed so far.')); mr.forEach(function (q) { var r = el('div', 'rp-miss'); r.appendChild(el('span', '', q)); r.appendChild(el('b', '', '×' + mm[q])); c3.appendChild(r); }); cols.appendChild(c3);
    var c4 = el('section', 'sd-card'); c4.appendChild(el('h4', '', 'Latest feedback'));
    rated.slice(0, 8).forEach(function (t) { var r = el('div', 'rp-fb'); r.appendChild(el('b', '', '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating))); r.appendChild(el('span', '', ' ' + (t.name || '') + (t.ratingNote ? ' — ' + t.ratingNote : ''))); c4.appendChild(r); });
    if (!rated.length) c4.appendChild(el('div', 'sd-muted', 'No ratings yet.')); cols.appendChild(c4);
    box.appendChild(cols);
  }
  function drawChips() {
    if (!DEFS[section]) return;
    var box = $('chips'); box.textContent = '';
    DEFS[section].forEach(function (d) {
      var n = tickets.filter(d[2]).length, b = el('button', (filter === d[0] ? 'on ' : '') + (d[3] && n ? 'hot' : ''));
      b.type = 'button'; b.appendChild(document.createTextNode(d[1])); b.appendChild(el('b', '', n));
      b.onclick = function () { filter = d[0]; drawChips(); drawList(); }; box.appendChild(b);
    });
  }
  function pass(t) { var d = DEFS[section].filter(function (x) { return x[0] === filter; })[0] || DEFS[section][0]; return d[2](t); }
  function drawList() {
    if (!DEFS[section]) return;
    var box = $('list'); box.textContent = '';
    var rows = tickets.filter(pass);
    if (!rows.length) { box.appendChild(el('div', 'adm-empty', 'Nothing here.')); return; }
    rows.forEach(function (t) {
      var b = el('button', 'adm-row' + (t.ticketId === sel ? ' sel' : '') + (isNeed(t) ? ' need' : '')); b.type = 'button';
      var r1 = el('div', 'r1'); r1.appendChild(el('span', 'nm', t.name || 'Customer')); r1.appendChild(el('span', 'tm', tm(t.updatedAt))); b.appendChild(r1);
      b.appendChild(el('div', 'pv', t.preview || '—'));
      var r3 = el('div', 'r3');
      if (isNeed(t)) r3.appendChild(el('span', 'atag need', 'Needs reply'));
      if (isT(t)) { r3.appendChild(el('span', 'atag cat', CATS[t.category] || 'Ticket')); if (t.priority === 'high') r3.appendChild(el('span', 'atag need', 'High')); var sl = slaText(t); if (sl) r3.appendChild(el('span', 'atag' + (/overdue/.test(sl) ? ' need' : ''), sl)); }
      r3.appendChild(el('span', 'atag ' + (t.status === 'closed' ? 'closed' : t.mode === 'human' ? 'live' : 'bot'), t.status === 'closed' ? 'Closed' : t.mode === 'human' ? 'Live' : 'Bot'));
      if (t.vip) r3.appendChild(el('span', 'atag vip', 'VIP')); if (t.rating) r3.appendChild(el('span', 'atag' + (t.rating <= 2 ? ' need' : ''), '★ ' + t.rating)); r3.appendChild(el('span', 'atag', t.ticketId)); var ci = closesIn(t); if (ci) r3.appendChild(el('span', 'atag', 'closes in ' + ci)); b.appendChild(r3);
      b.onclick = function () { open(t.ticketId); }; box.appendChild(b);
    });
  }

  /* ---------- thread ---------- */
  function open(id) {
    sel = id; cur = null; count = 0; pending = []; customerTyping = false; drawList();
    var box = $('detail'); box.textContent = ''; box.className = 'adm-chat';
    box.appendChild(el('div', 'adm-empty', 'Loading…'));
    poll(true);
  }
  function poll(first) {
    var id = sel; if (!id) return;
    var typing = Date.now() - lastTyping < 4000;
    post('/api/support/admin/poll', { ticketId: id, count: first ? 0 : count, typing: typing }).then(function (d) {
      if (id !== sel) return;
      if (!d.ok) { if (/authoris/i.test(d.error || '')) authFail(); else if (first) $('detail').textContent = d.error || 'Could not load.'; return; }
      var t = d.ticket, was = cur;
      if (first || !cur) { cur = t; cur.messages = t.messages || []; build(); }
      else { var add = t.messages || []; var changed = add.length || t.status !== cur.status || t.mode !== cur.mode; Object.keys(t).forEach(function (k) { if (k !== 'messages') cur[k] = t[k]; }); if (add.length) { cur.messages = cur.messages.concat(add); add.forEach(addMsg); } if (changed) head(); }
      count = t.total; customerTyping = !!d.customerTyping; typingUi();
    });
  }
  function build() {
    var root = $('detail'); root.textContent = ''; root.className = 'adm-chat split';
    var box = el('div', 'ad-main'); box.id = 'adMain'; var side = el('aside', 'ad-side'); side.id = 'adSide'; root.appendChild(box); root.appendChild(side);
    var h = el('div', 'ad-head'); h.id = 'adHead'; box.appendChild(h);
    var body = el('div', 'ad-body'); body.id = 'adBody'; box.appendChild(body);
    var ty = el('div', 'ad-typing'); ty.id = 'adTy'; box.appendChild(ty);
    var ce = el('div', 'ad-err'); ce.id = 'adErr'; box.appendChild(ce);
    var can = el('div', 'ad-canned'); can.id = 'adCanned'; box.appendChild(can); drawMacros();
    var fl = el('div', 'ad-files'); fl.id = 'adFiles'; fl.hidden = true; box.appendChild(fl);
    var ml = el('label', 'ad-mail'); ml.id = 'adMailRow'; ml.innerHTML = '<input type="checkbox" id="adMail"> <span>Also email this reply to <b id="adMailTo"></b></span>'; box.appendChild(ml);
    var f = el('form', 'ad-comp'); f.id = 'adForm';
    f.innerHTML = '<input type="file" id="adPick" accept="image/jpeg,image/png,image/webp" multiple hidden>' +
      '<button type="button" class="ad-ic" id="adAttach" aria-label="Attach photo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.5 12.5 21a5.5 5.5 0 0 1-8-8l9-9a3.7 3.7 0 0 1 5.3 5.3l-9 9a1.8 1.8 0 0 1-2.6-2.6L15 7"/></svg></button>' +
      '<textarea id="adText" rows="1" maxlength="1500" placeholder="Reply as Heavy Soul Support…"></textarea>' +
      '<button type="submit" class="ad-ic send" id="adSend" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>';
    box.appendChild(f);
    try { $('adMail').checked = localStorage.getItem('hs_admin_mail') === '1'; } catch (e) {}
    $('adMail').onchange = function () { try { localStorage.setItem('hs_admin_mail', this.checked ? '1' : '0'); } catch (e) {} };
    head(); cur.messages.forEach(addMsg); stick(true); loadCustomer(sel);
    var ta = $('adText');
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; if (ta.value.trim() && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); poll(false); } else if (ta.value.trim()) lastTyping = Date.now(); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    f.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    $('adAttach').onclick = function () { $('adPick').click(); };
    $('adPick').onchange = function () { addFiles(this.files); this.value = ''; };
    ta.focus();
  }
  function drawMacros() {
    var can = $('adCanned'); if (!can) return; can.textContent = '';
    var sug = el('button', 'sv', '✨ Suggest reply'); sug.type = 'button'; sug.title = 'Gemini writes a draft from this chat. You read, edit and send it.';
    sug.onclick = function () {
      if (!cur) return; var ta = $('adText'); sug.disabled = true; sug.textContent = '✨ Thinking…';
      post('/api/support/admin/suggest', { ticketId: cur.ticketId }).then(function (d) {
        sug.disabled = false; sug.textContent = '✨ Suggest reply';
        if (!d || !d.ok) { err((d && d.error) || 'Could not get a draft.'); return; }
        var first = String((cur && cur.name) || 'there').split(' ')[0];
        ta.value = d.draft.replace(/\[name\]/gi, first); ta.focus(); ta.dispatchEvent(new Event('input'));
        if (d.check) err('Draft has [CHECK: …] parts. Fill or remove them before sending.');
      });
    };
    can.appendChild(sug);
    MACROS.concat(custom).forEach(function (m, i) { var b = el('button', '', m[0]); b.type = 'button'; b.title = fillMacro(m[1]); b.onclick = function () { var ta = $('adText'); ta.value = fillMacro(m[1]); ta.focus(); ta.dispatchEvent(new Event('input')); }; can.appendChild(b); });
    var sv = el('button', 'sv', '+ save reply as macro'); sv.type = 'button'; sv.onclick = function () { var t = $('adText').value.trim(); if (!t) { err('Type the reply first, then save it as a macro.'); return; } var n = prompt('Macro name?'); if (!n) return; custom.push([n.slice(0, 24), t]); try { localStorage.setItem('hs_admin_macros', JSON.stringify(custom)); } catch (e) {} drawMacros(); };
    can.appendChild(sv);
  }
  function head() {
    var h = $('adHead'); if (!h || !cur) return; h.textContent = '';
    var l = el('div'); var t = el('h2', '', cur.name || 'Customer'); l.appendChild(t);
    var sm = el('small', '', cur.ticketId); l.appendChild(sm);
    var m = el('div', 'ad-meta'); var a = el('a', '', cur.phone || ''); a.href = 'tel:' + (cur.phone || ''); m.appendChild(a);
    var mt = $('adMailTo'); if (mt) mt.textContent = cur.email || '(no email on file)';
    var mr = $('adMailRow'); if (mr) mr.style.display = cur.status === 'closed' ? 'none' : '';
    if (cur.email) m.appendChild(el('span', '', '✉ ' + cur.email));
    if (cur.orderId) { var o = el('a', '', 'Order ' + cur.orderId); o.href = 'track.html?order=' + encodeURIComponent(cur.orderId); o.target = '_blank'; o.rel = 'noopener'; m.appendChild(o); }
    m.appendChild(el('span', '', 'Started ' + tm(cur.createdAt)));
    if (cur.status !== 'closed') { var ac = el('span', 'ad-auto', ''); ac.id = 'adAuto'; m.appendChild(ac); }
    l.appendChild(m); h.appendChild(l);
    var tools = el('div', 'ad-tools');
    if (cur.status !== 'closed' && cur.mode !== 'human') { var tk = el('button', 'ad-btn red', 'Take over'); tk.type = 'button'; tk.onclick = function () { act({ action: 'takeover' }, tk); }; tools.appendChild(tk); }
    var s = el('select'); Object.keys(LABEL).forEach(function (k) { var o = el('option', '', LABEL[k]); o.value = k; if (k === cur.status) o.selected = true; s.appendChild(o); });
    s.onchange = function () { if (s.value === 'closed' && !confirm('Close this chat? Photos will be deleted 7 days after closing.')) { s.value = cur.status; return; } act({ status: s.value }, s); };
    tools.appendChild(s);
    if (cur.status !== 'closed') { var c = el('button', 'ad-btn', 'Close chat'); c.type = 'button'; c.onclick = function () { if (confirm('Close this chat? Photos will be deleted 7 days after closing.')) act({ status: 'closed' }, c); }; tools.appendChild(c); }
    h.appendChild(tools); tickAuto(); renderTbox(false);
    var f = $('adForm'), closed = cur.status === 'closed'; if (f) f.style.display = closed ? 'none' : '';
    var old = $('adNote'); if (old) old.remove();
    if (cur.mode !== 'human' && !closed) { var n = el('div', 'ad-note', 'The bot is handling this chat. Sending a reply (or Take over) makes you the live agent.'); n.id = 'adNote'; $('adMain').appendChild(n); }
    if (closed) { var n2 = el('div', 'ad-note', 'Chat closed' + (cur.filesPurged ? ' — photos already deleted.' : ' — photos are deleted 7 days after closing.')); n2.id = 'adNote'; $('detail').appendChild(n2); }
  }
  function addMsg(m) {
    var b = $('adBody'); if (!b) return;
    if (m.from === 'system') { b.appendChild(el('div', 'sysm' + (m.internal ? ' int' : ''), m.text)); stick(); return; }
    var mine = m.from === 'support', w = el('div', 'm' + (mine ? ' mine' : '') + (m.from === 'bot' ? ' botm' : ''));
    w.appendChild(el('div', 'nm', m.from === 'customer' ? (cur.name || 'Customer') : m.from === 'bot' ? 'Soul (bot)' : 'You'));
    if (m.text || !(m.files && m.files.length)) w.appendChild(el('div', 'b', m.text || ''));
    if (m.files && m.files.length) {
      var im = el('div', 'imgs');
      m.files.forEach(function (f) {
        if (f.expired) { im.appendChild(el('div', 'gone', 'Photo expired')); return; }
        var bt = el('button'); bt.type = 'button'; var i = new Image(); i.src = f.local || '/api/support/file/' + f.key; i.alt = f.name || 'photo'; i.onload = function () { stick(); };
        bt.onclick = function () { $('lb').querySelector('img').src = i.src; $('lb').hidden = false; }; bt.appendChild(i); im.appendChild(bt);
      });
      w.appendChild(im);
    }
    w.appendChild(el('div', 't', tm(m.at))); b.appendChild(w); stick(mine);
  }
  function stick(force) { var b = $('adBody'); if (!b) return; if (force || b.scrollHeight - b.scrollTop - b.clientHeight < 160) b.scrollTop = b.scrollHeight; }
  function typingUi() {
    var t = $('adTy'); if (!t) return; t.textContent = '';
    if (customerTyping) { var d = el('span', 'tb'); d.innerHTML = '<i></i><i></i><i></i>'; t.appendChild(d); t.appendChild(el('span', '', (cur && cur.name || 'Customer') + ' is typing…')); stick(); }
  }

  /* ---------- actions ---------- */
  function err(m) { var e = $('adErr'); if (e) e.textContent = m || ''; }
  function act(extra, btn) {
    if (btn) btn.disabled = true; err('');
    post('/api/support/admin/reply', Object.assign({ ticketId: sel, count: count }, extra)).then(function (d) {
      if (btn) btn.disabled = false;
      if (!d.ok) { err(d.error || 'Failed.'); return; }
      merge(d.ticket); loadList();
    });
  }
  function merge(t) {
    var add = t.messages || []; Object.keys(t).forEach(function (k) { if (k !== 'messages') cur[k] = t[k]; });
    cur.messages = cur.messages.concat(add); add.forEach(addMsg); count = t.total; head(); renderTbox(true);
  }
  function send() {
    if (busy) return; var ta = $('adText'), text = ta.value.trim(), ready = pending.filter(function (p) { return p.file; });
    if (pending.some(function (p) { return !p.file && !p.failed; })) { err('Photos are still uploading…'); return; }
    if (!text && !ready.length) return;
    busy = true; $('adSend').disabled = true; err('');
    post('/api/support/admin/reply', { ticketId: sel, text: text, email: !!($('adMail') && $('adMail').checked && text), files: ready.map(function (p) { return p.file; }), count: count }).then(function (d) {
      busy = false; $('adSend').disabled = false;
      if (!d.ok) { err(d.error || 'Could not send.'); return; }
      var es = d.emailStatus; if (es) err(es === 'sent' ? '✓ Sent in chat and by email.' : es === 'no_email' ? 'Sent in chat. Email NOT sent: no email address on file (add it in the Ticket box).' : es === 'no_key' ? 'Sent in chat. Email NOT sent: email service is not set up yet.' : 'Sent in chat. Email failed, please check the email service.');
      ta.value = ''; ta.style.height = 'auto'; pending = []; drawPending(); lastTyping = 0; merge(d.ticket); loadList();
    });
  }
  function addFiles(list) {
    Array.prototype.slice.call(list).slice(0, 4).forEach(function (f) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { err('Only JPG, PNG or WebP photos.'); return; }
      if (f.size > 3 * 1024 * 1024) { err('"' + f.name + '" is over 3 MB.'); return; }
      if (pending.length >= 4) { err('Max 4 photos per message.'); return; }
      var p = { url: URL.createObjectURL(f), file: null, failed: false }; pending.push(p); drawPending();
      fetch('/api/support/admin/upload', { method: 'POST', headers: { 'X-Admin-Pw': pw, 'X-Ticket': sel, 'X-File-Name': encodeURIComponent(f.name), 'Content-Type': f.type }, body: f })
        .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Upload failed.' }; })
        .then(function (d) { if (d.ok) p.file = d.file; else { p.failed = true; pending = pending.filter(function (x) { return x !== p; }); err(d.error || 'Upload failed.'); } drawPending(); });
    });
  }
  function drawPending() {
    var b = $('adFiles'); if (!b) return; b.textContent = ''; b.hidden = !pending.length;
    pending.forEach(function (p) { var w = el('div', 'f' + (p.file ? ' ok' : '')), i = new Image(); i.src = p.url; w.appendChild(i); var x = el('button', '', '×'); x.type = 'button'; x.onclick = function () { pending = pending.filter(function (q) { return q !== p; }); drawPending(); }; w.appendChild(x); b.appendChild(w); });
  }


  function tickAuto() { var a = $('adAuto'); if (a && cur) { var c = closesIn(cur); a.textContent = c ? 'Auto-closes in ' + c + ' if nobody replies' : ''; } }
  setInterval(function () { tickAuto(); if (tickets.length) drawList(); }, 60000);

  /* ---------- ticket box: category / priority / tags / SLA / private notes ---------- */
  function sigOf(c) { return [c.email, c.isTicket, c.category, c.priority, (c.tags || []).join(), (c.notes || []).length, c.dueAt, c.firstReplyAt, c.status].join('|'); }
  function metaSave(m) { act({ meta: m }); }
  function renderTbox(force) {
    var box = $('adTbox'); if (!box || !cur) return;
    var sig = sigOf(cur); if (!force && sig === tbSig) return;
    var f = document.activeElement; if (!force && f && box.contains(f)) return;   // never rebuild while someone is typing a note
    tbSig = sig; box.textContent = '';
    var card = el('section', 'sd-card tk'); var top = el('div', 'sd-top'); top.appendChild(el('h4', '', cur.isTicket ? 'Ticket' : 'Chat')); 
    if (cur.isTicket) { var sl = slaText(cur); if (sl) top.appendChild(el('span', 'sd-st' + (/overdue/.test(sl) ? ' red' : ''), sl)); }
    card.appendChild(top);
    if (!cur.isTicket) {
      card.appendChild(el('div', 'sd-row', 'This is a normal chat. Convert it to a ticket when it needs follow-up work (courier chase, refund, replacement).'));
      var cb = el('button', 'ad-btn red', 'Convert to ticket'); cb.type = 'button'; cb.onclick = function () { metaSave({ isTicket: true }); }; card.appendChild(cb);
    } else {
      var l1 = el('label', 'sd-l', 'Category'); var sc = el('select'); Object.keys(CATS).forEach(function (k) { var o = el('option', '', CATS[k]); o.value = k; if (k === cur.category) o.selected = true; sc.appendChild(o); }); sc.onchange = function () { metaSave({ category: sc.value }); }; l1.appendChild(sc); card.appendChild(l1);
      var l2 = el('label', 'sd-l', 'Priority'); var sp = el('select'); ['low', 'normal', 'high'].forEach(function (k) { var o = el('option', '', k[0].toUpperCase() + k.slice(1)); o.value = k; if (k === (cur.priority || 'normal')) o.selected = true; sp.appendChild(o); }); sp.onchange = function () { metaSave({ priority: sp.value }); }; l2.appendChild(sp); card.appendChild(l2);
      var l3 = el('label', 'sd-l', 'Tags (comma separated)'); var ti = el('input'); ti.value = (cur.tags || []).join(', '); ti.placeholder = 'vip, courier-delay'; ti.onchange = function () { metaSave({ tags: ti.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) }); }; l3.appendChild(ti); card.appendChild(l3);
      var rm = el('button', 'sd-link', 'Remove from tickets (back to chats)'); rm.type = 'button'; rm.onclick = function () { metaSave({ isTicket: false }); }; card.appendChild(rm);
    }
    box.appendChild(card);
    var ec = el('section', 'sd-card'); ec.appendChild(el('h4', '', 'Customer email'));
    var ei = el('input'); ei.type = 'email'; ei.placeholder = 'name@example.com'; ei.value = cur.email || ''; ei.onchange = function () { metaSave({ email: ei.value.trim() }); }; ec.appendChild(ei);
    ec.appendChild(el('div', 'sd-row', 'Ticket-raised, chat-closed and "also email" replies go to this address. Filled automatically from the customer\'s account or orders.')); box.appendChild(ec);
    var nc = el('section', 'sd-card'); nc.appendChild(el('h4', '', 'Private notes (customer never sees these)'));
    (cur.notes || []).forEach(function (n) { var d = el('div', 'sd-note'); d.appendChild(el('div', '', n.text)); d.appendChild(el('small', '', tm(n.at))); nc.appendChild(d); });
    var nt = el('textarea'); nt.rows = 2; nt.placeholder = 'e.g. Called courier, parcel at hub. Refund ok up to ₹999.'; nc.appendChild(nt);
    var nb = el('button', 'ad-btn', 'Add note'); nb.type = 'button'; nb.onclick = function () { var v = nt.value.trim(); if (v) act({ note: v }, nb); }; nc.appendChild(nb); box.appendChild(nc);
  }

  /* ---------- customer panel (details + last 5 orders) ---------- */
  function loadCustomer(id) {
    var side = $('adSide'); if (!side) return; side.textContent = '';
    var tg = el('button', 'ad-sidetoggle', 'Customer & orders'); tg.type = 'button'; tg.onclick = function () { side.classList.toggle('open'); }; side.appendChild(tg);
    var wrap = el('div', 'ad-sidebody'); wrap.id = 'adSideBody'; var tbox = el('div', 'sd-tbox'); tbox.id = 'adTbox'; var body = el('div', 'sd-cbox'); wrap.appendChild(tbox); wrap.appendChild(body); side.appendChild(wrap); body.appendChild(el('div', 'sd-muted', 'Loading customer…')); tbSig = ''; renderTbox(true);
    post('/api/support/admin/customer', { ticketId: id }).then(function (d) {
      if (id !== sel) return; body.textContent = '';
      if (!d.ok) { body.appendChild(el('div', 'sd-muted', d.error || 'Could not load customer.')); return; }
      var c = d.customer;
      var card = el('section', 'sd-card'); card.appendChild(el('h3', '', c.name || 'Customer'));
      var ph = el('a', 'sd-row', c.phone); ph.href = 'tel:' + c.phone; card.appendChild(ph);
      var wa = el('a', 'sd-row', 'WhatsApp / call outside'); wa.href = 'https://wa.me/91' + c.phone; wa.target = '_blank'; wa.rel = 'noopener'; card.appendChild(wa);
      if (c.email) card.appendChild(el('div', 'sd-row', c.email));
      if (c.address) card.appendChild(el('div', 'sd-row', c.address));
      card.appendChild(el('div', 'sd-pills', '')); 
      var pills = card.lastChild; pills.appendChild(el('span', 'atag', c.hasAccount ? 'Has account / orders' : 'No saved orders'));
      pills.appendChild(el('span', 'atag', d.stats.orderCount + ' orders')); if (d.stats.lifetime) pills.appendChild(el('span', 'atag', money(d.stats.lifetime) + ' total'));
      body.appendChild(card);
      if (d.mentioned) { var mc = el('section', 'sd-card hot'); mc.appendChild(el('h4', '', 'Order mentioned in chat')); var ml = el('a', 'sd-oid', d.mentioned.orderId); ml.href = 'track.html?order=' + encodeURIComponent(d.mentioned.orderId); ml.target = '_blank'; ml.rel = 'noopener'; mc.appendChild(ml); mc.appendChild(el('div', 'sd-row', (d.mentioned.status || '—') + (d.mentioned.eta ? ' · ETA ' + d.mentioned.eta : ''))); body.appendChild(mc); }
      body.appendChild(el('h4', 'sd-h', 'Last ' + (d.orders.length || 5) + ' orders'));
      if (!d.orders.length) body.appendChild(el('div', 'sd-muted', 'No saved orders for this number. Guest checkouts are not linked here — check the Orders sheet.'));
      d.orders.forEach(function (o) {
        var oc = el('section', 'sd-card'); var top = el('div', 'sd-top');
        var a = el('a', 'sd-oid', o.orderId); a.href = 'track.html?order=' + encodeURIComponent(o.orderId); a.target = '_blank'; a.rel = 'noopener'; top.appendChild(a);
        top.appendChild(el('span', 'sd-st', o.status || '—')); oc.appendChild(top);
        oc.appendChild(el('div', 'sd-row', tm(o.createdAt) + ' · ' + (o.paymentType || '').toUpperCase() + ' · ' + money(o.total)));
        (o.items || []).forEach(function (i) { oc.appendChild(el('div', 'sd-item', (i.qty || 1) + ' × ' + (i.name || 'Item') + (i.size && i.size !== '-' ? ' (' + i.size + ')' : ''))); });
        if (o.awb) oc.appendChild(el('div', 'sd-row', (o.courier || 'Courier') + ' · ' + o.awb));
        if (o.eta) oc.appendChild(el('div', 'sd-row', 'ETA ' + o.eta));
        body.appendChild(oc);
      });
      if (d.otherChats && d.otherChats.length) {
        body.appendChild(el('h4', 'sd-h', 'Earlier chats'));
        d.otherChats.forEach(function (x) { var b = el('button', 'sd-chat', x.ticketId + ' · ' + (x.status === 'closed' ? 'Closed' : 'Open') + ' · ' + tm(x.createdAt)); b.type = 'button'; b.onclick = function () { open(x.ticketId); }; body.appendChild(b); });
      }
    });
  }

  /* ---------- sound ---------- */
  function snd() { var b = $('snd'); b.textContent = 'Sound: ' + (sound ? 'on' : 'off'); b.classList.toggle('on', sound); }
  function beep() { try { var C = window.AudioContext || window.webkitAudioContext, c = new C(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .18); } catch (e) {} }
  $('snd').onclick = function () { try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} sound = !sound; try { localStorage.setItem('hs_admin_snd', sound ? '1' : '0'); } catch (e) {} snd(); if (sound) beep(); };
  $('lb').onclick = function () { this.hidden = true; };

  /* ---------- login ---------- */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); pw = $('pw').value; $('loginErr').textContent = '';
    post('/api/support/admin/list', {}).then(function (d) {
      if (!d.ok) { $('loginErr').textContent = d.error || 'Wrong password.'; return; }
      try { localStorage.setItem(KEY, pw); } catch (x) {} enter();
    });
  });
  $('logout').onclick = function (e) { e.preventDefault(); try { localStorage.removeItem(KEY); } catch (x) {} location.reload(); };
  var saved = ''; try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
  if (saved) { pw = saved; enter(); }
})();

