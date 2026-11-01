// Sold out = stock is tracked and every size is at 0. No stock data = available.
function productIsSoldOut(p){
  if (!p || !p.stock || !p.sizes) return false;
  return p.sizes.every(s => !(Number(p.stock[s]) > 0));
}

// Shared product-card markup, used on the homepage and the shop page.
function productCardHTML(p){
  const soldOut = productIsSoldOut(p);
  const alt = p.images && p.images[1] ? p.images[1] : p.image;
  const priceHTML = p.compareAt
    ? `<span class="was">₹${p.compareAt}</span>₹${p.price}`
    : `₹${p.price}`;
  return `
    <a class="card" href="product.html?id=${p.id}">
      <div class="card-media"${soldOut ? ' style="opacity:.6"' : ""}>
        ${soldOut ? `<span class="tag accent">Sold out</span>` : p.badge ? `<span class="tag ${p.orderType === 'custom' ? 'accent' : ''}">${escapeHtml(p.badge)}</span>` : ""}
        <img class="main" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">
        <img class="alt" src="${escapeHtml(alt)}" alt="">
        <span class="quick-add">${soldOut ? "Sold out" : "View product"}</span>
      </div>
      <div class="card-body">
        <div class="card-cat">${escapeHtml(p.category)}</div>
        <h3 class="card-title">${escapeHtml(p.name)}</h3>
        <div class="card-price">${priceHTML}</div>
      </div>
    </a>
  `;
}

function renderFeatured(){
  const grid = document.getElementById("featuredGrid");
  if (!grid) return;
  const featured = PRODUCTS.filter(p => p.badge === "Best Seller" || p.badge === "New").slice(0, 8);
  grid.innerHTML = featured.map(productCardHTML).join("");
}

document.addEventListener("DOMContentLoaded", renderFeatured);
// Re-render if the live catalog finishes loading after the page paints
// (e.g. a product was just added/edited in the admin panel).
window.addEventListener("hs:productsUpdated", renderFeatured);
