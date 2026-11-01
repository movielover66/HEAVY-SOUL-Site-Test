const STATUS_STEPS = ["Confirmed", "Packed", "Shipped", "Out for Delivery", "Delivered"];
const AUTO_REFRESH_MS = 30000;

const form = document.getElementById("trackForm");
const input = document.getElementById("orderIdInput");
const resultBox = document.getElementById("trackResult");

let currentOrderId = null;
let refreshTimer = null;
let cancelCountdownTimer = null;

const urlOrder = new URLSearchParams(window.location.search).get("order");
const autoFillNote = document.getElementById("autoFillNote");
if (urlOrder) {
  input.value = urlOrder;
  if (autoFillNote) autoFillNote.classList.add("show");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = input.value.trim();
  if (!id) return;
  if (autoFillNote) autoFillNote.classList.remove("show");
  lookupOrder(id, true);
});

// copy tracking number
resultBox.addEventListener("click", (e) => {
  const c = e.target.closest(".trk-copy");
  if (!c) return;
  try { navigator.clipboard.writeText(c.dataset.copy || ""); } catch (err) {}
  if (typeof showToast === "function") showToast("Tracking number copied");
  c.textContent = "Copied";
  setTimeout(() => { c.textContent = "Copy"; }, 1500);
});

// Event delegation — resultBox.innerHTML gets replaced on every render/refresh,
// so we attach one listener here instead of re-binding a button listener each time.
resultBox.addEventListener("click", (e) => {
  const cancelBtn = e.target.closest(".cancel-order-btn");
  if (cancelBtn) { handleCancelClick(cancelBtn); return; }

  const moreBtn = e.target.closest(".show-more-history-btn");
  if (moreBtn) {
    const timeline = moreBtn.closest(".checkpoint-timeline");
    const extra = timeline && timeline.querySelector(".checkpoint-extra");
    if (!extra) return;
    const expanded = timeline.classList.toggle("expanded");
    moreBtn.textContent = expanded
      ? "Show less"
      : "Show " + extra.querySelectorAll(".checkpoint-item").length + " more";
  }
});

async function lookupOrder(orderId, showLoading){
  if (showLoading) {
    resultBox.innerHTML = `
      <div class="trk-sk">
        <div><div class="sk-line sk-w40"></div><div class="sk-line sk-h60"></div><div class="sk-line sk-w80"></div><div class="sk-line sk-w60"></div></div>
        <div><div class="sk-line sk-w60"></div><div class="sk-line sk-h120"></div><div class="sk-line sk-w40"></div></div>
      </div>`;
  }

  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes("PASTE-YOUR")) {
    resultBox.innerHTML = `<p class="trk-err">Live tracking isn't connected yet. Please message us on WhatsApp with your Order ID and we'll update you directly.</p>`;
    return;
  }

  try {
    const res = await fetch(`${url}?orderId=${encodeURIComponent(orderId)}`);
    const data = await res.json();
    if (!data.found) {
      stopAutoRefresh();
      stopCancelCountdown();
      resultBox.innerHTML = `<p class="trk-err">No order found with ID "${escapeHtml(orderId)}". Please double-check, or contact us on WhatsApp.</p>`;
      return;
    }
    currentOrderId = orderId;
    renderStatus(data);
    startAutoRefresh(orderId);
  } catch (err) {
    if (showLoading) {
      resultBox.innerHTML = `<p class="trk-err">Couldn't fetch tracking info right now. Please try again shortly, or contact us on WhatsApp.</p>`;
    }
  }
}

function startAutoRefresh(orderId){
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    lookupOrder(orderId, false);
  }, AUTO_REFRESH_MS);
}

function stopAutoRefresh(){
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/* =========================================================
   24HR SELF-SERVICE CANCEL
   ========================================================= */

function stopCancelCountdown(){
  if (cancelCountdownTimer) {
    clearInterval(cancelCountdownTimer);
    cancelCountdownTimer = null;
  }
}

function buildCancelSectionHtml(data){
  if (String(data.status || "").toLowerCase() === "cancelled") {
    return `
      <div class="hint">
        This order has been cancelled.
      </div>
    `;
  }

  if (!data.cancelEligible) {
    return data.cancelIneligibleReason ? `
      <div class="hint">
        ${escapeHtml(data.cancelIneligibleReason)}
      </div>
    ` : "";
  }

  return `
    <div class="cancel-card">
      <h2 style="font-size:19px;margin-bottom:6px;">Changed your mind?</h2><p class="hint" style="margin-bottom:14px;">You can cancel yourself while the window is open.</p><button type="button" class="btn outline block cancel-order-btn">Cancel order</button>
      <p class="hint cancel-countdown" style="margin-top:10px;"></p>
    </div>
  `;
}

function startCancelCountdown(deadlineIso){
  stopCancelCountdown();
  const countdownEl = resultBox.querySelector(".cancel-countdown");
  if (!countdownEl || !deadlineIso) return;

  const deadline = new Date(deadlineIso).getTime();

  const tick = () => {
    const msLeft = deadline - Date.now();
    if (msLeft <= 0) {
      countdownEl.textContent = "Cancellation window has closed.";
      const btn = resultBox.querySelector(".cancel-order-btn");
      if (btn) btn.remove();
      stopCancelCountdown();
      return;
    }
    const hrs = Math.floor(msLeft / 3600000);
    const mins = Math.floor((msLeft % 3600000) / 60000);
    countdownEl.textContent = `Cancellable for ${hrs}h ${mins}m more`;
  };

  tick();
  cancelCountdownTimer = setInterval(tick, 60000);
}

async function handleCancelClick(btn){
  if (!currentOrderId) return;
  if (!confirm("Cancel this order? This cannot be undone.")) return;

  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  btn.disabled = true;
  btn.textContent = "Cancelling...";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight on Apps Script
      body: JSON.stringify({
        type: "cancel_order",
        orderId: currentOrderId,
        apiToken: SITE_CONFIG.API_TOKEN || ""
      })
    });

    const data = await res.json();

    if (data.success) {
      stopCancelCountdown();
      alert(data.message || "Your order has been cancelled.");
      lookupOrder(currentOrderId, true);
    } else {
      alert(data.error || "Could not cancel this order. Please try again or contact us on WhatsApp.");
      btn.disabled = false;
      btn.textContent = "Cancel order";
    }
  } catch (err) {
    alert("Something went wrong. Please try again or contact us on WhatsApp.");
    btn.disabled = false;
    btn.textContent = "Cancel order";
  }
}

const CHECKPOINT_ICONS = {
  pickup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h13l3 4v6h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 7v7h4"/></svg>`,
  facility: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21V9l9-5 9 5v12"/><path d="M9 21v-6h6v6"/></svg>`,
  transit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h13l3 4v6h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
  outfordelivery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h11M13 6l6 6-6 6"/></svg>`,
  delivered: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6 9 17l-5-5"/></svg>`,
  default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/></svg>`
};

function iconForStatus(statusText){
  const s = String(statusText || "").toLowerCase();
  if (s.includes("delivered")) return CHECKPOINT_ICONS.delivered;
  if (s.includes("out for delivery")) return CHECKPOINT_ICONS.outfordelivery;
  if (s.includes("pickup") || s.includes("picked up")) return CHECKPOINT_ICONS.pickup;
  if (s.includes("facility") || s.includes("center") || s.includes("centre") || s.includes("warehouse")) return CHECKPOINT_ICONS.facility;
  if (s.includes("trip") || s.includes("transit") || s.includes("bag") || s.includes("arrived") || s.includes("departed")) return CHECKPOINT_ICONS.transit;
  return CHECKPOINT_ICONS.default;
}

const STEP_LABELS = ["Order Placed", "Packed", "Shipped", "Out for Delivery", "Delivered"];
const STATUS_COPY = {
  "Confirmed":        ["Order Confirmed", "We've received your order and are getting it ready."],
  "Packed":           ["Packed", "Your order is packed and waiting for courier pickup."],
  "Shipped":          ["Shipped", "Your order is on its way to you."],
  "Out for Delivery": ["Out for Delivery", "Your order is out for delivery and will reach you soon. Please keep an eye on your phone."],
  "Delivered":        ["Delivered", "Your order has been delivered. Thank you for choosing Heavy Soul!"],
  "Cancelled":        ["Cancelled", "This order has been cancelled."]
};


/* ---------- extras: recent orders, countdown, calendar, share, confetti ---------- */
const RECENT_KEY = "hs_recent_tracked";
function getRecent_(){ try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 4); } catch (e) { return []; } }
function saveRecent_(id){
  try {
    const list = [id, ...getRecent_().filter(x => x !== id)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (e) {}
  renderRecent_();
}
function renderRecent_(){
  const box = document.getElementById("trkRecent");
  if (!box) return;
  const list = getRecent_();
  box.innerHTML = list.length ? `<span>Recent</span>` + list.map(id => `<button type="button" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join("") : "";
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("#trkRecent button");
  if (!b) return;
  input.value = b.dataset.id;
  lookupOrder(b.dataset.id, true);
});
renderRecent_();

function daysLeft_(raw){
  const d = new Date(raw); if (isNaN(d)) return null;
  const t = new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0);
  return Math.round((d - t) / 86400000);
}
function daysLeftText_(raw){
  const n = daysLeft_(raw);
  if (n === null) return "";
  if (n < 0) return "Arriving any moment now";
  if (n === 0) return "Arriving today";
  if (n === 1) return "Arriving tomorrow";
  return "Arrives in " + n + " days";
}
function downloadIcs_(orderId, raw){
  const d = new Date(raw); if (isNaN(d)) return;
  const p = n => String(n).padStart(2, "0");
  const day = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  const next = new Date(d.getTime() + 86400000);
  const day2 = next.getFullYear() + p(next.getMonth() + 1) + p(next.getDate());
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Heavy Soul//Track//EN","BEGIN:VEVENT",
    "UID:" + orderId + "@heavysoul.in","DTSTAMP:" + day + "T000000Z","DTSTART;VALUE=DATE:" + day,"DTEND;VALUE=DATE:" + day2,
    "SUMMARY:Heavy Soul order arrives (" + orderId + ")","DESCRIPTION:Track: https://heavysoul.in/track.html?order=" + encodeURIComponent(orderId),
    "END:VEVENT","END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "heavy-soul-delivery.ics";
  document.body.appendChild(a); a.click(); a.remove();
}
function confetti_(host){
  const colors = ["#C42B38", "#E0505A", "#EFE8DA", "#8F8576", "#E3C16F"];
  const wrap = document.createElement("div");
  wrap.className = "trk-confetti";
  for (let i = 0; i < 46; i++) {
    const c = document.createElement("i");
    c.style.cssText = `left:${Math.random()*100}%;background:${colors[i%colors.length]};animation-delay:${Math.random()*0.5}s;animation-duration:${1.8+Math.random()*1.4}s;--dx:${(Math.random()*160-80).toFixed(0)}px;--r:${(Math.random()*720-360).toFixed(0)}deg;`;
    wrap.appendChild(c);
  }
  host.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3600);
}
resultBox.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "share") {
    const url = location.origin + location.pathname + "?order=" + encodeURIComponent(currentOrderId || "");
    if (navigator.share) { navigator.share({ title: "My Heavy Soul order", url }).catch(() => {}); }
    else { try { navigator.clipboard.writeText(url); } catch (e) {} if (typeof showToast === "function") showToast("Tracking link copied"); }
  } else if (act === "cal") {
    downloadIcs_(currentOrderId || "", t.dataset.date);
  }
});


/* ---------- learnings from big-brand tracking pages ---------- */
const NEXT_STEP = {
  "Confirmed":        "Next: we pack your order, usually within 24 hours.",
  "Packed":           "Next: the courier picks it up from our warehouse.",
  "Shipped":          "Next: it moves through courier hubs towards your city.",
  "Out for Delivery": "Next: the rider reaches you today. Keep your phone switched on.",
  "Delivered":        "Hope you love it. Wash inside-out in cold water to keep the print fresh."
};

function noticeHtml_(data, isDelivered, isCancelled){
  if (isDelivered || isCancelled) return "";
  const e = escapeHtml;
  const wa = "https://wa.me/" + (SITE_CONFIG.WHATSAPP_NUMBER || "919339909978");
  let out = "";
  const late = data.estimatedDelivery ? daysLeft_(data.estimatedDelivery) : null;
  if (late !== null && late < 0) {
    out += `<div class="trk-notice warn"><b>Running a little late</b><span>Your parcel has passed its estimated date. The courier is still moving it. If there is no update soon, message us and we will chase it.</span><a href="${wa}" target="_blank" rel="noopener">Message us →</a></div>`;
  }
  const isCod = String(data.paymentType || "").toLowerCase() === "cod";
  if (String(data.status || "").toLowerCase() === "out for delivery" && isCod && Number(data.codAmount) > 0) {
    out += `<div class="trk-notice cod"><b>Keep ${e(money_(data.codAmount))} ready</b><span>This is a cash on delivery order. Please pay the rider the balance amount when your parcel arrives.</span></div>`;
  }
  return out;
}

function nextStepHtml_(status){
  const t = NEXT_STEP[status];
  return t ? `<p class="trk-next"><span></span>${escapeHtml(t)}</p>` : "";
}

function reviewCardHtml_(data){
  const wa = "https://wa.me/" + (SITE_CONFIG.WHATSAPP_NUMBER || "919339909978");
  const stars = [1,2,3,4,5].map(n => `<a class="trk-star" style="--i:${n}" target="_blank" rel="noopener" href="${wa}?text=${encodeURIComponent("Hi Heavy Soul! My order " + data.orderId + " rating: " + n + "/5. ")}" aria-label="${n} star">★</a>`).join("");
  return `
    <section class="trk-card trk-rate">
      <h2>How was it?</h2>
      <p class="hint">Tap a star to tell us. It opens WhatsApp with your rating filled in.</p>
      <div class="trk-stars">${stars}</div>
    </section>`;
}

function recoHtml_(data){
  try {
    if (typeof PRODUCTS === "undefined" || !PRODUCTS.length) return "";
    const have = new Set((data.items || []).map(i => String(i.name || "").trim().toLowerCase()));
    const list = PRODUCTS.filter(p => !have.has(String(p.name || "").trim().toLowerCase()) && (p.image || (p.images && p.images[0]))).slice(0, 4);
    if (!list.length) return "";
    const e = escapeHtml;
    return `
      <section class="trk-reco">
        <div class="trk-card-h"><h2>You may also like</h2><a href="shop.html" class="trk-again">Shop all →</a></div>
        <div class="trk-reco-grid">
          ${list.map((p, i) => `
            <a class="trk-reco-item" style="--i:${i}" href="product.html?id=${e(p.id)}">
              <span class="trk-reco-img"><img src="${e(p.image || p.images[0])}" alt="${e(p.name)}" loading="lazy" onerror="this.style.display='none'"></span>
              <b>${e(p.name)}</b>
              <span>${money_(p.price)}${p.compareAt ? ` <s>${money_(p.compareAt)}</s>` : ""}</span>
            </a>`).join("")}
        </div>
      </section>`;
  } catch (err) { return ""; }
}

const ICON_STEP = [
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h13l3 4v6h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 7v7h4"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h11M13 6l6 6-6 6"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6 9 17l-5-5"/></svg>`
];
const ICON_BOX = ICON_STEP[4];
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg>`;

function money_(n){ return "₹" + (Number(n) || 0).toLocaleString("en-IN"); }

// Thumbnail source: the image saved with the order, else the live catalog
// (matched by SKU/id or by name), else null -> lettered placeholder tile.
function itemMeta_(it){
  let prod = null;
  try {
    if (typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS)) {
      const nm = String(it.name || "").trim().toLowerCase();
      prod = PRODUCTS.find(p => it.sku && String(p.id) === String(it.sku)) ||
             PRODUCTS.find(p => String(p.name || "").trim().toLowerCase() === nm) || null;
    }
  } catch (e) { /* catalog unavailable */ }
  return { id: prod ? prod.id : "", image: it.image || (prod && (prod.image || (prod.images && prod.images[0]))) || "", category: (prod && prod.category) || "" };
}

function renderItemsCard_(data){
  const e = escapeHtml;
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return "";
  const totalQty = items.reduce((a, it) => a + (Number(it.qty) || 1), 0);
  const subtotal = items.reduce((a, it) => a + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);

  const rows = items.map(it => {
    const m = itemMeta_(it);
    const qty = Number(it.qty) || 1, price = Number(it.price) || 0;
    const thumb = m.image
      ? `<img src="${e(m.image)}" alt="${e(it.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph&quot;>${e(String(it.name || "H").charAt(0).toUpperCase())}</div>'">`
      : `<div class="ph">${e(String(it.name || "H").charAt(0).toUpperCase())}</div>`;
    const hasSize = it.size && it.size !== "-";
    return `
      <div class="trk-line-item">
        <div class="trk-thumb">${thumb}<span class="trk-qty">×${qty}</span></div>
        <div class="trk-it">
          ${m.category ? `<span class="cat">${e(m.category)}</span>` : ""}
          <h3>${e(it.name)}</h3>
          <div class="trk-chips">
            ${hasSize ? `<span><b>Size</b>${e(it.size)}</span>` : ""}
            <span><b>Qty</b>${qty}</span>
            ${it.sku ? `<span><b>SKU</b>${e(it.sku)}</span>` : ""}
          </div>
          <span class="unit">${money_(price)} each${m.id ? ` · <a class="trk-again" href="product.html?id=${e(m.id)}">Buy again</a>` : ""}</span>
        </div>
        <div class="trk-total">${money_(price * qty)}</div>
      </div>`;
  }).join("");

  const isCod = String(data.paymentType || "").toLowerCase() === "cod";
  const grand = Number(data.grandTotal) || 0;
  const paidNow = Number(data.amount) || 0;
  const codDue = Number(data.codAmount) || 0;
  const handling = grand > subtotal ? grand - subtotal : 0;
  const total = grand || subtotal;

  const sum = `
    <div class="trk-sum">
      <div><span>Subtotal (${totalQty} item${totalQty > 1 ? "s" : ""})</span><span>${money_(subtotal)}</span></div>
      ${handling ? `<div><span>COD handling</span><span>${money_(handling)}</span></div>` : ""}
      <div><span>Shipping</span><span>Free</span></div>
      <div class="grand"><span>Order total</span><span>${money_(total)}</span></div>
      ${isCod && paidNow ? `<div><span>Paid online (advance)</span><span>${money_(paidNow)}</span></div>` : ""}
      ${isCod && codDue ? `<div class="due"><span>Pay on delivery</span><span>${money_(codDue)}</span></div>` : ""}
      ${!isCod && paidNow ? `<div><span>Paid online</span><span>${money_(paidNow)}</span></div>` : ""}
    </div>`;

  return `
    <section class="trk-card">
      <div class="trk-card-h"><h2>Your items</h2><span>${totalQty} piece${totalQty > 1 ? "s" : ""}</span></div>
      ${rows}${sum}
    </section>`;
}

function renderStatus(data){
  const status = String(data.status || "");
  const currentIndex = STATUS_STEPS.findIndex(s => s.toLowerCase() === status.toLowerCase());
  const isDelivered = currentIndex === STATUS_STEPS.length - 1;
  const isCancelled = status.toLowerCase() === "cancelled";
  const isOutForDelivery = STATUS_STEPS[currentIndex] === "Out for Delivery";
  const progress = currentIndex >= 0 ? currentIndex / (STATUS_STEPS.length - 1) : 0;
  const copy = STATUS_COPY[status] || [status || "Processing", ""];
  // data.history is oldest-first from the backend; the latest scan is the LAST element.
  const latest = (data.history && data.history.length > 0) ? data.history[data.history.length - 1] : null;
  const e = escapeHtml;
  const firstRender = !resultBox.querySelector(".trk");

  const stepsHtml = STATUS_STEPS.map((step, i) => {
    const done = currentIndex >= 0 && i <= currentIndex;
    const isCurrent = i === currentIndex && !isDelivered;
    const stamp = (i === currentIndex && latest && latest.time) ? `<small>${e(latest.time)}</small>` : (i === 0 && data.orderDate ? `<small>${e(formatEddDate(data.orderDate))}</small>` : "");
    return `
      <div class="trk-col">
        <span class="trk-dot ${done ? "done" : ""} ${isCurrent ? "now" : ""}">${done && !isCurrent ? ICON_CHECK : ICON_STEP[i]}</span>
        <span class="trk-lab ${done ? "done" : ""}">${STEP_LABELS[i]}${stamp}</span>
      </div>`;
  }).join("");

  const eddHtml = (data.estimatedDelivery && !isDelivered && !isCancelled) ? `
    <div class="trk-edd"><small>${data.eddIsEstimate ? "Estimated delivery (approx.)" : "Estimated delivery"}</small><b>${e(formatEddDate(data.estimatedDelivery))}</b><span class="trk-countdown">${e(daysLeftText_(data.estimatedDelivery))}</span>${data.eddIsEstimate ? "<i>Updates once the courier confirms</i>" : ""}</div>` : "";

  const statusCard = `
    <section class="trk-status">
      <div class="trk-status-top">
        <div>
          <span class="trk-pill">${isCancelled || isDelivered ? "" : '<span class="trk-live"></span>'}Order #${e(data.orderId)}</span>
          <h2 class="trk-title">${e(copy[0])}</h2>
          <p class="trk-sub">${e(copy[1])}</p>
          ${isCancelled ? "" : nextStepHtml_(STATUS_STEPS[currentIndex])}
        </div>
        ${eddHtml}
      </div>
      ${isCancelled ? `<div class="trk-cancelled">This order has been cancelled. If you paid online, your refund status is shown below.</div><div class="rf-mount" data-order="${e(data.orderId)}"></div>` : `
      <div class="trk-steps" style="--p:${progress}">
        <div class="trk-line"><i></i><span class="trk-truck">${isDelivered ? ICON_BOX : ICON_STEP[2]}</span></div>
        <div class="trk-cols">${stepsHtml}</div>
      </div>`}
    </section>`;

  const awbHtml = data.awb ? `
    <div class="trk-kv-row">
      <div><small>${e(data.courierServiceName || "Delhivery")} · Tracking number</small><b>${e(data.awb)}</b><button type="button" class="trk-copy" data-copy="${e(data.awb)}">Copy</button></div>
      ${data.trackingLink ? `<a href="${e(data.trackingLink)}" target="_blank" rel="noopener" class="btn outline trk-btn-sm">Courier site →</a>` : ""}
    </div>` : "";

  const locHtml = (latest && !isCancelled) ? `
    <div class="trk-kv-row"><div><small>Last known location</small><b class="loc">${e(latest.location || "In transit")}</b>
      <div class="rider-sub">${e(latest.status)}${latest.time ? " · " + e(latest.time) : ""}</div></div></div>` : "";

  const breadcrumbCurrentLabel = (latest && latest.location && !isDelivered) ? cleanLocationName_(latest.location) : null;
  const routeMapHtml = (!isCancelled && currentIndex >= 0) ? `
    <div class="route-breadcrumb">
      <span>Warehouse</span>
      ${breadcrumbCurrentLabel ? `<span class="rb-arrow">→</span><span>${e(breadcrumbCurrentLabel)}</span>` : ""}
      <span class="rb-arrow">→</span>
      <span>${isDelivered ? "Delivered" : "Your address"}</span>
    </div>
    <div id="trackRouteMap" class="route-map-leaflet"></div>` : "";

  const hasRiderInfo = data.riderName || data.riderPhone;
  const courierHtml = (hasRiderInfo && !isDelivered) ? `
    <div class="rider-card">
      <div class="rider-info">
        ${data.courierServiceName ? `<div class="rider-service">${e(data.courierServiceName)}</div>` : ""}
        <div class="rider-name">${e(data.riderName || "Delivery partner")}</div>
      </div>
      ${data.riderPhone ? `<a href="tel:${e(data.riderPhone)}" class="rider-call">Call rider</a>` : ""}
    </div>` : (isOutForDelivery ? `
    <div class="rider-card"><div class="rider-info"><div class="rider-name">Your parcel is out for delivery</div>
      <div class="rider-sub">Rider contact isn't shared by the courier for this shipment</div></div></div>` : "");

  const HISTORY_PREVIEW_COUNT = 5;
  const historyNewestFirst = (data.history || []).slice().reverse();
  const renderCheckpoint_ = (entry, i) => `
    <div class="checkpoint-item ${i === 0 ? "latest" : ""}" style="animation-delay:${Math.min(i, 8) * 60}ms;">
      <span class="checkpoint-icon ${i === 0 ? "latest" : ""}">${iconForStatus(entry.status)}</span>
      <div class="checkpoint-content">
        <div class="checkpoint-status">${e(entry.status)}</div>
        <div class="checkpoint-meta">
          ${entry.location ? `<span>${e(entry.location)}</span>` : ""}
          ${entry.time ? `<span>${e(entry.time)}</span>` : ""}
        </div>
      </div>
    </div>`;
  const historyHtml = (historyNewestFirst.length > 0) ? `
    <div class="checkpoint-timeline">
      <p class="eyebrow">Shipment activity</p>
      ${historyNewestFirst.slice(0, HISTORY_PREVIEW_COUNT).map((en, i) => renderCheckpoint_(en, i)).join("")}
      ${historyNewestFirst.length > HISTORY_PREVIEW_COUNT ? `
        <div class="checkpoint-extra">
          ${historyNewestFirst.slice(HISTORY_PREVIEW_COUNT).map((en, i) => renderCheckpoint_(en, i + HISTORY_PREVIEW_COUNT)).join("")}
        </div>
        <button type="button" class="show-more-history-btn">Show ${historyNewestFirst.length - HISTORY_PREVIEW_COUNT} more</button>
      ` : ""}
    </div>` : "";

  const shipmentCard = (awbHtml || locHtml || courierHtml || routeMapHtml || historyHtml) ? `
    <section class="trk-card">
      <div class="trk-card-h"><h2>Shipment</h2><span>${isCancelled ? "Cancelled" : "Live"}</span></div>
      ${awbHtml}${locHtml}${courierHtml}${routeMapHtml}${historyHtml}
      ${isCancelled ? "" : `<p class="trk-live-note"><span class="trk-live"></span> Live status — refreshes automatically</p>`}
    </section>` : `
    <section class="trk-card"><div class="trk-card-h"><h2>Shipment</h2></div>
      <p class="hint">Your parcel hasn't been handed to the courier yet. Tracking details appear here as soon as it ships.</p></section>`;

  const isCod = String(data.paymentType || "").toLowerCase() === "cod";
  const payTag = isCod ? `<span class="trk-tag cod">Cash on delivery</span>` : `<span class="trk-tag paid">Paid online</span>`;
  const wa = "https://wa.me/" + (SITE_CONFIG.WHATSAPP_NUMBER || "919339909978");

  const detailsCard = `
    <section class="trk-card">
      <h2>Order details</h2>
      <dl class="trk-dl">
        <div><dt>Order ID</dt><dd class="mono">${e(data.orderId)}</dd></div>
        ${data.orderDate ? `<div><dt>Placed on</dt><dd>${e(formatEddDate(data.orderDate))}</dd></div>` : ""}
        ${data.customerName ? `<div><dt>Name</dt><dd>${e(data.customerName)}</dd></div>` : ""}
        ${data.address ? `<div><dt>Delivering to</dt><dd>${e(data.address)}</dd></div>` : ""}
        <div><dt>Payment</dt><dd>${payTag}</dd></div>
      </dl>
    </section>`;

  const cancelHtml = buildCancelSectionHtml(data);
  const cancelCard = cancelHtml ? `<section class="trk-card">${cancelHtml}</section>` : "";

  resultBox.innerHTML = `
    <div class="trk ${firstRender ? "anim" : ""}">
      ${statusCard}
      ${noticeHtml_(data, isDelivered, isCancelled)}
      <div class="trk-grid">
        <div class="trk-main">
          ${renderItemsCard_(data)}
          ${shipmentCard}
        </div>
        <aside class="trk-side">
          ${detailsCard}
          <div class="trk-actions">
            <button type="button" class="btn outline trk-btn-sm" data-act="share">Share tracking link</button>
            ${(data.estimatedDelivery && !isDelivered && !isCancelled) ? `<button type="button" class="btn outline trk-btn-sm" data-act="cal" data-date="${e(data.estimatedDelivery)}">Add to calendar</button>` : ""}
          </div>
          <a class="trk-help-card" href="${wa}" target="_blank" rel="noopener"><b>Need help?</b><span>Chat with us on WhatsApp →</span></a>
          ${isDelivered ? reviewCardHtml_(data) : ""}
          ${cancelCard}
          <div class="trk-links"><a href="support.html?order=${encodeURIComponent(String(data.orderId))}">Raise a support ticket</a><a href="policy.html">Shipping &amp; returns</a><a href="orders.html">All my orders</a></div>
        </aside>
      </div>
      ${recoHtml_(data)}
    </div>`;

  if (data.cancelEligible && data.cancelDeadline) {
    startCancelCountdown(data.cancelDeadline);
  } else {
    stopCancelCountdown();
  }

  if (isCancelled && window.HSRefund) {
    const rfEl = resultBox.querySelector(".rf-mount");
    if (rfEl) HSRefund.mount(rfEl, String(data.orderId));
  }

  saveRecent_(String(data.orderId));
  if (isDelivered && firstRender) confetti_(resultBox.querySelector(".trk-status"));
  initRouteMap_(data, latest, isDelivered, isCancelled);
}

/* =========================================================
   CHECKPOINT MAP (Leaflet + free OpenStreetMap/Nominatim)
   Not live GPS — Delhivery only exposes hub/city-level scan
   checkpoints, not a continuous moving position. Each scan's
   location name is geocoded (via our own /api/geocode proxy,
   which calls Nominatim) into a real lat/lon, so the map always
   shows the most recent known checkpoint. It updates whenever a
   new scan comes in on the 30s auto-refresh.
   ========================================================= */

let _routeMap = null;
let _geocodeMemCache = (() => {
  try { return JSON.parse(localStorage.getItem("hs_geocode_cache") || "{}"); }
  catch (e) { return {}; }
})();

function saveGeocodeMemCache_(){
  try { localStorage.setItem("hs_geocode_cache", JSON.stringify(_geocodeMemCache)); }
  catch (e) { /* storage full/unavailable — fine, just skip persisting */ }
}

async function geocode_(query){
  const key = String(query).trim().toLowerCase();
  if (!key) return null;
  if (_geocodeMemCache[key]) return _geocodeMemCache[key];

  try {
    const res = await fetch("/api/geocode?q=" + encodeURIComponent(query));
    const data = await res.json();
    if (!data.success) return null;
    const point = { lat: data.lat, lon: data.lon };
    _geocodeMemCache[key] = point;
    saveGeocodeMemCache_();
    return point;
  } catch (e) {
    return null;
  }
}

// A raw customer-typed address ("house no:6/ thana: anandapur/ pin
// code:758021") rarely geocodes well as freeform text. A 6-digit PIN code
// searched structurally is far more reliable, so we pull one out of the
// address and prefer that; freeform text is only a fallback.
async function geocodePin_(pin){
  const key = "pin:" + pin;
  if (_geocodeMemCache[key]) return _geocodeMemCache[key];

  try {
    const res = await fetch("/api/geocode?pin=" + encodeURIComponent(pin));
    const data = await res.json();
    if (!data.success) return null;
    const point = { lat: data.lat, lon: data.lon };
    _geocodeMemCache[key] = point;
    saveGeocodeMemCache_();
    return point;
  } catch (e) {
    return null;
  }
}

function extractPincode_(address){
  const m = String(address || "").match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}

// Straight-line ("as the crow flies") distance in km — not the real road
// route, just enough to give a rough sense of how far away the shipment is.
function haversineKm_(a, b){
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Delhivery location strings look like "Hooghly_Chinsurah_D (West Bengal)"
// — strip the trailing facility-code segment in parentheses and swap
// underscores for spaces so it geocodes as a normal place name.
function cleanLocationName_(raw){
  if (!raw) return "";
  return String(raw).replace(/_/g, " ").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

async function initRouteMap_(data, latest, isDelivered, isCancelled){
  const el = document.getElementById("trackRouteMap");
  if (!el || isCancelled || typeof L === "undefined") return;

  // Resolve the warehouse pin: try the precise PIN code first, then fall
  // back to the freeform town name if that specific PIN isn't in
  // Nominatim's index (coverage of Indian postal codes is incomplete).
  async function resolveOrigin_(){
    const pin = (window.SITE_CONFIG && SITE_CONFIG.WAREHOUSE_PINCODE) || "";
    if (pin) {
      const p = await geocodePin_(pin);
      if (p) return p;
    }
    const fallbackQuery = (window.SITE_CONFIG && SITE_CONFIG.WAREHOUSE_GEOCODE_QUERY) || "Hooghly, West Bengal, India";
    return geocode_(fallbackQuery);
  }

  // Resolve the delivery address: structured PIN search first (most
  // precise), then that same PIN as plain free text (sometimes indexed
  // differently), then the full raw address as a last resort.
  async function resolveDestination_(){
    const pin = extractPincode_(data.address);
    if (pin) {
      const p1 = await geocodePin_(pin);
      if (p1) return p1;
      const p2 = await geocode_(pin + ", India");
      if (p2) return p2;
    }
    return data.address ? geocode_(data.address + ", India") : null;
  }

  const currentLocRaw = (latest && latest.location) ? cleanLocationName_(latest.location) : null;

  // Trail: every distinct hub the shipment has scanned through so far.
  // data.history is already oldest-first (chronological) from the backend,
  // so no reversal needed — just dedupe and keep the most recent 6 stops
  // (via slice(-6)) to cap the number of geocode calls.
  const chronological = (data.history || []).map(h => cleanLocationName_(h.location)).filter(Boolean);
  const trailLocs = [...new Set(chronological)].slice(-6);

  const [originPt, destPt, currentPt, trailPts] = await Promise.all([
    resolveOrigin_(),
    resolveDestination_(),
    (currentLocRaw && !isDelivered) ? geocode_(currentLocRaw + ", India") : Promise.resolve(null),
    Promise.all(trailLocs.map(loc => geocode_(loc + ", India")))
  ]);

  if (!document.getElementById("trackRouteMap")) return; // page re-rendered again while we were waiting

  if (!originPt && !destPt && !currentPt) {
    el.innerHTML = `<p class="hint" style="padding:16px; font-size:12px; margin:0;">Map unavailable right now.</p>`;
    return;
  }

  if (_routeMap) { _routeMap.remove(); _routeMap = null; }

  _routeMap = L.map(el, { zoomControl: false, attributionControl: true }).setView([22.5, 88.3], 7);
  // Standard OpenStreetMap tiles — free, no API key. Darkened via a CSS
  // filter on the tile pane only (see .route-map-leaflet .leaflet-tile-pane
  // in track.html), so markers/popups stay normal-colored.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(_routeMap);

  const dotIcon = (color, emoji) => L.divIcon({
    className: '',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #FBF9F5;box-shadow:0 0 0 3px ${color}40;font-size:11px;">${emoji || ''}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const bounds = [];
  if (originPt) {
    L.marker([originPt.lat, originPt.lon], { icon: dotIcon('#8F8576', '🏭') })
      .addTo(_routeMap)
      .bindTooltip("Warehouse", { permanent: true, direction: 'top', offset: [0, -13], className: 'origin-label' })
      .bindPopup("Warehouse");
    bounds.push([originPt.lat, originPt.lon]);
  }

  // Red dashed trail: warehouse → every scanned checkpoint so far → current
  // position (or the delivery address, once delivered). Grows stop by stop
  // as new scans come in on refresh — not a real road route, just a
  // straight-line "how far it's travelled" trail connecting the dots.
  const trailPoints = [];
  if (originPt) trailPoints.push([originPt.lat, originPt.lon]);
  trailPts.forEach(p => { if (p) trailPoints.push([p.lat, p.lon]); });
  if (isDelivered && destPt) trailPoints.push([destPt.lat, destPt.lon]);
  else if (currentPt) trailPoints.push([currentPt.lat, currentPt.lon]);

  // Drop consecutive duplicate points (same hub geocoded twice in a row)
  const dedupedTrail = trailPoints.filter((pt, i) => i === 0 ||
    Math.abs(pt[0] - trailPoints[i - 1][0]) > 0.0005 || Math.abs(pt[1] - trailPoints[i - 1][1]) > 0.0005);

  if (dedupedTrail.length > 1) {
    L.polyline(dedupedTrail, { color: '#C42B38', weight: 3, opacity: 0.85, dashArray: '7 7' }).addTo(_routeMap);
    dedupedTrail.forEach(pt => bounds.push(pt));
  }

  // Truck icon marks the courier's last known scan checkpoint — this is
  // NOT a live GPS position, just the most recent hub/city Delhivery
  // reported. It moves to a new spot only when a new scan comes in.
  if (currentPt && !isDelivered) {
    L.marker([currentPt.lat, currentPt.lon], { icon: dotIcon('#C42B38', '🚚') })
      .addTo(_routeMap)
      .bindTooltip("Heavy Soul Parcel", { permanent: true, direction: 'top', offset: [0, -13], className: 'truck-label' })
      .bindPopup("Last known checkpoint");
    bounds.push([currentPt.lat, currentPt.lon]);
  }
  if (destPt) {
    L.marker([destPt.lat, destPt.lon], { icon: dotIcon('#EFE8DA', '📍') })
      .addTo(_routeMap)
      .bindTooltip("Delivery address", { permanent: true, direction: 'top', offset: [0, -13], className: 'dest-label' })
      .bindPopup("Delivery address");
    bounds.push([destPt.lat, destPt.lon]);
  }

  // Grey dotted "remaining" path — current position (or warehouse, if not
  // yet dispatched) straight to the destination, so the red "traveled"
  // trail and the grey "still to go" stretch are visually distinct. Not
  // drawn once delivered, since the red trail already reaches the door.
  if (!isDelivered && destPt) {
    const remainingStart = currentPt || originPt;
    if (remainingStart) {
      L.polyline([[remainingStart.lat, remainingStart.lon], [destPt.lat, destPt.lon]], {
        color: '#8F8576', weight: 2, opacity: 0.7, dashArray: '2 8'
      }).addTo(_routeMap);
    }
  }

  if (bounds.length > 1) {
    _routeMap.fitBounds(bounds, { padding: [28, 28] });
  } else if (bounds.length === 1) {
    _routeMap.setView(bounds[0], 11);
  }

  // "How far" caption — straight-line distance from the last known
  // checkpoint (or the warehouse, if not shipped yet) to the delivery
  // address. Not the real road distance, just a rough sense of scale.
  const fromPt = (currentPt && !isDelivered) ? currentPt : originPt;
  let captionHtml = '';
  if (fromPt && destPt) {
    const km = haversineKm_(fromPt, destPt);
    const label = (currentPt && !isDelivered) ? 'from last known checkpoint' : 'from warehouse';
    captionHtml = `<div class="route-caption">~${km < 10 ? km.toFixed(1) : Math.round(km)} km ${label} to delivery address (straight-line, not road distance)</div>`;
  } else if (!destPt) {
    captionHtml = `<div class="route-caption">Couldn't pin the exact delivery address on the map — showing what we have.</div>`;
  }
  if (captionHtml) {
    const existingCap = el.parentNode.querySelector('.route-caption');
    if (existingCap) existingCap.remove();
    const cap = document.createElement('div');
    cap.innerHTML = captionHtml;
    el.parentNode.insertBefore(cap.firstChild, el.nextSibling);
  }
}


/* ---------- hero life: mouse glow, typing placeholder, scroll reveal ---------- */
(function heroLife_(){
  const hero = document.getElementById("trkHero");
  if (hero) {
    hero.addEventListener("pointermove", (ev) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", (ev.clientX - r.left) + "px");
      hero.style.setProperty("--my", (ev.clientY - r.top) + "px");
    });
  }

  // typing placeholder (only while the field is empty and unfocused)
  const samples = ["HS-20261022-448", "HS-20261025-102", "HS-20261026-377"];
  if (input && !urlOrder && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let si = 0, ci = 0, dir = 1, hold = 0;
    setInterval(() => {
      if (document.activeElement === input || input.value) { input.placeholder = "Enter your Order ID"; return; }
      const word = samples[si];
      if (hold > 0) { hold--; return; }
      ci += dir;
      input.placeholder = "e.g. " + word.slice(0, ci) + (ci % 2 ? "▌" : " ");
      if (ci >= word.length) { dir = -1; hold = 14; }
      if (ci <= 0 && dir === -1) { dir = 1; si = (si + 1) % samples.length; }
    }, 90);
  }

  // busy state on the Track button
  const btn = document.getElementById("trackBtn");
  if (btn) form.addEventListener("submit", () => {
    btn.classList.add("is-busy");
    setTimeout(() => btn.classList.remove("is-busy"), 1400);
  });

  // reveal on scroll
  const targets = document.querySelectorAll(".trk-empty > div, .trk-trust > div");
  targets.forEach((t, i) => { t.classList.add("rv"); t.style.setProperty("--d", i % 4); });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.15 });
    targets.forEach(t => io.observe(t));
  } else targets.forEach(t => t.classList.add("in"));
})();
