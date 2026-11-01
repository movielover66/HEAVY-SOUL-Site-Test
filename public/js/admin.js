// Heavy Soul — Admin Panel
// Talks to the same Apps Script backend as the rest of the site
// (SITE_CONFIG.APPS_SCRIPT_URL). Every admin_* request is sent with
// the stored password and re-checked server-side on every call.

const ADMIN_PW_KEY = "hs_admin_pw";
let currentProducts = [];
let editingId = null;      // null = "add new" mode
let pendingImages = [];    // urls, in display order — first is the main photo
let stockEditingId = null; // product whose stock dialog is open
let activeFilter = "all";
let searchQuery = "";

const API_URL = (typeof SITE_CONFIG !== "undefined") && SITE_CONFIG.APPS_SCRIPT_URL;

const $ = (id) => document.getElementById(id);

function getStoredPassword(){
  return localStorage.getItem(ADMIN_PW_KEY) || "";
}

async function apiPost(payload){
  if (!API_URL) throw new Error("APPS_SCRIPT_URL is not set in js/config.js");
  // text/plain avoids a CORS pre-flight request against Apps Script,
  // which doesn't handle OPTIONS — same trick used elsewhere on the site.
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    throw new Error("NETWORK: " + (networkErr && networkErr.message ? networkErr.message : networkErr));
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    throw new Error("BAD_RESPONSE (status " + res.status + "): " + text.slice(0, 200));
  }
}

function adminCall(type, extra){
  return apiPost(Object.assign({ type, adminPassword: getStoredPassword() }, extra || {}));
}

/* ========================= AUTH ========================= */

const loginScreen = $("loginScreen");
const panelScreen = $("panelScreen");
const loginError = $("loginError");
const loginBtn = $("loginBtn");

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("loginPassword").value;
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "Checking…";
  try {
    const data = await apiPost({ type: "admin_verify", adminPassword: pw });
    if (data && data.success) {
      localStorage.setItem(ADMIN_PW_KEY, pw);
      enterPanel();
    } else {
      loginError.textContent = "Wrong password.";
    }
  } catch (err) {
    loginError.textContent = "Error: " + (err && err.message ? err.message : err);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
  }
});

$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(ADMIN_PW_KEY);
  panelScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
});

function enterPanel(){
  loginScreen.classList.add("hidden");
  panelScreen.classList.remove("hidden");
  loadProducts();
}

// If a password is already stored, try it silently instead of showing
// the login screen every visit.
(async function autoLogin(){
  const pw = getStoredPassword();
  if (!pw) return;
  try {
    const data = await apiPost({ type: "admin_verify", adminPassword: pw });
    if (data && data.success) enterPanel();
  } catch (err) { /* stay on login screen, server may just be unreachable */ }
})();

/* ========================= STOCK HELPERS ========================= */

function isTracked(p){ return !!p.stock; }

function qtyFor(p, size){
  return Number(p.stock && p.stock[size]) || 0;
}

function isSoldOut(p){
  return isTracked(p) && (p.sizes || []).every(s => qtyFor(p, s) <= 0);
}

/* ========================= LOAD / RENDER LIST ========================= */

const productList = $("productList");
const listStatus = $("listStatus");

async function loadProducts(){
  listStatus.textContent = "Loading products…";
  try {
    const data = await adminCall("admin_list_products");
    if (!data || !data.success) {
      listStatus.textContent = "";
      localStorage.removeItem(ADMIN_PW_KEY);
      panelScreen.classList.add("hidden");
      loginScreen.classList.remove("hidden");
      loginError.textContent = "Session expired — please log in again.";
      return;
    }
    currentProducts = data.products || [];
    renderList();
    listStatus.textContent = "";
  } catch (err) {
    listStatus.textContent = "Error: " + (err && err.message ? err.message : err);
  }
}

function matchesFilter(p){
  const hidden = p.status === "Hidden";
  const out = isSoldOut(p);
  if (activeFilter === "hidden") return hidden;
  if (activeFilter === "out") return out;
  if (activeFilter === "in") return !out && !hidden;
  return true;
}

function matchesSearch(p){
  if (!searchQuery) return true;
  const hay = [p.name, p.sku, p.category].join(" ").toLowerCase();
  return hay.includes(searchQuery);
}

function sizeChips(p){
  if (!isTracked(p)) return `<span class="size untracked">Stock not tracked</span>`;
  return (p.sizes || []).map(s => {
    const q = qtyFor(p, s);
    return `<span class="size ${q <= 0 ? "out" : ""}"><b>${escapeHtml(s)}</b>${q}</span>`;
  }).join("");
}

function renderList(){
  const list = currentProducts.filter(p => matchesFilter(p) && matchesSearch(p));
  if (!currentProducts.length) {
    productList.innerHTML = `<p class="empty">No products yet — add your first t-shirt.</p>`;
    return;
  }
  if (!list.length) {
    productList.innerHTML = `<p class="empty">No products match this filter.</p>`;
    return;
  }
  productList.innerHTML = list.map(p => {
    const out = isSoldOut(p);
    const hidden = p.status === "Hidden";
    return `
    <div class="row ${out ? "is-out" : ""} ${hidden ? "is-hidden" : ""}">
      <img src="${escapeHtml(p.image || "")}" alt="" class="thumb" onerror="this.style.opacity=0.15">
      <div>
        <div class="pname">${escapeHtml(p.name)}${hidden ? '<span class="badge">Hidden</span>' : ""}</div>
        <div class="pmeta">${escapeHtml(p.sku || "")}${p.sku ? " · " : ""}${escapeHtml(p.category)} · ₹${p.price}${p.compareAt ? ` <s>₹${p.compareAt}</s>` : ""}</div>
      </div>
      <div class="sizes">${sizeChips(p)}</div>
      <div class="actions">
        <div class="switchwrap">
          <button type="button" class="switch" role="switch" aria-checked="${!out}" aria-label="${escapeHtml(p.name)} in stock" data-toggle="${p.id}"><span class="knob"></span></button>
          <span class="switchlabel ${out ? "out" : ""}">${out ? "Out of stock" : "In stock"}</span>
        </div>
        <button class="btn sm" data-stock="${p.id}">Edit stock</button>
        <button class="btn sm" data-edit="${p.id}">Edit</button>
        <button class="btn sm danger" data-delete="${p.id}">Delete</button>
      </div>
    </div>`;
  }).join("");
}

productList.addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle],[data-stock],[data-edit],[data-delete]");
  if (!t) return;
  if (t.dataset.toggle) handleToggle(t.dataset.toggle);
  else if (t.dataset.stock) openStock(t.dataset.stock);
  else if (t.dataset.edit) openForm(t.dataset.edit);
  else if (t.dataset.delete) handleDelete(t.dataset.delete);
});

$("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderList();
});

document.querySelectorAll("[data-filter]").forEach(btn => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
    renderList();
  });
});

function findById(id){
  return currentProducts.find(p => String(p.id) === String(id));
}

/* ========================= TOGGLE / STOCK ========================= */

async function handleToggle(id){
  const p = findById(id);
  if (!p) return;
  if (isSoldOut(p)) {
    // Back in stock needs quantities — open the editor.
    openStock(id);
    return;
  }
  const zeros = {};
  (p.sizes || []).forEach(s => { zeros[s] = 0; });
  await saveStock(id, zeros, `${p.name} marked out of stock.`);
}

async function saveStock(id, stock, okMessage){
  listStatus.textContent = "Saving stock…";
  try {
    const data = await adminCall("admin_set_stock", { id, stock });
    listStatus.textContent = "";
    if (data && data.success) {
      currentProducts = data.products;
      renderList();
      showAdminToast(okMessage || "Stock saved.");
      return true;
    }
    showAdminToast((data && data.error) || "Couldn't save stock.");
  } catch (err) {
    listStatus.textContent = "";
    showAdminToast("Network error — try again.");
  }
  return false;
}

const stockDialog = $("stockDialog");
const stockFields = $("stockFields");
const stockError = $("stockError");

function openStock(id){
  const p = findById(id);
  if (!p) return;
  stockEditingId = p.id;
  stockError.textContent = "";
  $("stockTitle").textContent = "Edit stock — " + p.name;
  $("stockHint").textContent = isTracked(p)
    ? "Units available per size. 0 = sold out."
    : "Stock isn't tracked yet (always available). Enter units per size to start tracking.";
  stockFields.innerHTML = (p.sizes || []).map(s => `
    <div class="field">
      <label for="stock-${escapeHtml(s)}">${escapeHtml(s)}</label>
      <input id="stock-${escapeHtml(s)}" data-size="${escapeHtml(s)}" type="number" min="0" step="1" inputmode="numeric"
             value="${isTracked(p) ? qtyFor(p, s) : ""}" placeholder="0">
    </div>`).join("");
  stockDialog.showModal();
  const first = stockFields.querySelector("input");
  if (first) first.focus();
}

function collectStock(){
  const stock = {};
  stockFields.querySelectorAll("input[data-size]").forEach(inp => {
    stock[inp.dataset.size] = Math.max(0, Math.floor(Number(inp.value) || 0));
  });
  return stock;
}

$("stockSaveBtn").addEventListener("click", async () => {
  const stock = collectStock();
  if (!Object.keys(stock).length) { stockError.textContent = "This product has no sizes."; return; }
  const ok = await saveStock(stockEditingId, stock);
  if (ok) stockDialog.close();
});

$("stockAllOutBtn").addEventListener("click", () => {
  stockFields.querySelectorAll("input[data-size]").forEach(inp => { inp.value = 0; });
});

$("stockUntrackBtn").addEventListener("click", async () => {
  const p = findById(stockEditingId);
  if (!confirm(`Stop tracking stock for "${p ? p.name : "this product"}"? It will always show as available.`)) return;
  try {
    const data = await adminCall("admin_clear_stock", { id: stockEditingId });
    if (data && data.success) {
      currentProducts = data.products;
      renderList();
      stockDialog.close();
      showAdminToast("Stock tracking turned off.");
    } else {
      stockError.textContent = (data && data.error) || "Couldn't update.";
    }
  } catch (err) {
    stockError.textContent = "Network error — try again.";
  }
});

$("stockCancelBtn").addEventListener("click", () => stockDialog.close());

/* ========================= DELETE ========================= */

async function handleDelete(id){
  const product = findById(id);
  if (!confirm(`Delete "${product ? product.name : "this product"}"? This can't be undone.`)) return;
  listStatus.textContent = "Deleting…";
  try {
    const data = await adminCall("admin_delete_product", { id });
    listStatus.textContent = "";
    if (data && data.success) {
      currentProducts = data.products;
      renderList();
      showAdminToast("Product deleted.");
    } else {
      showAdminToast(data && data.error ? data.error : "Couldn't delete.");
    }
  } catch (err) {
    listStatus.textContent = "";
    showAdminToast("Network error — try again.");
  }
}

/* ========================= ADD / EDIT FORM ========================= */

const formDialog = $("formDialog");
const productForm = $("productForm");
const imageGrid = $("imageGrid");
const imageInput = $("imageInput");
const imageStatus = $("imageStatus");
const formError = $("formError");
const saveBtn = $("saveBtn");

$("addProductBtn").addEventListener("click", () => openForm(null));
$("cancelFormBtn").addEventListener("click", closeForm);

function openForm(id){
  formError.textContent = "";
  if (id) {
    const p = findById(id);
    if (!p) return;
    editingId = p.id;
    $("formTitle").textContent = "Edit product";
    $("fName").value = p.name || "";
    $("fCategory").value = p.category || "";
    $("fPrice").value = p.price || "";
    $("fSku").value = p.sku || "";
    $("fCompareAt").value = p.compareAt || "";
    $("fBadge").value = p.badge || "";
    $("fOrderType").value = p.orderType === "custom" ? "custom" : "collection";
    $("fSizes").value = (p.sizes || []).join(", ");
    $("fDescription").value = p.description || "";
    $("fStatus").value = p.status === "Hidden" ? "Hidden" : "Active";
    pendingImages = [...(p.images || [])];
  } else {
    editingId = null;
    $("formTitle").textContent = "Add product";
    productForm.reset();
    $("fOrderType").value = "collection";
    $("fStatus").value = "Active";
    pendingImages = [];
  }
  renderImageGrid();
  formDialog.showModal();
}

function closeForm(){
  formDialog.close();
  editingId = null;
  pendingImages = [];
}

function renderImageGrid(){
  imageGrid.innerHTML = pendingImages.map((url, i) => `
    <div class="tile ${i === 0 ? "main" : ""}">
      <img src="${escapeHtml(url)}" alt="">
      ${i === 0 ? '<span class="tag">Main</span>' : ""}
      <button type="button" class="rm" data-remove="${i}" aria-label="Remove photo">✕</button>
    </div>
  `).join("");
}

imageGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  pendingImages.splice(Number(btn.dataset.remove), 1);
  renderImageGrid();
});

// Downscales/compresses a photo client-side before it's base64-encoded
// and sent up — keeps uploads fast and the request comfortably under
// Apps Script's payload limits.
function compressImage(file, maxDim = 1600, quality = 0.85){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read file"));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Couldn't read image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Compression failed")); return; }
          const outReader = new FileReader();
          outReader.onload = () => {
            const base64 = outReader.result.split(",")[1];
            resolve({ base64, mimeType: "image/jpeg", fileName: (file.name || "photo").replace(/\.\w+$/, "") + ".jpg" });
          };
          outReader.readAsDataURL(blob);
        }, "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

imageInput.addEventListener("change", async () => {
  const files = [...imageInput.files];
  if (!files.length) return;
  imageStatus.textContent = `Uploading ${files.length} photo${files.length > 1 ? "s" : ""}…`;
  for (const file of files) {
    try {
      const { base64, mimeType, fileName } = await compressImage(file);
      const data = await adminCall("admin_upload_image", { imageBase64: base64, mimeType, fileName });
      if (data && data.success) {
        pendingImages.push(data.url);
        renderImageGrid();
      } else {
        showAdminToast((data && data.error) || "Photo upload failed.");
      }
    } catch (err) {
      showAdminToast("Photo upload failed — try a smaller image.");
    }
  }
  imageStatus.textContent = "";
  imageInput.value = "";
});

productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  const sizes = $("fSizes").value.split(",").map(s => s.trim()).filter(Boolean);

  // NOTE: no "stock" key here on purpose — the backend keeps the existing
  // stock untouched when saving product details. Use "Edit stock" for that.
  const product = {
    id: editingId,
    name: $("fName").value.trim(),
    category: $("fCategory").value.trim(),
    price: Number($("fPrice").value),
    sku: $("fSku").value.trim(),
    compareAt: $("fCompareAt").value ? Number($("fCompareAt").value) : "",
    badge: $("fBadge").value.trim(),
    orderType: $("fOrderType").value,
    sizes,
    description: $("fDescription").value.trim(),
    status: $("fStatus").value,
    images: pendingImages
  };

  if (!product.images.length) {
    formError.textContent = "Add at least one photo.";
    return;
  }
  if (!sizes.length) {
    formError.textContent = "Add at least one size (comma-separated, e.g. S, M, L, XL).";
    return;
  }

  const wasEditing = !!editingId;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    const data = await adminCall("admin_save_product", { product });
    if (data && data.success) {
      currentProducts = data.products;
      renderList();
      closeForm();
      showAdminToast(wasEditing ? "Product updated." : "Product added.");
    } else {
      formError.textContent = (data && data.error) || "Couldn't save — try again.";
    }
  } catch (err) {
    formError.textContent = "Network error — try again.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save product";
  }
});

/* ========================= MISC ========================= */

function showAdminToast(message){
  let el = $("adminToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "adminToast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__adminToastTimer);
  window.__adminToastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// escapeHtml() is already defined in js/config.js, loaded before this file.
