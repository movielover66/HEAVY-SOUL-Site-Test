// Cart storage + rendering. Loaded on every page so addToCart() is always available.
let cart = JSON.parse(localStorage.getItem("cart")) || [];

function saveCart(){
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartCount();
}

function addToCart(product, size, qty){
  qty = qty || 1;
  const existing = cart.find(item => item.id === product.id && item.size === size);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      compareAt: product.compareAt || 0,
      image: product.image,
      category: product.category,
      orderType: product.orderType || "collection",
      sku: product.sku || "",
      size: size || "-",
      qty: qty
    });
  }
  saveCart();
  if (typeof showToast === "function") showToast("Added to bag");
  if (typeof trackEvent === "function") {
    trackEvent("AddToCart", { item_name: product.name, value: product.price, currency: "INR" });
  }
}

function changeQty(id, size, delta){
  const item = cart.find(i => i.id === id && i.size === size);
  if (!item) return;
  item.qty = (item.qty || 1) + delta;
  if (item.qty < 1) {
    cart = cart.filter(i => !(i.id === id && i.size === size));
  }
  saveCart();
  renderCartPage();
}

function removeItem(id, size){
  cart = cart.filter(item => !(item.id === id && item.size === size));
  saveCart();
  renderCartPage();
  if (typeof showToast === "function") showToast("Removed from bag");
}

function renderCartPage(){
  const container = document.getElementById("cartItems");
  if (!container) return;

  const empty = document.getElementById("cartEmpty");
  const layout = document.getElementById("cartLayout");
  const sticky = document.getElementById("cvSticky");
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  if (cart.length === 0) {
    if (layout) layout.classList.add("hidden");
    if (empty) empty.classList.remove("hidden");
    if (sticky) sticky.classList.add("hidden");
    setText("cartCountLabel", "0 PIECES");
    return;
  }
  if (layout) layout.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");
  if (sticky) sticky.classList.remove("hidden");

  const TRUCK = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2zM13 10h5l3 3v3h-8"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>';
  const BIN = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

  let subtotal = 0, mrp = 0, pieces = 0;

  container.innerHTML = cart.map((item, i) => {
    const qty = item.qty || 1;
    const lineTotal = item.price * qty;
    // "was" price: saved with the item, or looked up from the catalog for older bags
    let cmp = Number(item.compareAt) || 0;
    if (!cmp && typeof PRODUCTS !== "undefined") {
      const p = PRODUCTS.find(x => String(x.id) === String(item.id));
      if (p && p.compareAt) cmp = Number(p.compareAt) || 0;
    }
    if (cmp <= item.price) cmp = 0;
    subtotal += lineTotal;
    mrp += (cmp || item.price) * qty;
    pieces += qty;
    const pct = cmp ? Math.round((cmp - item.price) / cmp * 100) : 0;

    return `
      <div class="cv-card" style="animation-delay:${0.15 + i * 0.12}s">
        <div class="cv-img"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"></div>
        <div class="cv-info">
          <div class="cv-top">
            <div>
              <h3 class="cv-name">${escapeHtml(item.name)}</h3>
              <div class="cv-tags">
                <span class="cv-size">SIZE ${escapeHtml(item.size || "-")}</span>
                ${item.orderType === "custom" ? '<span class="cv-fd">MADE TO ORDER</span>' : ""}
                <span class="cv-fd">${TRUCK}FREE DELIVERY</span>
              </div>
            </div>
            <div class="cv-price">
              <b>₹${lineTotal}</b>
              ${pct ? `<div class="cv-was"><s>₹${cmp * qty}</s><span class="cv-off">${pct}% off</span></div>` : ""}
            </div>
          </div>
          <div class="cv-bot">
            <div class="cv-qty">
              <button onclick="changeQty(${item.id}, '${item.size}', -1)" aria-label="Decrease quantity">−</button>
              <span>${qty}</span>
              <button onclick="changeQty(${item.id}, '${item.size}', 1)" aria-label="Increase quantity">+</button>
            </div>
            <button class="cv-rm" onclick="removeItem(${item.id}, '${item.size}')" aria-label="Remove ${escapeHtml(item.name)}">${BIN}<span>REMOVE</span></button>
          </div>
        </div>
      </div>`;
  }).join("");

  const saved = mrp - subtotal;
  setText("cartCountLabel", pieces + (pieces === 1 ? " PIECE" : " PIECES"));
  setText("cartMrpLabel", "Price (" + pieces + (pieces === 1 ? " item)" : " items)"));
  setText("cartMrp", "₹" + mrp);
  setText("cartTotal", "₹" + subtotal);
  setText("cartTotal2", "₹" + subtotal);
  const dRow = document.getElementById("cartDiscRow"), sBox = document.getElementById("cartSaveBox");
  if (dRow) dRow.classList.toggle("hidden", saved <= 0);
  if (sBox) sBox.classList.toggle("hidden", saved <= 0);
  setText("cartDiscount", "−₹" + saved);
  setText("cartSaveAmt", "₹" + saved);
}

renderCartPage();
