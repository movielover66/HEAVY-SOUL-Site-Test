// ============================================================
// HEAVY SOUL — FIRESTORE: saved address + order history
// Loaded after config.js + auth.js (needs firebase app + auth
// already initialized) and the firebase-firestore-compat.js SDK.
// Safe no-ops if Firestore SDK isn't loaded on a given page.
// ============================================================

function firestoreReady() {
  return window.firebase && firebase.apps.length > 0 && typeof firebase.firestore === "function";
}

// ---- Wait for Firebase Auth to finish restoring the session (runs async
// on page load), instead of trusting currentUser to already be set. ----
function currentUserAsync() {
  return new Promise((resolve) => {
    if (!firestoreReady()) { resolve(null); return; }
    const unsub = firebase.auth().onAuthStateChanged((user) => {
      unsub();
      resolve(user);
    });
  });
}

// ---- Save the logged-in user's shipping address (called from checkout.js) ----
async function saveUserAddress(shippingInfo) {
  if (!firestoreReady()) return;
  const user = await currentUserAsync();
  if (!user) return;
  try {
    await firebase.firestore().collection("users").doc(user.uid).set({
      name: shippingInfo.name || "",
      phone: shippingInfo.phone || "",
      email: shippingInfo.email || "",
      address: shippingInfo.address || "",
      city: shippingInfo.city || "",
      state: shippingInfo.state || "",
      pin: shippingInfo.pin || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error("saveUserAddress failed:", err);
  }
}

// ---- Load the logged-in user's saved address, if any ----
async function loadUserAddress() {
  if (!firestoreReady()) return null;
  const user = await currentUserAsync();
  if (!user) return null;
  try {
    const doc = await firebase.firestore().collection("users").doc(user.uid).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    console.error("loadUserAddress failed:", err);
    return null;
  }
}

// ---- Save an order against the logged-in user (called from payment.js after payment) ----
// IMPORTANT: callers must `await` this before navigating away — otherwise
// the browser can cancel the write mid-flight on redirect.
async function saveOrderRecord(orderPayload) {
  if (!firestoreReady()) return;
  const user = await currentUserAsync();
  if (!user) return; // guest checkout — order still exists in the Sheet, just won't show under "My Orders"
  try {
    await firebase.firestore().collection("orders").doc(orderPayload.orderId).set({
      uid: user.uid,
      orderId: orderPayload.orderId,
      customerName: orderPayload.customerName || "",
      phone: orderPayload.phone || "",
      email: user.email || "",
      items: orderPayload.items || [],
      subtotal: orderPayload.grandTotal || orderPayload.amount || 0,
      amountPaid: orderPayload.amount || 0,
      paymentType: orderPayload.paymentType || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error("saveOrderRecord failed:", err);
  }
}

// ---- Load all past orders for the logged-in user, newest first ----
async function loadUserOrders() {
  if (!firestoreReady()) return [];
  const user = await currentUserAsync();
  if (!user) return [];
  try {
    const snap = await firebase.firestore()
      .collection("orders")
      .where("uid", "==", user.uid)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map(d => d.data());
  } catch (err) {
    console.error("loadUserOrders failed:", err);
    return [];
  }
}
