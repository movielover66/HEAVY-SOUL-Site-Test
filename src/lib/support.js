// ============================================================
// HEAVY SOUL — live support chat (Cloudflare Worker + Firestore REST + R2)
//
// Customer (ticket id + phone prove identity):
//   POST /api/support/chat/start     open a chat (bot greets)
//   POST /api/support/chat/send      send a message (+ images); bot answers if mode=bot
//   POST /api/support/chat/poll      fetch new messages + "agent is typing"; sends own typing ping
//   POST /api/support/upload         raw image body (<= 3 MB, jpg/png/webp), header X-Phone
//   GET  /api/support/file/<key>     serve an uploaded image
// Admin (admin password, re-used from admin.html):
//   POST /api/support/admin/list | poll | reply | upload
//
// Storage: Firestore "supportTickets" (+ tiny "supportTyping" docs), images in
// the R2 bucket bound as SUPPORT_FILES. Images are deleted 7 days after a
// ticket is CLOSED by purgeExpiredFiles() (daily cron, see wrangler.jsonc).
// ============================================================
import { getGoogleAccessToken } from "./gauth.js";
import { detectIntent, composeReply, CHIP_INTENTS, normaliseOrderId, BOT_NAME } from "./supportbot.js";
import { geminiIntent, geminiDraft } from "./gemini.js";

const COL = "supportTickets", TCOL = "supportTyping";
const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
const MAX_MSGS = 400, MAX_FILE = 3 * 1024 * 1024, MAX_FILES_MSG = 4, MAX_FILES_TICKET = 14;
const PURGE_AFTER_MS = 7 * 24 * 3600 * 1000;
const TYPING_MS = 6000;
// what kind of problem a bot escalation was about -> ticket category
const INTENT_CATEGORY = { not_received: "delivery", delivery_late: "delivery", damaged: "damaged", payment: "payment", refund: "refund", cancel: "cancel", size: "exchange", return: "exchange" };
const HIGH_CATS = new Set(["damaged", "payment", "delivery"]);
const CATEGORY_LABEL = { delivery: "Delivery problem", damaged: "Damaged / wrong item", payment: "Payment problem", refund: "Refund", cancel: "Cancellation", exchange: "Size / exchange", other: "Other" };
const AUTO_CLOSE_MS = 3 * 24 * 3600 * 1000;   // a chat nobody has touched for 3 days is closed automatically
const LINK_CHIPS = {
  "open my orders": { text: "Here you go.", link: { label: "Open My orders", href: "orders.html" } },
  "open tracking page": { text: "Here's the tracking page. Enter your Order ID there to see the live timeline.", link: { label: "Open tracking page", href: "track.html" } },
  "open login page": { text: "Here's the login page.", link: { label: "Open Login / Signup", href: "account.html" } }
};
let _tok = null;

function json_(d, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
const clean_ = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);
const phone10_ = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const now_ = () => new Date().toISOString();
const enc_ = encodeURIComponent;

function newId_() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(6));
  return "HST-" + Array.from(b, x => A[x % A.length]).join("");
}
const hex_ = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => x.toString(16).padStart(2, "0")).join("");

/* ---------- Firestore REST ---------- */
async function token_(env) {
  if (_tok && _tok.exp > Date.now() + 60000) return _tok.t;
  const t = await getGoogleAccessToken(await env.FIREBASE_SERVICE_ACCOUNT_EMAIL.get(), env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY, "https://www.googleapis.com/auth/datastore");
  _tok = { t, exp: Date.now() + 50 * 60 * 1000 };
  return t;
}
const base_ = (env) => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
function toFs_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "number") return { integerValue: String(Math.round(v)) };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs_) } };
  if (typeof v === "object") { const f = {}; for (const k in v) if (v[k] !== undefined) f[k] = toFs_(v[k]); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fromFs_(x) {
  if ("stringValue" in x) return x.stringValue;
  if ("integerValue" in x) return Number(x.integerValue);
  if ("booleanValue" in x) return x.booleanValue;
  if ("timestampValue" in x) return x.timestampValue;
  if ("arrayValue" in x) return (x.arrayValue.values || []).map(fromFs_);
  if ("mapValue" in x) { const o = {}, f = x.mapValue.fields || {}; for (const k in f) o[k] = fromFs_(f[k]); return o; }
  return null;
}
const docToObj_ = (d) => { const o = {}, f = d.fields || {}; for (const k in f) o[k] = fromFs_(f[k]); o._updateTime = d.updateTime; return o; };
async function fs_(env, method, path, body) {
  const r = await fetch(base_(env) + path, { method, headers: { Authorization: "Bearer " + await token_(env), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ("Firestore " + r.status)); e.code = r.status; throw e; }
  return j;
}
async function getTicket_(env, id) {
  try { return docToObj_(await fs_(env, "GET", `/${COL}/${enc_(id)}`)); }
  catch (e) { if (e.code === 404) return null; throw e; }
}
async function saveTicket_(env, id, t, updateTime) {
  const fields = {}; for (const k in t) if (k[0] !== "_" && t[k] !== undefined) fields[k] = toFs_(t[k]);
  const q = updateTime ? "?currentDocument.updateTime=" + enc_(updateTime) : "";
  return fs_(env, "PATCH", `/${COL}/${enc_(id)}${q}`, { fields });
}
// read-modify-write with an optimistic lock; retries when two writers collide
async function mutate_(env, id, fn) {
  for (let i = 0; i < 5; i++) {
    const t = await getTicket_(env, id); if (!t) return null;
    const ut = t._updateTime; fn(t);
    try { await saveTicket_(env, id, t, ut); return t; } catch (e) { if (e.code !== 409 && e.code !== 400 && e.code !== 412) throw e; }
  }
  throw new Error("busy");
}
// typing pings live in their own tiny doc so they never collide with message writes
async function setTyping_(env, id, who) {
  const field = who === "customer" ? "typingCustomer" : "typingAgent";
  try { await fs_(env, "PATCH", `/${TCOL}/${enc_(id)}?updateMask.fieldPaths=${field}`, { fields: { [field]: { stringValue: now_() } } }); } catch (e) { /* best effort */ }
}
async function getTyping_(env, id) {
  try { return docToObj_(await fs_(env, "GET", `/${TCOL}/${enc_(id)}`)); } catch (e) { return {}; }
}
const recent_ = (iso) => !!iso && Date.now() - Date.parse(iso) < TYPING_MS;
function lastAt_(t, from) { for (let i = (t.messages || []).length - 1; i >= 0; i--) if (t.messages[i].from === from) return t.messages[i].at; return ""; }

/* ---------- owner alerts (Telegram; silently skipped until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set) ---------- */
async function notify_(env, ctx, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const p = fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: String(text).slice(0, 900), disable_web_page_preview: true }) }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
}
// team hours: 10:00-19:00 IST, Monday-Saturday
function teamOnline_() { const ist = new Date(Date.now() + 5.5 * 3600 * 1000), h = ist.getUTCHours() + ist.getUTCMinutes() / 60, d = ist.getUTCDay(); return d !== 0 && h >= 10 && h < 19; }
const TAG_RULES = [[/courier|delhivery|tracking|awb|parcel|lost|delay/i, "courier"], [/refund|money back|paisa|taka/i, "refund"], [/size|exchange|small|large|fit/i, "size"], [/payment|upi|utr|deduct|charged/i, "payment"], [/torn|damag|defect|faded|stain|wrong/i, "quality"], [/cod|cash on/i, "cod"], [/angry|worst|fraud|scam|cheat|legal|consumer|complain/i, "angry"]];
const autoTags_ = (txt) => TAG_RULES.filter(([r]) => r.test(txt)).map(([, t]) => t).slice(0, 4);
async function signals_(env, phone) {
  try { const o = await queryEq_(env, "orders", "phone", phone10_(phone), 60); return { orders: o.length, lifetime: o.reduce((n, x) => n + (Number(x.subtotal) || 0), 0), recent: o.sort((a, c) => String(c.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 4).map(x => x.orderId).filter(Boolean) }; }
  catch (e) { return { orders: 0, lifetime: 0, recent: [] }; }
}

/* ---------- customer e-mails (Resend first, Apps Script MailApp as fallback) ---------- */
const siteUrl_ = (env) => String(env.SITE_URL || "https://heavysoul.in").replace(/\/+$/, "");
const esc_ = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// works for BOTH a normal Worker secret (string) and a Secrets Store binding (object with .get())
async function secret_(v) { try { return v && typeof v.get === "function" ? String((await v.get()) || "") : String(v || ""); } catch (e) { return ""; } }
const threadSubject_ = (id) => `Heavy Soul support · ticket ${id}`;   // same subject every time = one e-mail conversation per ticket
async function sendMail_(env, to, subject, text, html, thread) {
  const resendKey = await secret_(env.RESEND_API_KEY);
  // 1) Resend (free plan, domain verified): used whenever RESEND_API_KEY is set
  if (resendKey) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM || "Heavy Soul <support@heavysoul.in>", to: [to], reply_to: env.MAIL_REPLY_TO || undefined, subject, text, html,
          headers: thread ? { "In-Reply-To": `<${thread}@heavysoul.in>`, "References": `<${thread}@heavysoul.in>` } : undefined }) });
      if (r.ok) return "sent";
    } catch (e) {}
  }
  // 2) Fallback: Google Apps Script MailApp (only if you added the send_email action there)
  if (env.APPS_SCRIPT_URL) {
    try {
      const r = await fetch(env.APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ type: "send_email", apiToken: env.APPS_SCRIPT_API_TOKEN || "", to, subject, text, html, replyTo: env.MAIL_REPLY_TO || "" }) });
      const j = await r.json().catch(() => ({}));
      if (j && j.success) return "sent";
    } catch (e) {}
  }
  return resendKey ? "failed" : "no_key";
}
async function emailFor_(env, t) {
  if (t.email && EMAIL_RE.test(t.email)) return t.email;
  const ph = phone10_(t.phone);
  try { const u = await queryEq_(env, "users", "phone", ph, 1); if (u[0] && EMAIL_RE.test(u[0].email || "") && !/@phone\.heavysoul\.in$/.test(u[0].email)) return u[0].email; } catch (e) {}
  try { const o = await queryEq_(env, "orders", "phone", ph, 20); const hit = o.find(x => EMAIL_RE.test(x.email || "") && !/@phone\.heavysoul\.in$/.test(x.email)); if (hit) return hit.email; } catch (e) {}
  return "";
}
function mailHtml_(title, paras, link, linkLabel) {
  const body = paras.map(p => `<p style="margin:0 0 14px;line-height:1.55">${esc_(p).replace(/\n/g, "<br>")}</p>`).join("");
  const btn = link ? `<p style="margin:22px 0"><a href="${esc_(link)}" style="background:#C42B38;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${esc_(linkLabel || "Open chat")}</a></p>` : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1b1714"><div style="font:700 22px Georgia,serif;margin-bottom:18px">Heavy Soul</div><h2 style="margin:0 0 14px;font-size:19px">${esc_(title)}</h2>${body}${btn}<p style="margin:26px 0 0;font-size:12px;color:#7a716a">You are receiving this because you contacted Heavy Soul support. Reply to this email and our team will see it.</p></div>`;
}
// kind: raised | closed | reply. Sends the mail, then leaves a private log line in the thread (admin sees it, the customer does not).
async function mailEvent_(env, ticketId, kind, extra = {}) {
  const t = await getTicket_(env, ticketId); if (!t) return "no_ticket";
  if (kind === "raised" && t.mailRaised) return "dup"; if (kind === "closed" && t.mailClosed) return "dup";
  const first = String(t.name || "").trim().split(/\s+/)[0] || "there", link = `${siteUrl_(env)}/support.html?ticket=${t.ticketId}`;
  const email = await emailFor_(env, t);
  let status = "no_email", subject = "";
  if (email) {
    let title, paras, label = "Open your chat";
    if (kind === "raised") { subject = threadSubject_(t.ticketId); title = "We've got your request"; paras = [`Hi ${first},`, `Thanks for reaching out. We've opened a ${CATEGORY_LABEL[t.category] ? CATEGORY_LABEL[t.category].toLowerCase() + " " : ""}ticket for you${t.orderId ? " about order " + t.orderId : ""}.`, `Ticket ID: ${t.ticketId}`, "Our team usually replies within 24 hours on business days. You can follow the conversation any time using the button below."]; }
    else if (kind === "closed") { subject = threadSubject_(t.ticketId); title = "Your chat has been closed"; paras = [`Hi ${first},`, `We've closed your chat ${t.ticketId}. If it isn't fully sorted, just open the chat and write to us again, or start a new one.`, "Thank you for your patience. We'd love to hear how we did: you can rate the chat on the same page."]; label = "Open chat / rate us"; }
    else { subject = threadSubject_(t.ticketId); title = "A reply from our team"; paras = [`Hi ${first},`, String(extra.text || ""), "You can continue the conversation on the website:"]; label = "Reply in chat"; }
    status = await sendMail_(env, email, subject, paras.join("\n\n") + "\n\n" + link, mailHtml_(title, paras, link, label), t.ticketId);
  }
  const at = now_();
  await mutate_(env, ticketId, (x) => {
    if (email && !x.email) x.email = email;
    if (kind === "raised" && status === "sent") x.mailRaised = true; if (kind === "closed" && status === "sent") x.mailClosed = true;
    const label = { raised: "Ticket-raised email", closed: "Chat-closed email", reply: "Your reply by email" }[kind];
    const msg = status === "sent" ? `✉ ${label} sent to ${email}` : status === "no_email" ? `✉ ${label} NOT sent: no email address on file (add one under Customer email)` : status === "no_key" ? `✉ ${label} NOT sent: email service isn't set up yet (RESEND_API_KEY)` : `✉ ${label} to ${email} FAILED, please check the email service`;
    x.messages.push({ from: "system", internal: true, text: msg, at });
  });
  return status;
}
const bg_ = (ctx, p) => { const q = p.catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(q); return q; };

/* ---------- public shapes ---------- */
function pubMsg_(m) {
  const o = { from: m.from, text: m.text, at: m.at }; if (m.internal) o.internal = true;
  if (m.files && m.files.length) o.files = m.files.map(f => ({ key: f.key, name: f.name, type: f.type, size: f.size, expired: !!f.expired }));
  if (m.chips && m.chips.length) o.chips = m.chips;
  if (m.link) o.link = m.link;
  return o;
}
function pubTicket_(t, since, admin) {
  const all = t.messages || [], from = Math.max(0, since || 0);
  return { ticketId: t.ticketId, status: t.status, mode: t.mode || "human", category: t.category, subject: t.subject, orderId: t.orderId || "",
    createdAt: t.createdAt, updatedAt: t.updatedAt, closedAt: t.closedAt || "", rating: t.rating || 0, filesPurged: !!t.filesPurged, total: all.length, from, name: t.name,
    messages: all.slice(from).filter(m => admin || !m.internal).map(pubMsg_) };
}
function adminTicket_(t) { const o = { ...t }; delete o._updateTime; return o; }

/* ---------- soft rate limit (per IP, edge cache) ---------- */
async function hit_(request, bucket, limit, ttl) {
  if (typeof caches === "undefined") return true;
  const ip = request.headers.get("CF-Connecting-IP") || "x";
  const key = new Request(`https://rl.local/${bucket}/${enc_(ip)}`);
  const c = caches.default, got = await c.match(key);
  const n = got ? Number(await got.text()) || 0 : 0;
  if (n >= limit) return false;
  await c.put(key, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=" + ttl } }));
  return true;
}

/* ---------- admin check via Apps Script (cached 5 min so live polling stays cheap) ---------- */
const _adm = new Map();
async function isAdmin_(env, pw) {
  pw = String(pw || ""); if (!pw || !env.APPS_SCRIPT_URL) return false;
  const hit = _adm.get(pw); if (hit && hit > Date.now()) return true;
  try {
    const r = await fetch(env.APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ type: "admin_verify", adminPassword: pw, apiToken: env.APPS_SCRIPT_API_TOKEN || "" }) });
    const j = await r.json().catch(() => ({}));
    if (j.success) { _adm.set(pw, Date.now() + 5 * 60 * 1000); if (_adm.size > 20) _adm.clear(); return true; }
  } catch (e) { /* fall through */ }
  return false;
}

/* ---------- order lookup for the bot (same data the public track page shows) ---------- */
async function lookupOrder_(env, orderId) {
  if (!env.APPS_SCRIPT_URL) return null;
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(`${env.APPS_SCRIPT_URL}?orderId=${enc_(orderId)}`, { signal: ctl.signal }); clearTimeout(tm);
    const d = await r.json();
    return d && d.found ? { found: true, orderId, status: d.status, estimatedDelivery: d.estimatedDelivery, eddIsEstimate: d.eddIsEstimate, awb: d.awb, courierServiceName: d.courierServiceName, history: d.history || [] } : { found: false, orderId };
  } catch (e) { return null; }
}

/* ---------- the bot turn ---------- */
export async function botTurn_(env, t, text, hasFiles) {
  const raw = String(text || "").trim(), lower = raw.toLowerCase();
  if (LINK_CHIPS[lower]) return { ...LINK_CHIPS[lower], chips: ["Where is my order?", "Talk to a human"] };
  if (!raw && hasFiles) return { ...composeReply("damaged", { name: t.name }), intent: "damaged" }; // a photo with no words is almost always a problem report
  let { intent, orderId } = detectIntent(raw);
  if (CHIP_INTENTS[lower]) intent = CHIP_INTENTS[lower];
  let viaAI = false;
  if (intent === "unknown" && raw.length >= 2) {            // rules didn't understand -> let Gemini PICK an approved answer (it never writes one)
    const g = await geminiIntent(env, raw).catch(() => null);
    if (g && g.intent !== "none" && (g.confidence >= 0.7 || (g.intent === "human" && g.confidence >= 0.5))) { intent = g.intent; viaAI = true; }
  }
  if (t.awaiting === "orderId" && orderId) intent = "order_status";
  if (intent === "delay" && (orderId || t.orderId)) intent = "order_status";
  if (intent === "order_status") {
    let oid = orderId || t.orderId || "";
    let recent = [];
    if (!oid) {   // no ID given: look at this customer's own orders (by phone) so they can just tap one
      try { const ords = await queryEq_(env, "orders", "phone", phone10_(t.phone), 30); ords.sort((a, c) => String(c.createdAt || "").localeCompare(String(a.createdAt || ""))); recent = ords.map(o => o.orderId).filter(Boolean).slice(0, 4); } catch (e) { /* fine: ask for the ID */ }
      if (recent.length === 1) oid = recent[0];
    }
    if (!oid) return composeReply("order_status", { name: t.name, order: null, recent });
    const order = await lookupOrder_(env, normaliseOrderId(oid));
    if (!order) return { text: "I couldn't reach the tracking system just now. You can check live status on the tracking page, or I can get a person to look.", chips: ["Talk to a human"], link: { label: "Open tracking page", href: "track.html?order=" + enc_(oid) } };
    // is it overdue? (past its expected date by more than a day and still not delivered / cancelled)
    const edd = order.found ? Date.parse(order.estimatedDelivery || "") : NaN;
    const late = !!(order.found && edd && Date.now() - edd > 36 * 3600 * 1000 && !/deliver(ed)?$|cancel|return|rto/i.test(order.status || "") );
    return { ...composeReply("order_status", { name: t.name, order, late }), orderId: order.found ? order.orderId : "", intent: late ? "delivery_late" : "order_status" };
  }
  if (intent === "cancel" && (orderId || t.orderId)) {   // guided cancel: only possible before dispatch
    const oid = normaliseOrderId(orderId || t.orderId), o = await lookupOrder_(env, oid);
    if (o && o.found && /confirm|process|placed|pending|making|packed/i.test(o.status || "") && !o.awb) return { text: `Good news: **${oid}** hasn't been dispatched yet, so it can be cancelled. I've raised a cancellation ticket and our team will confirm it here shortly. You can also use the **Cancel order** button on its tracking page.`, chips: [], escalate: true, orderId: oid, intent: "cancel", link: { label: "Open tracking page", href: "track.html?order=" + enc_(oid) } };
    if (o && o.found) return { text: `**${oid}** is already **${o.status}**, and because each piece is handmade, a dispatched order can't be cancelled. If there's a problem with it, tell me and I'll get a person.`, chips: ["Talk to a human", "Where is my order?"], orderId: oid, intent: "cancel_late" };
  }
  if (orderId && intent === "refund") { const r = composeReply("human", {}); return { ...r, orderId, intent }; }
  const r = composeReply(intent, { name: t.name, fails: t.botFails || 0 });
  return { ...r, orderId: orderId || "", intent, ai: viaAI };
}

function applyBot_(t, reply, at, raw, sig) {
  const msg = { from: "bot", text: reply.text, at };
  if (reply.escalate && !teamOnline_()) msg.text += "\n\nOur team is offline right now (we're online 10 AM–7 PM IST, Monday–Saturday), so you'll hear back as soon as we're in.";
  if (reply.intent === "unknown" && raw) t.missed = (t.missed || []).concat([String(raw).slice(0, 120)]).slice(-10);
  if (reply.chips && reply.chips.length) msg.chips = reply.chips;
  if (reply.link) msg.link = reply.link;
  t.messages.push(msg);
  t.awaiting = reply.awaiting || "";
  t.botFails = reply.fail ? (t.botFails || 0) + 1 : 0;
  if (reply.orderId && !t.orderId) t.orderId = reply.orderId;
  if (reply.escalate) {
    t.mode = "human"; t.status = "open"; t.needsHuman = true; t.escalatedAt = at;
    // problems that need back-office work (courier chase, refund, replacement...) become a TICKET; plain "talk to a person" stays a chat
    const cat = INTENT_CATEGORY[reply.intent];
    if (cat && !t.isTicket) {
      t.isTicket = true; t.category = cat; t.priority = HIGH_CATS.has(cat) ? "high" : "normal";
      t.dueAt = new Date(Date.parse(at) + (t.priority === "high" ? 4 : 24) * 3600 * 1000).toISOString();
      t.messages.push({ from: "system", text: `Ticket raised: ${CATEGORY_LABEL[cat]}`, at });
    }
    const tags = autoTags_(raw || ""); if (tags.length) t.tags = Array.from(new Set([...(t.tags || []), ...tags])).slice(0, 8);
    if (sig && (sig.orders >= 3 || sig.lifetime >= 5000)) { t.vip = true; t.tags = Array.from(new Set([...(t.tags || []), "vip"])).slice(0, 8); if (t.isTicket) { t.priority = "high"; t.dueAt = new Date(Date.parse(at) + 4 * 3600 * 1000).toISOString(); } }
    t.messages.push({ from: "system", text: "Waiting for a support agent to join", at });
  }
}

/* ---------- file validation ---------- */
function sniff_(b) {
  const u = new Uint8Array(b.slice(0, 16));
  if (u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF) return { type: "image/jpeg", ext: "jpg" };
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47) return { type: "image/png", ext: "png" };
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}
async function checkFiles_(env, ticketId, files) {
  const out = [];
  if (!Array.isArray(files) || !env.SUPPORT_FILES) return out;
  for (const f of files.slice(0, MAX_FILES_MSG)) {
    const key = clean_(f && f.key, 120);
    if (!new RegExp("^t/" + ticketId + "/[a-f0-9]{32}\\.(jpg|png|webp)$").test(key)) continue;
    const head = await env.SUPPORT_FILES.head(key); if (!head) continue;
    out.push({ key, name: clean_(f.name, 60) || "photo", type: head.httpMetadata && head.httpMetadata.contentType || "image/jpeg", size: head.size });
  }
  return out;
}

/* ---------- customer handlers ---------- */
async function auth_(env, b) {
  const id = clean_(b.ticketId, 20).toUpperCase();
  if (!/^HST-[A-Z0-9]{6}$/.test(id)) return { err: json_({ ok: false, error: "Chat ID looks wrong." }, 400) };
  const t = await getTicket_(env, id);
  if (!t || t.phone !== phone10_(b.phone)) return { err: json_({ ok: false, error: "No chat found for that ID and phone number." }, 404) };
  return { id, t };
}
function greeting_(name) {
  const r = composeReply("greeting", { name });
  return { from: "bot", text: r.text, at: now_(), chips: r.chips };
}
async function chatStart_(request, env) {
  const b = await request.json().catch(() => ({}));
  if (b.website) return json_({ ok: true, ticket: { ticketId: "HST-DONE00", messages: [], total: 0, status: "closed", mode: "bot" } });
  if (!(await hit_(request, "tk-start", 8, 3600))) return json_({ ok: false, error: "Too many chats from this device. Please try again in an hour." }, 429);
  const name = clean_(b.name, 80), phone = phone10_(b.phone), orderRaw = clean_(b.orderId, 40);
  if (name.length < 2) return json_({ ok: false, error: "Please enter your name." }, 400);
  if (phone.length !== 10) return json_({ ok: false, error: "Please enter a valid 10-digit mobile number." }, 400);
  const orderId = orderRaw ? normaliseOrderId(orderRaw) : "";
  const id = newId_(), at = now_();
  const g = greeting_(name);
  try {   // known customer? mention their latest order up-front
    const sg = await signals_(env, phone), lastId = orderId || (sg.recent && sg.recent[0]);
    if (lastId) {
      const o = await Promise.race([lookupOrder_(env, normaliseOrderId(lastId)), new Promise(r => setTimeout(() => r(null), 2500))]);
      if (o && o.found) { g.text += `\n\nBy the way, your order **${o.orderId}** is **${o.status}**${o.estimatedDelivery && !/deliver|cancel/i.test(o.status || "") ? ", expected " + o.estimatedDelivery : ""}.`; }
    }
  } catch (e) { /* greeting still works without it */ }
  const t = { ticketId: id, status: "open", mode: "bot", category: "Chat support", subject: "Chat with " + name, orderId, name, phone,
    createdAt: at, updatedAt: at, lastFrom: "bot", awaiting: "", botFails: 0, needsHuman: false, fileCount: 0, messages: [g] };
  await saveTicket_(env, id, t);
  return json_({ ok: true, ticket: pubTicket_(t, 0) });
}
async function chatSend_(request, env, ctx) {
  if (!(await hit_(request, "tk-send", 120, 3600))) return json_({ ok: false, error: "Too many messages. Please slow down a little." }, 429);
  const b = await request.json().catch(() => ({}));
  const a = await auth_(env, b); if (a.err) return a.err;
  const text = clean_(b.text, 1500);
  const files = await checkFiles_(env, a.id, b.files);
  if (!text && !files.length) return json_({ ok: false, error: "Please type a message." }, 400);
  if (a.t.status === "closed") return json_({ ok: false, closed: true, error: "This chat was closed. Please start a new chat." }, 409);
  if ((a.t.messages || []).length >= MAX_MSGS) return json_({ ok: false, error: "This chat is full. Please start a new chat." }, 400);

  let reply = null;
  if ((a.t.mode || "human") === "bot") reply = await botTurn_(env, a.t, text, files.length > 0);

  const sig = reply && reply.escalate ? await signals_(env, a.t.phone) : null;
  const sinceCount = Math.max(0, Number(b.count) || 0);
  const t = await mutate_(env, a.id, (t) => {
    const at = now_();
    const m = { from: "customer", text, at }; if (files.length) m.files = files;
    t.messages.push(m); t.updatedAt = at; t.lastFrom = "customer";
    t.fileCount = (t.fileCount || 0);
    if (t.status === "resolved" || t.status === "waiting_customer") t.status = "open";
    if ((t.mode || "human") === "bot" && reply) applyBot_(t, reply, new Date(Date.now() + 1).toISOString(), text, sig);
    else t.needsHuman = true;
  });
  if (reply && reply.escalate && t.isTicket) bg_(ctx, mailEvent_(env, a.id, "raised"));
  if (reply && reply.escalate) await notify_(env, ctx, `${t.isTicket ? "NEW TICKET" : "Chat needs a person"}${t.vip ? " (VIP)" : ""}: ${CATEGORY_LABEL[t.category] || "chat"}\n${t.name} · ${t.phone}${t.orderId ? " · " + t.orderId : ""}\n"${text.slice(0, 140)}"\nOpen /admin-support.html`);
  return json_({ ok: true, ticket: pubTicket_(t, sinceCount) });
}
async function chatRate_(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const a = await auth_(env, b); if (a.err) return a.err;
  const rating = Math.round(Number(b.rating)); if (!(rating >= 1 && rating <= 5)) return json_({ ok: false, error: "Please pick a rating." }, 400);
  if (a.t.status !== "closed") return json_({ ok: false, error: "You can rate once the chat is closed." }, 409);
  if (a.t.rating) return json_({ ok: true, ticket: pubTicket_(a.t, Number(b.count) || 0) });
  const note = clean_(b.note, 300);
  const t = await mutate_(env, a.id, (x) => {
    x.rating = rating; x.ratingNote = note; x.ratedAt = now_();
    if (rating <= 2) { x.lowRating = true; x.isTicket = true; x.category = x.category || "other"; x.priority = "high"; x.tags = Array.from(new Set([...(x.tags || []), "low-rating"])).slice(0, 8); }
  });
  if (rating <= 2) await notify_(env, ctx, `Low rating (${rating}/5) from ${t.name} · ${t.phone} · chat ${t.ticketId}${note ? '\n"' + note + '"' : ""}`);
  return json_({ ok: true, ticket: pubTicket_(t, Number(b.count) || 0) });
}
async function chatPoll_(request, env) {
  const b = await request.json().catch(() => ({}));
  const a = await auth_(env, b); if (a.err) return a.err;
  if (b.typing && a.t.status !== "closed") await setTyping_(env, a.id, "customer");
  const ty = await getTyping_(env, a.id);
  const agentTyping = recent_(ty.typingAgent) && ty.typingAgent > lastAt_(a.t, "support");
  return json_({ ok: true, agentTyping, ticket: pubTicket_(a.t, Number(b.count) || 0) });
}

async function upload_(request, env, admin) {
  if (!env.SUPPORT_FILES) return json_({ ok: false, error: "Photo upload isn't set up on the server yet." }, 503);
  const id = clean_(request.headers.get("X-Ticket"), 20).toUpperCase();
  if (!/^HST-[A-Z0-9]{6}$/.test(id)) return json_({ ok: false, error: "Chat ID looks wrong." }, 400);
  if (admin) { if (!(await isAdmin_(env, request.headers.get("X-Admin-Pw")))) return json_({ ok: false, error: "Not authorised." }, 401); }
  else if (!(await hit_(request, "tk-upload", 24, 3600))) return json_({ ok: false, error: "Too many uploads. Please wait a bit." }, 429);
  const t = await getTicket_(env, id);
  if (!t || (!admin && t.phone !== phone10_(request.headers.get("X-Phone")))) return json_({ ok: false, error: "No chat found." }, 404);
  if (t.status === "closed") return json_({ ok: false, closed: true, error: "This chat is closed." }, 409);
  if ((t.fileCount || 0) >= MAX_FILES_TICKET) return json_({ ok: false, error: "This chat already has the maximum number of photos." }, 400);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_FILE + 2048) return json_({ ok: false, error: "That photo is too large. Maximum is 3 MB." }, 413);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_FILE) return json_({ ok: false, error: "That photo is too large. Maximum is 3 MB." }, 413);
  if (buf.byteLength < 200) return json_({ ok: false, error: "That file looks empty." }, 400);
  const kind = sniff_(buf);
  if (!kind) return json_({ ok: false, error: "Only JPG, PNG or WebP photos can be sent." }, 415);
  const key = `t/${id}/${hex_(16)}.${kind.ext}`;
  await env.SUPPORT_FILES.put(key, buf, { httpMetadata: { contentType: kind.type }, customMetadata: { ticket: id } });
  let name = "photo"; try { name = clean_(decodeURIComponent(request.headers.get("X-File-Name") || ""), 60) || "photo"; } catch (e) {}
  await mutate_(env, id, (x) => { x.fileCount = (x.fileCount || 0) + 1; }).catch(() => {});
  return json_({ ok: true, file: { key, name, type: kind.type, size: buf.byteLength } });
}

export async function serveFile_(request, env, path) {
  const key = decodeURIComponent(path.replace("/api/support/file/", ""));
  if (!env.SUPPORT_FILES || !/^t\/HST-[A-Z0-9]{6}\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  const o = await env.SUPPORT_FILES.get(key);
  if (!o) return new Response("This attachment has expired.", { status: 404 });
  return new Response(o.body, { headers: { "Content-Type": o.httpMetadata.contentType || "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-origin" } });
}

/* ---------- customer card for the admin: details + last 5 orders + earlier chats ---------- */
async function queryEq_(env, col, field, value, limit) {
  const rows = await fs_(env, "POST", ":runQuery", { structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } }, limit } });
  return (rows || []).filter(r => r.document).map(r => docToObj_(r.document));
}
async function adminCustomer_(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!(await isAdmin_(env, b.adminPassword))) return json_({ ok: false, error: "Not authorised." }, 401);
  const id = clean_(b.ticketId, 20).toUpperCase();
  const t = await getTicket_(env, id);
  if (!t) return json_({ ok: false, error: "Ticket not found." }, 404);
  const ph = phone10_(t.phone);
  const [ords, users, chats] = await Promise.all([
    queryEq_(env, "orders", "phone", ph, 60).catch(() => []),
    queryEq_(env, "users", "phone", ph, 1).catch(() => []),
    queryEq_(env, COL, "phone", ph, 30).catch(() => [])
  ]);
  ords.sort((a, c) => String(c.createdAt || "").localeCompare(String(a.createdAt || "")));
  const last5 = ords.slice(0, 5);
  const ids = last5.map(o => o.orderId).filter(Boolean);
  const mention = t.orderId && !ids.includes(t.orderId) ? t.orderId : "";
  const live = await Promise.all([...ids, ...(mention ? [mention] : [])].map(o => lookupOrder_(env, o)));
  const byId = {}; live.forEach(l => { if (l) byId[l.orderId] = l; });
  const shape = (o) => { const l = byId[o.orderId]; return { orderId: o.orderId, createdAt: o.createdAt || "", paymentType: o.paymentType || "", total: o.subtotal || 0, paid: o.amountPaid || 0,
    items: (o.items || []).map(i => ({ name: i.name, size: i.size, qty: i.qty, price: i.price })),
    status: l ? (l.found ? l.status : "Not in tracking sheet") : "", eta: l && l.found ? l.estimatedDelivery || "" : "", awb: l && l.found ? l.awb || "" : "", courier: l && l.found ? l.courierServiceName || "" : "" }; };
  const u = users[0] || {};
  const lifetime = ords.reduce((n, o) => n + (Number(o.subtotal) || 0), 0);
  return json_({ ok: true, customer: { name: t.name, phone: ph, email: u.email || (ords[0] && ords[0].email) || "", address: [u.address, u.city, u.state, u.pin].filter(Boolean).join(", "), hasAccount: users.length > 0 || ords.length > 0 },
    orders: last5.map(shape), mentioned: mention ? (() => { const l = byId[mention]; return { orderId: mention, status: l ? (l.found ? l.status : "Not found") : "", eta: l && l.found ? l.estimatedDelivery || "" : "" }; })() : null,
    stats: { orderCount: ords.length, lifetime }, otherChats: chats.filter(c => c.ticketId !== id).sort((a, c) => String(c.createdAt).localeCompare(String(a.createdAt))).slice(0, 5).map(c => ({ ticketId: c.ticketId, status: c.status, createdAt: c.createdAt })) });
}

/* ---------- auto-close: no activity for 3 days -> closed (photos then go 7 days later) ---------- */
export async function autoCloseStale_(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) return { closed: 0 };
  let closed = 0, nudged = 0;
  for (const st of STATUSES.filter(x => x !== "closed")) {
    const rows = await queryEq_(env, COL, "status", st, 300);
    for (const t of rows) {
      const last = Date.parse(t.updatedAt || t.createdAt || "");
      if (last && t.isTicket && !t.firstReplyAt && !t.overdueAlerted && t.dueAt && Date.parse(t.dueAt) < Date.now() && t.status !== "closed") {
        await notify_(env, null, `OVERDUE ticket (${CATEGORY_LABEL[t.category] || "ticket"}): ${t.name} · ${t.phone} · ${t.ticketId}\nNo reply yet. Open /admin-support.html`);
        await mutate_(env, t.ticketId, (x) => { x.overdueAlerted = true; }); nudged++;
      }
      if (last && st === "waiting_customer" && !t.nudgedAt && Date.now() - last > 24 * 3600 * 1000 && Date.now() - last < AUTO_CLOSE_MS) {   // gentle check-in after 24 h of silence
        await mutate_(env, t.ticketId, (x) => { if (x.status !== "waiting_customer" || x.nudgedAt) return; x.nudgedAt = now_(); x.messages.push({ from: "bot", text: "Just checking in: is this sorted? If we don't hear back, this chat will close on its own in about 2 days. You can reply here any time to keep it open.", at: x.nudgedAt }); }); nudged++;
      }
      if (!last || Date.now() - last < AUTO_CLOSE_MS) continue;
      await mutate_(env, t.ticketId, (x) => {
        if (x.status === "closed" || Date.now() - Date.parse(x.updatedAt || x.createdAt) < AUTO_CLOSE_MS) return;
        const at = now_(); x.status = "closed"; x.closedAt = at; x.autoClosed = true; x.needsHuman = false; x.updatedAt = at;
        x.messages.push({ from: "system", text: "This chat was closed automatically after 3 days without a reply. You can start a new chat any time. Photos are removed 7 days after closing.", at });
      }); closed++;
      await mailEvent_(env, t.ticketId, "closed").catch(() => {});
    }
  }
  return { closed, nudged };
}

/* ---------- admin handlers ---------- */
async function adminList_(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!(await isAdmin_(env, b.adminPassword))) return json_({ ok: false, error: "Not authorised." }, 401);
  const q = { structuredQuery: { from: [{ collectionId: COL }], orderBy: [{ field: { fieldPath: "updatedAt" }, direction: "DESCENDING" }], limit: 150 } };
  const rows = await fs_(env, "POST", ":runQuery", q);
  const tickets = (rows || []).filter(r => r.document).map(r => {
    const t = docToObj_(r.document); const msgs = t.messages || [];
    const vis = msgs.filter(m => !m.internal), last = vis.length ? vis[vis.length - 1] : null;
    t.noteCount = (t.notes || []).length; delete t.notes; t.total = msgs.length; t.preview = last ? String(last.text || (last.files ? "[photo]" : "")).slice(0, 90) : "";
    delete t.messages; delete t._updateTime; return t;
  });
  return json_({ ok: true, tickets, statuses: STATUSES, categories: CATEGORY_LABEL, autoCloseMs: AUTO_CLOSE_MS });
}
async function adminPoll_(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!(await isAdmin_(env, b.adminPassword))) return json_({ ok: false, error: "Not authorised." }, 401);
  const id = clean_(b.ticketId, 20).toUpperCase();
  if (b.typing) await setTyping_(env, id, "agent");
  const [t, ty] = await Promise.all([getTicket_(env, id), getTyping_(env, id)]);
  if (!t) return json_({ ok: false, error: "Ticket not found." }, 404);
  const customerTyping = recent_(ty.typingCustomer) && ty.typingCustomer > lastAt_(t, "customer");
  return json_({ ok: true, customerTyping, ticket: { ...adminTicket_({ ...t, messages: undefined }), ...pubTicket_(t, Number(b.count) || 0, true), phone: t.phone, email: t.email || "", needsHuman: !!t.needsHuman, lastFrom: t.lastFrom } });
}
// facts the AI may use when drafting: exactly the answers the bot already gives (single source of truth)
function approvedFacts_() {
  const ids = ["delivery_time", "shipping_charge", "cod", "payment", "refund", "cancel", "size", "return", "damaged", "not_received", "address", "custom", "care", "invoice", "discount", "contact"];
  return ids.map((id) => { try { return `Q: ${id.replace(/_/g, " ")}\nA: ${String(composeReply(id, {}).text || "").replace(/\*\*/g, "")}`; } catch (e) { return ""; } }).filter(Boolean).join("\n\n");
}
async function adminSuggest_(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!(await isAdmin_(env, b.adminPassword))) return json_({ ok: false, error: "Not authorised." }, 401);
  const t = await getTicket_(env, clean_(b.ticketId, 20).toUpperCase());
  if (!t) return json_({ ok: false, error: "Ticket not found." }, 404);
  const out = await geminiDraft(env, { messages: (t.messages || []).filter((m) => !m.internal && m.from !== "system"), facts: approvedFacts_() });
  if (!out.ok) return json_({ ok: false, error: out.reason === "no_keys" ? "Gemini isn't set up yet (add the GEMINI_KEYS secret in Cloudflare)."
    : out.reason === "model" ? "Gemini model name not available. Add a GEMINI_MODEL variable with a model name from AI Studio." + (out.detail ? " (" + out.detail + ")" : "")
    : /^key_/.test(out.reason || "") ? "Gemini refused the key(s) [" + out.reason.slice(4) + "]. " + (out.reason === "key_429" ? "Quota limit reached, wait a minute or add more keys." : "Check GEMINI_KEYS.") + (out.detail ? " (" + out.detail + ")" : "")
    : "Gemini couldn't write a draft [" + (out.reason || "failed") + (out.detail ? ": " + out.detail : "") + "]. Please try again." });
  return json_({ ok: true, draft: out.text, check: /\[CHECK:/i.test(out.text) });
}

async function adminReply_(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!(await isAdmin_(env, b.adminPassword))) return json_({ ok: false, error: "Not authorised." }, 401);
  const id = clean_(b.ticketId, 20).toUpperCase(), text = clean_(b.text, 1500), st = STATUSES.includes(b.status) ? b.status : null;
  const files = await checkFiles_(env, id, b.files);
  const takeover = b.action === "takeover";
  const note = clean_(b.note, 1000), meta = b.meta && typeof b.meta === "object" ? b.meta : null;
  if (!text && !files.length && !st && !takeover && !note && !meta) return json_({ ok: false, error: "Nothing to update." }, 400);
  let wasTicket = false, wasClosed = false;
  const wantMail = b.email === true && !!text;
  const t = await mutate_(env, id, (t) => {
    wasTicket = !!t.isTicket; wasClosed = t.status === "closed";
    const at = now_();
    const joining = (text || files.length || takeover) && (t.mode || "human") !== "human";
    if (joining) { t.mode = "human"; t.messages.push({ from: "system", text: "Heavy Soul Support joined the chat", at }); }
    if (text || files.length || takeover || st === "closed" || st === "resolved") t.needsHuman = false;
    if (note) { t.notes = (t.notes || []).concat([{ text: note, at }]).slice(-50); }
    if (meta) {
      if (typeof meta.isTicket === "boolean") {
        t.isTicket = meta.isTicket;
        if (meta.isTicket && !t.dueAt) t.dueAt = new Date(Date.parse(at) + 24 * 3600 * 1000).toISOString();
        if (meta.isTicket && !t.category) t.category = "other";
      }
      if (CATEGORY_LABEL[meta.category]) t.category = meta.category;
      if (typeof meta.email === "string") { const em = clean_(meta.email, 120).toLowerCase(); if (!em || EMAIL_RE.test(em)) { t.email = em; if (em) { t.mailRaised = t.mailRaised || false; } } }
      if (["low", "normal", "high"].includes(meta.priority)) { t.priority = meta.priority; if (t.isTicket && !t.firstReplyAt) t.dueAt = new Date(Date.parse(t.escalatedAt || t.createdAt || at) + (meta.priority === "high" ? 4 : 24) * 3600 * 1000).toISOString(); }
      if (Array.isArray(meta.tags)) t.tags = meta.tags.map(x => clean_(x, 24).toLowerCase()).filter(Boolean).slice(0, 8);
    }
    if (text || files.length) { const m = { from: "support", text, at: new Date(Date.now() + 1).toISOString() }; if (files.length) m.files = files; t.messages.push(m); t.lastFrom = "support"; if (!t.firstReplyAt) t.firstReplyAt = at; if (!st && t.status !== "closed") t.status = "waiting_customer"; }
    if (st) {
      if (st === "closed" && t.status !== "closed") { t.closedAt = at; t.messages.push({ from: "system", text: "This chat was closed. Photos in it are removed 7 days after closing.", at }); }
      if (st !== "closed" && t.status === "closed") t.closedAt = "";
      t.status = st;
    }
    t.updatedAt = at;
  });
  if (!t) return json_({ ok: false, error: "Ticket not found." }, 404);
  let emailStatus = "", t2 = t;
  if (t.isTicket && !wasTicket) await mailEvent_(env, id, "raised").catch(() => {});                 // admin turned a chat into a ticket
  if (t.status === "closed" && !wasClosed) await mailEvent_(env, id, "closed").catch(() => {});       // chat closed
  if (wantMail) emailStatus = await mailEvent_(env, id, "reply", { text }).catch(() => "failed");     // "also email this reply"
  if (emailStatus || (t.isTicket && !wasTicket) || (t.status === "closed" && !wasClosed)) t2 = (await getTicket_(env, id)) || t;
  return json_({ ok: true, emailStatus, ticket: { ...adminTicket_({ ...t2, messages: undefined }), ...pubTicket_(t2, Number(b.count) || 0, true), phone: t2.phone, email: t2.email || "" } });
}

/* ---------- nightly clean-up: delete photos 7 days after a ticket is closed ---------- */
export async function purgeExpiredFiles(env) {
  if (!env.SUPPORT_FILES || !env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) return { purged: 0 };
  const q = { structuredQuery: { from: [{ collectionId: COL }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "closed" } } }, limit: 300 } };
  const rows = await fs_(env, "POST", ":runQuery", q);
  let purged = 0;
  for (const r of rows || []) {
    if (!r.document) continue;
    const t = docToObj_(r.document); const closed = Date.parse(t.closedAt || "");
    if (t.filesPurged || !closed || Date.now() - closed < PURGE_AFTER_MS) continue;
    let cursor;
    do {
      const list = await env.SUPPORT_FILES.list({ prefix: `t/${t.ticketId}/`, cursor });
      if (list.objects.length) await env.SUPPORT_FILES.delete(list.objects.map(o => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    await mutate_(env, t.ticketId, (x) => { x.filesPurged = true; (x.messages || []).forEach(m => (m.files || []).forEach(f => { f.expired = true; })); });
    purged++;
  }
  return { purged };
}

export async function handleSupport(request, env, ctx, path) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.FIREBASE_SERVICE_ACCOUNT_EMAIL) return json_({ ok: false, error: "Support is not configured on the server yet." }, 500);
    if (request.method === "GET" && path.startsWith("/api/support/file/")) return await serveFile_(request, env, path);
    if (request.method !== "POST") return json_({ ok: false, error: "Not found" }, 404);
    if (path === "/api/support/chat/start") return await chatStart_(request, env);
    if (path === "/api/support/chat/send") return await chatSend_(request, env, ctx);
    if (path === "/api/support/chat/rate") return await chatRate_(request, env, ctx);
    if (path === "/api/support/chat/poll") return await chatPoll_(request, env);
    if (path === "/api/support/upload") return await upload_(request, env, false);
    if (path === "/api/support/admin/upload") return await upload_(request, env, true);
    if (path === "/api/support/admin/list") return await adminList_(request, env);
    if (path === "/api/support/admin/poll") return await adminPoll_(request, env);
    if (path === "/api/support/admin/reply") return await adminReply_(request, env);
    if (path === "/api/support/admin/customer") return await adminCustomer_(request, env);
    if (path === "/api/support/admin/suggest") return await adminSuggest_(request, env);
    return json_({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    return json_({ ok: false, error: "Something went wrong. Please try again in a moment." }, 500);
  }
}

/* ============================================================
   INBOUND EMAIL  ->  chat thread
   Cloudflare Email Routing sends mail for support@heavysoul.in to the Worker's email() handler,
   which lands here. A customer's reply (ticket id in the subject, sent from the e-mail address on
   file) is added to the ticket as a normal customer message. A copy is always forwarded to
   FORWARD_TO (your Gmail) so nothing is ever lost.
   ============================================================ */
const b2s_ = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
function splitHead_(s) { const m = /\r?\n\r?\n/.exec(s); return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s, ""]; }
function parseHeaders_(h) {
  const o = {};
  h.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach((l) => { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in o)) o[k] = l.slice(i + 1).trim(); } });
  return o;
}
const param_ = (v, name) => { const m = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', "i").exec(v || ""); return m ? (m[1] != null ? m[1] : m[2]) : ""; };
function decodeBody_(body, enc, charset) {
  enc = String(enc || "").toLowerCase(); let bytes;
  try {
    if (enc === "base64") bytes = Uint8Array.from(atob(body.replace(/[^A-Za-z0-9+/=]/g, "")), (c) => c.charCodeAt(0));
    else if (enc === "quoted-printable") bytes = Uint8Array.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0) & 255);
    else bytes = Uint8Array.from(body, (c) => c.charCodeAt(0) & 255);
  } catch (e) { return ""; }
  try { return new TextDecoder(String(charset || "utf-8").toLowerCase()).decode(bytes); } catch (e) { return new TextDecoder().decode(bytes); }
}
function decodeWords_(s) {   // =?UTF-8?B?...?=  and  =?UTF-8?Q?...?=
  return String(s || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, e, t) =>
    e.toLowerCase() === "b" ? decodeBody_(t, "base64", cs) : decodeBody_(t.replace(/_/g, " "), "quoted-printable", cs));
}
function walk_(raw) {
  const [h, b] = splitHead_(raw), hd = parseHeaders_(h), ct = String(hd["content-type"] || "text/plain");
  if (/^attachment/i.test(hd["content-disposition"] || "")) return { plain: "", html: "" };
  if (/^multipart\//i.test(ct)) {
    const bd = param_(ct, "boundary"); if (!bd) return { plain: "", html: "" };
    let plain = "", html = "";
    for (const p of b.split("--" + bd).slice(1)) { if (/^--/.test(p)) break; const r = walk_(p.replace(/^\r?\n/, "")); plain += r.plain; html += r.html; }
    return { plain, html };
  }
  const txt = decodeBody_(b, hd["content-transfer-encoding"], param_(ct, "charset"));
  if (/^text\/plain/i.test(ct)) return { plain: txt, html: "" };
  if (/^text\/html/i.test(ct)) return { plain: "", html: txt };
  return { plain: "", html: "" };
}
function htmlToText_(html) {
  return String(html || "").replace(/<(style|script|blockquote)[\s\S]*?<\/\1>/gi, "").replace(/<div class="gmail_quote"[\s\S]*$/i, "").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
// keep only what the customer just wrote: cut at "On ... wrote:", "Original Message", quoted ">" lines, our own e-mail text
function stripQuoted_(text) {
  let t = "\n" + String(text || "").replace(/\r\n?/g, "\n");
  const cuts = [/\n\s*On\s[\s\S]{3,300}?wrote:\s*\n/i, /\n\s*-{2,}\s*Original Message\s*-{2,}/i, /\n\s*_{5,}\s*\n/, /\n\s*From:\s.+\n\s*Sent:/i, /\n\s*>/, /\n[^\n]*support\.html\?ticket=/i, /\n\s*(?:Hi|Hello)\s+[^\n]{0,40},\s*\n+\s*[^\n]*\n*\s*You can continue the conversation/i];
  let cut = t.length;
  for (const re of cuts) { const m = re.exec(t); if (m && m.index < cut) cut = m.index; }
  return t.slice(0, cut).replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
}

export async function handleInboundEmail(message, env, ctx) {
  const fwd = String(env.FORWARD_TO || "").trim();
  const forwardCopy = async () => { if (fwd) { try { await message.forward(fwd); } catch (e) {} } };
  try {
    if (!(message.rawSize <= 1500000)) return await forwardCopy();
    const raw = b2s_(new Uint8Array(await new Response(message.raw).arrayBuffer()));
    const hd = parseHeaders_(splitHead_(raw)[0]);
    const auto = /auto|bulk|junk|list/i.test(hd["precedence"] || "") || (hd["auto-submitted"] && !/^no$/i.test(hd["auto-submitted"])) || hd["x-autoreply"] || hd["x-autorespond"];
    const fromHdr = decodeWords_(hd["from"] || ""), fm = /<([^>]+)>/.exec(fromHdr);
    const sender = String(fm ? fm[1] : (fromHdr || message.from || "")).trim().toLowerCase();
    const subject = decodeWords_(hd["subject"] || "");
    const parsed = walk_(raw), full = parsed.plain || htmlToText_(parsed.html);
    const idm = /HST-[A-Z0-9]{6}/i.exec(subject) || /HST-[A-Z0-9]{6}/i.exec(full);
    if (auto || !idm || /@(?:[a-z0-9-]+\.)*heavysoul\.in$/.test(sender)) return await forwardCopy();

    const id = idm[0].toUpperCase(), t = await getTicket_(env, id);
    if (!t) return await forwardCopy();
    const onFile = String(await emailFor_(env, t)).toLowerCase();
    if (!onFile || onFile !== sender) return await forwardCopy();        // only the person who owns the ticket can reply by e-mail

    const body = stripQuoted_(full);
    if (!body) return await forwardCopy();

    if (t.status === "closed") {                                         // closed chats stay closed: point them to a new chat
      const first = String(t.name || "").trim().split(/\s+/)[0] || "there", link = `${siteUrl_(env)}/support.html`;
      const paras = [`Hi ${first},`, `Your chat ${t.ticketId} is closed, so we couldn't add your message to it. Please start a new chat and we'll pick it up right away.`];
      await sendMail_(env, sender, threadSubject_(t.ticketId), paras.join("\n\n") + "\n\n" + link, mailHtml_("Please start a new chat", paras, link, "Start a new chat"), t.ticketId);
      return await forwardCopy();
    }
    if ((t.messages || []).length >= MAX_MSGS) return await forwardCopy();

    const at = now_();
    await mutate_(env, id, (x) => {
      x.messages.push({ from: "customer", text: body, at, viaEmail: true });
      x.messages.push({ from: "system", internal: true, text: "✉ Customer replied by email (shown above as their message)", at });
      x.updatedAt = at; x.lastFrom = "customer";
      if (x.status === "resolved" || x.status === "waiting_customer") x.status = "open";
      x.mode = "human"; x.needsHuman = true;
    });
    await notify_(env, ctx, `📧 Email reply on ticket ${id} from ${t.name || "customer"}:\n${body.slice(0, 300)}`).catch(() => {});
    return await forwardCopy();
  } catch (e) {
    return await forwardCopy();
  }
}
