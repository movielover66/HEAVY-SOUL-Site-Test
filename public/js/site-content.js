// Heavy Soul — editable home page content.
// ONE list of every editable field (label + default text). It is used by:
//   • index.html      — shows the saved text/photos, falls back to these defaults
//   • admin.html      — builds the "Site content" tab from this same list
// To make another line editable: add a field here + data-c="that.key" on the element in index.html.
(function () {
  var S = [
    { id: 'top', title: 'Top bar & moving strip', fields: [
      { k: 'notice', label: 'Black bar at the very top', type: 'text', def: 'Free shipping over ₹1499 · Made-to-order pieces ship in 5–7 days' },
      { k: 'ticker', label: 'Red moving strip (separate items with ✦)', type: 'long', def: 'QUALITY YOU CAN FEEL ✦ TRUST YOU CAN COUNT ON ✦ SECURE PAYMENTS ✦ TRACKED DELIVERY ✦ MADE IN INDIA ✦ FREE SHIPPING OVER ₹1499' }
    ] },
    { id: 'cats', title: 'Categories (Find your fit)', fields: [
      { k: 'cats.h1', label: 'Heading — line 1', type: 'text', def: 'Find your' },
      { k: 'cats.h2', label: 'Heading — line 2 (outlined)', type: 'text', def: 'fit.' },
      { k: 'cats.hint', label: 'Small note (computer only)', type: 'text', def: 'Hover a panel to see more.' },
      { k: 'cats.0.name', label: 'Panel 1 name', type: 'text', def: 'T-Shirts' },
      { k: 'cats.0.image', label: 'Panel 1 photo (empty = automatic from products)', type: 'image', def: '' },
      { k: 'cats.1.name', label: 'Panel 2 name', type: 'text', def: 'Hoodies' },
      { k: 'cats.1.image', label: 'Panel 2 photo', type: 'image', def: '' },
      { k: 'cats.2.name', label: 'Panel 3 name', type: 'text', def: 'Bottoms' },
      { k: 'cats.2.image', label: 'Panel 3 photo', type: 'image', def: '' },
      { k: 'cats.3.name', label: 'Panel 4 name', type: 'text', def: 'Outerwear' },
      { k: 'cats.3.image', label: 'Panel 4 photo', type: 'image', def: '' }
    ] },
    { id: 'best', title: 'Best sellers heading', fields: [
      { k: 'best.h1', label: 'Heading — line 1', type: 'text', def: 'Best sellers' },
      { k: 'best.h2', label: 'Heading — line 2 (coloured)', type: 'text', def: '& new arrivals' },
      { k: 'best.btn', label: 'Button text', type: 'text', def: 'View all →' }
    ] },
    { id: 'why', title: 'Quality & Trust section', fields: [
      { k: 'why.eyebrow', label: 'Small label', type: 'text', def: 'Why Heavy Soul' },
      { k: 'why.h1', label: 'Heading — line 1', type: 'text', def: 'Quality you can feel.' },
      { k: 'why.h2', label: 'Heading — line 2', type: 'text', def: 'Trust you can count on.' },
      { k: 'why.lead', label: 'Paragraph', type: 'long', def: 'We don’t pick one over the other. Every piece is made to look good and last, and every order is handled so you never have to wonder where it is or whether it will turn up.' },
      { k: 'why.b1.label', label: 'Box 1 — label', type: 'text', def: 'Quality' },
      { k: 'why.b1.title', label: 'Box 1 — title', type: 'text', def: 'Made to last.' },
      { k: 'why.b1.text', label: 'Box 1 — text', type: 'long', def: 'Premium fabric, garment-washed so it feels broken-in from day one, and made in small batches so every piece gets proper attention.' },
      { k: 'why.b2.label', label: 'Box 2 — label', type: 'text', def: 'Trust' },
      { k: 'why.b2.title', label: 'Box 2 — title', type: 'text', def: 'No guesswork.' },
      { k: 'why.b2.text', label: 'Box 2 — text', type: 'long', def: 'Secure payments, tracked delivery on every order, easy returns, and real people on WhatsApp when you need help.' },
      { k: 'why.t0.title', label: 'Tile 1 — title', type: 'text', def: 'Secure payments' },
      { k: 'why.t0.sub', label: 'Tile 1 — small text', type: 'text', def: 'Safe checkout' },
      { k: 'why.t1.title', label: 'Tile 2 — title', type: 'text', def: 'Tracked delivery' },
      { k: 'why.t1.sub', label: 'Tile 2 — small text', type: 'text', def: 'Know where it is' },
      { k: 'why.t2.title', label: 'Tile 3 — title', type: 'text', def: 'Easy returns' },
      { k: 'why.t2.sub', label: 'Tile 3 — small text', type: 'text', def: 'See our policy' },
      { k: 'why.t3.title', label: 'Tile 4 — title', type: 'text', def: 'Made in India' },
      { k: 'why.t3.sub', label: 'Tile 4 — small text', type: 'text', def: 'Ships across India' }
    ] },
    { id: 'look', title: 'Moving photo strip', fields: [
      { k: 'look.images', label: 'Photos (up to 12). Leave empty to use your product photos automatically.', type: 'images', def: '' }
    ] },
    { id: 'custom', title: 'Custom prints section', fields: [
      { k: 'custom.eyebrow', label: 'Small label', type: 'text', def: 'Custom prints' },
      { k: 'custom.h1', label: 'Heading — line 1', type: 'text', def: 'Send your art.' },
      { k: 'custom.h2', label: 'Heading — line 2 (outlined)', type: 'text', def: 'We print it.' },
      { k: 'custom.text', label: 'Paragraph', type: 'long', def: 'DTF printing on our signature boxy tee — your artwork, your photo, your logo. Made to order, so please allow a little extra time.' },
      { k: 'custom.btn', label: 'Button text', type: 'text', def: 'Start a custom order →' },
      { k: 'custom.badge', label: 'Big text in the circle', type: 'text', def: '5–7d' },
      { k: 'custom.ring', label: 'Text going around the circle', type: 'text', def: 'CUSTOM PRINTS ✦ MADE TO ORDER ✦ 5–7 DAYS ✦ DTF ✦' },
      { k: 'custom.s0.title', label: 'Step 1 — title', type: 'text', def: 'Pick your base' },
      { k: 'custom.s0.text', label: 'Step 1 — text', type: 'text', def: 'Choose the tee, size and colourway.' },
      { k: 'custom.s1.title', label: 'Step 2 — title', type: 'text', def: 'Send your art' },
      { k: 'custom.s1.text', label: 'Step 2 — text', type: 'text', def: 'Share the design over WhatsApp after checkout.' },
      { k: 'custom.s2.title', label: 'Step 3 — title', type: 'text', def: 'We print & ship' },
      { k: 'custom.s2.text', label: 'Step 3 — text', type: 'text', def: 'Made to order in 5–7 days, tracked to your door.' }
    ] },
    { id: 'foot', title: 'Footer', fields: [
      { k: 'foot.brand', label: 'Brand name', type: 'text', def: 'Heavy Soul' },
      { k: 'foot.desc', label: 'About text', type: 'long', def: 'Premium streetwear essentials, designed in small batches and built to last. Quality you can feel, trust you can count on.' },
      { k: 'foot.nl.title', label: 'Newsletter title', type: 'text', def: 'Stay in the loop' },
      { k: 'foot.nl.text', label: 'Newsletter text', type: 'text', def: 'New drops, restocks, no spam.' },
      { k: 'foot.word', label: 'Giant word at the bottom', type: 'text', def: 'HEAVY SOUL' },
      { k: 'foot.copy', label: 'Bottom line — left', type: 'text', def: '© 2026 Heavy Soul. All rights reserved.' },
      { k: 'foot.mid', label: 'Bottom line — middle', type: 'text', def: 'Prices in INR · Ships across India' },
      { k: 'foot.reg', label: 'Bottom line — right', type: 'text', def: 'Trade Reg. No. 3549 (Saptagram GP, Hooghly)' }
    ] }
  ];

  var defs = {};
  S.forEach(function (s) { s.fields.forEach(function (f) { defs[f.k] = f.def; }); });

  var HS = window.HS = window.HS || {};
  HS.SCHEMA = S; HS.defs = defs; HS.content = {};
  // current value: saved text if there is one, otherwise the default
  HS.val = function (k) { var v = HS.content[k]; return (v != null && v !== '') ? v : (defs[k] != null ? defs[k] : ''); };
  HS.list = function (k) { try { var a = JSON.parse(HS.content[k] || '[]'); return Array.isArray(a) ? a.filter(function (u) { return typeof u === 'string' && u; }) : []; } catch (e) { return []; } };
  // writes saved text into every element that has data-c="key" (text only — never HTML)
  HS.apply = function (map) {
    HS.content = map && typeof map === 'object' ? map : {};
    [].forEach.call(document.querySelectorAll('[data-c]'), function (el) {
      var k = el.getAttribute('data-c');
      if (!(k in defs)) return;
      el.textContent = HS.val(k) + (el.getAttribute('data-c-after') || '');
    });
  };
})();
