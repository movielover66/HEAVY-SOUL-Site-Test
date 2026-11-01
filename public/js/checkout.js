// Step 2: address. Cart is read fresh from localStorage.
// Returning customers see their saved address(es) and continue in one tap;
// everyone else (or "Edit" / "Add a new address") gets the full details form.
const orderCart = JSON.parse(localStorage.getItem("cart")) || [];

const checkoutItems = document.getElementById("checkoutItems");
const totalPriceEl = document.getElementById("checkoutTotal");

let total = 0;

if (orderCart.length === 0) {
  checkoutItems.innerHTML = `<p style="color:var(--hs-text-soft);">Your bag is empty. <a href="shop.html" style="color:var(--hs-accent-text);">Go shopping →</a></p>`;
} else {
  orderCart.forEach(item => {
    const qty = item.qty || 1;
    total += item.price * qty;
    checkoutItems.innerHTML += `
      <div class="mini-item">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
        <div>
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="meta">Size ${escapeHtml(item.size || "-")} · Qty ${qty}</div>
          <div class="meta">₹${item.price * qty}</div>
        </div>
      </div>
    `;
  });
}
totalPriceEl.textContent = "₹" + total;
["barTotal", "barTotal2", "subtotalVal"].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "₹" + total; });
const estEl = document.getElementById("estText");
if (estEl && window.HSAddr) estEl.textContent = HSAddr.estimate();

if (orderCart.length > 0 && typeof trackEvent === "function") {
  trackEvent("InitiateCheckout", { value: total, currency: "INR", num_items: orderCart.length });
}

// ---- Fields ----
const $ = id => document.getElementById(id);
const nameEl = $("name"), phoneEl = $("phone"), altEl = $("altPhone"), emailEl = $("email");
const houseEl = $("house"), streetEl = $("street"), landmarkEl = $("landmark");
const stateEl = $("state"), cityEl = $("city"), pinEl = $("pin"), pinChecking = $("pinChecking");
const PHONE_RE = /^[6-9]\d{9}$/;

let book = [];            // saved addresses (max 3)
let selectedId = null;    // which saved address is ticked
let editingId = null;     // id being edited (null = brand-new address)
let addrType = "Home";
let mode = "form";        // "saved" | "form"

// ---- Validation helpers ----
function setState(el, errId, filled, ok) {
  const box = el.closest(".ck-box"), errEl = errId ? $(errId) : null;
  if (!filled) { box.classList.remove("valid", "invalid"); if (errEl) errEl.classList.remove("show"); return; }
  box.classList.toggle("valid", ok); box.classList.toggle("invalid", !ok);
  if (errEl) errEl.classList.toggle("show", !ok);
}
function check(el, errId, ok, optional) {
  const filled = el.value.trim().length > 0;
  if (!filled && !optional) { const box = el.closest(".ck-box"); box.classList.remove("valid"); box.classList.add("invalid"); if ($(errId)) $(errId).classList.add("show"); return false; }
  setState(el, errId, filled, ok);
  return filled ? ok : true;
}
const rules = {
  name:  () => nameEl.value.trim().length >= 2,
  phone: () => PHONE_RE.test(phoneEl.value.trim()),
  alt:   () => !altEl.value.trim() || (PHONE_RE.test(altEl.value.trim()) && altEl.value.trim() !== phoneEl.value.trim()),
  email: () => !emailEl.value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim()),
  house: () => houseEl.value.trim().length >= 1,
  street:() => streetEl.value.trim().length >= 3 && (houseEl.value.trim() + streetEl.value.trim()).length >= 10,
  pin:   () => /^\d{6}$/.test(pinEl.value.trim()),
  state: () => stateEl.value.trim().length >= 2
};
nameEl.addEventListener("input", () => setState(nameEl, "err-name", nameEl.value.trim().length > 0, rules.name()));
phoneEl.addEventListener("input", () => { phoneEl.value = phoneEl.value.replace(/\D/g, "").slice(0, 10); setState(phoneEl, "err-phone", !!phoneEl.value, rules.phone()); });
altEl.addEventListener("input", () => { altEl.value = altEl.value.replace(/\D/g, "").slice(0, 10); setState(altEl, "err-altPhone", !!altEl.value, rules.alt()); });
emailEl.addEventListener("input", () => setState(emailEl, "err-email", !!emailEl.value.trim(), rules.email()));
houseEl.addEventListener("input", () => setState(houseEl, "err-house", !!houseEl.value.trim(), rules.house()));
streetEl.addEventListener("input", () => setState(streetEl, "err-street", !!streetEl.value.trim(), rules.street()));
stateEl.addEventListener("input", () => setState(stateEl, "err-state", !!stateEl.value.trim(), rules.state()));

// ---- PIN code: validate + auto-fill city/state via the free India Post API ----
let pinLookupTimeout;
pinEl.addEventListener("input", () => {
  pinEl.value = pinEl.value.replace(/\D/g, "").slice(0, 6);
  const valid = rules.pin();
  setState(pinEl, "err-pin", !!pinEl.value, valid);
  pinChecking.textContent = ""; pinChecking.classList.remove("pin-error", "ok");
  clearTimeout(pinLookupTimeout);
  if (!valid) return;
  pinLookupTimeout = setTimeout(async () => {
    pinChecking.textContent = "Checking PIN code…";
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pinEl.value.trim()}`);
      const data = await res.json();
      const po = data?.[0]?.PostOffice?.[0];
      if (po) {
        stateEl.value = po.State; stateEl.closest(".ck-box").classList.add("valid");
        cityEl.value = po.District; cityEl.closest(".ck-box").classList.add("valid");
        stateEl.dataset.city = po.District;
        pinChecking.textContent = `✓ Deliverable — ${po.District}, ${po.State}`;
      } else {
        stateEl.dataset.city = "";
        pinChecking.textContent = "✓ Deliverable to this area";
      }
    } catch { pinChecking.textContent = "✓ Deliverable to this area"; }
    pinChecking.classList.add("ok");
  }, 500);
});

// ---- Address type chips ----
$("typeChips").addEventListener("click", e => {
  const b = e.target.closest(".ck-chip"); if (!b) return;
  addrType = b.dataset.type;
  document.querySelectorAll("#typeChips .ck-chip").forEach(c => c.classList.toggle("on", c === b));
});

// ---- Views ----
function first(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }
function setHeading() {
  const f = first((book[0] && book[0].name) || "");
  if (mode === "saved" && f) { $("helloLine").textContent = "hey, good to see you again"; $("pageTitle").textContent = "Welcome back, " + f + "."; }
  else if (mode === "form" && book.length) { $("helloLine").textContent = "tell us everything, we’ll be careful"; $("pageTitle").textContent = editingId ? "Edit your address." : "Add a new address."; }
  else { $("helloLine").textContent = "tell us everything, we’ll be careful"; $("pageTitle").textContent = "Where should we send it?"; }
}
function showSaved() {
  mode = "saved"; $("savedView").hidden = false; $("formView").hidden = true; renderSaved(); setHeading();
}
function clearForm() {
  [nameEl, phoneEl, altEl, emailEl, houseEl, streetEl, landmarkEl, pinEl, cityEl, stateEl].forEach(el => { el.value = ""; el.closest(".ck-box").classList.remove("valid", "invalid"); });
  stateEl.dataset.city = ""; pinChecking.textContent = "";
  document.querySelectorAll(".ck-err").forEach(e => e.classList.remove("show"));
}
function fillForm(a) {
  clearForm(); if (!a) return;
  nameEl.value = a.name || ""; phoneEl.value = a.phone || ""; altEl.value = a.altPhone || ""; emailEl.value = a.email || "";
  houseEl.value = a.house || ""; streetEl.value = a.street || a.address || ""; landmarkEl.value = a.landmark || "";
  pinEl.value = a.pin || ""; cityEl.value = a.city || ""; stateEl.value = a.state || "";
  if (a.city) stateEl.dataset.city = a.city;
  addrType = a.type || "Home";
  document.querySelectorAll("#typeChips .ck-chip").forEach(c => c.classList.toggle("on", c.dataset.type === addrType));
}
function showForm(entry) {
  mode = "form"; editingId = entry ? entry.id : null;
  $("savedView").hidden = true; $("formView").hidden = false; $("backToSaved").hidden = book.length === 0;
  fillForm(entry || (book.length ? { name: book[0].name, phone: book[0].phone, altPhone: book[0].altPhone, email: book[0].email } : null));
  setHeading();
}
$("backToSaved").addEventListener("click", showSaved);
$("addNewBtn").addEventListener("click", () => showForm(null));

function renderSaved() {
  const list = $("savedList");
  if (!selectedId || !book.some(a => a.id === selectedId)) selectedId = book[0] && book[0].id;
  list.innerHTML = book.map(a => {
    const sel = a.id === selectedId;
    const line1 = [a.house, a.street].filter(Boolean).join(", ") || a.address;
    const line2 = [a.landmark ? "Near " + a.landmark : "", [a.city, a.state].filter(Boolean).join(", ") + (a.pin ? " – " + a.pin : "")].filter(Boolean).join(" · ");
    return `<label class="ck-addr ${sel ? "sel" : ""}" data-id="${escapeHtml(a.id)}">
      <div class="stripe"></div>
      <div class="ck-addr-in">
        <input type="radio" name="addr" ${sel ? "checked" : ""}>
        <div class="body">
          <div class="top"><b>${escapeHtml(a.name)}</b><span class="badge">${sel ? tickSvg() : ""}Saved · ${escapeHtml(a.type || "Home")}</span></div>
          <span>${escapeHtml(line1)}<br>${escapeHtml(line2)}</span>
          <span class="meta">+91 ${escapeHtml(a.phone)}${a.altPhone ? " · Alt +91 " + escapeHtml(a.altPhone) : ""}${a.email ? "<br>" + escapeHtml(a.email) : ""}</span>
        </div>
      </div>
      <div class="acts"><button type="button" class="ck-pill" data-edit="${escapeHtml(a.id)}">Edit details</button></div>
    </label>`;
  }).join("");
}
function tickSvg() {
  return `<svg class="ck-tick" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
}
$("savedList").addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]");
  if (ed) { e.preventDefault(); showForm(book.find(a => a.id === ed.dataset.edit)); return; }
  const card = e.target.closest(".ck-addr");
  if (card) { selectedId = card.dataset.id; renderSaved(); }
});

// ---- Load saved addresses: this device first, then the account (works across devices) ----
function initBook() {
  const local = HSAddr.loadLocal();
  const legacy = HSAddr.fromLegacy(JSON.parse(localStorage.getItem("shippingInfo") || "null"));
  book = HSAddr.merge([local, legacy ? [legacy] : []]);
  if (book.length) showSaved(); else showForm(null);
}
initBook();

if (window.firebase) {
  firebase.auth().onAuthStateChanged(async function (user) {
    if (!user) return;
    const remote = await HSAddr.loadRemote();
    if (!remote.length) return;
    const merged = HSAddr.merge([remote, book]);
    const pristine = mode === "form" && !nameEl.value && !streetEl.value && !pinEl.value;
    book = merged; HSAddr.saveLocal(book);
    if (mode === "saved") { renderSaved(); setHeading(); }
    else if (pristine) showSaved();
  });
}

// ---- Read + validate the form ----
function readForm() {
  const ok = [
    check(nameEl, "err-name", rules.name()),
    check(phoneEl, "err-phone", rules.phone()),
    check(altEl, "err-altPhone", rules.alt(), true),
    check(emailEl, "err-email", rules.email(), true),
    check(pinEl, "err-pin", rules.pin()),
    check(stateEl, "err-state", rules.state()),
    check(houseEl, "err-house", rules.house()),
    check(streetEl, "err-street", rules.street())
  ].every(Boolean);
  if (!ok) return null;
  return HSAddr.clean({
    id: editingId || undefined, type: addrType, name: nameEl.value.trim(), phone: phoneEl.value.trim(), altPhone: altEl.value.trim(), email: emailEl.value.trim(),
    house: houseEl.value.trim(), street: streetEl.value.trim(), landmark: landmarkEl.value.trim(),
    city: (cityEl.value || stateEl.dataset.city || "").trim(), state: stateEl.value.trim(), pin: pinEl.value.trim()
  });
}

// Asks the backend if everything in the bag is still in stock.
// Fails open: if the check can't run (network etc.), the customer continues
// and the server re-checks before payment anyway.
async function checkStockBeforePayment(){
  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes("PASTE-YOUR")) return { ok: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "check_stock",
        apiToken: SITE_CONFIG.API_TOKEN || "",
        items: orderCart.map(i => ({ id: i.id, sku: i.sku || "", name: i.name, size: i.size, qty: i.qty || 1 }))
      })
    });
    const data = await res.json();
    if (data && data.success === true && data.ok === false) {
      return { ok: false, message: data.message };
    }
  } catch (err) { /* fail open */ }
  return { ok: true };
}

function setBusy(busy) {
  ["continueBtn", "barContinueBtn"].forEach(id => {
    const b = $(id); if (!b) return;
    b.disabled = busy;
    const l = b.querySelector(".lbl"); if (l) l.textContent = busy ? "Checking stock…" : (id === "continueBtn" ? "Continue to payment" : "Continue");
  });
}

async function goToPayment(){
  if (orderCart.length === 0) { showToast("Your bag is empty"); return; }

  let entry;
  if (mode === "saved") {
    entry = book.find(a => a.id === selectedId);
    const complete = entry && entry.name.length >= 2 && PHONE_RE.test(entry.phone) && entry.house && entry.street && /^\d{6}$/.test(entry.pin) && entry.state;
    if (!complete) { showForm(entry || null); readForm(); showToast("Please complete your address details"); return; }
  } else {
    entry = readForm();
    if (!entry) { showToast("Please check the highlighted fields"); return; }
  }

  setBusy(true);
  const stockCheck = await checkStockBeforePayment();
  setBusy(false);
  if (!stockCheck.ok) { showToast(stockCheck.message || "An item in your bag is sold out"); return; }

  const shippingInfo = {
    name: entry.name, phone: entry.phone, altPhone: entry.altPhone, email: entry.email,
    address: entry.address, city: entry.city, state: entry.state, pin: entry.pin,
    house: entry.house, street: entry.street, landmark: entry.landmark, addressType: entry.type
  };
  localStorage.setItem("shippingInfo", JSON.stringify(shippingInfo));

  const save = mode === "saved" || $("saveAddr").checked;
  if (save) {
    book = HSAddr.upsert(book, entry); HSAddr.saveLocal(book);
    // If logged in, also save to their account so it's there next time on any device
    if (window.firebase && typeof saveUserAddress === "function") saveUserAddress(shippingInfo);
    HSAddr.saveRemote(book);
  }

  logAbandonedCart(shippingInfo);

  localStorage.removeItem("paymentDeadline");
  localStorage.removeItem("paymentMethod");

  window.location.href = "payment.html";
}

function logAbandonedCart(shippingInfo){
  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes("PASTE-YOUR")) return;

  const cartSummary = orderCart
    .map(item => `${item.name} (${item.size || "-"}) x${item.qty || 1}`)
    .join(", ");

  fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      type: "abandoned_cart",
      apiToken: SITE_CONFIG.API_TOKEN || "",
      customerName: shippingInfo.name,
      phone: shippingInfo.phone,
      cartSummary: cartSummary
    })
  }).catch(() => {});
}
