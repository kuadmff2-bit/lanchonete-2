(() => {
  const DEFAULT_NUMBER = "5592992973832";

  function digits(value) {
    let number = String(value || "").replace(/\D/g, "");
    if (number.length === 10 || number.length === 11) number = `55${number}`;
    return /^55\d{10,11}$/.test(number) ? number : "";
  }

  function format(number) {
    const normalized = digits(number);
    if (!normalized) return "";
    const local = normalized.slice(2);
    const ddd = local.slice(0, 2);
    const body = local.slice(2);
    return body.length === 9
      ? `(${ddd}) ${body.slice(0, 5)}-${body.slice(5)}`
      : `(${ddd}) ${body.slice(0, 4)}-${body.slice(4)}`;
  }

  function maskInput(value) {
    let local = String(value || "").replace(/\D/g, "");
    if (local.startsWith("55") && local.length > 11) local = local.slice(2);
    local = local.slice(0, 11);
    if (local.length <= 2) return local;
    const ddd = local.slice(0, 2);
    const body = local.slice(2);
    if (body.length <= 4) return `(${ddd}) ${body}`;
    if (body.length <= 8) return `(${ddd}) ${body.slice(0, 4)}-${body.slice(4)}`;
    return `(${ddd}) ${body.slice(0, 5)}-${body.slice(5)}`;
  }

  async function loadContact() {
    const response = await fetch('/api/business-contact', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o número.');
    return data;
  }

  async function saveContact(number) {
    if (typeof api === 'function') {
      return api('/api/business-contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ whatsappNumber: number })
      });
    }
    const headers = { 'content-type': 'application/json' };
    if (typeof adminPassword !== 'undefined' && adminPassword) headers['x-admin-password'] = adminPassword;
    const response = await fetch('/api/business-contact', {
      method: 'POST', headers, body: JSON.stringify({ whatsappNumber: number })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o número.');
    return data;
  }

  function ensureContactCard() {
    const host = document.querySelector('#robotPanel');
    if (!host || host.querySelector('#businessWhatsappCard')) return;

    const card = document.createElement('section');
    card.id = 'businessWhatsappCard';
    card.className = 'robot-admin-card';
    card.style.marginBottom = '14px';
    card.innerHTML = `
      <div class="robot-admin-header">
        <div>
          <h2>📱 WhatsApp da lanchonete</h2>
          <p>Este é o número central usado pelo site e pelo robô. Alterando aqui, os botões e pedidos do site passam a usar o novo número automaticamente.</p>
        </div>
      </div>
      <div class="robot-grid">
        <label class="robot-full">Número do WhatsApp
          <input id="businessWhatsappInput" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="(92) 99999-9999">
        </label>
      </div>
      <div class="robot-actions">
        <button type="button" class="admin-primary" id="businessWhatsappSave">Salvar número</button>
      </div>
      <p class="status" id="businessWhatsappStatus" aria-live="polite"></p>
      <div class="robot-note"><strong>Sincronização automática:</strong> o site público e qualquer serviço do robô conectado a <code>/api/business-contact</code> passam a consultar este mesmo número.</div>
    `;

    host.insertAdjacentElement('afterbegin', card);
    const input = card.querySelector('#businessWhatsappInput');
    const button = card.querySelector('#businessWhatsappSave');
    const status = card.querySelector('#businessWhatsappStatus');

    input.addEventListener('input', () => { input.value = maskInput(input.value); });

    loadContact().then((data) => {
      input.value = data.whatsappDisplay || format(data.whatsappNumber || DEFAULT_NUMBER);
    }).catch((error) => {
      input.value = format(DEFAULT_NUMBER);
      status.className = 'status error';
      status.textContent = error.message;
    });

    button.addEventListener('click', async () => {
      const normalized = digits(input.value);
      if (!normalized) {
        status.className = 'status error';
        status.textContent = 'Informe um número válido com DDD. Ex.: (92) 99999-9999.';
        return;
      }
      button.disabled = true;
      status.className = 'status';
      status.textContent = 'Salvando número...';
      try {
        const result = await saveContact(normalized);
        input.value = result.whatsappDisplay || format(result.whatsappNumber || normalized);
        status.className = 'status ok';
        status.textContent = 'Número atualizado no site e na configuração central do robô.';
      } catch (error) {
        status.className = 'status error';
        status.textContent = error.message || 'Não foi possível salvar o número.';
      } finally {
        button.disabled = false;
      }
    });
  }

  const observer = new MutationObserver(ensureContactCard);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureContactCard);
  else ensureContactCard();
})();
