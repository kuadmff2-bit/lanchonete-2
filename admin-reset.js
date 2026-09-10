(() => {
  const refreshButton = document.querySelector("#refreshOrders");
  if (!refreshButton) return;

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  refreshButton.parentNode.insertBefore(actions, refreshButton);
  actions.appendChild(refreshButton);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.id = "clearOrdersButton";
  clearButton.className = "secondary-small danger-outline";
  clearButton.textContent = "Limpar pedidos e valores";
  actions.appendChild(clearButton);

  clearButton.addEventListener("click", async () => {
    const first = confirm("Isso vai zerar TODOS os pedidos, valores acumulados e o histórico de pedidos. Produtos e promoções não serão apagados. Continuar?");
    if (!first) return;

    const second = confirm("Tem certeza? Essa ação não pode ser desfeita.");
    if (!second) return;

    clearButton.disabled = true;
    setStatus("#dashboardStatus", "Limpando pedidos e valores...");

    try {
      const data = await api("/api/orders", { method: "DELETE" });
      renderDashboard(data);
      setStatus("#dashboardStatus", "Pedidos, valores e histórico foram zerados.", "ok");
    } catch (error) {
      setStatus("#dashboardStatus", error.message || "Não foi possível limpar os dados.", "error");
    } finally {
      clearButton.disabled = false;
    }
  });
})();

// No APK administrativo não existe formulário: uma chave exclusiva é entregue
// pelo app nativo e validada pelo mesmo backend do painel web.
(() => {
  const isAdminApp = (navigator.userAgent || "").includes("LanchoneteAdminApp/");
  if (!isAdminApp) return;
  const token = typeof getAdminAppToken === "function" ? getAdminAppToken() : "";
  if (!token) return;
  adminAppToken = token;

  const loginPanel = document.querySelector("#loginPanel");
  const adminApp = document.querySelector("#adminApp");
  const logoutButton = document.querySelector("#logoutButton");

  if (loginPanel) loginPanel.hidden = true;
  if (adminApp) adminApp.hidden = false;
  if (logoutButton) logoutButton.hidden = true;

  (async () => {
    try {
      const orders = await api("/api/orders");
      if (typeof renderDashboard === "function") renderDashboard(orders);
      if (typeof loadProducts === "function" && typeof loadPromotion === "function") {
        await Promise.all([loadProducts(), loadPromotion()]);
      }
    } catch (error) {
      if (typeof setStatus === "function") {
        setStatus("#dashboardStatus", error.message || "Não foi possível abrir o painel administrativo.", "error");
      }
    }
  })();
})();

// Carrega a conexão e a configuração transacional do WhatsApp.
(() => {
  if (!document.querySelector('script[data-admin-robot]')) {
    const script = document.createElement('script');
    script.src = 'admin-robot.js';
    script.defer = true;
    script.dataset.adminRobot = '1';
    document.body.appendChild(script);
  }

  if (!document.querySelector('script[data-admin-whatsapp]')) {
    const contactScript = document.createElement('script');
    contactScript.src = 'admin-whatsapp.js';
    contactScript.defer = true;
    contactScript.dataset.adminWhatsapp = '1';
    document.body.appendChild(contactScript);
  }
})();
