const FALLBACK_PRODUCTS = [
  { id: "1", name: "X-Tudo", price: 15, description: "O mais completo da casa.", category: "lanche", available: true, image: "" },
  { id: "2", name: "X-Calabresa", price: 12, description: "Lanche com sabor marcante de calabresa.", category: "lanche", available: true, image: "" },
  { id: "3", name: "X-Bacon", price: 12, description: "Clássico com bacon.", category: "lanche", available: true, image: "" },
  { id: "4", name: "X-Salsicha", price: 12, description: "Lanche reforçado com salsicha.", category: "lanche", available: true, image: "" },
  { id: "5", name: "X-Banana", price: 12, description: "Uma combinação diferente e saborosa.", category: "lanche", available: true, image: "" },
  { id: "6", name: "X-Salada", price: 9, description: "Clássico, leve e bem montado.", category: "lanche", available: true, image: "" },
  { id: "7", name: "X-Burguer", price: 7, description: "Hambúrguer simples e direto ao ponto.", category: "lanche", available: true, image: "" },
  { id: "8", name: "X-Egg / X-Pio", price: 7, description: "Opção com ovo.", category: "lanche", available: true, image: "" },
  { id: "9", name: "Misto Duplo", price: 7, description: "Misto em versão dupla.", category: "lanche", available: true, image: "" },
  { id: "10", name: "Queijo Duplo", price: 6, description: "Para quem gosta de muito queijo.", category: "lanche", available: true, image: "" },
  { id: "11", name: "Hambúrguer", price: 5, description: "Hambúrguer tradicional.", category: "lanche", available: true, image: "" },
  { id: "12", name: "Misto Quente", price: 5, description: "O clássico misto quente.", category: "lanche", available: true, image: "" },
  { id: "13", name: "Misto Simples", price: 5, description: "Simples, rápido e saboroso.", category: "lanche", available: true, image: "" }
];

let products = [...FALLBACK_PRODUCTS];
const cart = new Map();
const $ = (selector) => document.querySelector(selector);
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

const lanchesEl = $("#lanchesProducts");
const bebidasEl = $("#bebidasProducts");
const cartItemsEl = $("#cartItems");
const cartCountEl = $("#cartCount");
const cartTotalEl = $("#cartTotal");
const sheetTotalEl = $("#sheetTotal");
const checkoutTotalEl = $("#checkoutTotal");
const openCartBtn = $("#openCart");
const cartSheet = $("#cartSheet");
const sheetBackdrop = $("#sheetBackdrop");
const cartEmptyEl = $("#cartEmpty");
const goCheckoutBtn = $("#goCheckout");
const checkoutModal = $("#checkoutModal");
const checkoutBackdrop = $("#checkoutBackdrop");
const checkoutForm = $("#checkoutForm");
const checkoutButton = checkoutForm.querySelector('.whatsapp-button');
const paymentEl = $("#payment");
const changeWrap = $("#changeWrap");
const changeFor = $("#changeFor");
const addressFields = $("#addressFields");
const addressInput = $("#address");
const previewMode = new URLSearchParams(window.location.search).get("preview") === "admin";
const successModal = $("#orderSuccessModal");
const successBackdrop = $("#successBackdrop");

if (previewMode) {
  const banner = $("#previewModeBanner");
  if (banner) banner.hidden = false;
  checkoutButton.textContent = "Simular pedido";
  document.body.classList.add("is-admin-preview");
}

function productCard(product) {
  const available = product.available !== false;
  const image = product.image ? `<img src="${product.image}" alt="${esc(product.name)}">` : "";
  return `<article class="product-card${available ? "" : " unavailable"}">
    <div class="product-image ${product.category === "bebida" ? "bebida" : "lanche"}">${image}${available ? "" : '<span class="unavailable-badge">Indisponível</span>'}</div>
    <div class="product-body">
      <h3>${esc(product.name)}</h3>
      <p>${esc(product.description || "")}</p>
      <div class="product-bottom">
        <span class="price">${money(product.price)}</span>
        <button class="add-button" type="button" data-add="${esc(product.id)}" ${available ? "" : "disabled"}>${available ? "+ Adicionar" : "Indisponível"}</button>
      </div>
    </div>
  </article>`;
}

function renderProducts() {
  const lanches = products.filter((p) => p.category !== "bebida");
  const bebidas = products.filter((p) => p.category === "bebida");
  lanchesEl.innerHTML = lanches.map(productCard).join("");
  bebidasEl.innerHTML = bebidas.map(productCard).join("");
  $("#lanchesEmpty").hidden = lanches.length > 0;
  $("#bebidasEmpty").hidden = bebidas.length > 0;
}

async function loadProducts() {
  try {
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (Array.isArray(data.products)) products = data.products.map((p) => ({ ...p, id: String(p.id) }));
  } catch {
    products = [...FALLBACK_PRODUCTS];
  }
  renderProducts();
  renderCart();
}

function cartDetails() {
  let count = 0;
  let total = 0;
  cart.forEach((qty, id) => {
    const product = products.find((item) => String(item.id) === String(id));
    if (!product) return;
    count += qty;
    total += Number(product.price) * qty;
  });
  return { count, total };
}

function renderCart() {
  const { count, total } = cartDetails();
  cartCountEl.textContent = count === 1 ? "1 item no carrinho" : `${count} itens no carrinho`;
  cartTotalEl.textContent = money(total);
  sheetTotalEl.textContent = money(total);
  checkoutTotalEl.textContent = money(total);
  goCheckoutBtn.disabled = count === 0;

  cartItemsEl.innerHTML = [...cart.entries()].map(([id, qty]) => {
    const product = products.find((item) => String(item.id) === String(id));
    if (!product) return "";
    return `<div class="cart-item">
      <div><strong>${esc(product.name)}</strong><small>${money(product.price)} cada</small>
        <div class="qty-control"><button type="button" data-minus="${esc(id)}">−</button><span>${qty}</span><button type="button" data-plus="${esc(id)}">+</button></div>
      </div><strong>${money(Number(product.price) * qty)}</strong>
    </div>`;
  }).join("");
  cartEmptyEl.hidden = count > 0;
}

function addItem(id) {
  const product = products.find((item) => String(item.id) === String(id));
  if (!product || product.available === false) return;
  cart.set(String(id), (cart.get(String(id)) || 0) + 1);
  renderCart();
}

function changeQty(id, delta) {
  const key = String(id);
  const next = (cart.get(key) || 0) + delta;
  if (next <= 0) cart.delete(key); else cart.set(key, next);
  renderCart();
}

function openCart() { cartSheet.classList.add("open"); cartSheet.setAttribute("aria-hidden", "false"); sheetBackdrop.hidden = false; document.body.style.overflow = "hidden"; }
function closeCart() { cartSheet.classList.remove("open"); cartSheet.setAttribute("aria-hidden", "true"); sheetBackdrop.hidden = true; document.body.style.overflow = ""; }
function openCheckout() { closeCart(); checkoutBackdrop.hidden = false; checkoutModal.classList.add("open"); checkoutModal.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; $("#customerName").focus(); }
function closeCheckout() { checkoutBackdrop.hidden = true; checkoutModal.classList.remove("open"); checkoutModal.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; }
function getDeliveryType() { return document.querySelector('input[name="deliveryType"]:checked').value; }
function syncDeliveryFields() { const isDelivery = getDeliveryType() === "Entrega"; addressFields.hidden = !isDelivery; addressInput.required = isDelivery; }
function syncPaymentFields() { const isCash = paymentEl.value === "Dinheiro"; changeWrap.hidden = !isCash; if (!isCash) changeFor.value = ""; }

function orderItems() {
  return [...cart.entries()].map(([id, qty]) => {
    const product = products.find((item) => String(item.id) === String(id));
    return product ? { id: String(product.id), name: product.name, qty, price: Number(product.price) } : null;
  }).filter(Boolean);
}

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clientOrderId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function registerOrder(formData) {
  const payload = {
    clientOrderId: clientOrderId(),
    localDate: localDateKey(),
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone"),
    payment: formData.get("payment"),
    deliveryType: formData.get("deliveryType"),
    address: formData.get("address") || "",
    reference: formData.get("reference") || "",
    changeFor: formData.get("changeFor") || "",
    note: formData.get("orderNote") || "",
    items: orderItems().map(({ id, name, qty }) => ({ id, name, qty }))
  };

  const data = await submitOrderPayload(payload);
  return Object.assign(data.order, { _messaging: data.messaging || null });
}

async function submitOrderPayload(payload) {
  if (previewMode) {
    return {
      order: {
        ...payload,
        id: "PRÉVIA",
        total: cartDetails().total,
        createdAt: new Date().toISOString(),
        status: "teste"
      },
      messaging: { preview: true, sent: false }
    };
  }

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.order) throw new Error(data.error || "Não foi possível registrar o pedido. Tente novamente.");
  return data;
}

function showOrderSuccess(order) {
  const title = $("#orderSuccessTitle");
  const message = $("#orderSuccessMessage");
  const number = $("#orderSuccessNumber");

  if (previewMode || order?._messaging?.preview) {
    title.textContent = "Simulação concluída";
    message.textContent = "Este pedido de prévia não foi registrado, contabilizado nem enviado pelo WhatsApp.";
    number.textContent = "Modo de prévia";
  } else {
    title.textContent = "Pedido feito com sucesso!";
    message.textContent = order?._messaging?.sent === false
      ? "O pedido foi registrado, mas o WhatsApp automático está temporariamente desconectado."
      : "Você pode visualizar a confirmação no seu WhatsApp.";
    number.textContent = order?.id ? `Pedido ${order.id}` : "";
  }

  successBackdrop.hidden = false;
  successModal.hidden = false;
  document.body.style.overflow = "hidden";
  $("#closeOrderSuccess").focus();
}

function closeOrderSuccess() {
  successBackdrop.hidden = true;
  successModal.hidden = true;
  document.body.style.overflow = "";
}

async function loadPromotion() {
  const promoSection = $("#promoSection");
  try {
    const response = await fetch("/api/promo", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const promo = await response.json();
    if (!promo?.active || (!promo.image && !promo.title && !promo.description)) { promoSection.hidden = true; return; }
    const image = $("#promoImage");
    if (promo.image) { image.src = promo.image; image.hidden = false; } else image.hidden = true;
    $("#promoTitle").textContent = promo.title || "Promoção do dia";
    $("#promoDescription").textContent = promo.description || "";
    promoSection.hidden = false;
  } catch { promoSection.hidden = true; }
}

document.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (add && !add.disabled) {
    addItem(add.dataset.add);
    const original = "+ Adicionar";
    add.textContent = "Adicionado ✓";
    setTimeout(() => { if (!add.disabled) add.textContent = original; }, 900);
    return;
  }
  const plus = event.target.closest("[data-plus]");
  const minus = event.target.closest("[data-minus]");
  if (plus) changeQty(plus.dataset.plus, 1);
  if (minus) changeQty(minus.dataset.minus, -1);
});

openCartBtn.addEventListener("click", openCart);
$("#closeCart").addEventListener("click", closeCart);
sheetBackdrop.addEventListener("click", closeCart);
goCheckoutBtn.addEventListener("click", openCheckout);
$("#closeCheckout").addEventListener("click", closeCheckout);
checkoutBackdrop.addEventListener("click", closeCheckout);
$("#closeOrderSuccess").addEventListener("click", closeOrderSuccess);
successBackdrop.addEventListener("click", closeOrderSuccess);
document.querySelectorAll('input[name="deliveryType"]').forEach((input) => input.addEventListener("change", syncDeliveryFields));
paymentEl.addEventListener("change", syncPaymentFields);

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (cart.size === 0) { closeCheckout(); openCart(); return; }
  syncDeliveryFields();
  if (!checkoutForm.reportValidity()) return;

  const formData = new FormData(checkoutForm);
  const originalText = checkoutButton.textContent;
  checkoutButton.disabled = true;
  checkoutButton.textContent = "Registrando pedido...";

  try {
    const registeredOrder = await registerOrder(formData);
    checkoutButton.textContent = previewMode ? "Simulação concluída" : `Pedido ${registeredOrder.id} enviado`;

    cart.clear();
    checkoutForm.reset();
    renderCart();
    syncDeliveryFields();
    syncPaymentFields();
    closeCheckout();
    showOrderSuccess(registeredOrder);
  } catch (error) {
    alert(error.message || "Não foi possível registrar o pedido.");
  } finally {
    checkoutButton.disabled = false;
    checkoutButton.textContent = previewMode ? "Simular pedido" : originalText;
  }
});

renderProducts();
renderCart();
syncDeliveryFields();
syncPaymentFields();
loadProducts();
loadPromotion();
