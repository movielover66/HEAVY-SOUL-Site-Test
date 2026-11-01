/* HEAVY SOUL — saved addresses ("address book") + delivery estimate.
   Keeps up to 3 addresses per customer: in localStorage (this device) and, when
   logged in, in their Firestore user document (field "addressBook") so they
   follow the customer across devices. Used by checkout.js and payment-fx.js. */
(function (w) {
  'use strict';
  var KEY = 'hsAddressBook', MAX = 3;

  function compose(a) {                                   // one clean string for the order sheet / WhatsApp
    var s = [a.house, a.street].filter(Boolean).join(', ');
    if (a.landmark) s += (s ? ', ' : '') + 'Landmark: ' + a.landmark;
    return s || a.address || '';
  }
  function sig(a) { return [a.pin || '', String(a.house || '').toLowerCase(), String(a.street || a.address || '').toLowerCase().slice(0, 30)].join('|'); }
  function newId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function clean(a) {
    var o = {
      id: a.id || newId(), type: a.type || 'Home', name: a.name || '', phone: a.phone || '', altPhone: a.altPhone || '', email: a.email || '',
      house: a.house || '', street: a.street || '', landmark: a.landmark || '', city: a.city || '', state: a.state || '', pin: a.pin || ''
    };
    o.address = compose(o);
    return o;
  }
  function fromLegacy(info) {                              // old single-address records (no house / landmark fields)
    if (!info || !(info.address || info.street) || !info.pin) return null;
    return clean({ name: info.name, phone: info.phone, altPhone: info.altPhone, email: info.email, house: info.house, street: info.street || info.address,
      landmark: info.landmark, city: info.city, state: info.state, pin: info.pin, type: info.addressType || info.type });
  }
  function loadLocal() {
    try { var b = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(b) ? b.map(clean) : []; } catch (e) { return []; }
  }
  function saveLocal(book) { try { localStorage.setItem(KEY, JSON.stringify(book.slice(0, MAX))); } catch (e) {} }
  function merge(lists) {                                  // first list wins, de-duplicated
    var seen = {}, out = [];
    lists.forEach(function (l) { (l || []).forEach(function (a) { if (!a) return; var k = sig(a); if (!seen[k]) { seen[k] = 1; out.push(clean(a)); } }); });
    return out.slice(0, MAX);
  }
  function upsert(book, entry) {
    var e = clean(entry), k = sig(e);
    return [e].concat(book.filter(function (a) { return a.id !== e.id && sig(a) !== k; })).slice(0, MAX);
  }
  async function loadRemote() {                            // [] when logged out / offline
    try {
      if (typeof loadUserAddress !== 'function') return [];
      var doc = await loadUserAddress();
      if (!doc) return [];
      var list = Array.isArray(doc.addressBook) ? doc.addressBook : [];
      var legacy = fromLegacy(doc);
      return merge([list, legacy ? [legacy] : []]);
    } catch (e) { return []; }
  }
  async function saveRemote(book) {                        // separate write so the original saveUserAddress can never be affected
    try {
      if (!w.firebase || typeof currentUserAsync !== 'function' || typeof firestoreReady !== 'function' || !firestoreReady()) return;
      var user = await currentUserAsync(); if (!user) return;
      await firebase.firestore().collection('users').doc(user.uid).set({ addressBook: book.slice(0, MAX) }, { merge: true });
    } catch (e) { console.error('address book save failed:', e); }
  }

  /* delivery estimate: dispatch in 2-3 business days, then about 7 days (see policy page) */
  function addBD(d, n) { var x = new Date(d); while (n > 0) { x.setDate(x.getDate() + 1); var wd = x.getDay(); if (wd !== 0 && wd !== 6) n--; } return x; }
  function estimate() {
    var now = new Date(), a = addBD(now, 2), b = addBD(now, 3);
    a.setDate(a.getDate() + 7); b.setDate(b.getDate() + 7);
    var f = function (d) { return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    return f(a) + ' – ' + f(b);
  }

  w.HSAddr = { compose: compose, clean: clean, fromLegacy: fromLegacy, loadLocal: loadLocal, saveLocal: saveLocal, merge: merge, upsert: upsert, loadRemote: loadRemote, saveRemote: saveRemote, estimate: estimate };
})(window);
