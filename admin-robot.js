(() => {
  let connectionPollTimer = null;
  let connectionRequestRunning = false;

  function ensureStyle() {
    if (document.querySelector("link[data-robot-style]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "admin-robot.css";
    link.dataset.robotStyle = "1";
    document.head.appendChild(link);
  }

  function ensureShell() {
    const nav = document.querySelector(".admin-tabs");
    const adminApp = document.querySelector("#adminApp");
    if (!nav || !adminApp) return null;

    let button = nav.querySelector('[data-tab="robot"]');
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "tab-button";
      button.dataset.tab = "robot";
      button.textContent = "WhatsApp";
      button.addEventListener("click", () => {
        if (typeof switchTab === "function") switchTab("robot");
      });
      nav.appendChild(button);
    }

    let panel = document.querySelector("#tab-robot");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "tab-panel";
      panel.id = "tab-robot";
      panel.innerHTML = '<div class="panel-heading"><div><span>MENSAGENS</span><h2>WhatsApp automático</h2></div></div><div id="robotPanel"></div>';
      const note = adminApp.querySelector(".security-note");
      if (note) adminApp.insertBefore(panel, note);
      else adminApp.appendChild(panel);
    }
    return panel.querySelector("#robotPanel");
  }

  async function connectionApi(options = {}) {
    if (typeof api === "function") return api("/api/robot/connection", options);

    const headers = { ...(options.headers || {}) };
    const appToken = typeof getAdminAppToken === "function" ? getAdminAppToken() : "";
    if (appToken) headers["x-admin-app-token"] = appToken;
    const response = await fetch("/api/robot/connection", {
      ...options,
      headers,
      cache: "no-store",
      credentials: "include"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível consultar a conexão do WhatsApp.");
    return data;
  }

  function renderConnection(host, data = {}) {
    const badge = host.querySelector("#robotConnectionBadge");
    const message = host.querySelector("#robotConnectionMessage");
    const qrBox = host.querySelector("#robotQrBox");
    const qrImage = host.querySelector("#robotQrImage");
    const resetButton = host.querySelector("#robotConnectionReset");

    badge.className = "robot-connection-badge";
    qrBox.hidden = true;
    qrImage.removeAttribute("src");
    resetButton.disabled = !data.configured;
    resetButton.textContent = "Conectar WhatsApp";

    if (!data.configured) {
      badge.classList.add("is-neutral");
      badge.textContent = "Serviço não vinculado";
      message.textContent = data.message || "O serviço 24 horas ainda precisa ser vinculado a este sistema.";
      return;
    }

    if (data.connected) {
      badge.classList.add("is-connected");
      badge.textContent = "WhatsApp conectado";
      message.textContent = "Pronto para enviar pedidos e atualizações automáticas. Mensagens recebidas não serão respondidas pelo sistema.";
      resetButton.textContent = "Conectar outro WhatsApp";
      return;
    }

    if (data.qrReady && data.qrImage) {
      badge.classList.add("is-waiting");
      badge.textContent = "QR Code pronto";
      message.textContent = "Escaneie o QR Code abaixo com o WhatsApp da lanchonete.";
      qrImage.src = data.qrImage;
      qrBox.hidden = false;
      resetButton.textContent = "Gerar outro QR Code";
      return;
    }

    if (data.authState === "unreachable" || data.authState === "error") {
      badge.classList.add("is-error");
      badge.textContent = "Conexão indisponível";
      const rawError = String(data.error || data.lastError || "");
      message.textContent = /não autorizado/i.test(rawError)
        ? "O serviço do WhatsApp não autorizou a conexão. Tente atualizar o estado; se persistir, gere um novo QR Code."
        : rawError || "Não foi possível acessar o serviço do WhatsApp agora.";
      resetButton.textContent = "Tentar conectar WhatsApp";
      return;
    }

    badge.classList.add("is-preparing");
    badge.textContent = "Preparando QR Code";
    message.textContent = "Aguarde alguns segundos. Esta tela será atualizada automaticamente.";
    resetButton.textContent = "Gerar novo QR Code";
  }

  async function loadConnection(host, quiet = false) {
    if (!host || connectionRequestRunning) return;
    connectionRequestRunning = true;
    const button = host.querySelector("#robotConnectionRefresh");
    const actionStatus = host.querySelector("#robotConnectionActionStatus");
    if (!quiet) button.disabled = true;
    try {
      renderConnection(host, await connectionApi());
      if (actionStatus && !actionStatus.dataset.locked) {
        actionStatus.className = "status";
        actionStatus.textContent = "";
      }
    } catch (error) {
      renderConnection(host, { configured: true, authState: "unreachable", error: error.message });
    } finally {
      connectionRequestRunning = false;
      button.disabled = false;
    }
  }

  function renderPanel() {
    ensureStyle();
    const host = ensureShell();
    if (!host || host.dataset.robotReady === "1") return host;
    host.dataset.robotReady = "1";
    host.innerHTML = `
      <section class="robot-admin-card robot-connection-card">
        <div class="robot-admin-header">
          <div>
            <h2>Conexão do WhatsApp</h2>
            <p>Esta conexão serve somente para enviar pedidos e avisos automáticos. Ela não atende nem responde clientes.</p>
          </div>
          <span class="robot-connection-badge is-preparing" id="robotConnectionBadge">Verificando</span>
        </div>
        <p class="robot-connection-message" id="robotConnectionMessage">Consultando o serviço do WhatsApp...</p>
        <div class="robot-qr-box" id="robotQrBox" hidden>
          <img id="robotQrImage" alt="QR Code para conectar o WhatsApp">
          <ol>
            <li>Abra o WhatsApp da lanchonete.</li>
            <li>Entre em <strong>Aparelhos conectados</strong>.</li>
            <li>Toque em <strong>Conectar um aparelho</strong> e leia este código.</li>
          </ol>
        </div>
        <div class="robot-actions">
          <button type="button" class="admin-secondary" id="robotConnectionRefresh">Atualizar estado</button>
          <button type="button" class="admin-primary" id="robotConnectionReset">Conectar WhatsApp</button>
        </div>
        <p class="status" id="robotConnectionActionStatus" aria-live="polite"></p>
      </section>

      <section class="robot-admin-card">
        <div class="robot-admin-header">
          <div>
            <h2>Mensagens automáticas</h2>
            <p>O envio acontece sozinho. Não é necessário abrir conversas ou tocar novamente no WhatsApp.</p>
          </div>
          <span class="robot-status is-on">● Automático</span>
        </div>
        <div class="robot-note">
          <strong>O sistema enviará:</strong>
          <ul class="automatic-message-list">
            <li>o pedido completo para o WhatsApp da lanchonete;</li>
            <li>a confirmação de recebimento para o cliente;</li>
            <li>pedido confirmado;</li>
            <li>pedido saiu para entrega ou está pronto para retirada;</li>
            <li>pedido cancelado.</li>
          </ul>
        </div>
        <div class="robot-note"><strong>Sem atendimento automático:</strong> mensagens que o cliente enviar serão deixadas para a equipe responder normalmente.</div>
      </section>`;

    host.querySelector("#robotConnectionRefresh").addEventListener("click", () => loadConnection(host));
    host.querySelector("#robotConnectionReset").addEventListener("click", async () => {
      const badge = host.querySelector("#robotConnectionBadge");
      const isConnected = badge?.classList.contains("is-connected");
      if (isConnected && !confirm("Isso desconectará o WhatsApp atual e gerará um novo QR Code. Continuar?")) return;

      const button = host.querySelector("#robotConnectionReset");
      const status = host.querySelector("#robotConnectionActionStatus");
      button.disabled = true;
      status.dataset.locked = "1";
      status.className = "status";
      status.textContent = "Preparando um novo QR Code...";
      try {
        const result = await connectionApi({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reset" })
        });
        status.className = "status ok";
        status.textContent = result.message || "Novo QR Code solicitado.";
        renderConnection(host, { configured: true, authState: "starting" });
        setTimeout(() => {
          delete status.dataset.locked;
          loadConnection(host);
        }, 1400);
      } catch (error) {
        status.className = "status error";
        status.textContent = error.message || "Não foi possível gerar um novo QR Code.";
        delete status.dataset.locked;
      } finally {
        button.disabled = false;
      }
    });

    loadConnection(host);
    connectionPollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const panel = document.querySelector("#tab-robot");
      if (panel?.classList.contains("active")) loadConnection(host, true);
    }, 4000);
    return host;
  }

  window.LanchoneteRobot = { renderRobotPanel: renderPanel };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderPanel);
  else renderPanel();
})();
