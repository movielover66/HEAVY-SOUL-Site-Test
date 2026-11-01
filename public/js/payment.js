const cart = JSON.parse(localStorage.getItem("cart")) || [];
const shippingInfo = JSON.parse(localStorage.getItem("shippingInfo") || "null");

if (cart.length === 0) window.location.href = "shop.html";
if (!shippingInfo) window.location.href = "checkout.html";

let paymentMethod = "prepaid";

const checkoutItems = document.getElementById("checkoutItems");
let subtotal = 0, customTotal = 0, collectionQty = 0, totalQty = 0;

cart.forEach(item => {
  const qty = item.qty || 1;
  const lineTotal = item.price * qty;
  subtotal += lineTotal;
  totalQty += qty;

  if (item.orderType === "custom") customTotal += lineTotal;
  else collectionQty += qty;

  checkoutItems.innerHTML += `
    <div class="mini-item">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
      <div>
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="meta">Size ${escapeHtml(item.size || "-")} · Qty ${qty}</div>
        <div class="meta">₹${lineTotal}${item.orderType === "custom" ? " · Made to order" : ""}</div>
      </div>
    </div>
  `;
});

document.getElementById("subtotalVal").textContent = "₹" + subtotal;

function calcCodAdvance(){
  let advance = 0;
  if (customTotal > 0) advance += Math.round(customTotal * SITE_CONFIG.CUSTOM_ADVANCE_PERCENT);
  if (collectionQty > 0) advance += SITE_CONFIG.COD_FLAT_ADVANCE * collectionQty;
  return Math.min(advance, subtotal);
}

function renderAmounts(){
  const dueLabel = document.getElementById("dueLabel");
  const dueVal = document.getElementById("dueVal");
  const rowHandling = document.getElementById("rowHandling");
  const handlingVal = document.getElementById("handlingVal");
  const rowGrandTotal = document.getElementById("rowGrandTotal");
  const grandTotalVal = document.getElementById("grandTotalVal");
  const rowRemaining = document.getElementById("rowRemaining");
  const remainingVal = document.getElementById("remainingVal");

  let amountDue;

  if (paymentMethod === "prepaid") {
    dueLabel.textContent = "Pay now";
    dueVal.textContent = "₹" + subtotal;
    rowHandling.classList.add("hidden");
    rowGrandTotal.classList.add("hidden");
    rowRemaining.classList.add("hidden");
    amountDue = subtotal;
  } else {
    const advance = calcCodAdvance();
    const handling = SITE_CONFIG.COD_HANDLING_PER_ITEM * totalQty;
    const grandTotal = subtotal + handling;
    const balance = grandTotal - advance;

    handlingVal.textContent = "₹" + handling;
    grandTotalVal.textContent = "₹" + grandTotal;
    remainingVal.textContent = "₹" + balance;
    dueLabel.textContent = "Advance to pay now";
    dueVal.textContent = "₹" + advance;

    rowHandling.classList.remove("hidden");
    rowGrandTotal.classList.remove("hidden");
    rowRemaining.classList.remove("hidden");
    amountDue = advance;
  }

  const payBtn = document.getElementById("payBtn");
  if (payBtn) payBtn.textContent = "Pay ₹" + amountDue;

  const barDueLabel = document.getElementById("barDueLabel");
  const barDueVal = document.getElementById("barDueVal");
  const barRemainingSub = document.getElementById("barRemainingSub");
  if (barDueLabel) barDueLabel.textContent = dueLabel.textContent;
  if (barDueVal) barDueVal.textContent = dueVal.textContent;
  if (barRemainingSub) {
    if (paymentMethod === "cod") {
      barRemainingSub.textContent = "+ ₹" + remainingVal.textContent.replace("₹", "") + " on delivery";
      barRemainingSub.classList.remove("hidden");
    } else {
      barRemainingSub.classList.add("hidden");
    }
  }

  const codNote = document.getElementById("codNote");
  const codExplainer = document.getElementById("codExplainer");
  if (codNote) codNote.style.display = paymentMethod === "cod" ? "block" : "none";
  if (codExplainer) codExplainer.style.display = paymentMethod === "cod" ? "block" : "none";
}

function setMethod(method){
  paymentMethod = method;
  document.getElementById("btnPrepaid").classList.toggle("active", method === "prepaid");
  document.getElementById("btnCod").classList.toggle("active", method === "cod");
  renderAmounts();
}

renderAmounts();

let deadline = Number(localStorage.getItem("paymentDeadline"));
const windowMs = SITE_CONFIG.PAYMENT_WINDOW_MINUTES * 60 * 1000;
if (!deadline || deadline < Date.now()) {
  deadline = Date.now() + windowMs;
  localStorage.setItem("paymentDeadline", String(deadline));
}

const clock = document.getElementById("clock");
const timerBox = document.getElementById("timerBox");

function cancelOrder(){
  localStorage.removeItem("cart");
  localStorage.removeItem("shippingInfo");
  localStorage.removeItem("paymentDeadline");
  document.getElementById("paymentMain").classList.add("hidden");
  document.getElementById("cancelledView").classList.remove("hidden");
  const payBar = document.getElementById("payBar");
  const payBarSpacer = document.getElementById("payBarSpacer");
  if (payBar) payBar.classList.add("hidden");
  if (payBarSpacer) payBarSpacer.classList.add("hidden");
}

const tickInterval = setInterval(() => {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    clearInterval(tickInterval);
    clock.textContent = "00:00";
    cancelOrder();
    return;
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  clock.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  if (remainingMs <= 2 * 60 * 1000) timerBox.classList.add("danger");
}, 1000);

// NOTE: API_SHARED_SECRET must match the Apps Script "API_SHARED_SECRET"
// Script Property exactly, or every order silently fails to save to the
// Orders sheet (the sendOrderToSheet call uses no-cors, so a rejected
// apiToken never shows up as a visible error in the browser).
const API_SHARED_SECRET = "jsjshjeushe73uhebsi3u3h3882u2b382";

function buildOrderPayload_(orderId, amountDue){
  const fullAddress = `${shippingInfo.address}, ${shippingInfo.state} - ${shippingInfo.pin}`;
  const estWeight = totalQty * (SITE_CONFIG.WEIGHT_PER_ITEM_G || 300);
  const handling = paymentMethod === "cod" ? (SITE_CONFIG.COD_HANDLING_PER_ITEM * totalQty) : 0;
  const grandTotal = subtotal + handling;
  const remaining = paymentMethod === "cod" ? (grandTotal - amountDue) : 0;

  const items = cart.map(item => ({
    id: item.id,
    name: item.name,
    size: item.size || "-",
    qty: item.qty || 1,
    price: item.price,
    sku: item.sku || "",
    image: item.image || ""
  }));

  return {
    type: "order",
    orderId: orderId,
    apiToken: API_SHARED_SECRET,
    customerName: shippingInfo.name,
    phone: shippingInfo.phone,
    email: shippingInfo.email || "",
    address: shippingInfo.address,
    city: shippingInfo.city || "",
    state: shippingInfo.state,
    pincode: shippingInfo.pin,
    pin: shippingInfo.pin,
    altPhone: shippingInfo.altPhone || "",
    fullAddress: fullAddress,
    amount: amountDue,
    codAmount: remaining,
    grandTotal: grandTotal,
    paymentType: paymentMethod === "cod" ? "cod" : "prepaid",
    weight: estWeight,
    items: items
  };
}

// Verifies the payment signature SERVER-SIDE and, only if genuine, asks
// the server to write the order to the Orders sheet. This replaces the
// old direct-to-Apps-Script write — the client is never trusted to save
// an order on its own anymore. Throws on failure so the caller can stop
// and show an error instead of treating the order as placed.
async function verifyAndSaveOrder_(razorpayResponse, orderPayload){
  const res = await fetch("/api/verify-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      razorpay_order_id: razorpayResponse.razorpay_order_id,
      razorpay_payment_id: razorpayResponse.razorpay_payment_id,
      razorpay_signature: razorpayResponse.razorpay_signature,
      orderPayload: orderPayload
    })
  });
  const data = await res.json().catch(() => ({ success: false, error: "Invalid server response." }));
  if (!data.success) {
    throw new Error(data.error || "Payment could not be verified.");
  }
  return data;
}

function generateOrderId(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `HS-${y}${m}${d}-${rand}`;
}

async function placeOrder(){
  if (deadline - Date.now() <= 0) {
    showToast("Payment window has expired — please check out again");
    return;
  }
  await startRazorpayPayment();
}

async function startRazorpayPayment() {
  const amountDue = paymentMethod === "prepaid" ? subtotal : calcCodAdvance();

  const payBtn = document.getElementById("payBtn");
  if (payBtn) { payBtn.disabled = true; payBtn.textContent = "Please wait…"; }

  const orderId = generateOrderId();
  const orderPayload = buildOrderPayload_(orderId, amountDue);

  try {
    const response = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ amount: amountDue }, orderPayload))
    });

    const rzpOrderData = await response.json();

    if (!rzpOrderData.success) {
      showToast("Payment creation failed: " + rzpOrderData.error);
      resetPayButton_();
      return;
    }

    var options = {
      "key": "rzp_live_TLJ04Y2T7hnl5m",
      "amount": amountDue * 100, 
      "currency": "INR",
      "name": "Heavy Soul",
      "description": "Order Payment",
      "order_id": rzpOrderData.order_id,
      "handler": async function (response) {
        // IMPORTANT: do not treat the order as placed just because this
        // callback fired — it only means the checkout widget reported
        // success. finalizeOrder() now verifies with the server first,
        // and bails out (without saving anything) if that check fails.
        try {
          await finalizeOrder(response, orderId, orderPayload);
        } catch (err) {
          showToast("We couldn't confirm your payment: " + err.message + ". If money was deducted, please contact us on WhatsApp before retrying.");
          resetPayButton_();
        }
      },
      "prefill": {
        "name": shippingInfo.name,
        "contact": shippingInfo.phone,
        "email": shippingInfo.email || ""
      },
      "theme": {
        "color": "#C42B38"
      },
      "modal": {
        "ondismiss": function () {
          resetPayButton_();
        }
      }
    };

    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response){
      showToast("Payment failed! " + response.error.description);
      resetPayButton_();
    });
    rzp.open();
  } catch (error) {
    showToast("Server error. Please try again.");
    console.error(error);
    resetPayButton_();
  }
}

function resetPayButton_(){
  const payBtn = document.getElementById("payBtn");
  if (!payBtn) return;
  payBtn.disabled = false;
  const amountDue = paymentMethod === "prepaid" ? subtotal : calcCodAdvance();
  payBtn.textContent = "Pay ₹" + amountDue;
}

async function finalizeOrder(razorpayResponse, orderId, orderPayload) {
  const paymentRef = razorpayResponse.razorpay_payment_id;
  const amountDue = orderPayload.amount;
  const handling = paymentMethod === "cod" ? (SITE_CONFIG.COD_HANDLING_PER_ITEM * totalQty) : 0;
  const grandTotal = orderPayload.grandTotal;
  const remaining = orderPayload.codAmount;

  let orderLines = "";
  cart.forEach(item => {
    const qty = item.qty || 1;
    orderLines += `• ${item.name}\nSize: ${item.size || "-"}\nQty: ${qty}\nPrice: ₹${item.price * qty}${item.orderType === "custom" ? " (Custom)" : ""}\n\n`;
  });

  const message = `🛍️ *NEW ORDER — HEAVY SOUL*

Order ID: ${orderId}

Name: ${shippingInfo.name}
Phone: ${shippingInfo.phone}
Alt phone: ${shippingInfo.altPhone || "-"}
Email: ${shippingInfo.email || "-"}

Address:
${shippingInfo.address}

State: ${shippingInfo.state}
PIN: ${shippingInfo.pin}

--------------------
${orderLines}Item Total: ₹${subtotal}${paymentMethod === "cod" ? `\nCOD Handling Charge: ₹${handling}\nTotal Payable: ₹${grandTotal}` : ""}
Payment Method: ${paymentMethod === "prepaid" ? "Prepaid (Online)" : "COD (Advance Paid)"}
Amount Paid Now: ₹${amountDue}${paymentMethod === "cod" ? `\nBalance (Pay on Delivery): ₹${remaining}` : ""}

Payment Reference (Razorpay):
${paymentRef}

Track your order anytime: ${window.location.origin}${window.location.pathname.replace("payment.html","track.html")}?order=${encodeURIComponent(orderId)}

Please verify payment and confirm the order.`;

  // Throws if verification fails — propagates up to the handler's
  // try/catch above, which shows an error and does NOT proceed to
  // open WhatsApp / redirect to success.html / clear the cart.
  await verifyAndSaveOrder_(razorpayResponse, orderPayload);

  if (window.firebase && typeof saveOrderRecord === "function") {
    await saveOrderRecord(orderPayload);
  }

  window.open(`https://wa.me/${SITE_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank");

  clearInterval(tickInterval);
  localStorage.removeItem("cart");
  localStorage.removeItem("shippingInfo");
  localStorage.removeItem("paymentDeadline");

  window.location.href = `success.html?order=${encodeURIComponent(orderId)}&value=${amountDue}`;
}
