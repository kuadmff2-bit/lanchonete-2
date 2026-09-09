const $ = (selector) => document.querySelector(selector);
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

let adminPassword = "";
let products = [];
let editingId = null;
let productImageData = "";
let promoImageData = "";

function setStatus(selector, message, type = "") {
  const el = typeof selector === "string" ? $(selector) : selector;
  if (!el) return;
  el.textContent = message;
  el.className = `status ${type}`.trim();
}

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function compressImage(file, maxSide = 900, quality = 0.7) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Imagem inválida."));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (adminPassword) headers["x-admin-password"] = adminPassword;
  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

function switchTab(name) {
  document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
}

document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

async function login(password) {
  adminPassword = password;
  setStatus("#loginStatus", "Entrando...");
  try {
    const orders = await api("/api/orders");
    $("#loginPanel").hidden = true;
    $("#adminApp").hidden = false;
    renderDashboard(orders);
    await Promise.all([loadProducts(), loadPromotion()]);
  } catch (error) {
    adminPassword = "";
    setStatus("#loginStatus", error.message, "error");
  }
}

$("#loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const password = $("#loginPassword").value;
  if (!password) return;
  login(password);
});

$("#logoutButton").addEventListener("click", () => {
  adminPassword = "";
  $("#loginPassword").value = "";
  $("#adminApp").hidden = true;
  $("#loginPanel").hidden = false;
  setStatus("#loginStatus", "");
});

function renderDashboard(data) {
  const stats = data?.stats || {};
  const isToday = stats.currentDate === localDateKey();
  $("#todayOrders").textContent = isToday ? Number(stats.todayOrders || 0) : 0;
  $("#totalOrders").textContent = Number(stats.totalOrders || 0);
  $("#todayValue").textContent = money(isToday ? stats.todayValue : 0);
  $("#totalValue").textContent = money(stats.totalValue || 0);

  const recent = Array.isArray(data?.recent) ? data.recent : [];
  $("#recentOrders").innerHTML = recent.length ? recent.map((order) => {
    const date = new Date(order.createdAt);
    const time = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const itemText = Array.isArray(order.items) && order.items.length
      ? order.items.map((item) => `${item.qty}x ${esc(item.name)}`).join(", ")
      : `${Number(order.itemCount || 0)} item(ns)`;
    return `<article class="recent-order">
      <div class="recent-order-id"><strong>${esc(order.id || "Pedido")}</strong><small>${esc(time)}</small></div>
      <div class="recent-order-main"><strong>${itemText}</strong><small>${esc(order.deliveryType || "")} · ${esc(order.payment || "")}</small></div>
      <div class="recent-order-total">${money(order.total)}</div>
    </article>`;
  }).join("") : '<p class="empty-admin">Ainda não há pedidos registrados.</p>';
}

async function refreshOrders() {
  setStatus("#dashboardStatus", "Atualizando...");
  try {
    renderDashboard(await api("/api/orders"));
    setStatus("#dashboardStatus", "Atualizado.", "ok");
  } catch (error) {
    setStatus("#dashboardStatus", error.message, "error");
  }
}

$("#refreshOrders").addEventListener("click", refreshOrders);

async function loadProducts() {
  try {
    const response = await fetch("/api/products", { cache: "no-store" });
    const data = await response.json();
    products = Array.isArray(data.products) ? data.products.map((p) => ({ ...p, id: String(p.id) })) : [];
    renderProductList();
  } catch (error) {
    setStatus("#productStatus", "Não foi possível carregar os produtos.", "error");
  }
}

function renderProductList() {
  $("#productCount").textContent = products.length === 1 ? "1 produto" : `${products.length} produtos`;
  $("#productList").innerHTML = products.length ? products.map((product) => `
    <article class="admin-product">
      <div class="admin-product-image">${product.image ? `<img src="${product.image}" alt="${esc(product.name)}">` : "Sem foto"}</div>
      <div class="admin-product-main">
        <strong>${esc(product.name)}</strong>
        <small>${product.category === "bebida" ? "Bebida" : "Lanche"} · ${money(product.price)}</small>
        <span class="availability ${product.available === false ? "off" : "on"}">${product.available === false ? "INDISPONÍVEL" : "DISPONÍVEL"}</span>
      </div>
      <div class="product-actions">
        <button type="button" data-toggle-product="${esc(product.id)}">${product.available === false ? "Disponibilizar" : "Indisponibilizar"}</button>
        <button type="button" data-edit-product="${esc(product.id)}">Editar</button>
        <button type="button" class="danger" data-delete-product="${esc(product.id)}">Excluir</button>
      </div>
    </article>`).join("") : '<p class="empty-admin">Nenhum produto cadastrado.</p>';
}

async function saveProducts(message = "Produtos atualizados.") {
  setStatus("#productStatus", "Salvando...");
  try {
    const data = await api("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ products })
    });
    products = data.products.map((p) => ({ ...p, id: String(p.id) }));
    renderProductList();
    setStatus("#productStatus", message, "ok");
    return true;
  } catch (error) {
    setStatus("#productStatus", error.message, "error");
    return false;
  }
}

function resetProductForm() {
  editingId = null;
  productImageData = "";
  $("#productForm").reset();
  $("#productAvailable").checked = true;
  $("#productCategory").value = "lanche";
  $("#productPreview").hidden = true;
  $("#productFormTitle").textContent = "Adicionar produto";
  $("#productSaveButton").textContent = "Adicionar produto";
  $("#cancelEdit").hidden = true;
}

$("#productImage").addEventListener("change", async () => {
  const file = $("#productImage").files?.[0];
  if (!file) return;
  setStatus("#productStatus", "Preparando foto...");
  try {
    productImageData = await compressImage(file, 800, 0.68);
    $("#productPreviewImage").src = productImageData;
    $("#productPreview").hidden = false;
    setStatus("#productStatus", "Foto pronta.", "ok");
  } catch (error) {
    setStatus("#productStatus", error.message, "error");
  }
});

$("#productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#productName").value.trim();
  const price = Number($("#productPrice").value);
  if (!name || !Number.isFinite(price) || price < 0) {
    setStatus("#productStatus", "Preencha nome e preço corretamente.", "error");
    return;
  }
  const product = {
    id: editingId || `p-${Date.now()}`,
    name,
    price,
    category: $("#productCategory").value === "bebida" ? "bebida" : "lanche",
    description: $("#productDescription").value.trim(),
    available: $("#productAvailable").checked,
    image: productImageData
  };
  if (editingId) {
    products = products.map((item) => String(item.id) === editingId ? product : item);
  } else {
    products.push(product);
  }
  const saved = await saveProducts(editingId ? "Produto atualizado." : "Produto adicionado.");
  if (saved) resetProductForm();
});

$("#cancelEdit").addEventListener("click", resetProductForm);

$("#productList").addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-toggle-product]");
  const edit = event.target.closest("[data-edit-product]");
  const del = event.target.closest("[data-delete-product]");

  if (toggle) {
    const id = toggle.dataset.toggleProduct;
    products = products.map((p) => String(p.id) === id ? { ...p, available: p.available === false } : p);
    await saveProducts("Disponibilidade atualizada.");
  }

  if (edit) {
    const id = edit.dataset.editProduct;
    const product = products.find((p) => String(p.id) === id);
    if (!product) return;
    editingId = id;
    productImageData = product.image || "";
    $("#productName").value = product.name || "";
    $("#productPrice").value = Number(product.price || 0);
    $("#productCategory").value = product.category === "bebida" ? "bebida" : "lanche";
    $("#productDescription").value = product.description || "";
    $("#productAvailable").checked = product.available !== false;
    if (productImageData) {
      $("#productPreviewImage").src = productImageData;
      $("#productPreview").hidden = false;
    } else {
      $("#productPreview").hidden = true;
    }
    $("#productFormTitle").textContent = "Editar produto";
    $("#productSaveButton").textContent = "Salvar alterações";
    $("#cancelEdit").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (del) {
    const id = del.dataset.deleteProduct;
    const product = products.find((p) => String(p.id) === id);
    if (!product || !confirm(`Excluir ${product.name}?`)) return;
    products = products.filter((p) => String(p.id) !== id);
    await saveProducts("Produto excluído.");
    if (editingId === id) resetProductForm();
  }
});

function updatePromoPreview() {
  const title = $("#promoTitle").value.trim();
  const description = $("#promoDescription").value.trim();
  const preview = $("#preview");
  if (!promoImageData && !title && !description) { preview.hidden = true; return; }
  preview.hidden = false;
  $("#previewImage").hidden = !promoImageData;
  if (promoImageData) $("#previewImage").src = promoImageData;
  $("#previewTitle").textContent = title || "Promoção";
  $("#previewDescription").textContent = description;
}

async function loadPromotion() {
  try {
    const response = await fetch("/api/promo", { cache: "no-store" });
    const promo = await response.json();
    $("#promoTitle").value = promo.title || "";
    $("#promoDescription").value = promo.description || "";
    $("#promoActive").checked = promo.active !== false;
    promoImageData = promo.image || "";
    updatePromoPreview();
  } catch {}
}

$("#promoImage").addEventListener("change", async () => {
  const file = $("#promoImage").files?.[0];
  if (!file) return;
  setStatus("#promoStatus", "Preparando imagem...");
  try {
    promoImageData = await compressImage(file, 1100, 0.74);
    updatePromoPreview();
    setStatus("#promoStatus", "Imagem pronta.", "ok");
  } catch (error) {
    setStatus("#promoStatus", error.message, "error");
  }
});

$("#promoTitle").addEventListener("input", updatePromoPreview);
$("#promoDescription").addEventListener("input", updatePromoPreview);

async function savePromotion(activeOverride = null) {
  const active = activeOverride === null ? $("#promoActive").checked : activeOverride;
  const title = $("#promoTitle").value.trim();
  if (active && !title) {
    setStatus("#promoStatus", "Digite o título da promoção.", "error");
    return;
  }
  setStatus("#promoStatus", "Salvando...");
  try {
    await api("/api/promo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active, title, description: $("#promoDescription").value.trim(), image: promoImageData })
    });
    $("#promoActive").checked = active;
    setStatus("#promoStatus", active ? "Promoção publicada." : "Promoção ocultada.", "ok");
  } catch (error) {
    setStatus("#promoStatus", error.message, "error");
  }
}

$("#promoForm").addEventListener("submit", (event) => { event.preventDefault(); savePromotion(); });
$("#hidePromoButton").addEventListener("click", () => savePromotion(false));
