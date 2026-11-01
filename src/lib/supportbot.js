// ============================================================
// HEAVY SOUL — support assistant "Soul" (rule-based, no external AI).
// Pure functions only, so it can be unit-tested in Node.
//   detectIntent(text)  -> { intent, orderId }
//   composeReply(intent, ctx) -> { text, chips, escalate, awaiting }
// Every fact below comes from policy.html / js/config.js. If a policy
// changes, change the text here too.
// ============================================================

export const BOT_NAME = "Soul";
export const ORDER_ID_RE = /\bHS-?\d{8}-?\d{2,4}\b/i;

const CHIPS_HOME = ["Where is my order?", "Delivery time", "COD & payment", "Exchange / size", "Cancel my order", "Talk to a human"];

// normalise: lower-case, strip punctuation, squash repeats ("heyyy" -> "heyy")
export function norm(t) {
  return " " + String(t || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9₹\- ]+/g, " ").replace(/(.)\1{2,}/g, "$1$1").replace(/\s+/g, " ").trim() + " ";
}

// Order matters: first match wins. Hinglish / Bangla-in-English-letters included.
const RULES = [
  ["human",       /\b(human|real person|agent|executive|representative|customer care|support team|someone|insaan|manush|talk to (a |an )?(person|human|agent|someone)|speak (to|with)|call me|connect me)\b/],
  ["not_received",/(not (yet )?(received|delivered|got|come)|didnt (get|receive)|delivered but|shows? delivered|marked delivered|lost|missing parcel|nahi mila|paini|pai ni|ashe ni|asheni)/],
  ["damaged",     /(damag|torn|tear|defect|stain|hole|faded|misprint|wrong (item|product|print|colou?r|design)|not as (shown|described|expected)|quality (issue|problem)|kharab|nosto)/],
  ["payment",     /(payment (failed|fail|stuck|pending|issue|problem|not)|money (got )?(deducted|cut|debited)|amount (deducted|debited)|paisa (kat|cut)|taka kete|upi (failed|issue|pending)|utr|transaction (id|failed)|double (charge|payment)|charged twice)/],
  ["refund",      /(refund|money back|paisa (wapas|vapas)|taka ferot|return my money|refund kab|refund kobe)/],
  ["cancel",      /(cancel|cancellation|dont want (it|this|the order)|order (cancel|band)|batil|bhul order)/],
  ["address",     /(change (my )?(the )?(delivery )?address|wrong address|address (change|galat|bhul|update)|pincode|pin code|different address|ṭhikana|thikana)/],
  ["size",        /(size|exchange|too (small|big|tight|loose|large)|fit|chest|measurement|xl|xxl|\bm\b size|chhoto|boro hoye)/],
  ["return",      /(return|replace|replacement|swap|wapas karna|ferot dite)/],
  ["order_status",/(where.*(order|parcel|package|shipment)|order status|track|tracking|kothay|kaha hai|kidhar|status of|my order|parcel|awb|courier|delhivery|out for delivery|shipped|dispatch(ed)? hua|pathiyechhe|pathaiche)/],
  ["delay",       /(delay|late|still not|so long|abhi tak|ekhono|ekhono ashe|why (is it )?taking|taking too)/],
  ["delivery_time",/(how (long|many days)|delivery time|deliver in|days to (deliver|arrive)|when.*(arrive|deliver|reach|come|get)|kab (tak )?(aayega|milega|aaega)|kitne din|kobe (ashbe|pabo)|koto din|dispatch time|processing time|shipping time|ready in)/],
  ["shipping_charge",/(shipping (charge|cost|fee|free)|free (shipping|delivery)|delivery (charge|cost|fee)|postage|courier (charge|cost)|₹ ?699|699 ?(rs|rupees|inr))/],
  ["cod",         /(\bcod\b|cash on delivery|pay (on|at) delivery|advance|handling (charge|fee)|cash payment|partial payment)/],
  ["custom",      /(custom|customi[sz]e|my own design|print my|personali[sz]e|bulk|wholesale|resell|team order|group order|college order)/],
  ["care",        /(wash|care|shrink|fabric|gsm|cotton|material|iron|fade|bleach)/],
  ["discount",    /(coupon|discount|promo|offer|sale|voucher|code|cashback)/],
  ["account",     /(login|log in|sign ?in|sign ?up|register|otp|password|account|forgot)/],
  ["invoice",     /(invoice|bill|gst|receipt)/],
  ["contact",     /(contact|phone number|call|email|mail id|whatsapp|office|address of (the )?(shop|store)|business hours|working hours|open (time|hours)|when (are )?you (open|available))/],
  ["thanks",      /\b(thanks?|thank you|thx|ty|dhanyavad|shukriya|dhonnobad|great|perfect|awesome|got it|understood|ok(ay)? (thanks|thank you))\b/],
  ["bye",         /\b(bye|goodbye|see you|that.?s all|nothing else|no more|done)\b/],
  ["greeting",    /^ *(hi+|hello+|hey+|hii+|helo|namaste|namaskar|good (morning|afternoon|evening)|yo|hola|sup|kemon acho|kya haal|start|menu|help) *$/]
];

export function detectIntent(text) {
  const idm = String(text || "").match(ORDER_ID_RE);
  const orderId = idm ? normaliseOrderId(idm[0]) : "";
  const t = norm(idm ? String(text).replace(ORDER_ID_RE, " ") : text);   // digits inside an order id must not trigger other rules
  for (const [intent, re] of RULES) if (re.test(t)) return { intent, orderId };
  if (orderId) return { intent: "order_status", orderId };   // a bare order id = "where is it?"
  return { intent: "unknown", orderId };
}

export function normaliseOrderId(raw) {
  const m = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^HS(\d{8})(\d{2,4})$/);
  return m ? `HS-${m[1]}-${m[2]}` : String(raw).toUpperCase();
}

const WA_NOTE = "";
const HUMAN = (extra) => ({ text: (extra ? extra + "\n\n" : "") + "I'm passing this to our support team. They'll reply right here in this chat. We're a small handmade brand, so it can take a little while: usually within 24 hours on business days. You can close this page and come back any time with your Chat ID (shown at the top), and your messages will be waiting.", chips: [], escalate: true });

// ctx: { name, orderId, order (result of an order lookup or null), fails }
export function composeReply(intent, ctx = {}) {
  const first = String(ctx.name || "").trim().split(/\s+/)[0] || "";
  switch (intent) {
    case "greeting":
      return { text: `Hi${first ? " " + first : ""}! I'm ${BOT_NAME}, Heavy Soul's assistant. I can check your order, explain shipping, COD and exchanges, or connect you to our team. What do you need?`, chips: CHIPS_HOME };

    case "thanks":
      return { text: "Happy to help! Anything else I can do?", chips: ["Where is my order?", "Talk to a human", "No, that's all"] };

    case "bye":
      return { text: "Take care, and thank you for choosing Heavy Soul. If you need anything later, just open this chat again.", chips: [], done: true };

    case "human":
      return HUMAN("Sure, let me get a person for you.");

    case "order_status": {
      const o = ctx.order;
      if (o && o.found) {
        const st = String(o.status || "Confirmed"), low = st.toLowerCase();
        const last = o.history && o.history.length ? o.history[o.history.length - 1] : null;
        const lines = [`${first ? first + ", here" : "Here"}'s your order **${o.orderId}**:`, `**Status:** ${st}`];
        if (/delivered/.test(low) && !/out for/.test(low)) {
          lines.push("**Delivered.** I hope you love it!" + (last && last.time ? ` (${last.time})` : ""));
        } else if (/cancel/.test(low)) {
          lines.push("This order was **cancelled**. If you paid, the refund status is on its tracking page.");
        } else {
          let where = "";
          if (last) where = `${last.status}${last.location ? " at " + last.location : ""}${last.time ? " (" + last.time + ")" : ""}`;
          else if (/confirm|process|placed|pending|making|packed/.test(low)) where = "Being handmade for you at our studio. It hasn't left us yet.";
          if (where) lines.push(`**Where it is now:** ${where}`);
          if (/out for delivery/.test(low)) lines.push("**Arriving:** today. Please keep your phone handy for the courier's call.");
          else if (o.estimatedDelivery) lines.push(`**Expected delivery:** ${fmtDate(o.estimatedDelivery)}${o.eddIsEstimate ? " (approximate, it firms up once the courier scans the parcel)" : ""}`);
          else lines.push("**Expected delivery:** dispatch takes 2–3 business days, then usually about 7 days to reach you.");
        }
        if (o.awb && !/cancel/.test(low)) lines.push(`**Courier:** ${o.courierServiceName || "Delhivery"} · tracking no. ${o.awb}`);
        if (ctx.late) {
          lines.push("I'm sorry, this is **past its expected date**. I've flagged it to our team as a delivery ticket so they can chase the courier. They'll reply right here, usually within 24 hours on business days.");
          return { text: lines.join("\n"), chips: [], escalate: true, link: { label: "Open live tracking", href: "track.html?order=" + encodeURIComponent(o.orderId) } };
        }
        return { text: lines.join("\n"), chips: ["Delivery time", "Cancel my order", "Talk to a human"], link: { label: "Open live tracking", href: "track.html?order=" + encodeURIComponent(o.orderId) } };
      }
      if (o && o.found === false) return { text: `I couldn't find an order with the ID ${o.orderId}. Please check it (it looks like HS-20261022-448) and send it again, or I can get a person to look into it.`, chips: [...(ctx.recent || []), "Talk to a human"].slice(0, 5), awaiting: "orderId" };
      if (ctx.recent && ctx.recent.length) return { text: "Sure! Which order should I check? Tap one of your recent orders, or type another Order ID.", chips: [...ctx.recent, "Talk to a human"], awaiting: "orderId" };
      return { text: "Sure, I can check that. Please type your **Order ID** (it looks like HS-20261022-448). You'll find it on WhatsApp right after checkout and in My orders.", chips: ["Open My orders"], awaiting: "orderId" };
    }

    case "delivery_time":
      return { text: "Every piece is handmade after you order, so please allow **2–3 business days** for dispatch (no dispatch on Sundays or public holidays). Once dispatched, it usually reaches you within **7 days**, depending on your location. Remote areas can take a little longer, and courier delays of 1–2 days happen.", chips: ["Where is my order?", "Shipping charges", "Talk to a human"] };

    case "delay":
      return { text: "Sorry about the wait. Orders are handmade and take 2–3 business days to dispatch, then about 7 days in transit, and courier delays of 1–2 days can add to that. If you send me your Order ID I'll check where it is right now.", chips: ["Where is my order?", "Talk to a human"], awaiting: "orderId" };

    case "shipping_charge":
      return { text: "Shipping is **free on orders above ₹699**. Below that there's a flat shipping charge, shown clearly at checkout before you pay. Offers can change during sales.", chips: ["Delivery time", "COD & payment"] };

    case "cod":
      return { text: "You can **pay in full** via UPI, or choose **Cash on Delivery**: pay a small advance via UPI to confirm the order (₹150 per piece on ready-stock items, 50% of the item price on custom orders) and the rest in cash when it's delivered. A COD handling charge (₹50 per item) is added. The exact amounts are shown at checkout. COD orders are dispatched only after the advance is confirmed.", chips: ["Payment problem", "Delivery time", "Talk to a human"] };

    case "payment":
      return HUMAN("Sorry about the payment trouble. Please type your registered mobile number, the amount, and the UPI transaction ID (UTR) or Razorpay payment ID, and attach a screenshot with the paperclip if you have one.");

    case "refund":
      return { text: "If a paid order was cancelled, the refund status appears on your order's tracking page (track.html), live from the payment gateway. Refunds are issued by our team and the bank then takes its own time to credit. Tell me your Order ID and I'll pass the details to our team if the refund hasn't shown up.", chips: ["Where is my order?", "Talk to a human"], awaiting: "orderId" };

    case "cancel":
      return { text: "Because each piece is handmade for you, an order can be **cancelled only before it is dispatched**. If your order is still eligible, you'll see a **Cancel order** button with a countdown on its tracking page (track.html). Once dispatched it can't be cancelled and no refund is issued. If you don't see the button but think it's too early, I can ask our team to check.", chips: ["Open tracking page", "Talk to a human"] };

    case "size":
      return { text: "To **change a size**, tell us within **24 hours of placing the order**, before we start making your piece. We'll update it for you. If **we** sent the wrong size, we'll exchange it free of cost: message us within **7 days of delivery** with your Order ID and a couple of photos (you can attach them here with the paperclip). We can't do exchanges for change of mind or size preference once production has begun.", chips: ["I need to change my size", "Wrong size was sent", "Talk to a human"] };

    case "return":
      return { text: "Every t-shirt is handmade specifically for you, so we can't accept returns or exchanges for change of mind or size preference once production has begun. The exception is a mistake on our side (for example, the wrong size sent), which we exchange free of cost. Is that your situation?", chips: ["Wrong size was sent", "Damaged item", "Talk to a human"] };

    case "damaged":
      return HUMAN("I'm really sorry about that. Please attach clear photos of the item (and the parcel label if you can) with the paperclip, and type your Order ID so our team can sort it out.");

    case "not_received":
      return HUMAN("I'm sorry your parcel hasn't reached you. Please type your Order ID and I'll flag it for our team.");

    case "address":
      return { text: "Please make sure the address is right before dispatch: we can't take responsibility if a parcel fails because of an incorrect address. If your order hasn't been dispatched yet, our team may still be able to fix it. Type your Order ID and the corrected address and I'll pass it on right away.", chips: ["Talk to a human"], escalate: true, quietEscalate: true };

    case "custom":
      return HUMAN("Custom designs and bulk or team orders are handled by our team directly. Tell us what you have in mind (design, quantity, deadline) and attach any reference images with the paperclip.");

    case "care":
      return { text: "Our tees are heavyweight cotton (around 240 GSM on the signature drop-shoulder tee), garment-washed for a broken-in feel. A tip to keep prints fresh: wash inside-out in cold water and avoid bleach. For a specific product's fabric details, check its page or ask me about it and I'll connect you to our team.", chips: ["Delivery time", "Talk to a human"] };

    case "discount":
      return { text: "Any live offers or coupon codes are shown on the site and at checkout. I don't have a list of codes to share here, but our team can tell you if something is running. Want me to ask them?", chips: ["Talk to a human", "No, thanks"] };

    case "account":
      return { text: "You can log in with your **email or mobile number**. On the Login / Signup page choose OTP or password. If you forgot your password, use **Forgot password** there: it sends a reset link to your email, or an OTP to your mobile. If something still fails, I'll pass it to our team.", chips: ["Open Login page", "Talk to a human"] };

    case "invoice":
      return { text: "For an invoice or bill copy, please type your Order ID and any details you need on it (name, GST number if any), and our team will help.", chips: ["Talk to a human"], escalate: true, quietEscalate: true };

    case "contact":
      return { text: "You're already in the right place. Our team replies in this chat, usually within **24 hours on business days**. You can also email tukaisana88@gmail.com or message us on WhatsApp.", chips: ["Talk to a human", "Where is my order?"] };

    default: {
      const fails = (ctx.fails || 0) + 1;
      if (fails >= 2) return HUMAN("I'm sorry, I'm still not sure I understood.");
      return { text: "Sorry, I didn't quite get that. Could you say it a different way, or pick one of these?", chips: CHIPS_HOME, fail: true };
    }
  }
}

// Chip labels that should map to a particular intent regardless of wording.
export const CHIP_INTENTS = {
  "where is my order?": "order_status", "delivery time": "delivery_time", "cod & payment": "cod", "exchange / size": "size",
  "cancel my order": "cancel", "talk to a human": "human", "shipping charges": "shipping_charge", "payment problem": "payment",
  "wrong size was sent": "damaged", "damaged item": "damaged", "i need to change my size": "size", "no, thats all": "bye", "no, that's all": "bye", "no, thanks": "bye"
};

function fmtDate(raw) {
  const d = new Date(raw); if (isNaN(d)) return String(raw);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
