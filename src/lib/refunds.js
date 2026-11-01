// ============================================================
// HEAVY SOUL — live refund status (read-only)
//   GET /api/refund-status?orderId=HSxxxx
//
// Looks the order up in Razorpay by its receipt (= our order id),
// finds the captured payment(s), then lists every refund on them.
// Nothing here moves money — it only READS from the gateway, so the
// customer always sees what Razorpay itself says right now.
//
// Razorpay refund statuses: pending -> processed (or failed).
//   normal refunds reach the customer in ~5-7 working days after they
//   are created; instant refunds usually within minutes (up to a day).
//   Razorpay does not report the exact moment the bank credits the
//   money, so the "expected by" dates are estimates.
// ============================================================

const RZP = "https://api.razorpay.com/v1";
const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;

function json_(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}

// Add N working days (Mon-Fri; bank holidays are not known, hence "estimate").
function addWorkingDays_(date, n) {
  const d = new Date(date.getTime());
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n--;
  }
  return d;
}

export function mapRefund_(r, payment) {
  const created = new Date((r.created_at || 0) * 1000);
  const speed = r.speed_processed || r.speed_requested || "normal";
  const instant = speed === "instant";
  const from = instant ? created : addWorkingDays_(created, 5);
  const by = instant ? new Date(created.getTime() + 24 * 3600 * 1000) : addWorkingDays_(created, 7);
  const id = String(r.id || "");
  return {
    ref: id ? "rfnd_••" + id.slice(-4) : "",
    amount: (r.amount || 0) / 100,
    status: r.status === "processed" ? "processed" : r.status === "failed" ? "failed" : "pending",
    speed: instant ? "instant" : "normal",
    method: payment.method || "",
    createdAt: created.toISOString(),
    expectedFrom: from.toISOString(),
    expectedBy: by.toISOString(),
    arn: (r.acquirer_data && r.acquirer_data.arn) ? String(r.acquirer_data.arn) : ""
  };
}

export async function handleRefundStatus(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const orderId = (url.searchParams.get("orderId") || "").trim();
    if (!ID_RE.test(orderId)) return json_({ ok: false, error: "Invalid order ID" }, 400);
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return json_({ ok: false, error: "Refund status is not available right now." }, 500);
    }

    // 20-second edge cache so a busy page can't hammer the Razorpay API
    const cache = (typeof caches !== "undefined") ? caches.default : null;
    const cacheKey = new Request(url.origin + "/api/refund-status?orderId=" + encodeURIComponent(orderId));
    if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }

    const auth = "Basic " + btoa((await env.RAZORPAY_KEY_ID.get()) + ":" + (await env.RAZORPAY_KEY_SECRET.get()));
    const rz = async (path) => {
      const r = await fetch(RZP + path, { headers: { Authorization: auth } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j && j.error && j.error.description) || ("Razorpay " + r.status));
      return j;
    };

    const orders = await rz("/orders?receipt=" + encodeURIComponent(orderId) + "&count=10");
    const paidOrders = (orders.items || []).filter(o => (o.amount_paid || 0) > 0 || o.status === "paid");

    let paid = 0;
    const refunds = [];
    for (const o of paidOrders) {
      const pays = await rz("/orders/" + encodeURIComponent(o.id) + "/payments");
      for (const p of (pays.items || [])) {
        if (p.status !== "captured" && p.status !== "refunded") continue;
        paid += (p.amount || 0) / 100;
        const rf = await rz("/payments/" + encodeURIComponent(p.id) + "/refunds?count=20");
        for (const r of (rf.items || [])) refunds.push(mapRefund_(r, p));
      }
    }
    refunds.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const sum = (st) => refunds.filter(r => r.status === st).reduce((a, r) => a + r.amount, 0);
    const body = {
      ok: true, orderId, found: paid > 0, currency: "INR",
      paidAmount: paid,
      refundedAmount: sum("processed"), pendingAmount: sum("pending"), failedAmount: sum("failed"),
      refunds, checkedAt: new Date().toISOString()
    };
    const res = json_(body, 200, { "Cache-Control": "public, max-age=20" });
    if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return json_({ ok: false, error: "Couldn't reach the payment gateway right now. Please try again in a moment." }, 502);
  }
}
