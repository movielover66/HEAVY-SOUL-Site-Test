// ============================================================
// HEAVY SOUL — SITE CONFIG
// Fill in the four placeholders below before going live.
// Nothing else in the codebase needs to change.
// ============================================================
const SITE_CONFIG = {
  // Your UPI ID (e.g. yourname@okicici) — shown on the payment page
  // and used to build the "Pay via UPI App" button.
  UPI_ID: "BHARATPE.9R0B0D0O8X316101@unitype",

  // Name shown to the customer's UPI app as the payee.
  UPI_PAYEE_NAME: "HEAVY SOUL",

  // WhatsApp number that receives new orders, in country code + number,
  // no spaces or plus sign (e.g. 91XXXXXXXXXX).
  WHATSAPP_NUMBER: "919339909978",

  // Optional: a deployed Google Apps Script Web App URL (ends in /exec)
  // used to log orders/abandoned carts to a Sheet and power track.html.
  // Leave as-is to skip this — everything else still works.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzHbUao38sh9dP6AiAu1p6cxeZl6KkZX56KPZaSi7t_1fwA6sBQgcudlT1tfgcqYSmR/exec",

  // Must exactly match the 'API_SHARED_SECRET' Script Property set in the
  // Apps Script backend (Project Settings -> Script Properties). If the
  // backend has that property set and this doesn't match it exactly,
  // every order/abandoned-cart POST is silently rejected as "Unauthorized"
  // and never reaches the Sheet or iThink Logistics.
  // This lives in public JS, so it's a spam filter, not real security.
  API_TOKEN: "jsjshjeushe73uhebsi3u3h3882u2b382",

  // COD terms
  COD_FLAT_ADVANCE: 150,        // flat advance per unit for ready stock items
  CUSTOM_ADVANCE_PERCENT: 0.5,  // 50% advance for made-to-order / custom items
  COD_HANDLING_PER_ITEM: 50,    // handling fee per item, added on top for COD

  PAYMENT_WINDOW_MINUTES: 10,

  // Rough shipping weight per item, in grams. Used only for NimbusPost
  // shipment creation — doesn't need to be exact, just close enough
  // to avoid weight-discrepancy charges from the courier.
  WEIGHT_PER_ITEM_G: 300,

  // Firebase project config (free "Spark" plan is enough for Auth).
  // Get this from: Firebase Console → Project settings → General →
  // "Your apps" → Web app (</>) → SDK setup and configuration → Config.
  FIREBASE_CONFIG: {
    apiKey: "AIzaSyAP8qb7o_cDBjaXhwE8jItCkDZ72fd6XmM",
    authDomain: "heavy-soul-auth.firebaseapp.com",
    projectId: "heavy-soul-auth",
    storageBucket: "heavy-soul-auth.firebasestorage.app",
    messagingSenderId: "421145657035",
    appId: "1:421145657035:web:9fab0fec092fb3b575e54e"
  },

  // Used by track.html's checkpoint map to place the "Warehouse" pin.
  // A PIN code geocodes FAR more precisely than a district/town name (a
  // name like "Hooghly, West Bengal" is ambiguous — Nominatim can resolve
  // it to the whole district's centroid, which can be many km from the
  // actual town). Set this to your warehouse's real 6-digit PIN code.
  WAREHOUSE_PINCODE: "712121",
  // Fallback only, used if the PIN code above fails to geocode.
  WAREHOUSE_GEOCODE_QUERY: "Chinsurah, Hooghly, West Bengal, India",

  // Live site URL — used for og:url meta tags. No trailing slash.
  SITE_URL: "https://heavysoul.in",

  // Analytics — leave the placeholder values as-is to skip either one.
  // GA4: Google Analytics → Admin → Data Streams → Web → Measurement ID (starts with "G-")
  // Meta Pixel: Meta Events Manager → your Pixel → Pixel ID (a number)
  ANALYTICS: {
    GA4_ID: "G-XXXXXXXXXX",
    META_PIXEL_ID: "0000000000000000"
  }
};

// Shared HTML-escaping helper. Product data is our own, but this is
// cheap insurance for anything that ever ends up in innerHTML —
// use it whenever a name/label/text value is inserted into a template.
function escapeHtml(str){
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Shared EDD date formatter — "2026-10-05" -> "Mon, 5 Oct"
function formatEddDate(raw){
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d)) return String(raw);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
