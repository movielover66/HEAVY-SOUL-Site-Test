const STATUS_STEPS = ["Confirmed", "Packed", "Shipped", "Out for Delivery", "Delivered"];
const AUTO_REFRESH_MS = 30000;

const form = document.getElementById("trackForm");
const input = document.getElementById("orderIdInput");
const resultBox = document.getElementById("trackResult");

let currentOrderId = null;
let refreshTimer = null;

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

async function lookupOrder(orderId, showLoading){
  if (showLoading) {
    resultBox.innerHTML = `
      <div class="track-skeleton">
        <div class="sk-line sk-w60"></div>
        <div class="sk-steps">
          <div class="sk-dot"></div><div class="sk-dot"></div><div class="sk-dot"></div><div class="sk-dot"></div><div class="sk-dot"></div>
        </div>
        <div class="sk-line sk-w40"></div>
        <div class="sk-line sk-w80"></div>
      </div>
    `;
  }

  const url = SITE_CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes("PASTE-YOUR")) {
    resultBox.innerHTML = `<p class="hint pin-error">Live tracking isn't connected yet. Please message us on WhatsApp with your Order ID and we'll update you directly.</p>`;
    return;
  }

  try {
    const res = await fetch(`${url}?orderId=${encodeURIComponent(orderId)}`);
    const data = await res.json();
    if (!data.found) {
      stopAutoRefresh();
      resultBox.innerHTML = `<p class="hint pin-error">No order found with ID "${escapeHtml(orderId)}". Please double-check, or contact us on WhatsApp.</p>`;
      return;
    }
    currentOrderId = orderId;
    renderStatus(data);
    startAutoRefresh(orderId);
  } catch (err) {
    if (showLoading) {
      resultBox.innerHTML = `<p class="hint pin-error">Couldn't fetch tracking info right now. Please try again shortly, or contact us on WhatsApp.</p>`;
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

function renderStatus(data){
  const currentIndex = STATUS_STEPS.findIndex(s => s.toLowerCase() === String(data.status || "").toLowerCase());
  const isDelivered = currentIndex === STATUS_STEPS.length - 1;
  const isOutForDelivery = STATUS_STEPS[currentIndex] === "Out for Delivery";
  const progressPct = currentIndex >= 0 ? (currentIndex / (STATUS_STEPS.length - 1)) * 100 : 0;

  const stepsHtml = STATUS_STEPS.map((step, i) => {
    const done = currentIndex >= 0 && i <= currentIndex;
    const isCurrent = i === currentIndex && !isDelivered;
    return `
      <div class="step-col">
        <span class="step-dot ${done ? "done" : ""} ${isCurrent ? "pulse" : ""}">
          ${done && !isCurrent ? `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>` : ""}
        </span>
        <span class="step-label ${done ? "done" : ""}">${step}</span>
      </div>
    `;
  }).join("");

  const hasCustomerInfo = data.customerName || data.phone || data.address;
  const customerHtml = hasCustomerInfo ? `
    <div class="info-card">
      <p class="info-card-title">Delivery details</p>
      ${data.customerName ? `<p><b>Name:</b> ${data.customerName}</p>` : ""}
      ${data.phone ? `<p><b>Phone:</b> ${data.phone}</p>` : ""}
      ${data.address ? `<p><b>Address:</b> ${data.address}</p>` : ""}
    </div>
  ` : "";

  const hasRiderInfo = data.riderName || data.riderPhone || data.courierServiceName;
  const courierHtml = (hasRiderInfo && !isDelivered) ? `
    <div class="rider-card">
      <div class="rider-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h13l3 4v6h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 7v7h4"/></svg>
      </div>
      <div class="rider-info">
        ${data.courierServiceName ? `<div class="rider-service">${data.courierServiceName}</div>` : ""}
        ${data.riderName ? `<div class="rider-name">${data.riderName}</div>` : `<div class="rider-name">Delivery partner</div>`}
      </div>
      ${data.riderPhone ? `<a href="tel:${data.riderPhone}" class="rider-call">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z"/></svg>
          Call
        </a>` : ""}
    </div>
  ` : (isOutForDelivery ? `
    <div class="rider-card muted">
      <div class="rider-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h13l3 4v6h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 7v7h4"/></svg></div>
      <div class="rider-info">
        <div class="rider-name">Your parcel is out for delivery</div>
        <div class="rider-sub">Courier partner hasn't shared rider contact for this shipment</div>
      </div>
    </div>
  ` : "");

  const eddHtml = (data.estimatedDelivery && !isDelivered) ? `
    <div class="edd-banner">
      <span class="live-dot"></span>
      Estimated delivery: <b>${data.estimatedDelivery}</b>
    </div>
  ` : "";

  const historyHtml = (data.history && data.history.length > 0) ? `
    <div class="checkpoint-timeline">
      <p class="eyebrow" style="margin-top:28px;">Shipment activity</p>
      ${data.history.map((entry, i) => `
        <div class="checkpoint-item ${i === 0 ? "latest" : ""}" style="animation-delay:${i * 60}ms;">
          <span class="checkpoint-icon ${i === 0 ? "latest" : ""}">${iconForStatus(entry.status)}</span>
          <div class="checkpoint-content">
            <div class="checkpoint-status">${entry.status}</div>
            <div class="checkpoint-meta">
              ${entry.location ? `<span>${entry.location}</span>` : ""}
              ${entry.time ? `<span>${entry.time}</span>` : ""}
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";

  resultBox.innerHTML = `
    <div class="track-card">
      <p class="eyebrow">Order ${data.orderId}</p>

      <div class="status-track">
        <div class="status-track-line">
          <div class="status-track-line-fill" style="width:${progressPct}%;"></div>
        </div>
        <div class="status-track-steps">${stepsHtml}</div>
      </div>

      ${eddHtml}
      ${courierHtml}
      ${customerHtml}
      ${historyHtml}

      ${data.trackingLink ? `<a href="${data.trackingLink}" target="_blank" rel="noopener" class="btn outline" style="margin-top:20px;">View courier tracking</a>` : ""}
      <p class="hint" style="margin-top:16px; font-size:12px; opacity:0.6;">
        <span class="live-dot small"></span> Live status — updates automatically
      </p>
    </div>
  `;
}
