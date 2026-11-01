/* HEAVY SOUL — My orders page logic.
   Data: Firestore order records (loadUserOrders, js/orders.js) + live status
   from the Apps Script tracking endpoint. */
const OD_STEPS = ["Confirmed", "Packed", "Shipped", "Out for Delivery", "Delivered"];
const OD_STEP_LABEL = ["Placed", "Packed", "Shipped", "Out for delivery", "Delivered"];
const OD_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>';
const OD_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const OD_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
const OD_COPY = {
  "confirmed": ["Order confirmed", "We are getting your order ready."],
  "packed": ["Packed and waiting", "Your parcel is packed. The courier picks it up next."],
  "shipped": ["On its way to you", "Your parcel is moving through the courier network."],
  "out for delivery": ["Out for delivery", "The rider is heading to you today. Keep your phone on."]
};
const OD_STATUS_CLASS = { "confirmed":"s-confirmed","packed":"s-packed","shipped":"s-shipped","out for delivery":"s-outfordelivery","delivered":"s-delivered","cancelled":"s-cancelled" };

let allOrdersCache = [];
let statusCache = {};
let currentFilter = "all";
let currentSort = "new";
let catalogCache = { bySku: {}, byName: {} };
let openIds = new Set();
let statsAnimated = false;

const e_ = (s) => escapeHtml(String(s == null ? "" : s));
const money_ = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN");

/* ---------- catalog images for older orders ---------- */
let _catalogPromise = null;
function loadProductCatalog_(){
  if (_catalogPromise) return _catalogPromise;
  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes("PASTE-YOUR")) return Promise.resolve({ bySku: {}, byName: {} });
  _catalogPromise = fetch(url + "?type=products").then(r => r.json()).then(data => {
    const bySku = {}, byName = {};
    (data && data.products ? data.products : []).forEach(p => {
      const img = p.image || p.imageUrl || p.img || "";
      if (!img) return;
      if (p.sku) bySku[String(p.sku).trim().toLowerCase()] = img;
      if (p.name) byName[String(p.name).trim().toLowerCase()] = img;
    });
    return { bySku, byName };
  }).catch(() => ({ bySku: {}, byName: {} }));
  return _catalogPromise;
}
function resolveItemImage_(item, order){
  if (!item) return "";
  if (item.image) return item.image;
  const st = order && statusCache[order.orderId];
  if (st && Array.isArray(st.items)) {
    const nm = String(item.name || "").trim().toLowerCase();
    const m = st.items.find(x => String(x.name || "").trim().toLowerCase() === nm && x.image);
    if (m) return m.image;
  }
  const sku = String(item.sku || "").trim().toLowerCase();
  if (sku && catalogCache.bySku[sku]) return catalogCache.bySku[sku];
  const name = String(item.name || "").trim().toLowerCase();
  return (name && catalogCache.byName[name]) || "";
}

/* ---------- helpers ---------- */
function orderDate_(o){ return o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null; }
function sKey_(o){ const st = statusCache[o.orderId]; return st ? String(st.status || "").toLowerCase() : ""; }
function isActive_(o){ const k = sKey_(o); return !!k && k !== "delivered" && k !== "cancelled"; }
function stepIndex_(k){ return OD_STEPS.findIndex(s => s.toLowerCase() === k); }
function daysLeft_(raw){
  const d = new Date(raw); if (isNaN(d)) return null;
  const t = new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0);
  return Math.round((d - t) / 86400000);
}
function daysText_(raw){
  const n = daysLeft_(raw);
  if (n === null) return "";
  if (n < 0) return "Arriving any moment";
  if (n === 0) return "Arriving today";
  if (n === 1) return "Arriving tomorrow";
  return "In " + n + " days";
}
function thumbHtml_(item, order, cls){
  const img = resolveItemImage_(item, order);
  const ch = e_(String((item && item.name) || "H").charAt(0).toUpperCase());
  return `<span class="od-thumb ${cls || ""}">${img ? `<img src="${e_(img)}" alt="${e_(item && item.name)}" loading="lazy" onerror="this.outerHTML='<span class=&quot;ph&quot;>${ch}</span>'">` : `<span class="ph">${ch}</span>`}</span>`;
}
function stackHtml_(order){
  const items = order.items || [];
  const shown = items.slice(0, 3).map(it => thumbHtml_(it, order)).join("");
  const rest = items.length - 3;
  return `<div class="od-stack">${shown || thumbHtml_(null, order)}${rest > 0 ? `<span class="od-thumb more">+${rest}</span>` : ""}</div>`;
}
function totalOf_(o){
  const st = statusCache[o.orderId];
  return Number(o.subtotal) || (st && Number(st.grandTotal)) || Number(o.amountPaid) || 0;
}

/* ---------- spotlight (nearest active order) ---------- */
function spotlightHtml_(){
  const active = allOrdersCache.filter(isActive_).sort((a, b) => {
    const ea = statusCache[a.orderId].estimatedDelivery, eb = statusCache[b.orderId].estimatedDelivery;
    return (ea ? new Date(ea) : 9e15) - (eb ? new Date(eb) : 9e15);
  });
  if (!active.length) return "";
  const o = active[0], st = statusCache[o.orderId], k = sKey_(o);
  const idx = Math.max(stepIndex_(k), 0);
  const copy = OD_COPY[k] || [st.status, ""];
  const steps = OD_STEPS.map((s, i) => `<div class="od-st ${i <= idx ? "done" : ""} ${i === idx ? "now" : ""}" style="--k:${i}"><i>${i <= idx ? OD_CHECK : ""}</i><span>${OD_STEP_LABEL[i]}</span></div>`).join("");
  return `
    <section class="od-spot" aria-label="Active order">
      <div class="od-spot-top">
        <span class="od-spot-tag"><i></i> ${active.length > 1 ? active.length + " orders on the way · next to arrive" : "On the way"}</span>
        <span class="od-id">${e_(o.orderId)}</span>
      </div>
      <div class="od-spot-main">
        ${stackHtml_(o)}
        <div><h2>${e_(copy[0])}</h2><p>${e_(copy[1])}</p></div>
        <div class="od-spot-edd">
          ${st.estimatedDelivery ? `<small>Estimated delivery</small><b>${e_(formatEddDate(st.estimatedDelivery))}</b><span class="od-chip-pink">${e_(daysText_(st.estimatedDelivery))}</span>` : ""}
          <div style="margin-top:14px;"><a class="od-btn" href="track.html?order=${encodeURIComponent(o.orderId)}">Track live ${OD_ARROW}</a></div>
        </div>
      </div>
      <div class="od-steps" style="--p:${idx / 4}">${steps}</div>
    </section>`;
}

/* ---------- order card ---------- */
function cardHtml_(o, n){
  const st = statusCache[o.orderId];
  const k = sKey_(o);
  const d = orderDate_(o);
  const dateStr = d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const items = o.items || [];
  const itemsText = items.map(it => `${it.name}${it.size && it.size !== "-" ? " (" + it.size + ")" : ""} ×${it.qty || 1}`).join(", ");
  const idx = stepIndex_(k);
  const isCod = String(o.paymentType || (st && st.paymentType) || "").toLowerCase() === "cod";
  const open = openIds.has(o.orderId);
  const live = k && k !== "delivered" && k !== "cancelled";

  const badge = st ? `<span class="od-badge ${OD_STATUS_CLASS[k] || "s-confirmed"}">${e_(st.status || "Confirmed")}</span>` : `<span class="od-badge s-loading">Checking</span>`;
  const edd = (st && st.estimatedDelivery && live) ? `<span class="od-chip">${e_(daysText_(st.estimatedDelivery))} · <b>${e_(formatEddDate(st.estimatedDelivery))}</b></span>` : "";
  const can = (st && st.cancelEligible) ? `<span class="od-chip can">Cancellable</span>` : "";
  const mini = (st && k !== "cancelled") ? `<div class="od-mini">${OD_STEPS.map((s, i) => `<i class="${i <= idx ? "on" : ""}" style="--k:${i}"></i>`).join("")}</div>` : "";

  const rows = items.map(it => {
    const q = Number(it.qty) || 1, p = Number(it.price) || 0;
    return `<div class="od-row">${thumbHtml_(it, o)}<div><h4>${e_(it.name)}</h4><small>${it.size && it.size !== "-" ? "Size " + e_(it.size) + " · " : ""}Qty ${q} · ${money_(p)} each</small></div><span class="pr">${money_(p * q)}</span></div>`;
  }).join("");
  const wa = "https://wa.me/" + (SITE_CONFIG.WHATSAPP_NUMBER || "919339909978") + "?text=" + encodeURIComponent("Hi Heavy Soul, I need help with order " + o.orderId);
  const paid = Number(o.amountPaid) || (st && Number(st.amount)) || 0;
  const due = st && Number(st.codAmount) || 0;
  const detail = `
    <div class="od-detail"><div><div class="od-detail-in">
      <div>${rows}</div>
      <div>
        <dl class="od-dl">
          <div><dt>Order ID</dt><dd>${e_(o.orderId)}</dd></div>
          ${dateStr ? `<div><dt>Placed on</dt><dd>${e_(dateStr)}</dd></div>` : ""}
          <div><dt>Payment</dt><dd>${isCod ? "Cash on delivery" : "Paid online"}</dd></div>
          ${paid ? `<div><dt>${isCod ? "Advance paid" : "Paid"}</dt><dd>${money_(paid)}</dd></div>` : ""}
          ${isCod && due ? `<div class="due"><dt>Pay on delivery</dt><dd>${money_(due)}</dd></div>` : ""}
          <div class="tot"><dt>Order total</dt><dd>${money_(totalOf_(o))}</dd></div>
          ${st && st.awb ? `<div><dt>${e_(st.courierServiceName || "Delhivery")} AWB</dt><dd>${e_(st.awb)}</dd></div>` : ""}
          ${st && st.address ? `<div><dt>Deliver to</dt><dd style="font-family:var(--sans);word-break:normal;">${e_(st.address)}</dd></div>` : ""}
        </dl>
        <a class="od-help" href="${wa}" target="_blank" rel="noopener">Need help with this order →</a>
      </div>
    </div></div></div>`;

  return `
    <article class="od-card ${open ? "open" : ""}" data-order-id="${e_(o.orderId)}" style="--n:${Math.min(n, 8)}">
      <div class="od-card-main">
        ${stackHtml_(o)}
        <div>
          <div><span class="od-id">${e_(o.orderId)}</span><span class="od-date">${e_(dateStr)}</span></div>
          <div class="od-line">${badge}${edd}${can}</div>
          <div class="od-items">${e_(itemsText)}</div>
          ${mini}
        </div>
        <div class="od-right">
          <div class="od-total">${money_(totalOf_(o))}</div>
          <span class="od-pay ${isCod ? "cod" : "paid"}">${isCod ? "COD" : "Paid"}</span>
          <div class="od-actions">
            <a class="od-btn" href="track.html?order=${encodeURIComponent(o.orderId)}">Track ${OD_ARROW}</a>
            <button type="button" class="od-btn ghost" data-act="reorder">Reorder</button>
          </div>
        </div>
      </div>
      <button type="button" class="od-more" data-act="toggle" aria-expanded="${open}"><span>${open ? "Hide details" : "View details · " + items.length + " item" + (items.length > 1 ? "s" : "")}</span>${OD_CHEV}</button>
      ${detail}
    </article>`;
}

/* ---------- render ---------- */
function counts_(){
  const c = { all: allOrdersCache.length, active: 0, delivered: 0, cancelled: 0 };
  allOrdersCache.forEach(o => {
    const k = sKey_(o);
    if (k === "delivered") c.delivered++; else if (k === "cancelled") c.cancelled++; else c.active++;
  });
  return c;
}
function countUp_(el, to, isMoney){
  const start = performance.now(), dur = 1100;
  const fmt = v => isMoney ? money_(Math.round(v)) : String(Math.round(v));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  (function step(t){
    const p = Math.min((t - start) / dur, 1), eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(to * eased);
    if (p < 1) requestAnimationFrame(step);
  })(start);
}
function renderStats_(){
  const c = counts_();
  const spent = allOrdersCache.filter(o => sKey_(o) !== "cancelled").reduce((a, o) => a + totalOf_(o), 0);
  const vals = { total: c.all, live: c.active, done: c.delivered, spent };
  document.querySelectorAll("[data-stat]").forEach(el => {
    const key = el.dataset.stat;
    const v = vals[key] || 0;
    if (el.dataset.last === String(v)) return;
    el.dataset.last = String(v);
    countUp_(el, v, key === "spent");
  });
  document.querySelectorAll(".od-tab").forEach(t => {
    const em = t.querySelector("em"); if (em) em.textContent = c[t.dataset.filter] || 0;
  });
}
function monthLabel_(o){
  const d = orderDate_(o);
  return d ? d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "Earlier";
}
function render_(){
  renderStats_();
  const spotEl = document.getElementById("odSpot");
  const listEl = document.getElementById("ordersList");
  spotEl.innerHTML = (currentFilter === "all" || currentFilter === "active") && !document.getElementById("orderSearchInput").value ? spotlightHtml_() : "";

  const q = (document.getElementById("orderSearchInput").value || "").trim().toLowerCase();
  let list = allOrdersCache.filter(o => {
    const k = sKey_(o);
    if (currentFilter === "delivered" && k !== "delivered") return false;
    if (currentFilter === "cancelled" && k !== "cancelled") return false;
    if (currentFilter === "active" && (k === "delivered" || k === "cancelled")) return false;
    if (q) {
      const txt = (o.items || []).map(i => i.name).join(" ").toLowerCase();
      if (!String(o.orderId).toLowerCase().includes(q) && !txt.includes(q)) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    const da = orderDate_(a), db = orderDate_(b);
    if (currentSort === "amount") return totalOf_(b) - totalOf_(a);
    return currentSort === "old" ? (da - db) : (db - da);
  });

  if (!list.length) {
    listEl.innerHTML = `
      <div class="od-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>
        <h3>${allOrdersCache.length ? "Nothing here" : "No orders yet"}</h3>
        <p>${allOrdersCache.length ? "No orders match this filter or search." : "When you place your first order it will show up here, with live tracking."}</p>
        <a class="od-btn" href="shop.html">Start shopping ${OD_ARROW}</a>
      </div>`;
    return;
  }
  let html = "", lastMonth = "", n = 0;
  list.forEach(o => {
    if (currentSort !== "amount") {
      const m = monthLabel_(o);
      if (m !== lastMonth) { html += `<div class="od-month">${e_(m)}</div>`; lastMonth = m; }
    }
    html += cardHtml_(o, n++);
  });
  listEl.innerHTML = html;
}

/* ---------- data ---------- */
async function hydrateStatuses_(orders){
  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes("PASTE-YOUR")) return;
  await Promise.all(orders.slice(0, 12).map(async (o) => {
    try {
      const r = await fetch(url + "?orderId=" + encodeURIComponent(o.orderId));
      const d = await r.json();
      if (d && d.found) statusCache[o.orderId] = d;
    } catch (err) { /* stays "Checking" */ }
  }));
  render_();
}
async function loadAndRender_(){
  const [orders, catalog] = await Promise.all([loadUserOrders(), loadProductCatalog_()]);
  allOrdersCache = orders;
  catalogCache = catalog;
  render_();
  if (orders.length) hydrateStatuses_(orders);
}
function reorder_(orderId){
  const o = allOrdersCache.find(x => x.orderId === orderId);
  if (!o || !o.items) { if (typeof showToast === "function") showToast("Couldn't find items for this order"); return; }
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem("cart")) || []; } catch (err) {}
  o.items.forEach(it => cart.push({ name: it.name, size: it.size || "-", qty: it.qty || 1, price: it.price || 0, sku: it.sku || "", image: resolveItemImage_(it, o) || it.image || "" }));
  localStorage.setItem("cart", JSON.stringify(cart));
  if (typeof showToast === "function") showToast("Added to bag");
  window.location.href = "cart.html";
}

/* ---------- events ---------- */
document.getElementById("odTabs").addEventListener("click", (ev) => {
  const b = ev.target.closest(".od-tab"); if (!b) return;
  document.querySelectorAll(".od-tab").forEach(t => t.classList.remove("active"));
  b.classList.add("active");
  currentFilter = b.dataset.filter;
  render_();
});
document.getElementById("odSort").addEventListener("change", (ev) => { currentSort = ev.target.value; render_(); });
let _deb;
document.getElementById("orderSearchInput").addEventListener("input", () => { clearTimeout(_deb); _deb = setTimeout(render_, 180); });
document.getElementById("ordersList").addEventListener("click", (ev) => {
  const card = ev.target.closest(".od-card"); if (!card) return;
  const act = ev.target.closest("[data-act]");
  if (!act) return;
  const id = card.dataset.orderId;
  if (act.dataset.act === "toggle") {
    const open = card.classList.toggle("open");
    open ? openIds.add(id) : openIds.delete(id);
    act.setAttribute("aria-expanded", open);
    act.querySelector("span").textContent = open ? "Hide details" : "View details · " + ((allOrdersCache.find(o => o.orderId === id) || {}).items || []).length + " items";
  } else if (act.dataset.act === "reorder") reorder_(id);
});
const hero_ = document.getElementById("odHero");
if (hero_) hero_.addEventListener("pointermove", (ev) => {
  const r = hero_.getBoundingClientRect();
  hero_.style.setProperty("--mx", (ev.clientX - r.left) + "px");
  hero_.style.setProperty("--my", (ev.clientY - r.top) + "px");
});

document.addEventListener("DOMContentLoaded", function(){
  if (!authReady()) return;
  firebase.auth().onAuthStateChanged(function(user){
    document.getElementById("ordersLoginPrompt").style.display = user ? "none" : "block";
    document.getElementById("ordersLoggedIn").style.display = user ? "block" : "none";
    document.getElementById("odStats").style.visibility = user ? "visible" : "hidden";
    if (user) loadAndRender_();
  });
});
