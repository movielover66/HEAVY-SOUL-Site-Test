function getCart(){
  return JSON.parse(localStorage.getItem("cart")) || [];
}

function updateCartCount(){
  const el = document.getElementById("cartCount");
  if (!el) return;
  const count = getCart().reduce((sum, item) => sum + (item.qty || 1), 0);
  el.textContent = count;
  el.style.display = count > 0 ? "flex" : "none";
}

function toggleMobileNav(){
  const panel = document.getElementById("mobilePanel");
  if (panel) panel.classList.toggle("open");
}

document.addEventListener("DOMContentLoaded", updateCartCount);
