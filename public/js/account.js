// ============================================================
// HEAVY SOUL — My Account dashboard
// Loaded on account.html after config.js, auth.js, orders.js,
// products.js, toast.js, cart.js and nav.js.
// Login/signup UI (#authBox) is handled by auth-unified.js and is
// untouched; this file only drives the logged-in dashboard (#acctApp).
// ============================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v);

  const STEPS = ["Confirmed", "Packed", "Shipped", "Out for Delivery", "Delivered"];
  const STEP_LABELS = ["Order placed", "Packed", "Shipped", "Out for delivery", "Delivered"];
  const VIP_AT = 3; // matches VIP_ORDER_THRESHOLD in the Orders sheet backend
  const VIEWS = ["overview", "orders", "addresses", "rewards", "profile", "security", "help"];

  const state = { user: null, profile: {}, orders: [], tracking: {}, isVip: false, view: "overview", editingAddrId: null };

  /* ---------------- helpers ---------------- */

  function toast(msg) { if (typeof showToast === "function") showToast(msg); }

  function isSyntheticEmail(email) { return !!email && email.endsWith("@phone.heavysoul.in"); }

  function realEmail() {
    const p = state.profile.email;
    if (p && !isSyntheticEmail(p)) return p;
    const e = state.user && state.user.email;
    return e && !isSyntheticEmail(e) ? e : "";
  }

  function realPhone() { return state.profile.phone ? String(state.profile.phone) : ""; }

  function displayName() {
    return (state.profile.name || (state.user && state.user.displayName) || "").trim();
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "HS";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || ""))).toUpperCase();
  }

  function fmtDate(d) {
    return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  }

  function orderDate(o) {
    return o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
  }

  function orderTotal(o) { return o.subtotal || o.amountPaid || 0; }

  function statusOf(o) {
    const t = state.tracking[o.orderId];
    return t && t.status ? String(t.status) : "";
  }

  function chipFor(status) {
    const s = status.toLowerCase();
    if (s === "delivered") return { cls: "ok", label: "Delivered" };
    if (s === "cancelled") return { cls: "no", label: "Cancelled" };
    if (s === "shipped" || s === "out for delivery") return { cls: "go", label: s === "shipped" ? "In transit" : "Out for delivery" };
    if (s === "packed") return { cls: "wait", label: "Packed" };
    return { cls: "wait", label: "Processing" };
  }

  function isActiveStatus(status) {
    const s = status.toLowerCase();
    return s !== "delivered" && s !== "cancelled";
  }

  /* ---------------- data loading ---------------- */

  async function loadProfile(user) {
    try {
      const doc = await firebase.firestore().collection("users").doc(user.uid).get();
      return doc.exists ? doc.data() : {};
    } catch (err) {
      console.warn("Could not load profile:", err);
      return {};
    }
  }

  async function loadTracking(orders) {
    const url = SITE_CONFIG.APPS_SCRIPT_URL;
    if (!url) return;
    const subset = orders.slice(0, 8);
    await Promise.all(subset.map(async (o) => {
      try {
        const res = await fetch(url + "?orderId=" + encodeURIComponent(o.orderId));
        const data = await res.json();
        if (data && data.found !== false && data.status) state.tracking[o.orderId] = data;
      } catch (err) { /* leave this order without live status */ }
    }));
  }

  async function loadVip() {
    const phone = realPhone();
    const url = SITE_CONFIG.APPS_SCRIPT_URL;
    if (!phone || !url) return;
    try {
      const res = await fetch(url + "?type=vip_status&phone=" + encodeURIComponent(phone));
      const data = await res.json();
      state.isVip = !!(data && data.isVip);
    } catch (err) { /* ignore */ }
  }

  async function boot(user) {
    state.user = user;
    state.profile = await loadProfile(user);
    renderStatic();
    renderAddresses();
    renderOrders();
    const orders = typeof loadUserOrders === "function" ? await loadUserOrders() : [];
    state.orders = orders;
    renderOrders();
    renderRewards();
    await Promise.all([loadTracking(orders), loadVip()]);
    renderOrders();
    renderRewards();
  }

  /* ---------------- render: header/profile/security/help ---------------- */

  function renderStatic() {
    const name = displayName();
    $("greetName").textContent = name ? "Hey, " + name.split(" ")[0] : "Hey there";
    const created = state.user.metadata && state.user.metadata.creationTime ? new Date(state.user.metadata.creationTime) : null;
    const since = created && !isNaN(created) ? created.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "";
    const contact = realEmail() || (realPhone() ? "+91 " + realPhone() : "");
    $("greetSub").textContent = [contact, since ? "Member since " + since : ""].filter(Boolean).join(" · ");
    $("avatar").textContent = initials(name);

    // profile card
    $("pfName").textContent = name || "—";
    $("pfEmail").textContent = realEmail() || "—";
    $("pfMobile").textContent = realPhone() ? "+91 " + realPhone() : "—";
    $("pfBirthday").textContent = state.profile.birthday ? fmtBirthday(state.profile.birthday) : "Not added";

    // security card
    const ids = (state.user.providerData || []).map(p => p.providerId);
    const hasPassword = ids.indexOf("password") !== -1;
    let method = "Email & password";
    if (ids.indexOf("google.com") !== -1 && !hasPassword) method = "Google";
    else if (hasPassword && isSyntheticEmail(state.user.email)) method = "Mobile number & password";
    $("secMethod").textContent = "Sign-in method: " + method;
    $("changePwBtn").hidden = !hasPassword;
    $("secNote").textContent = hasPassword
      ? "Use a password you don't use anywhere else."
      : "You sign in with Google, so your password is managed in your Google account.";

    // help card
    const wa = SITE_CONFIG.WHATSAPP_NUMBER;
    const waBtn = $("helpWa");
    if (wa) {
      waBtn.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent("Hi Heavy Soul, I need help with my account/order.");
      waBtn.hidden = false;
    } else {
      waBtn.hidden = true;
    }
  }

  function fmtBirthday(v) {
    const d = new Date(v + "T00:00:00");
    return isNaN(d) ? v : d.toLocaleDateString("en-IN", { day: "numeric", month: "long" });
  }

  /* ---------------- render: rewards ---------------- */

  function renderRewards() {
    const count = state.orders.length;
    const vip = state.isVip || count >= VIP_AT;
    const left = Math.max(0, VIP_AT - count);
    $("tierName").textContent = (vip ? "VIP" : "Member") + " member";
    $("tierNote").textContent = vip
      ? "You've unlocked VIP status"
      : left + " more order" + (left === 1 ? "" : "s") + " to VIP";
    $("tierBar").style.width = (vip ? 100 : Math.round((count / VIP_AT) * 100)) + "%";
    $("statTier").textContent = vip ? "VIP" : "Member";
  }

  /* ---------------- render: orders / stats / current ---------------- */

  function itemSummary(o) {
    const items = o.items || [];
    if (!items.length) return "Order items";
    const first = items[0];
    const size = first.size && first.size !== "-" ? " · " + first.size : "";
    const more = items.length > 1 ? " +" + (items.length - 1) + " more" : "";
    return esc(first.name) + esc(size) + " × " + (first.qty || 1) + more;
  }

  function thumbFor(o) {
    const first = (o.items || [])[0];
    const img = first && first.image;
    return img ? `<img class="thumb" src="${esc(img)}" alt="">` : `<span class="thumb"></span>`;
  }

  function orderRow(o) {
    const status = statusOf(o);
    const chip = chipFor(status);
    const delivered = status.toLowerCase() === "delivered";
    const action = delivered
      ? `<button class="btn" data-reorder="${esc(o.orderId)}">Reorder</button>`
      : `<a class="btn" href="track.html?order=${encodeURIComponent(o.orderId)}">Details</a>`;
    return `
      <div class="row">
        <span><b>#${esc(o.orderId)}</b><br><span class="mut">${fmtDate(orderDate(o))}</span></span>
        <span class="oi">${thumbFor(o)}<span>${itemSummary(o)}</span></span>
        <span><span class="chip ${chip.cls}">${chip.label}</span></span>
        <span>₹${orderTotal(o)}</span>
        ${action}
      </div>`;
  }

  function renderOrders() {
    const orders = state.orders;
    const empty = `<p class="empty">No orders yet. <a href="shop.html">Start shopping →</a></p>`;
    $("recentList").innerHTML = orders.length ? orders.slice(0, 3).map(orderRow).join("") : empty;
    $("allOrdersList").innerHTML = orders.length ? orders.map(orderRow).join("") : empty;

    // stats
    const inTransit = orders.filter(o => { const s = statusOf(o).toLowerCase(); return s === "shipped" || s === "out for delivery"; }).length;
    const delivered = orders.filter(o => statusOf(o).toLowerCase() === "delivered").length;
    $("statOrders").textContent = orders.length;
    $("statTransit").textContent = inTransit;
    $("statDelivered").textContent = delivered;

    renderCurrent();
  }

  function renderCurrent() {
    const card = $("currentCard");
    const active = state.orders.find(o => { const s = statusOf(o); return s && isActiveStatus(s); });
    if (!active) { card.setAttribute("data-empty", "1"); applyView(); return; }
    card.removeAttribute("data-empty");

    const t = state.tracking[active.orderId];
    const idx = Math.max(0, STEPS.findIndex(s => s.toLowerCase() === String(t.status).toLowerCase()));
    $("curTitle").textContent = "Current order · #" + active.orderId;
    const bits = [];
    if (t.estimatedDelivery) bits.push((t.eddIsEstimate ? "Estimated delivery " : "Delivery by ") + formatEddDate(t.estimatedDelivery));
    if (t.courierServiceName) bits.push("Courier " + t.courierServiceName);
    if (t.awb) bits.push("AWB " + t.awb);
    $("curMeta").textContent = bits.join(" · ") || "We'll update this as your order moves.";
    $("curTrack").href = "track.html?order=" + encodeURIComponent(active.orderId);
    $("curSteps").innerHTML = STEP_LABELS.map((label, i) =>
      `<div class="step ${i <= idx ? "d" : ""}"><i></i>${label}</div>`).join("");
    applyView();
  }

  /* ---------------- render: addresses ---------------- */

  function getAddresses() {
    const list = Array.isArray(state.profile.addresses) ? state.profile.addresses.slice() : [];
    if (!list.length && state.profile.address) {
      list.push({
        id: "legacy",
        name: state.profile.name || "",
        phone: state.profile.phone || "",
        address: state.profile.address,
        city: state.profile.city || "",
        state: state.profile.state || "",
        pin: state.profile.pin || "",
        isDefault: true
      });
    }
    return list;
  }

  function renderAddresses() {
    const list = getAddresses();
    $("addrList").innerHTML = list.length ? list.map(a => `
      <div class="addr">
        ${a.isDefault ? '<span class="tag">Default</span><br>' : ""}
        <b>${esc(a.name)}</b><br>
        ${esc(a.address)}<br>
        ${esc([a.city, a.state].filter(Boolean).join(", "))}${a.pin ? " – " + esc(a.pin) : ""}<br>
        <span class="mut">${a.phone ? "+91 " + esc(a.phone) : ""}</span>
        <div class="btns">
          <button class="btn" data-addr-edit="${esc(a.id)}">Edit</button>
          ${a.isDefault ? "" : `<button class="btn" data-addr-default="${esc(a.id)}">Make default</button>`}
          <button class="btn bad" data-addr-remove="${esc(a.id)}">Remove</button>
        </div>
      </div>`).join("") : `<p class="empty">No saved address yet. Add one to speed up checkout.</p>`;
  }

  async function persistAddresses(list) {
    // Keep exactly one default; mirror it onto the root fields that
    // checkout.js already reads (name/phone/address/city/state/pin).
    if (list.length && !list.some(a => a.isDefault)) list[0].isDefault = true;
    const def = list.find(a => a.isDefault);
    const clean = list.map(a => ({
      id: a.id === "legacy" ? "a" + Date.now() : a.id,
      name: a.name || "", phone: a.phone || "", address: a.address || "",
      city: a.city || "", state: a.state || "", pin: a.pin || "", isDefault: !!a.isDefault
    }));
    const defClean = clean.find(a => a.isDefault);
    const patch = { addresses: clean, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (defClean) {
      Object.assign(patch, { name: defClean.name, phone: defClean.phone, address: defClean.address, city: defClean.city, state: defClean.state, pin: defClean.pin });
    } else {
      Object.assign(patch, { address: "", city: "", state: "", pin: "" });
    }
    await firebase.firestore().collection("users").doc(state.user.uid).set(patch, { merge: true });
    Object.assign(state.profile, patch);
    delete state.profile.updatedAt;
    renderAddresses();
    renderStatic();
  }

  /* ---------------- views ---------------- */

  function applyView() {
    document.querySelectorAll("#acctApp [data-views]").forEach(el => {
      const views = el.dataset.views.split(" ");
      const show = views.indexOf("all") !== -1 || views.indexOf(state.view) !== -1;
      el.hidden = !show || el.hasAttribute("data-empty");
    });
    document.querySelectorAll("#acctApp [data-nav]").forEach(b => {
      if (b.dataset.nav === state.view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  function setView(v) {
    state.view = VIEWS.indexOf(v) !== -1 ? v : "overview";
    if (location.hash.slice(1) !== state.view) history.replaceState(null, "", state.view === "overview" ? location.pathname + location.search : "#" + state.view);
    applyView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- reorder ---------------- */

  function reorder(orderId) {
    const o = state.orders.find(x => x.orderId === orderId);
    if (!o || typeof findProduct !== "function" || typeof addToCart !== "function") return;
    let added = 0;
    (o.items || []).forEach(item => {
      const p = findProduct(item.id) || (typeof PRODUCTS !== "undefined" ? PRODUCTS.find(x => x.name === item.name) : null);
      if (!p) return;
      const size = item.size && item.size !== "-" ? item.size : (p.sizes && p.sizes[0]) || "-";
      if (p.sizes && p.sizes.length && p.sizes.indexOf(size) === -1) return;
      addToCart(p, size, item.qty || 1);
      added++;
    });
    if (added) window.location.href = "cart.html";
    else toast("Those items are no longer available");
  }

  /* ---------------- dialogs ---------------- */

  function openAddress(id) {
    const list = getAddresses();
    const a = id ? list.find(x => String(x.id) === String(id)) : null;
    state.editingAddrId = a ? a.id : null;
    $("addrTitle").textContent = a ? "Edit address" : "Add address";
    $("adName").value = a ? a.name : displayName();
    $("adPhone").value = a ? a.phone : realPhone();
    $("adAddress").value = a ? a.address : "";
    $("adPin").value = a ? a.pin : "";
    $("adCity").value = a ? a.city : "";
    $("adState").value = a ? a.state : "";
    $("adDefault").checked = a ? !!a.isDefault : list.length === 0;
    $("adErr").textContent = "";
    $("addrDialog").showModal();
  }

  let pinTimer;
  function onPinInput() {
    const pin = $("adPin");
    pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    clearTimeout(pinTimer);
    if (pin.value.length !== 6) return;
    pinTimer = setTimeout(async () => {
      try {
        const res = await fetch("https://api.postalpincode.in/pincode/" + pin.value);
        const data = await res.json();
        const po = data && data[0] && data[0].PostOffice && data[0].PostOffice[0];
        if (po) { $("adCity").value = po.District; $("adState").value = po.State; }
      } catch (err) { /* user can type city/state */ }
    }, 400);
  }

  async function saveAddress(e) {
    e.preventDefault();
    const a = {
      id: state.editingAddrId || "a" + Date.now(),
      name: $("adName").value.trim(),
      phone: $("adPhone").value.replace(/\D/g, ""),
      address: $("adAddress").value.trim(),
      pin: $("adPin").value.trim(),
      city: $("adCity").value.trim(),
      state: $("adState").value.trim(),
      isDefault: $("adDefault").checked
    };
    if (a.name.length < 2) { $("adErr").textContent = "Enter the full name."; return; }
    if (!/^[6-9]\d{9}$/.test(a.phone)) { $("adErr").textContent = "Enter a valid 10-digit mobile number."; return; }
    if (a.address.length < 10) { $("adErr").textContent = "Enter the full address (house, street, landmark)."; return; }
    if (!/^\d{6}$/.test(a.pin)) { $("adErr").textContent = "Enter a valid 6-digit PIN code."; return; }
    if (!a.state) { $("adErr").textContent = "State is required."; return; }

    let list = getAddresses();
    if (a.isDefault) list = list.map(x => Object.assign({}, x, { isDefault: false }));
    const i = list.findIndex(x => String(x.id) === String(state.editingAddrId));
    if (i >= 0) list[i] = a; else list.push(a);

    const btn = $("adSave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      await persistAddresses(list);
      $("addrDialog").close();
      toast("Address saved");
    } catch (err) {
      $("adErr").textContent = "Couldn't save. Please try again.";
    } finally {
      btn.disabled = false; btn.textContent = "Save address";
    }
  }

  async function removeAddress(id) {
    if (!confirm("Remove this address?")) return;
    const list = getAddresses().filter(x => String(x.id) !== String(id));
    try { await persistAddresses(list); toast("Address removed"); } catch (err) { toast("Couldn't remove. Try again."); }
  }

  async function makeDefault(id) {
    const list = getAddresses().map(x => Object.assign({}, x, { isDefault: String(x.id) === String(id) }));
    try { await persistAddresses(list); toast("Default address updated"); } catch (err) { toast("Couldn't update. Try again."); }
  }

  function openProfile() {
    $("pdName").value = displayName();
    $("pdBirthday").value = state.profile.birthday || "";
    $("pdErr").textContent = "";
    $("profileDialog").showModal();
  }

  async function saveProfile(e) {
    e.preventDefault();
    const name = $("pdName").value.trim();
    const birthday = $("pdBirthday").value;
    if (name.length < 2) { $("pdErr").textContent = "Enter your name."; return; }
    const btn = $("pdSave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      await state.user.updateProfile({ displayName: name });
      await firebase.firestore().collection("users").doc(state.user.uid).set({ name, birthday }, { merge: true });
      state.profile.name = name; state.profile.birthday = birthday;
      renderStatic();
      $("profileDialog").close();
      toast("Profile updated");
    } catch (err) {
      $("pdErr").textContent = "Couldn't save. Please try again.";
    } finally {
      btn.disabled = false; btn.textContent = "Save";
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    const cur = $("pwCurrent").value, next = $("pwNew").value;
    if (next.length < 6) { $("pwErr").textContent = "New password must be at least 6 characters."; return; }
    if (next === cur) { $("pwErr").textContent = "New password must be different."; return; }
    const btn = $("pwSave"); btn.disabled = true; btn.textContent = "Updating…";
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(state.user.email, cur);
      await state.user.reauthenticateWithCredential(cred);
      await state.user.updatePassword(next);
      $("passwordDialog").close();
      $("pwCurrent").value = ""; $("pwNew").value = "";
      toast("Password changed");
    } catch (err) {
      $("pwErr").textContent = typeof authErrorMessage === "function" ? authErrorMessage(err) : "Couldn't change password.";
    } finally {
      btn.disabled = false; btn.textContent = "Change password";
    }
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    document.querySelectorAll("#acctApp [data-nav]").forEach(b => b.addEventListener("click", () => setView(b.dataset.nav)));
    document.querySelectorAll("#acctApp [data-goto]").forEach(b => b.addEventListener("click", () => setView(b.dataset.goto)));
    $("signOutBtn").addEventListener("click", () => authLogOut());

    $("acctApp").addEventListener("click", (e) => {
      const t = e.target.closest("[data-reorder],[data-addr-edit],[data-addr-default],[data-addr-remove]");
      if (!t) return;
      if (t.dataset.reorder) reorder(t.dataset.reorder);
      else if (t.dataset.addrEdit) openAddress(t.dataset.addrEdit);
      else if (t.dataset.addrDefault) makeDefault(t.dataset.addrDefault);
      else if (t.dataset.addrRemove) removeAddress(t.dataset.addrRemove);
    });

    $("addAddrBtn").addEventListener("click", () => openAddress(null));
    $("addrForm").addEventListener("submit", saveAddress);
    $("adCancel").addEventListener("click", () => $("addrDialog").close());
    $("adPin").addEventListener("input", onPinInput);

    $("editProfileBtn").addEventListener("click", openProfile);
    $("profileForm").addEventListener("submit", saveProfile);
    $("pdCancel").addEventListener("click", () => $("profileDialog").close());

    $("changePwBtn").addEventListener("click", () => { $("pwErr").textContent = ""; $("passwordDialog").showModal(); });
    $("passwordForm").addEventListener("submit", savePassword);
    $("pwCancel").addEventListener("click", () => $("passwordDialog").close());

    window.addEventListener("hashchange", () => { state.view = VIEWS.indexOf(location.hash.slice(1)) !== -1 ? location.hash.slice(1) : "overview"; applyView(); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const authBox = $("authBox");
    const app = $("acctApp");

    if (typeof authReady !== "function" || !authReady()) {
      authBox.style.display = "block";
      return;
    }

    wire();
    const h = location.hash.slice(1);
    if (VIEWS.indexOf(h) !== -1) state.view = h;

    firebase.auth().onAuthStateChanged(function (user) {
      document.body.classList.toggle("is-acct", !!user);
      authBox.style.display = user ? "none" : "block";
      app.hidden = !user;
      if (user) { applyView(); boot(user); }
    });
  });
})();
