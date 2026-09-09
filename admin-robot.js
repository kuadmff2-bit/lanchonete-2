(() => {
  const DEFAULTS = {
    enabled: false,
    greeting: 'Olá! 👋 Sou o atendimento automático da Lanchonete 2. Como posso ajudar?',
    fallback: 'Não consegui entender sua mensagem. Digite *menu* para ver as opções ou aguarde um atendente.',
    humanHandoff: true,
    businessHoursOnly: false,
    openTime: '18:00',
    closeTime: '23:59',
    menuText: '1 - Ver cardápio\n2 - Fazer pedido\n3 - Acompanhar pedido\n4 - Falar com atendente',
    deliveryFee: 0,
    updatedAt: null
  };

  const STORAGE_KEY = 'lanchonete_2_robot_settings_v1';
  let currentSettings = { ...DEFAULTS };
  let connectionPollTimer = null;
  let connectionRequestRunning = false;

  function loadLocalSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function persistLocal(settings) {
    currentSettings = { ...DEFAULTS, ...settings };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings)); } catch (_) {}
    return currentSettings;
  }

  async function loadRemoteSettings() {
    const local = loadLocalSettings();
    currentSettings = local;
    try {
      const response = await fetch('/api/robot', { cache: 'no-store' });
      if (!response.ok) throw new Error('Falha ao carregar configurações');
      const data = await response.json();
      currentSettings = persistLocal({ ...local, ...data });
    } catch (_) {
      currentSettings = local;
    }
    return currentSettings;
  }

  async function saveSettings(settings) {
    const next = persistLocal({ ...DEFAULTS, ...settings, updatedAt: new Date().toISOString() });
    try {
      if (typeof api === 'function') {
        const data = await api('/api/robot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next)
        });
        if (data?.settings) persistLocal(data.settings);
      } else {
        const headers = { 'content-type': 'application/json' };
        if (typeof adminPassword !== 'undefined' && adminPassword) headers['x-admin-password'] = adminPassword;
        const response = await fetch('/api/robot', { method: 'POST', headers, body: JSON.stringify(next) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o robô.');
        if (data?.settings) persistLocal(data.settings);
      }
      window.dispatchEvent(new CustomEvent('lanchonete-robot-settings', { detail: currentSettings }));
      return { ok: true, settings: currentSettings };
    } catch (error) {
      return { ok: false, settings: next, error };
    }
  }

  function isWithinBusinessHours(settings = currentSettings, now = new Date()) {
    if (!settings.businessHoursOnly) return true;
    const [oh, om] = String(settings.openTime || '00:00').split(':').map(Number);
    const [ch, cm] = String(settings.closeTime || '23:59').split(':').map(Number);
    const current = now.getHours() * 60 + now.getMinutes();
    const open = oh * 60 + om;
    const close = ch * 60 + cm;
    return open <= close ? current >= open && current <= close : current >= open || current <= close;
  }

  function getReply(message, settings = currentSettings) {
    if (!settings.enabled) return null;
    if (!isWithinBusinessHours(settings)) {
      return 'Olá! Nosso atendimento automático está fora do horário configurado. Assim que possível, um atendente continuará com você.';
    }

    const text = String(message || '').trim().toLowerCase();
    if (!text) return settings.greeting;

    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|iniciar|começar|comecar)$/.test(text)) {
      return `${settings.greeting}\n\n${settings.menuText}`;
    }
    if (/^(1|cardápio|cardapio|menu de produtos|produtos)$/.test(text)) {
      return 'Você pode conferir os produtos disponíveis diretamente no nosso cardápio. Se quiser, diga o nome de um produto para eu tentar ajudar.';
    }
    if (/^(2|pedido|fazer pedido|quero pedir|comprar)$/.test(text)) {
      return 'Perfeito! Escolha os itens no cardápio e finalize o pedido. Se precisar de ajuda durante o pedido, é só me chamar.';
    }
    if (/^(3|acompanhar|acompanhar pedido|status|meu pedido)$/.test(text)) {
      return 'Para acompanhar seu pedido, informe o número ou nome usado no pedido.';
    }
    if (/^(4|atendente|humano|falar com atendente|secretaria|suporte)$/.test(text)) {
      return settings.humanHandoff
        ? 'Certo. Vou encaminhar seu atendimento para uma pessoa da equipe.'
        : settings.fallback;
    }
    return settings.fallback;
  }

  function ensureStyle() {
    if (document.querySelector('link[data-robot-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'admin-robot.css';
    link.dataset.robotStyle = '1';
    document.head.appendChild(link);
  }

  function ensureShell() {
    const nav = document.querySelector('.admin-tabs');
    const adminApp = document.querySelector('#adminApp');
    if (!nav || !adminApp) return null;

    let button = nav.querySelector('[data-tab="robot"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab-button';
      button.dataset.tab = 'robot';
      button.textContent = 'Robô';
      button.addEventListener('click', () => {
        if (typeof switchTab === 'function') switchTab('robot');
      });
      nav.appendChild(button);
    }

    let panel = document.querySelector('#tab-robot');
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.id = 'tab-robot';
      panel.innerHTML = '<div id="robotPanel"></div>';
      const note = adminApp.querySelector('.security-note');
      if (note) adminApp.insertBefore(panel, note); else adminApp.appendChild(panel);
    }
    return panel.querySelector('#robotPanel');
  }

  function updateForm(host, settings) {
    if (!host) return;
    host.querySelector('#robotEnabled').checked = Boolean(settings.enabled);
    host.querySelector('#robotGreeting').value = settings.greeting || DEFAULTS.greeting;
    host.querySelector('#robotFallback').value = settings.fallback || DEFAULTS.fallback;
    host.querySelector('#robotMenuText').value = settings.menuText || DEFAULTS.menuText;
    host.querySelector('#robotHumanHandoff').checked = settings.humanHandoff !== false;
    host.querySelector('#robotBusinessHoursOnly').checked = Boolean(settings.businessHoursOnly);
    host.querySelector('#robotOpenTime').value = settings.openTime || '18:00';
    host.querySelector('#robotCloseTime').value = settings.closeTime || '23:59';
    host.querySelector('#robotDeliveryFee').value = Number(settings.deliveryFee || 0).toFixed(2);
    refreshStatus(host);
  }

  function refreshStatus(host) {
    const on = host.querySelector('#robotEnabled').checked;
    const status = host.querySelector('#robotStatus');
    status.className = `robot-status ${on ? 'is-on' : 'is-off'}`;
    status.textContent = on ? '● Robô ligado' : '● Robô desligado';
  }

  async function connectionApi(options = {}) {
    if (typeof api === 'function') return api('/api/robot/connection', options);

    const headers = { ...(options.headers || {}) };
    if (typeof adminPassword !== 'undefined' && adminPassword) headers['x-admin-password'] = adminPassword;
    const response = await fetch('/api/robot/connection', {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'include'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível consultar a conexão do WhatsApp.');
    return data;
  }

  function renderConnection(host, data = {}) {
    if (!host) return;
    const badge = host.querySelector('#robotConnectionBadge');
    const message = host.querySelector('#robotConnectionMessage');
    const qrBox = host.querySelector('#robotQrBox');
    const qrImage = host.querySelector('#robotQrImage');
    const resetButton = host.querySelector('#robotConnectionReset');

    badge.className = 'robot-connection-badge';
    qrBox.hidden = true;
    qrImage.removeAttribute('src');
    resetButton.disabled = !data.configured;

    if (!data.configured) {
      badge.classList.add('is-neutral');
      badge.textContent = 'Serviço não vinculado';
      message.textContent = data.message || 'O serviço 24 horas ainda precisa ser vinculado a este sistema.';
      return;
    }

    if (data.connected) {
      badge.classList.add('is-connected');
      badge.textContent = 'WhatsApp conectado';
      message.textContent = 'A conexão está ativa e o robô pode receber mensagens.';
      return;
    }

    if (data.qrReady && data.qrImage) {
      badge.classList.add('is-waiting');
      badge.textContent = 'Aguardando leitura';
      message.textContent = 'Abra o WhatsApp no celular que será usado pela lanchonete e leia o código abaixo.';
      qrImage.src = data.qrImage;
      qrBox.hidden = false;
      return;
    }

    if (data.authState === 'unreachable' || data.authState === 'error') {
      badge.classList.add('is-error');
      badge.textContent = 'Conexão indisponível';
      message.textContent = data.error || data.lastError || 'Não foi possível acessar o serviço do WhatsApp agora.';
      return;
    }

    badge.classList.add('is-preparing');
    badge.textContent = 'Preparando QR Code';
    message.textContent = 'Aguarde alguns segundos. Esta tela será atualizada automaticamente.';
  }

  async function loadConnection(host, { quiet = false } = {}) {
    if (!host || connectionRequestRunning) return;
    connectionRequestRunning = true;
    const refreshButton = host.querySelector('#robotConnectionRefresh');
    if (!quiet) refreshButton.disabled = true;

    try {
      renderConnection(host, await connectionApi());
    } catch (error) {
      renderConnection(host, {
        configured: true,
        connected: false,
        authState: 'unreachable',
        error: error.message
      });
    } finally {
      connectionRequestRunning = false;
      refreshButton.disabled = false;
    }
  }

  function startConnectionPolling(host) {
    if (connectionPollTimer) clearInterval(connectionPollTimer);
    connectionPollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const panel = document.querySelector('#tab-robot');
      if (panel && !panel.classList.contains('active')) return;
      loadConnection(host, { quiet: true });
    }, 5000);
  }

  function renderRobotPanel() {
    ensureStyle();
    const host = ensureShell();
    if (!host || host.dataset.robotReady === '1') return host;
    host.dataset.robotReady = '1';

    host.innerHTML = `
      <section class="robot-admin-card robot-connection-card">
        <div class="robot-admin-header">
          <div>
            <h2>Conexão do WhatsApp</h2>
            <p>O QR Code aparece aqui e a conexão fica salva para o atendimento funcionar 24 horas.</p>
          </div>
          <span class="robot-connection-badge is-preparing" id="robotConnectionBadge">Verificando</span>
        </div>

        <p class="robot-connection-message" id="robotConnectionMessage">Consultando o serviço do WhatsApp...</p>

        <div class="robot-qr-box" id="robotQrBox" hidden>
          <img id="robotQrImage" alt="QR Code para conectar o WhatsApp">
          <ol>
            <li>Abra o WhatsApp no celular da lanchonete.</li>
            <li>Entre em <strong>Aparelhos conectados</strong>.</li>
            <li>Toque em <strong>Conectar um aparelho</strong> e leia este código.</li>
          </ol>
        </div>

        <div class="robot-actions">
          <button type="button" class="admin-secondary" id="robotConnectionRefresh">Atualizar estado</button>
          <button type="button" class="admin-primary" id="robotConnectionReset">Conectar outro WhatsApp</button>
        </div>
        <p class="status" id="robotConnectionActionStatus" aria-live="polite"></p>
      </section>

      <section class="robot-admin-card">
        <div class="robot-admin-header">
          <div>
            <h2>Robô de atendimento</h2>
            <p>Configure as respostas automáticas e deixe tudo pronto para o canal de WhatsApp conectado ao sistema.</p>
          </div>
          <label class="robot-switch"><input id="robotEnabled" type="checkbox"><span></span></label>
        </div>

        <div class="robot-status is-off" id="robotStatus">● Robô desligado</div>

        <div class="robot-grid">
          <label>Mensagem de saudação<textarea id="robotGreeting" rows="3"></textarea></label>
          <label>Mensagem quando não entender<textarea id="robotFallback" rows="3"></textarea></label>
          <label class="robot-full">Menu automático<textarea id="robotMenuText" rows="5"></textarea></label>
        </div>

        <div class="robot-options">
          <label><input id="robotHumanHandoff" type="checkbox"> Permitir encaminhar para atendente humano</label>
          <label><input id="robotBusinessHoursOnly" type="checkbox"> Responder apenas no horário configurado</label>
        </div>

        <div class="robot-hours">
          <label>Abertura<input id="robotOpenTime" type="time"></label>
          <label>Fechamento<input id="robotCloseTime" type="time"></label>
          <label>Taxa de entrega (R$)<input id="robotDeliveryFee" type="number" min="0" max="1000" step="0.01" inputmode="decimal"></label>
        </div>

        <div class="robot-actions">
          <button type="button" class="admin-primary" id="robotSave">Salvar configurações</button>
          <button type="button" class="admin-secondary" id="robotTest">Testar robô</button>
        </div>
        <p class="status" id="robotSaveStatus" aria-live="polite"></p>

        <div class="robot-test" id="robotTestBox" hidden>
          <div class="robot-test-title">Teste rápido</div>
          <div class="robot-test-row"><input id="robotTestInput" placeholder="Digite: oi, menu, 1, pedido, atendente..."><button type="button" id="robotTestSend">Enviar</button></div>
          <div class="robot-test-reply" id="robotTestReply"></div>
        </div>

        <div class="robot-note"><strong>Sincronização:</strong> o robô usa os produtos, preços e disponibilidade publicados neste cardápio.</div>
      </section>`;

    const collect = () => ({
      enabled: host.querySelector('#robotEnabled').checked,
      greeting: host.querySelector('#robotGreeting').value.trim() || DEFAULTS.greeting,
      fallback: host.querySelector('#robotFallback').value.trim() || DEFAULTS.fallback,
      humanHandoff: host.querySelector('#robotHumanHandoff').checked,
      businessHoursOnly: host.querySelector('#robotBusinessHoursOnly').checked,
      openTime: host.querySelector('#robotOpenTime').value || '18:00',
      closeTime: host.querySelector('#robotCloseTime').value || '23:59',
      menuText: host.querySelector('#robotMenuText').value.trim() || DEFAULTS.menuText,
      deliveryFee: Math.max(0, Math.min(1000, Number(host.querySelector('#robotDeliveryFee').value.replace(',', '.')) || 0))
    });

    host.querySelector('#robotEnabled').addEventListener('change', () => refreshStatus(host));
    host.querySelector('#robotSave').addEventListener('click', async () => {
      const btn = host.querySelector('#robotSave');
      const status = host.querySelector('#robotSaveStatus');
      btn.disabled = true;
      status.className = 'status';
      status.textContent = 'Salvando...';
      const result = await saveSettings(collect());
      btn.disabled = false;
      refreshStatus(host);
      if (result.ok) {
        status.className = 'status ok';
        status.textContent = 'Configurações do robô salvas e sincronizadas.';
      } else {
        status.className = 'status error';
        status.textContent = result.error?.message || 'Salvo neste aparelho, mas não foi possível sincronizar com o servidor.';
      }
    });

    host.querySelector('#robotTest').addEventListener('click', () => {
      const box = host.querySelector('#robotTestBox');
      box.hidden = !box.hidden;
      if (!box.hidden) host.querySelector('#robotTestInput').focus();
    });

    const sendTest = () => {
      const reply = getReply(host.querySelector('#robotTestInput').value, collect());
      host.querySelector('#robotTestReply').textContent = reply || 'O robô está desligado.';
    };
    host.querySelector('#robotTestSend').addEventListener('click', sendTest);
    host.querySelector('#robotTestInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') sendTest(); });

    host.querySelector('#robotConnectionRefresh').addEventListener('click', () => loadConnection(host));
    host.querySelector('#robotConnectionReset').addEventListener('click', async () => {
      const confirmed = confirm('Isso desconectará o WhatsApp atual e gerará um novo QR Code. Continuar?');
      if (!confirmed) return;

      const button = host.querySelector('#robotConnectionReset');
      const status = host.querySelector('#robotConnectionActionStatus');
      button.disabled = true;
      status.className = 'status';
      status.textContent = 'Preparando uma nova conexão...';

      try {
        const result = await connectionApi({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        });
        status.className = 'status ok';
        status.textContent = result.message || 'Novo QR Code solicitado.';
        renderConnection(host, { configured: true, authState: 'starting' });
        setTimeout(() => loadConnection(host), 1200);
      } catch (error) {
        status.className = 'status error';
        status.textContent = error.message || 'Não foi possível gerar um novo QR Code.';
      } finally {
        button.disabled = false;
      }
    });

    updateForm(host, currentSettings);
    loadConnection(host);
    startConnectionPolling(host);
    return host;
  }

  async function boot() {
    currentSettings = loadLocalSettings();
    const host = renderRobotPanel();
    const settings = await loadRemoteSettings();
    updateForm(host, settings);
  }

  window.LanchoneteRobot = {
    get settings() { return { ...currentSettings }; },
    loadRemoteSettings,
    saveSettings,
    getReply,
    isWithinBusinessHours,
    renderRobotPanel
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
