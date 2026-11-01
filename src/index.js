// ============================================================
// HEAVY SOUL — CLOUDFLARE WORKER (backend API)
// Routes:
//   POST /api/create-order            → creates a Razorpay order
//   POST /api/verify-payment          → verifies a Razorpay payment
//                                        signature server-side, THEN
//                                        (and only then) writes the
//                                        order to the Orders sheet.
//                                        This is the ONLY place an
//                                        order is allowed to be saved —
//                                        the client can no longer save
//                                        an order on its own.
//   GET  /api/geocode                 → proxies a place-name search to
//                                        OpenStreetMap's free Nominatim
//                                        geocoder (adds a required
//                                        User-Agent, caches results per
//                                        isolate). Used by track.html's
//                                        checkpoint map — NOT a live GPS
//                                        feed, just turns each courier
//                                        scan's city/hub name into a
//                                        lat/lon pin.
//   POST /api/signup                  → NEW. Verifies the MSG91 OTP token
//                                        server-side, then creates ONE
//                                        Firebase account that has both
//                                        the real email and the verified
//                                        phone number. Returns a custom
//                                        token so the browser is signed in.
//   POST /api/login-phone             → NEW. Mobile number + password login
//                                        (works for new dual accounts and
//                                        old phone-only accounts).
//   POST /api/login-otp               → NEW. Mobile number + SMS OTP login.
//   POST /api/phone-forgot-password   → verifies an MSG91 OTP access
//                                        token, then resets the
//                                        Firebase password for the
//                                        matching phone account
//   *                                  → falls through to static assets
// ============================================================

import { getGoogleAccessToken, createFirebaseCustomToken } from "./lib/gauth.js";
import { handleRefundStatus } from "./lib/refunds.js";
import { handleSupport, purgeExpiredFiles, autoCloseStale_, handleInboundEmail } from "./lib/support.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-order" && request.method === "POST") {
      return handleCreateOrder(request, env, ctx);
    }

    if (url.pathname === "/api/phone-forgot-password" && request.method === "POST") {
      return handlePhoneForgotPassword(request, env, ctx);
    }

    if (url.pathname === "/api/signup" && request.method === "POST") {
      return handleSignup(request, env, ctx);
    }

    if (url.pathname === "/api/account-check" && request.method === "POST") {
      return handleAccountCheck(request, env, ctx);
    }

    if (url.pathname === "/api/login-phone" && request.method === "POST") {
      return handleLoginPhone(request, env, ctx);
    }

    if (url.pathname === "/api/login-otp" && request.method === "POST") {
      return handleLoginOtp(request, env, ctx);
    }

    if (url.pathname === "/api/verify-payment" && request.method === "POST") {
      return handleVerifyPayment(request, env, ctx);
    }

    if (url.pathname === "/api/refund-status" && request.method === "GET") {
      return handleRefundStatus(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/support/") && (request.method === "POST" || (request.method === "GET" && url.pathname.startsWith("/api/support/file/")))) {
      return handleSupport(request, env, ctx, url.pathname);
    }

    if (url.pathname === "/api/geocode" && request.method === "GET") {
      return handleGeocode(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },

  // Hourly cron (see "triggers" in wrangler.jsonc): closes support chats idle for 3 days, then deletes photos
  // 7 days after the chat was closed.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { await autoCloseStale_(env).catch(() => {}); await purgeExpiredFiles(env).catch(() => {}); })());
  },

  // Inbound e-mail (Cloudflare Email Routing -> support@heavysoul.in)
  async email(message, env, ctx) {
    await handleInboundEmail(message, env, ctx);
  }
};

/* ========================================================= CREATE ORDER (Razorpay) ========================================================= */

async function handleCreateOrder(request, env, ctx) {
  try {
    const body = await request.json();

    if (!Number(body.amount) || Number(body.amount) <= 0) {
      return jsonResponse({ success: false, error: "Invalid amount" }, 400);
    }
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(String(body.orderId || ""))) {
      return jsonResponse({ success: false, error: "Invalid order reference. Please refresh and try again." }, 400);
    }
    // Money is decided HERE, from the catalog — never from what the browser sent.
    const priceCheck = await validateCartPricing_(body, env);
    if (!priceCheck.ok) {
      return jsonResponse({ success: false, error: priceCheck.error }, priceCheck.status || 400);
    }
    const priced = priceCheck.order;
    const amount = priced.amount;
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return jsonResponse({ success: false, error: "Razorpay keys not configured on server" }, 500);
    }

    const keyId = await env.RAZORPAY_KEY_ID.get();
    const keySecret = await env.RAZORPAY_KEY_SECRET.get();
    const auth = btoa(`${keyId}:${keySecret}`);

    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100),
        currency: "INR",
        receipt: body.orderId,
        notes: {
          heavySoulOrderId: body.orderId,
          cartSig: await cartFingerprint_(body.orderId, priced.method, Math.round(amount * 100), priced.lines)
        }
      })
    });

    const rzpData = await rzpRes.json();

    if (!rzpRes.ok) {
      return jsonResponse({ success: false, error: rzpData?.error?.description || "Razorpay order creation failed" }, 500);
    }

    if (env.APPS_SCRIPT_URL) {
      ctx.waitUntil(
        fetch(env.APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(Object.assign({ type: "store_pending_order", apiToken: env.APPS_SCRIPT_API_TOKEN || "" }, body, {
            // server-priced values replace whatever the browser sent
            items: priced.lines, amount: priced.amount, grandTotal: priced.grandTotal,
            codAmount: priced.codAmount, paymentType: priced.method
          }))
        }).catch(() => {})
      );
    }

    return jsonResponse({ success: true, order_id: rzpData.id });

  } catch (err) {
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
}

/* ========================================================= VERIFY PAYMENT (server-side, authoritative) ========================================================= */
// The client's Razorpay "handler" callback is JUST a UI event — it proves
// nothing on its own and can fire without a real captured payment (stale
// tab state, a replayed order_id, a browser/extension quirk, DevTools,
// etc.). This endpoint re-derives the HMAC-SHA256 signature from
// razorpay_order_id + razorpay_payment_id using OUR OWN key secret (never
// trust a signature the client sends) and compares it to what the client
// supplied. Only if that matches do we forward the order to Apps Script —
// this is now the ONLY path that can create a row in the Orders sheet for
// a prepaid/COD-advance order. The client is never trusted to save an
// order directly anymore.

// Confirms the order details sent at verify-payment match the cart the server priced at
// create-order, then rewrites the money fields from server data. Nothing the browser sent
// for price, quantity, totals or amount survives.
async function bindOrderToPayment_(payload, rzpOrderId, rzpPaymentId, env) {
  const orderId = String(payload.orderId || "");
  const method = payload.paymentType === "cod" ? "cod" : payload.paymentType === "prepaid" ? "prepaid" : null;
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(orderId) || !method) {
    return { ok: false, status: 400, error: `Order details are invalid. Payment ${rzpPaymentId} was received — message us on WhatsApp.` };
  }
  let rzp;
  try {
    const auth = btoa(`${await env.RAZORPAY_KEY_ID.get()}:${await env.RAZORPAY_KEY_SECRET.get()}`);
    const r = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(rzpOrderId)}`, { headers: { Authorization: `Basic ${auth}` } });
    if (!r.ok) throw new Error("rzp " + r.status);
    rzp = await r.json();
  } catch (e) {
    return { ok: false, status: 502, error: `We couldn't confirm your payment with the gateway just now. Payment ${rzpPaymentId} is safe — please try again or message us.` };
  }
  const paidPaise = Number(rzp.amount);
  const paidAmount = paidPaise / 100;
  if (!Number.isFinite(paidPaise) || paidPaise < 100) {
    return { ok: false, status: 400, error: `Payment amount couldn't be confirmed (${rzpPaymentId}). Please message us.` };
  }
  if (rzp.notes && rzp.notes.heavySoulOrderId && rzp.notes.heavySoulOrderId !== orderId) {
    return { ok: false, status: 400, error: `This payment belongs to a different order (${rzpPaymentId}). Please message us.` };
  }

  const cfg = pricingConfig_(env);
  const catalog = await fetchAuthoritativeProducts_(env, false);
  const priced = catalog ? priceCart_(payload.items, method, catalog, cfg) : { ok: false };
  const lines = priced.ok ? priced.lines : (Array.isArray(payload.items) ? payload.items.map(i => ({ id: i.id, size: String(i.size || "-").slice(0, 20), qty: Number(i.qty) })) : []);
  const sig = await cartFingerprint_(orderId, method, paidPaise, lines);
  const sigOk = !!(rzp.notes && rzp.notes.cartSig) && rzp.notes.cartSig === sig;

  if (!sigOk) {
    // Older order (created before the fingerprint existed) or a changed cart: accept only if the
    // catalog-priced amount equals what was actually paid.
    if (!priced.ok || Math.abs(priced.amount - paidAmount) > 1) {
      return { ok: false, status: 400, error: `Order details don't match the payment (${rzpPaymentId}). Please message us on WhatsApp.` };
    }
  }
  if (priced.ok) {
    payload.items = priced.lines;
    payload.grandTotal = priced.grandTotal;
    payload.codAmount = method === "cod" ? Math.max(0, priced.grandTotal - paidAmount) : 0;
    if (Math.abs(priced.amount - paidAmount) > 1) payload.priceChangedDuringCheckout = true;
  }
  payload.amount = paidAmount;      // what Razorpay actually charged
  payload.paymentType = method;
  return { ok: true };
}

async function handleVerifyPayment(request, env, ctx) {
  try {
    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderPayload } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderPayload) {
      return jsonResponse({ success: false, error: "Missing payment verification fields." }, 400);
    }

    if (!env.RAZORPAY_KEY_SECRET) {
      return jsonResponse({ success: false, error: "Razorpay keys not configured on server" }, 500);
    }

    const keySecret = await env.RAZORPAY_KEY_SECRET.get();
    const expectedSignature = await hmacSha256Hex_(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`);

    if (!timingSafeEqual_(expectedSignature, String(razorpay_signature))) {
      return jsonResponse({ success: false, error: "Payment verification failed — signature mismatch." }, 400);
    }

    // Signature is valid -> this payment is genuinely captured by Razorpay.
    // Before anything is saved, tie the browser's order details to what was actually paid for.
    const bound = await bindOrderToPayment_(orderPayload, razorpay_order_id, razorpay_payment_id, env);
    if (!bound.ok) {
      return jsonResponse({ success: false, error: bound.error }, bound.status || 400);
    }
    orderPayload.paymentReference = razorpay_payment_id;
    orderPayload.apiToken = env.APPS_SCRIPT_API_TOKEN || orderPayload.apiToken || "";

    if (!env.APPS_SCRIPT_URL) {
      return jsonResponse({ success: false, error: "Order backend not configured on server" }, 500);
    }

    const sheetRes = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(orderPayload)
    });
    const sheetData = await sheetRes.json().catch(() => ({ success: false, error: "Invalid response from order backend." }));

    return jsonResponse(sheetData, sheetRes.ok ? 200 : 500);

  } catch (err) {
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
}

async function hmacSha256Hex_(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ========================================================= PHONE FORGOT-PASSWORD ========================================================= */
// Flow: the browser already ran the MSG91 OTP widget and got an
// "access token" proving the user owns this phone number. We re-verify
// that token server-side with MSG91 (never trust the client alone for
// something as sensitive as a password reset), then use a Firebase
// service-account OAuth2 token (see lib/gauth.js) to call the Identity
// Toolkit REST API directly — no firebase-admin, since that package
// isn't Workers-compatible.

async function handlePhoneForgotPassword(request, env, ctx) {
  try {
    const body = await request.json();
    const accessToken = String(body.accessToken || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const newPassword = String(body.newPassword || "");

    if (!accessToken) {
      return jsonResponse({ success: false, error: "Missing OTP access token" }, 400);
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return jsonResponse({ success: false, error: "Invalid phone number" }, 400);
    }
    if (!passwordIsStrong_(newPassword)) {
      return jsonResponse({ success: false, error: "Password must be 8+ characters and mix at least 3 of: lowercase, uppercase, number, symbol" }, 400);
    }

    if (!env.MSG91_AUTHKEY || !env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      return jsonResponse({ success: false, error: "Server is not fully configured" }, 500);
    }

    // ---- 1. Re-verify the OTP access token with MSG91 ----
    const msg91Authkey = await env.MSG91_AUTHKEY.get();
    const verifyRes = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authkey: msg91Authkey, "access-token": accessToken })
    });
    const verifyData = await verifyRes.json().catch(() => null);

    if (!verifyRes.ok || !verifyData || verifyData.type !== "success") {
      return jsonResponse({ success: false, error: "OTP could not be verified — please try again" }, 401);
    }
    const bind = checkOtpPhoneBinding_(verifyData, accessToken, phone, env, false);
    if (!bind.ok) {
      return jsonResponse({ success: false, error: bind.error }, 403);
    }

    // ---- 2. Get a Google OAuth2 access token for the Identity Toolkit API ----
    // FIREBASE_SERVICE_ACCOUNT_EMAIL lives in the Cloudflare Secrets Store (needs .get()).
    // FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY is a classic Worker secret (too long for the
    // Secrets Store's 1024-char limit) — it's already a plain string, no .get() needed.
    const clientEmail = await env.FIREBASE_SERVICE_ACCOUNT_EMAIL.get();
    const privateKeyPem = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const googleToken = await getGoogleAccessToken(
      clientEmail,
      privateKeyPem,
      "https://www.googleapis.com/auth/identitytoolkit"
    );

    // ---- 3. Find the Firebase user for this phone ----
    // New accounts store the verified number on the Auth record itself;
    // old phone-only accounts use the synthetic "<phone>@phone.heavysoul.in".
    let account;
    try {
      account = await findAccountByPhone_(googleToken, phone);
    } catch (e) {
      return jsonResponse({ success: false, error: String(e.message || e) }, 500);
    }
    if (!account) {
      return jsonResponse({ success: false, error: "No account found for this phone number" }, 404);
    }

    // ---- 4. Set the new password ----
    const updateRes = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${googleToken}`
      },
      body: JSON.stringify({ localId: account.localId, password: newPassword })
    });
    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      return jsonResponse({ success: false, error: updateData?.error?.message || "Password update failed" }, 500);
    }

    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
}

/* ========================================================= GEOCODE (free, OpenStreetMap Nominatim) ========================================================= */
// A tiny in-memory cache (reused across requests within the same Worker
// isolate, same pattern as the products cache below) so repeat lookups of
// the same hub/pincode — which happen constantly since the tracking page
// auto-refreshes every 30s — don't re-hit Nominatim every time. Nominatim's
// usage policy requires a descriptive User-Agent and asks for at most ~1
// request/sec of genuinely new traffic, which this easily stays under for
// a small shop.
let _geocodeCache = new Map();
const GEOCODE_CACHE_MAX = 500; // simple cap so the isolate's memory can't grow unbounded

async function handleGeocode(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();

    if (!q) {
      return jsonResponse({ success: false, error: "Missing q parameter" }, 400);
    }

    const key = q.toLowerCase();
    if (_geocodeCache.has(key)) {
      return jsonResponse({ success: true, ..._geocodeCache.get(key), cached: true });
    }

    const nomRes = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=" + encodeURIComponent(q),
      { headers: { "User-Agent": "HeavySoul-OrderTracking/1.0 (contact: heavysoulclothing@gmail.com)" } }
    );
    const nomData = await nomRes.json().catch(() => null);

    if (!nomRes.ok || !Array.isArray(nomData) || nomData.length === 0) {
      return jsonResponse({ success: false, error: "No match found for this location." }, 404);
    }

    const result = {
      lat: parseFloat(nomData[0].lat),
      lon: parseFloat(nomData[0].lon),
      display_name: nomData[0].display_name
    };

    if (_geocodeCache.size >= GEOCODE_CACHE_MAX) {
      _geocodeCache.delete(_geocodeCache.keys().next().value); // drop oldest
    }
    _geocodeCache.set(key, result);

    return jsonResponse({ success: true, ...result });

  } catch (err) {
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
}

/* ========================================================= PRICE VALIDATION ========================================================= */
// A tiny in-memory cache so we don't hit the Apps Script products
// endpoint on every single checkout — the sheet doesn't change that
// often. Workers reuse this across requests within the same isolate.
let _productsCache = null;
let _productsCacheAt = 0;
const PRODUCTS_CACHE_MS = 5 * 60 * 1000;          // reuse the catalog for 5 minutes
const PRODUCTS_STALE_MS = 6 * 60 * 60 * 1000;     // if the sheet is down, a catalog up to 6h old is still trusted

// The catalog comes from YOUR Google Sheet via Apps Script (?type=products). It is the only
// source of truth for prices — nothing the browser sends is ever trusted for money.
async function fetchAuthoritativeProducts_(env, force) {
  const now = Date.now();
  if (!force && _productsCache && (now - _productsCacheAt) < PRODUCTS_CACHE_MS) return _productsCache;
  if (env.APPS_SCRIPT_URL) {
    try {
      const res = await fetch(`${env.APPS_SCRIPT_URL}?type=products`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.products) && data.products.length) {
        _productsCache = data.products;
        _productsCacheAt = now;
        return _productsCache;
      }
    } catch (err) { /* fall through to the stale copy */ }
  }
  if (_productsCache && (now - _productsCacheAt) < PRODUCTS_STALE_MS) return _productsCache;
  return null; // no catalog at all -> callers must REFUSE the order (fail closed)
}

// A hard floor no legitimate order falls below.
const MIN_ORDER_AMOUNT = 1;

// These MUST equal SITE_CONFIG in js/config.js (COD_FLAT_ADVANCE, CUSTOM_ADVANCE_PERCENT,
// COD_HANDLING_PER_ITEM). Override with the vars of the same name in wrangler.jsonc.
function pricingConfig_(env) {
  const num = (v, d) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v))) ? d : Number(v);
  return {
    codFlatAdvance: num(env.COD_FLAT_ADVANCE, 150),
    customAdvancePercent: num(env.CUSTOM_ADVANCE_PERCENT, 0.5),
    codHandlingPerItem: num(env.COD_HANDLING_PER_ITEM, 50)
  };
}

// Prices the cart from the catalog. Item id (or sku) decides the product; the browser's
// price / name / orderType / totals are ignored and rebuilt here.
function priceCart_(items, method, catalog, cfg) {
  if (!Array.isArray(items) || !items.length || items.length > 50) {
    return { ok: false, error: "Your bag looks empty or invalid. Please refresh and try again." };
  }
  const byId = new Map(), bySku = new Map();
  for (const p of catalog) {
    byId.set(String(p.id), p);
    if (p.sku) bySku.set(String(p.sku), p);
  }
  let subtotal = 0, customTotal = 0, collectionQty = 0, totalQty = 0;
  const lines = [];
  for (const it of items) {
    const qty = Number(it && it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      return { ok: false, error: "Invalid quantity in your bag. Please refresh and try again." };
    }
    const hasId = it.id !== undefined && it.id !== null && String(it.id) !== "";
    const p = (hasId ? byId.get(String(it.id)) : null) || (it.sku ? bySku.get(String(it.sku)) : null);
    if (!p) {
      return { ok: false, error: "An item in your bag isn't available any more. Please refresh your bag." };
    }
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: "A price couldn't be confirmed. Please try again in a minute." };
    }
    const custom = String(p.orderType || "collection") === "custom";
    const line = price * qty;
    subtotal += line; totalQty += qty;
    if (custom) customTotal += line; else collectionQty += qty;
    lines.push({
      id: p.id,
      name: String(p.name || (it && it.name) || ""),
      size: String((it && it.size) || "-").slice(0, 20),
      qty, price,
      sku: String(p.sku || (it && it.sku) || ""),
      image: String(p.image || (it && it.image) || ""),
      orderType: custom ? "custom" : "collection"
    });
  }
  const cod = method === "cod";
  const handling = cod ? cfg.codHandlingPerItem * totalQty : 0;
  const grandTotal = subtotal + handling;
  let amount = subtotal;
  if (cod) {
    let advance = 0;
    if (customTotal > 0) advance += Math.round(customTotal * cfg.customAdvancePercent);
    if (collectionQty > 0) advance += cfg.codFlatAdvance * collectionQty;
    amount = Math.min(advance, subtotal);
  }
  return { ok: true, method, lines, subtotal, grandTotal, amount, codAmount: cod ? grandTotal - amount : 0 };
}

// Used by /api/create-order. Returns { ok, order } or { ok:false, status, error }.
async function validateCartPricing_(body, env) {
  const method = body.paymentType === "cod" ? "cod" : body.paymentType === "prepaid" ? "prepaid" : null;
  if (!method) return { ok: false, status: 400, error: "Invalid payment type. Please refresh and try again." };
  const claimed = Number(body.amount);
  if (!Number.isFinite(claimed) || claimed < MIN_ORDER_AMOUNT) {
    return { ok: false, status: 400, error: "Order amount too low. Please refresh the page and try again." };
  }
  const cfg = pricingConfig_(env);
  let last = null;
  // 1st pass uses the cached catalog; if anything disagrees we re-read the sheet once, so a
  // price change in the last few minutes doesn't wrongly block a real customer.
  for (let pass = 0; pass < 2; pass++) {
    const catalog = await fetchAuthoritativeProducts_(env, pass === 1);
    if (!catalog) {
      return { ok: false, status: 503, error: "We couldn't confirm prices right now. Please try again in a minute." };
    }
    const r = priceCart_(body.items, method, catalog, cfg);
    last = r;
    if (r.ok && Math.abs(r.amount - claimed) <= 1) return { ok: true, order: r };
  }
  return {
    ok: false, status: 400,
    error: last && !last.ok ? last.error : "Prices have updated. Please refresh your bag and try again."
  };
}

// Fingerprint of the cart that was validated at create-order. It is stored in the Razorpay
// order's notes, and re-checked at verify-payment, so the cart can't be swapped after the
// customer has paid. Only things the server decided go into it.
async function cartFingerprint_(orderId, method, amountPaise, lines) {
  const parts = lines.map(l => `${l.id}:${l.size}:${l.qty}`).sort().join(",");
  const data = new TextEncoder().encode(`${orderId}|${method}|${amountPaise}|${parts}`);
  const h = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}

/* ========================================================= HELPERS ========================================================= */

/* ========================================================= HELPERS ========================================================= */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
} 


/* ========================================================= ACCOUNTS: SIGNUP / PHONE LOGIN / OTP LOGIN ========================================================= */
// Why these live in the Worker and not in the browser:
//  - SIGNUP: the old browser-only flow only *hid* the "Create account"
//    button until the OTP passed. Anyone could skip the button and call
//    Firebase directly, registering a phone number they do not own. Now
//    the account is created here, only after MSG91 confirms the OTP.
//  - PHONE LOGIN: new accounts use the person's real email as the Firebase
//    login, and the verified phone number is stored on the same Auth
//    record. To let someone log in with just a phone number we look the
//    account up here, check the password here, and hand the browser a
//    custom token. The real email is never sent to the browser.
//
// Needs (see wrangler.jsonc): FIREBASE_WEB_API_KEY, FIREBASE_PROJECT_ID.

const IDTK = "https://identitytoolkit.googleapis.com/v1";

let _fbAdminCache = null; // { token, exp } — reused while the isolate lives

async function getFirebaseAdminToken_(env) {
  const now = Date.now();
  if (_fbAdminCache && _fbAdminCache.exp > now + 60000) return _fbAdminCache.token;
  const clientEmail = await env.FIREBASE_SERVICE_ACCOUNT_EMAIL.get();
  const token = await getGoogleAccessToken(
    clientEmail,
    env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,
    "https://www.googleapis.com/auth/identitytoolkit"
  );
  _fbAdminCache = { token, exp: now + 50 * 60 * 1000 };
  return token;
}

function passwordIsStrong_(pw) {
  pw = String(pw || "");
  if (pw.length < 8 || pw.length > 128) return false;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/\d/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  return classes >= 3;
}

function cleanPhone_(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}

async function idtkAdmin_(env, path, payload) {
  const token = await getFirebaseAdminToken_(env);
  const res = await fetch(IDTK + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function fbLookup_(env, payload) {
  const r = await idtkAdmin_(env, "/accounts:lookup", payload);
  if (!r.ok) throw new Error((r.data && r.data.error && r.data.error.message) || "Account lookup failed");
  return (r.data.users && r.data.users[0]) || null;
}

// Finds an account by phone. New accounts: phoneNumber on the Auth record.
// Old phone-only accounts: the synthetic internal email.
async function findAccountByPhone_(tokenOrEnv, phone) {
  // tokenOrEnv: the existing forgot-password handler passes a ready Google
  // token string; new handlers pass env.
  if (typeof tokenOrEnv === "string") {
    const call = async (payload) => {
      const res = await fetch(IDTK + "/accounts:lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tokenOrEnv },
        body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (!res.ok) throw new Error((d && d.error && d.error.message) || "Account lookup failed");
      return (d.users && d.users[0]) || null;
    };
    return (await call({ phoneNumber: ["+91" + phone] })) || (await call({ email: [phone + "@phone.heavysoul.in"] }));
  }
  const env = tokenOrEnv;
  return (await fbLookup_(env, { phoneNumber: ["+91" + phone] })) ||
         (await fbLookup_(env, { email: [phone + "@phone.heavysoul.in"] }));
}

async function mintCustomToken_(env, uid) {
  const clientEmail = await env.FIREBASE_SERVICE_ACCOUNT_EMAIL.get();
  return createFirebaseCustomToken(clientEmail, env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY, uid);
}

async function verifyMsg91Token_(env, accessToken) {
  const authkey = await env.MSG91_AUTHKEY.get();
  const res = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authkey, "access-token": accessToken })
  });
  const data = await res.json().catch(() => null);
  return { ok: !!(res.ok && data && data.type === "success"), data };
}

// An OTP token proves "someone verified SOME phone". It must also be tied
// to the phone the request is about, otherwise a person could verify their
// own number and then ask to log in / reset as somebody else's number.
// We look for a phone number inside MSG91's response (and inside the token
// if it is a JWT). If one is found it MUST match.
// strict=true  → also refuse when no phone can be found at all.
// strict=false → allow in that case, but log it (so existing flows keep working).
function checkOtpPhoneBinding_(verifyData, accessToken, phone, env, strict) {
  const found = new Set();
  const scan = (text) => {
    const re = /(?:^|[^\d])(?:\+?91)?([6-9]\d{9})(?!\d)/g;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  };
  try { scan(JSON.stringify(verifyData || {})); } catch (e) {}
  try {
    const parts = String(accessToken).split(".");
    if (parts.length === 3) {
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      scan(atob(b64));
    }
  } catch (e) {}

  if (found.size > 0) {
    if (found.has(phone)) return { ok: true, bound: true };
    return { ok: false, error: "This OTP was not issued for that mobile number." };
  }
  const forceStrict = strict || String((env && env.OTP_BINDING) || "").toLowerCase() === "strict";
  console.warn("OTP binding: MSG91 response carried no phone number. Keys: " + Object.keys(verifyData || {}).join(","));
  if (forceStrict) {
    return { ok: false, error: "OTP login is not available yet — please log in with your password." };
  }
  return { ok: true, bound: false };
}

function readJson_(request) {
  return request.json().catch(() => null);
}

/* ---------------- POST /api/signup ---------------- */
async function handleSignup(request, env, ctx) {
  try {
    const body = await readJson_(request);
    if (!body) return jsonResponse({ success: false, error: "Invalid request" }, 400);

    const name = String(body.name || "").trim().slice(0, 60);
    const email = String(body.email || "").trim().toLowerCase();
    const phone = cleanPhone_(body.phone);
    const password = String(body.password || "");
    const accessToken = String(body.accessToken || "").trim();

    if (name.length < 2) return jsonResponse({ success: false, error: "Please enter your name." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
      return jsonResponse({ success: false, error: "Please enter a valid email address." }, 400);
    }
    if (!phone) return jsonResponse({ success: false, error: "Please enter a valid 10-digit mobile number." }, 400);
    if (!passwordIsStrong_(password)) {
      return jsonResponse({ success: false, error: "Password must be 8+ characters and mix at least 3 of: lowercase, uppercase, number, symbol." }, 400);
    }
    if (!accessToken) return jsonResponse({ success: false, error: "Please verify your mobile number with the OTP first." }, 400);

    const v = await verifyMsg91Token_(env, accessToken);
    if (!v.ok) return jsonResponse({ success: false, error: "OTP could not be verified — please try again." }, 401);
    const bind = checkOtpPhoneBinding_(v.data, accessToken, phone, env, false);
    if (!bind.ok) return jsonResponse({ success: false, error: bind.error }, 403);

    // Already registered? (checked here so the answer is authoritative)
    if (await fbLookup_(env, { email: [email] })) {
      return jsonResponse({ success: false, code: "email-exists", error: "An account with this email already exists." }, 409);
    }
    if (await findAccountByPhone_(env, phone)) {
      return jsonResponse({ success: false, code: "phone-exists", error: "An account with this mobile number already exists." }, 409);
    }

    const projectId = env.FIREBASE_PROJECT_ID || "heavy-soul-auth";
    const created = await idtkAdmin_(env, "/projects/" + projectId + "/accounts", {
      email, password, displayName: name, phoneNumber: "+91" + phone, emailVerified: false
    });
    if (!created.ok) {
      const msg = (created.data && created.data.error && created.data.error.message) || "";
      if (msg.indexOf("EMAIL_EXISTS") === 0) return jsonResponse({ success: false, code: "email-exists", error: "An account with this email already exists." }, 409);
      if (msg.indexOf("PHONE_NUMBER_EXISTS") === 0) return jsonResponse({ success: false, code: "phone-exists", error: "An account with this mobile number already exists." }, 409);
      return jsonResponse({ success: false, error: "Could not create the account. Please try again." }, 500);
    }

    const uid = created.data.localId;
    const customToken = await mintCustomToken_(env, uid);
    return jsonResponse({ success: true, customToken, uid });
  } catch (err) {
    return jsonResponse({ success: false, error: "Something went wrong. Please try again." }, 500);
  }
}

/* ---------------- POST /api/login-phone ---------------- */
async function handleLoginPhone(request, env, ctx) {
  const bad = () => jsonResponse({ success: false, error: "Incorrect mobile number or password." }, 401);
  try {
    const body = await readJson_(request);
    if (!body) return jsonResponse({ success: false, error: "Invalid request" }, 400);
    const phone = cleanPhone_(body.phone);
    const password = String(body.password || "");
    if (!phone || !password || password.length > 128) return bad();

    const account = await findAccountByPhone_(env, phone);
    if (!account || account.disabled || !account.email) return bad();

    // Check the password with Firebase itself, so its own brute-force
    // protection (TOO_MANY_ATTEMPTS_TRY_LATER) applies.
    const apiKey = env.FIREBASE_WEB_API_KEY;
    if (!apiKey) return jsonResponse({ success: false, error: "Server is not fully configured." }, 500);
    const res = await fetch(IDTK + "/accounts:signInWithPassword?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email, password, returnSecureToken: false })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || "";
      if (msg.indexOf("TOO_MANY_ATTEMPTS") === 0) {
        return jsonResponse({ success: false, code: "locked", error: "Too many attempts. Please try again in a little while." }, 429);
      }
      return bad();
    }
    const customToken = await mintCustomToken_(env, account.localId);
    return jsonResponse({ success: true, customToken });
  } catch (err) {
    return jsonResponse({ success: false, error: "Something went wrong. Please try again." }, 500);
  }
}

/* ---------------- POST /api/login-otp ---------------- */
async function handleLoginOtp(request, env, ctx) {
  try {
    const body = await readJson_(request);
    if (!body) return jsonResponse({ success: false, error: "Invalid request" }, 400);
    const phone = cleanPhone_(body.phone);
    const accessToken = String(body.accessToken || "").trim();
    if (!phone || !accessToken) return jsonResponse({ success: false, error: "Invalid request" }, 400);

    const v = await verifyMsg91Token_(env, accessToken);
    if (!v.ok) return jsonResponse({ success: false, error: "OTP could not be verified — please try again." }, 401);

    // A login must be bound to the phone. No exceptions (strict = true).
    const bind = checkOtpPhoneBinding_(v.data, accessToken, phone, env, true);
    if (!bind.ok) return jsonResponse({ success: false, error: bind.error }, 403);

    const account = await findAccountByPhone_(env, phone);
    if (!account || account.disabled) {
      return jsonResponse({ success: false, code: "no-account", error: "No account found for this mobile number." }, 404);
    }
    const customToken = await mintCustomToken_(env, account.localId);
    return jsonResponse({ success: true, customToken });
  } catch (err) {
    return jsonResponse({ success: false, error: "Something went wrong. Please try again." }, 500);
  }
}

/* ---------------- POST /api/account-check ---------------- */
// Answers "is this email / mobile already a user?" straight from Firebase
// Authentication, so it works for every account no matter how it was created.
// Returns only: exists, provider ("google" | "password"), linked (["email","phone"]).
async function handleAccountCheck(request, env, ctx) {
  try {
    const body = await readJson_(request);
    if (!body) return jsonResponse({ success: false, error: "Invalid request" }, 400);
    const type = String(body.type || "");
    let account = null;
    if (type === "email") {
      const email = String(body.value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
        return jsonResponse({ success: false, error: "Invalid email" }, 400);
      }
      account = await fbLookup_(env, { email: [email] });
    } else if (type === "phone") {
      const phone = cleanPhone_(body.value);
      if (!phone) return jsonResponse({ success: false, error: "Invalid phone" }, 400);
      account = await findAccountByPhone_(env, phone);
    } else {
      return jsonResponse({ success: false, error: "Invalid request" }, 400);
    }

    if (!account) return jsonResponse({ success: true, exists: false });

    const synthetic = /@phone\.heavysoul\.in$/i.test(account.email || "");
    const providers = (account.providerUserInfo || []).map((p) => p.providerId);
    const googleOnly = providers.length > 0 && providers.indexOf("password") === -1 && providers.indexOf("google.com") > -1;
    const linked = [];
    if (account.email && !synthetic) linked.push("email");
    if (account.phoneNumber || synthetic) linked.push("phone");
    return jsonResponse({ success: true, exists: true, provider: googleOnly ? "google" : "password", linked });
  } catch (err) {
    return jsonResponse({ success: false, error: "Lookup failed" }, 500);
  }
}
