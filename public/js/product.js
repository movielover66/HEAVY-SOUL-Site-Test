const productId = new URLSearchParams(window.location.search).get("id");

let renderedStockSig = null;
function stockSig_(p){ return JSON.stringify((p && p.stock) || null); }

function sizeQty_(product, size){
  if (!product.stock) return Infinity; // stock not tracked for this product
  const q = product.stock[size];
  return q === undefined ? 0 : Number(q);
}
function isSoldOut_(product){
  return !!product.stock && product.sizes.every(s => sizeQty_(product, s) <= 0);
}

function renderProductPage_(){
  const product = findProduct(productId);

  if (!product) {
    document.getElementById("pdRoot").innerHTML = `
      <div class="empty-state">
        <h2>Product not found</h2>
        <p>This item may have been removed or the link is incorrect.</p>
        <a class="btn" href="shop.html">Back to shop</a>
      </div>`;
    return false;
  }

  renderedStockSig = stockSig_(product);
  sessionStorage.removeItem("hs_stock_reload");
  document.title = `${product.name} — Heavy Soul`;

  document.getElementById("pdCrumb").innerHTML =
    `<a href="index.html">Home</a> / <a href="shop.html">Shop</a> / <a href="shop.html?category=${encodeURIComponent(product.category)}">${escapeHtml(product.category)}</a> / ${escapeHtml(product.name)}`;

  document.getElementById("pdCat").textContent = product.category;
  document.getElementById("pdTitle").textContent = product.name;
  document.getElementById("pdPrice").textContent = "₹" + product.price + (product.compareAt ? ` · was ₹${product.compareAt}` : "");
  document.getElementById("pdDesc").textContent = product.description;

  if (product.badge) {
    document.getElementById("pdBadge").innerHTML = `<span class="tag ${product.orderType === "custom" ? "accent" : ""}">${escapeHtml(product.badge)}</span>`;
  }

  // Gallery
  const mainImg = document.getElementById("pdMainImg");
  mainImg.src = product.image;
  mainImg.alt = product.name;
  document.getElementById("pdThumbs").innerHTML = product.images.map((src, i) => `
    <img src="${escapeHtml(src)}" class="${i === 0 ? "active" : ""}" data-src="${escapeHtml(src)}" alt="${escapeHtml(product.name)} view ${i+1}">
  `).join("");
  document.getElementById("pdThumbs").addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (!img) return;
    mainImg.src = img.dataset.src;
    document.querySelectorAll("#pdThumbs img").forEach(t => t.classList.toggle("active", t === img));
  });

  // Sizes (sold-out sizes are disabled)
  const soldOut = isSoldOut_(product);
  let selectedSize = null;
  let qty = 1;
  const qtyLabel = document.getElementById("pdQty");
  const maxQty_ = () => Math.min(10, selectedSize ? sizeQty_(product, selectedSize) : 10);

  const sizesEl = document.getElementById("pdSizes");
  sizesEl.innerHTML = product.sizes.map(s => {
    const out = sizeQty_(product, s) <= 0;
    return `<button class="size-btn${out ? " sold-out" : ""}" data-size="${s}" ${out ? 'disabled title="Sold out"' : ""}>${s}</button>`;
  }).join("");
  sizesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".size-btn");
    if (!btn || btn.disabled) return;
    selectedSize = btn.dataset.size;
    document.querySelectorAll(".size-btn").forEach(b => b.classList.toggle("active", b === btn));
    qty = Math.min(qty, maxQty_());
    qtyLabel.textContent = qty;
  });
  if (product.sizes.length === 1 && !soldOut) {
    selectedSize = product.sizes[0];
    document.querySelector(".size-btn").classList.add("active");
  }

  // Qty
  document.getElementById("qtyMinus").addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    qtyLabel.textContent = qty;
  });
  document.getElementById("qtyPlus").addEventListener("click", () => {
    if (qty >= maxQty_()) { showToast("No more stock for this size"); return; }
    qty = qty + 1;
    qtyLabel.textContent = qty;
  });

  const addBtn = document.getElementById("addToCartBtn");
  const buyBtn = document.getElementById("buyNowBtn");

  addBtn.addEventListener("click", () => {
    if (!selectedSize) { showToast("Please select a size"); return; }
    addToCart(product, selectedSize, qty);
  });
  buyBtn.addEventListener("click", () => {
    if (!selectedSize) { showToast("Please select a size"); return; }
    addToCart(product, selectedSize, qty);
    window.location.href = "cart.html";
  });

  if (soldOut) {
    document.getElementById("pdBadge").innerHTML = `<span class="tag accent">Sold out</span>`;
    addBtn.disabled = true;
    addBtn.textContent = "Sold out";
    buyBtn.style.display = "none";
    const qtyBlock = document.getElementById("qtyMinus").closest(".pd-block");
    if (qtyBlock) qtyBlock.style.display = "none";
    const waNum = (typeof SITE_CONFIG !== "undefined") && SITE_CONFIG.WHATSAPP_NUMBER;
    if (waNum) {
      const msg = encodeURIComponent(`Hi Heavy Soul, please notify me when "${product.name}" is back in stock.`);
      document.querySelector(".pd-actions").insertAdjacentHTML("afterend",
        `<a class="btn block" style="margin-top:10px;" href="https://wa.me/${waNum}?text=${msg}" target="_blank" rel="noopener">Notify me on WhatsApp</a>`);
    }
  }

  if (product.orderType === "custom") {
    document.getElementById("pdNote").classList.remove("hidden");
  }

  // Size guide — show the numeric (bottoms) table if sizes look like waist numbers
  const sizeGuideBtn = document.getElementById("sizeGuideBtn");
  const sizeGuideModal = document.getElementById("sizeGuideModal");
  const sizeGuideClose = document.getElementById("sizeGuideClose");
  const isNumericSizing = product.sizes.every(s => /^\d+$/.test(s));
  document.getElementById("sizeGuideTops").classList.toggle("hidden", isNumericSizing);
  document.getElementById("sizeGuideBottoms").classList.toggle("hidden", !isNumericSizing);

  if (sizeGuideBtn) {
    sizeGuideBtn.addEventListener("click", () => sizeGuideModal.classList.remove("hidden"));
  }
  if (sizeGuideClose) {
    sizeGuideClose.addEventListener("click", () => sizeGuideModal.classList.add("hidden"));
  }
  if (sizeGuideModal) {
    sizeGuideModal.addEventListener("click", (e) => {
      if (e.target === sizeGuideModal) sizeGuideModal.classList.add("hidden");
    });
  }

  // Related products — same category, excluding self
  const related = PRODUCTS.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  const relatedWrap = document.getElementById("relatedGrid");
  if (related.length) {
    relatedWrap.innerHTML = related.map(productCardHTML).join("");
  } else {
    document.getElementById("relatedSection").classList.add("hidden");
  }

  // Structured data — lets Google show price/availability in search results
  const siteUrl = ((typeof SITE_CONFIG !== "undefined") && SITE_CONFIG.SITE_URL) || "https://heavysoul.in";
  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": product.name,
    "description": product.description,
    "image": product.images && product.images.length ? product.images.map(img => siteUrl + "/" + img) : [siteUrl + "/" + product.image],
    "category": product.category,
    "offers": {
      "@type": "Offer",
      "url": siteUrl + "/product.html?id=" + product.id,
      "priceCurrency": "INR",
      "price": product.price,
      "availability": soldOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition"
    }
  };
  const schemaTag = document.createElement("script");
  schemaTag.type = "application/ld+json";
  schemaTag.textContent = JSON.stringify(productSchema);
  document.head.appendChild(schemaTag);

  return true;
}

// If the product isn't in the cached/fallback catalog yet (e.g. it was
// just added in the admin panel), retry once the live catalog arrives
// instead of leaving the visitor stuck on "Product not found".
if (!renderProductPage_()) {
  window.addEventListener("hs:productsUpdated", function retryRender_(){
    window.removeEventListener("hs:productsUpdated", retryRender_);
    renderProductPage_();
  });
}

// If the live catalog arrives with different stock than the cached copy this
// page was drawn from, reload once so sold-out sizes/buttons are correct.
window.addEventListener("hs:productsUpdated", function(){
  const p = findProduct(productId);
  if (!p || renderedStockSig === null) return;
  if (stockSig_(p) !== renderedStockSig && !sessionStorage.getItem("hs_stock_reload")) {
    sessionStorage.setItem("hs_stock_reload", "1");
    window.location.reload();
  }
});
