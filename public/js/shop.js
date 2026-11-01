const shopGrid = document.getElementById("shopGrid");
const chipRow = document.getElementById("chipRow");
const sortSelect = document.getElementById("sortSelect");
const resultCount = document.getElementById("resultCount");

let activeCategory = new URLSearchParams(window.location.search).get("category") || "All";

function renderChips(){
  const categories = ["All", ...new Set(PRODUCTS.map(p => p.category))];
  if (!categories.includes(activeCategory)) activeCategory = "All";
  chipRow.innerHTML = categories.map(c =>
    `<button class="chip ${c === activeCategory ? "active" : ""}" data-cat="${c}">${c}</button>`
  ).join("");
}
renderChips();

chipRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  activeCategory = btn.dataset.cat;
  [...chipRow.children].forEach(c => c.classList.toggle("active", c === btn));
  render();
});

sortSelect.addEventListener("change", render);

function render(){
  let list = activeCategory === "All"
    ? [...PRODUCTS]
    : PRODUCTS.filter(p => p.category === activeCategory);

  if (sortSelect.value === "price-asc") list.sort((a,b) => a.price - b.price);
  if (sortSelect.value === "price-desc") list.sort((a,b) => b.price - a.price);
  if (sortSelect.value === "newest") list = [...list].reverse();

  shopGrid.innerHTML = list.map(productCardHTML).join("") ||
    `<p style="grid-column:1/-1;color:var(--ink-soft);">No products in this category yet.</p>`;

  resultCount.textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
}

render();

// Live catalog finished loading after this page already painted —
// rebuild the category chips (new categories may exist) and re-render.
window.addEventListener("hs:productsUpdated", () => {
  renderChips();
  render();
});
