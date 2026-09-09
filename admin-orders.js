// Gestão dos pedidos para uso diário da lanchonete.
const orderStyles = document.createElement("link");
orderStyles.rel = "stylesheet";
orderStyles.href = "admin-orders.css";
document.head.appendChild(orderStyles);

const ORDER_STATUS_LABELS = {
  novo: "Novo",
  confirmado: "Confirmado",
  preparando: "Preparando",
  saiu_entrega: "Saiu para entrega",
  finalizado: "Finalizado",
  cancelado: "Cancelado"
};

const ORDER_ACTIONS = [
  { status: "confirmado", label: "✓ Confirmado", className: "confirmado" },
  { status: "saiu_entrega", label: "➜ Saiu pra entrega", className: "entrega" },
  { status: "cancelado", label: "✕ Cancelado", className: "cancelado" }
];

function orderActionButtons(orderId, currentStatus) {
  return ORDER_ACTIONS.map(({ status, label, className }) => `
    <button
      type="button"
      class="order-action-button action-${className}${currentStatus === status ? " is-active" : ""}"
      data-order-id="${esc(orderId)}"
      data-order-status="${status}"
      aria-pressed="${currentStatus === status ? "true" : "false"}"
    >${label}</button>
  `).join("");
}

function normalizeWhatsAppPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55\d{10,11}$/.test(digits) ? digits : "";
}

function formatWhatsAppPhone(value) {
  const phone = normalizeWhatsAppPhone(value);
  if (!phone) return "";
  const local = phone.slice(2);
  const ddd = local.slice(0, 2);
  const number = local.slice(2);
  if (number.length === 9) return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
}

function customerStatusMessage(order, status) {
  const name = String(order?.customerName || "Cliente").trim();
  const orderId = String(order?.id || "").trim();

  if (status === "confirmado") {
    return `Olá, ${name}! Seu pedido ${orderId} foi confirmado ✅. Já estamos cuidando dele.`;
  }

  if (status === "saiu_entrega") {
    if (order?.deliveryType === "Retirada") {
      return `Olá, ${name}! Seu pedido ${orderId} está pronto para retirada ✅.`;
    }
    return `Olá, ${name}! Seu pedido ${orderId} saiu para entrega 🛵. Em breve chega até você.`;
  }

  if (status === "cancelado") {
    return `Olá, ${name}. Seu pedido ${orderId} foi cancelado. Se precisar de ajuda, fale com a lanchonete por aqui.`;
  }

  return "";
}

function openCustomerWhatsApp(order, status) {
  const phone = normalizeWhatsAppPhone(order?.customerPhone);
  const message = customerStatusMessage(order, status);
  if (!phone || !message) return false;
  window.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  return true;
}

renderDashboard = function (data) {
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
    const dateText = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const status = ORDER_STATUS_LABELS[order.status] ? order.status : "novo";
    const itemText = Array.isArray(order.items) && order.items.length
      ? order.items.map((item) => `${Number(item.qty || 1)}x ${esc(item.name)}`).join(", ")
      : `${Number(order.itemCount || 0)} item(ns)`;
    const deliveryInfo = order.deliveryType === "Entrega" && order.address
      ? `<small class="order-detail"><b>Entrega:</b> ${esc(order.address)}${order.reference ? ` · Ref.: ${esc(order.reference)}` : ""}</small>`
      : `<small class="order-detail"><b>${esc(order.deliveryType || "Pedido")}</b></small>`;
    const note = order.note ? `<small class="order-detail"><b>Obs.:</b> ${esc(order.note)}</small>` : "";
    const phone = formatWhatsAppPhone(order.customerPhone);
    const phoneInfo = phone
      ? `<small class="order-detail order-phone"><b>WhatsApp:</b> ${esc(phone)}</small>`
      : `<small class="order-detail order-phone missing"><b>WhatsApp:</b> não informado neste pedido</small>`;

    return `<article class="recent-order order-card status-${status}">
      <div class="recent-order-id">
        <strong>${esc(order.id || "Pedido")}</strong>
        <small>${esc(dateText)} · ${esc(time)}</small>
        <span class="order-status-badge status-${status}">${esc(ORDER_STATUS_LABELS[status])}</span>
      </div>
      <div class="recent-order-main">
        <strong>${esc(order.customerName || "Cliente")}</strong>
        ${phoneInfo}
        <small>${itemText}</small>
        <small class="order-detail">${esc(order.deliveryType || "")} · ${esc(order.payment || "")}</small>
        ${deliveryInfo}
        ${note}
      </div>
      <div class="recent-order-side">
        <strong class="recent-order-total">${money(order.total)}</strong>
        <div class="order-status-actions" aria-label="Ações do pedido ${esc(order.id || "")}">
          ${orderActionButtons(order.id || "", status)}
        </div>
      </div>
    </article>`;
  }).join("") : '<p class="empty-admin">Ainda não há pedidos registrados.</p>';

  const count = recent.length;
  const counter = document.querySelector(".recent-card .card-title span");
  if (counter) counter.textContent = count === 1 ? "1 pedido" : `${count} pedidos recentes`;
};

$("#recentOrders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-order-status][data-order-id]");
  if (!button) return;

  const orderId = button.dataset.orderId;
  const status = button.dataset.orderStatus;
  const card = button.closest(".order-card");
  const actionButtons = card ? [...card.querySelectorAll("[data-order-status][data-order-id]")] : [button];
  actionButtons.forEach((item) => { item.disabled = true; });
  setStatus("#dashboardStatus", `Atualizando ${orderId}...`);

  try {
    const data = await api(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    renderDashboard(data);

    const updatedOrder = data?.order || {};
    if (openCustomerWhatsApp(updatedOrder, status)) {
      setStatus("#dashboardStatus", `Pedido ${orderId}: ${ORDER_STATUS_LABELS[status]}. Abrindo mensagem para o cliente...`, "ok");
    } else {
      setStatus("#dashboardStatus", `Pedido ${orderId}: ${ORDER_STATUS_LABELS[status]}. Este pedido não tem WhatsApp salvo.`, "ok");
    }
  } catch (error) {
    setStatus("#dashboardStatus", error.message || "Não foi possível mudar o status.", "error");
    await refreshOrders();
  }
});

// O APK recebe uma sessão segura por cookie. Se ainda estiver válida,
// o painel abre direto sem pedir a senha novamente.
async function restoreAdminSession() {
  try {
    const response = await fetch("/api/orders", { cache: "no-store", credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    $("#loginPanel").hidden = true;
    $("#adminApp").hidden = false;
    renderDashboard(data);
    await Promise.all([loadProducts(), loadPromotion()]);
  } catch {}
}

$("#logoutButton").addEventListener("click", () => {
  fetch("/api/logout", { method: "POST", credentials: "include", keepalive: true }).catch(() => {});
});

// Mantém a tela do dono atualizada sem precisar tocar em Atualizar toda hora.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  const app = $("#adminApp");
  if (!app || app.hidden) return;
  refreshOrders().catch(() => {});
}, 20000);

restoreAdminSession();
