const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const wppconnect = require('@wppconnect-team/wppconnect');

const PORT = Number(process.env.PORT || 3000);
const ROBOT_API_BASE = String(process.env.ROBOT_API_BASE || process.env.LANCHONETE_ROBOT_API_BASE || 'https://lanchonete-2.kuadmff2.workers.dev').replace(/\/$/, '');
const ROBOT_WEBHOOK_TOKEN = String(process.env.ROBOT_WEBHOOK_TOKEN || process.env.LANCHONETE_ROBOT_WEBHOOK_TOKEN || '');
const SESSION_NAME = String(process.env.WPP_SESSION || process.env.LANCHONETE_WPP_SESSION || 'lanchonete-2-whatsapp');
const TOKEN_DIR = String(process.env.WPP_TOKEN_PATH || path.join(process.cwd(), 'tokens'));
const SUPERVISED = process.env.ROBOT_SUPERVISED === '1';
const QR_ACCESS_TOKEN = String(process.env.QR_ACCESS_TOKEN || crypto.randomBytes(20).toString('hex'));
const ROBOT_CONTROL_TOKEN = String(process.env.ROBOT_CONTROL_TOKEN || QR_ACCESS_TOKEN);
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';
const DIRECT_CONTROL = process.env.ROBOT_DIRECT_CONTROL === '1';

let clientRef = null;
let connected = false;
let qrImage = null;
let authState = 'starting';
let lastError = '';
let reconnectTimer = null;
let starting = false;
let connectedAt = null;
let stateSyncRunning = false;
let stateSyncPending = false;
let commandPollRunning = false;
let lastCommandId = '';
let lastBridgeWarningAt = 0;
let clientWatchRunning = false;
let consecutiveClientWatchFailures = 0;

fs.mkdirSync(TOKEN_DIR, { recursive: true });
lastCommandId = loadLastCommandId();

function publicDomain() {
  return process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`;
}

function normalizeOutgoingPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55\d{10,11}$/.test(digits) ? digits : '';
}

function cleanMessageText(value, fallback = '') {
  return String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function orderLines(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.map((item) => {
    const qty = Math.max(1, Number(item?.qty || 1));
    const subtotal = Number(item?.subtotal ?? (Number(item?.unitPrice || 0) * qty));
    return `${qty}x ${cleanMessageText(item?.name, 'Item')} — ${money(subtotal)}`;
  });
}

function businessOrderMessage(order) {
  const lines = [
    '🍔 *NOVO PEDIDO*',
    `*Pedido:* ${cleanMessageText(order?.id)}`,
    '',
    `*Cliente:* ${cleanMessageText(order?.customerName, 'Cliente')}`,
    `*WhatsApp:* ${cleanMessageText(order?.customerPhone)}`,
    `*Recebimento:* ${cleanMessageText(order?.deliveryType, 'Não informado')}`,
  ];
  if (order?.deliveryType === 'Entrega') {
    lines.push(`*Endereço:* ${cleanMessageText(order?.address, 'Não informado')}`);
    if (order?.reference) lines.push(`*Referência:* ${cleanMessageText(order.reference)}`);
  }
  lines.push('', '*ITENS*', ...orderLines(order));
  lines.push('', `*Total:* ${money(order?.total)}`, `*Pagamento:* ${cleanMessageText(order?.payment, 'Não informado')}`);
  if (order?.changeFor) lines.push(`*Troco para:* ${cleanMessageText(order.changeFor)}`);
  if (order?.note) lines.push('', `*Observação:* ${cleanMessageText(order.note)}`);
  lines.push('', 'O pedido também está disponível no APK administrativo.');
  return lines.join('\n');
}

function customerReceiptMessage(order) {
  const lines = [
    '✅ *Pedido realizado com sucesso!*',
    '',
    `Olá, ${cleanMessageText(order?.customerName, 'cliente')}! Recebemos o pedido *${cleanMessageText(order?.id)}*.`,
    '',
    ...orderLines(order),
    '',
    `*Total:* ${money(order?.total)}`,
    `*Pagamento:* ${cleanMessageText(order?.payment, 'Não informado')}`,
    order?.deliveryType === 'Retirada'
      ? '*Recebimento:* retirada na lanchonete'
      : `*Entrega:* ${cleanMessageText(order?.address, 'endereço informado')}`,
    '',
    'Você receberá as atualizações do pedido por aqui.'
  ];
  return lines.join('\n');
}

function customerStatusMessage(order, status) {
  const name = cleanMessageText(order?.customerName, 'cliente');
  const orderId = cleanMessageText(order?.id);
  if (status === 'confirmado') {
    return `✅ Olá, ${name}! Seu pedido *${orderId}* foi confirmado e já está sendo preparado.`;
  }
  if (status === 'saiu_entrega') {
    return order?.deliveryType === 'Retirada'
      ? `✅ Olá, ${name}! Seu pedido *${orderId}* está pronto para retirada.`
      : `🛵 Olá, ${name}! Seu pedido *${orderId}* saiu para entrega.`;
  }
  if (status === 'cancelado') {
    return `❌ Olá, ${name}. Seu pedido *${orderId}* foi cancelado pela lanchonete.`;
  }
  return '';
}

async function sendTextToPhone(phone, message) {
  const normalized = normalizeOutgoingPhone(phone);
  if (!normalized) throw new Error('Número de WhatsApp inválido.');
  if (!connected || !clientRef) throw new Error('WhatsApp desconectado.');
  await clientRef.sendText(`${normalized}@c.us`, message);
  return true;
}

async function sendOrderMessages(payload) {
  const order = payload?.order;
  if (!order?.id) throw new Error('Pedido inválido.');
  const businessPhone = normalizeOutgoingPhone(payload?.businessPhone);
  const customerPhone = normalizeOutgoingPhone(order?.customerPhone);
  if (!businessPhone || !customerPhone) throw new Error('Número da lanchonete ou do cliente inválido.');

  const [business, customer] = await Promise.allSettled([
    sendTextToPhone(businessPhone, businessOrderMessage(order)),
    sendTextToPhone(customerPhone, customerReceiptMessage(order)),
  ]);
  const businessSent = business.status === 'fulfilled';
  const customerSent = customer.status === 'fulfilled';
  return {
    sent: businessSent && customerSent,
    businessSent,
    customerSent,
    error: businessSent && customerSent
      ? ''
      : [business, customer]
          .filter((result) => result.status === 'rejected')
          .map((result) => String(result.reason?.message || result.reason))
          .join(' ')
          .slice(0, 240),
  };
}

async function sendStatusMessage(payload) {
  const order = payload?.order;
  const status = String(payload?.status || order?.status || '');
  const message = customerStatusMessage(order, status);
  if (!order?.id || !message) throw new Error('Status automático inválido.');
  await sendTextToPhone(order.customerPhone, message);
  return { sent: true, businessSent: false, customerSent: true };
}

async function runTransactionalAction(action, payload) {
  if (action === 'send-order') return sendOrderMessages(payload);
  if (action === 'send-status') return sendStatusMessage(payload);
  throw new Error('Ação de mensagem inválida.');
}

function statusPayload(includeQr = false) {
  return {
    ok: true,
    connected,
    authState,
    qrReady: Boolean(qrImage),
    qrImage: includeQr && !connected ? qrImage : undefined,
    connectedAt,
    lastError: lastError || null,
  };
}

function robotHeaders() {
  const headers = { 'content-type': 'application/json' };
  if (ROBOT_WEBHOOK_TOKEN) headers['x-robot-token'] = ROBOT_WEBHOOK_TOKEN;
  return headers;
}

function logBridgeWarning(message) {
  if (Date.now() - lastBridgeWarningAt < 60000) return;
  lastBridgeWarningAt = Date.now();
  console.warn(`⚠️ ${message}`);
}

async function syncConnectionState() {
  if (DIRECT_CONTROL || !ROBOT_WEBHOOK_TOKEN) return;
  if (stateSyncRunning) {
    stateSyncPending = true;
    return;
  }

  stateSyncRunning = true;
  try {
    const response = await fetch(`${ROBOT_API_BASE}/api/robot/connection/sync`, {
      method: 'POST',
      headers: robotHeaders(),
      body: JSON.stringify(statusPayload(true)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    logBridgeWarning(`Não foi possível atualizar o QR no painel (${error.message}).`);
  } finally {
    stateSyncRunning = false;
    if (stateSyncPending) {
      stateSyncPending = false;
      setImmediate(syncConnectionState);
    }
  }
}

function queueConnectionSync() {
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'robot-state', state: statusPayload(true) });
    } catch (_) {}
  }
  if (!DIRECT_CONTROL) setImmediate(syncConnectionState);
}

async function pollConnectionCommand() {
  if (DIRECT_CONTROL || !ROBOT_WEBHOOK_TOKEN || commandPollRunning) return;
  commandPollRunning = true;
  try {
    const url = `${ROBOT_API_BASE}/api/robot/connection/command?after=${encodeURIComponent(lastCommandId)}`;
    const response = await fetch(url, { headers: robotHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    const command = data?.command;
    if (!command?.id || command.id === lastCommandId) return;
    lastCommandId = String(command.id);
    rememberLastCommandId(lastCommandId);
    if (command.action === 'reset' || command.action === 'restart') {
      const clearSession = command.action === 'reset';
      if (SUPERVISED) {
        await stopWhatsApp({ logout: clearSession, clearSession });
        await syncConnectionState();
        process.exit(0);
      }
      await restartWhatsApp({ clearSession });
    }
  } catch (error) {
    logBridgeWarning(`Não foi possível consultar comandos do painel (${error.message}).`);
  } finally {
    commandPollRunning = false;
  }
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function controlAuthorized(req) {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const supplied = bearer || String(req.headers['x-robot-control-token'] || '');
  if (!supplied || !ROBOT_CONTROL_TOKEN) return false;

  const expectedBuffer = Buffer.from(ROBOT_CONTROL_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function readRequestJson(req, maxBytes = 262144) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Corpo da solicitação muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function commandMarkerPath() {
  const resolvedRoot = path.resolve(TOKEN_DIR);
  const filesystemRoot = path.parse(resolvedRoot).root;
  const safeSession = SESSION_NAME.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeSession || resolvedRoot === filesystemRoot || resolvedRoot === '/app' || resolvedRoot.length < filesystemRoot.length + 4) {
    throw new Error('WPP_TOKEN_PATH aponta para um diretório inseguro.');
  }
  return path.join(resolvedRoot, `.${safeSession}.last-command`);
}

function loadLastCommandId() {
  try { return fs.readFileSync(commandMarkerPath(), 'utf8').trim().slice(0, 80); }
  catch { return ''; }
}

function rememberLastCommandId(commandId) {
  fs.writeFileSync(commandMarkerPath(), String(commandId || '').slice(0, 80), { mode: 0o600 });
}

function sessionTokenTargets() {
  const resolvedRoot = path.resolve(TOKEN_DIR);
  const filesystemRoot = path.parse(resolvedRoot).root;
  const safeSession = SESSION_NAME.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeSession || resolvedRoot === filesystemRoot || resolvedRoot === '/app' || resolvedRoot.length < filesystemRoot.length + 4) {
    throw new Error('WPP_TOKEN_PATH aponta para um diretório inseguro.');
  }
  return [
    path.join(resolvedRoot, safeSession),
    path.join(resolvedRoot, `${safeSession}.data.json`),
  ];
}

function clearStoredSession() {
  fs.mkdirSync(path.resolve(TOKEN_DIR), { recursive: true });
  for (const target of sessionTokenTargets()) fs.rmSync(target, { recursive: true, force: true });
}

async function stopWhatsApp({ logout = false, clearSession = false } = {}) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const client = clientRef;
  clientRef = null;
  connected = false;
  connectedAt = null;
  qrImage = null;
  authState = clearSession ? 'resetting' : 'restarting';
  queueConnectionSync();

  if (client) {
    if (logout && typeof client.logout === 'function') {
      try { await client.logout(); } catch (_) {}
    }
    if (typeof client.close === 'function') {
      try { await client.close(); } catch (_) {}
    }
  }

  if (clearSession) clearStoredSession();
}

async function restartWhatsApp({ clearSession = false } = {}) {
  try {
    await stopWhatsApp({ logout: clearSession, clearSession });
    await startWhatsApp();
  } catch (error) {
    lastError = String(error?.message || error);
    connected = false;
    authState = 'error';
    scheduleReconnect();
  }
}

function qrPage() {
  let content;
  if (connected) {
    content = '<div class="ok">✅ WhatsApp conectado</div><p>Pronto para enviar pedidos e atualizações automáticas. O sistema não responde mensagens recebidas.</p>';
  } else if (qrImage) {
    content = `<div class="title">📲 Escaneie o QR Code</div><img src="${qrImage}" alt="QR Code"><p>WhatsApp → Aparelhos conectados → Conectar um aparelho</p><small>Esta página atualiza sozinha.</small>`;
  } else {
    content = '<div class="title">⏳ Preparando QR Code...</div><p>Aguarde alguns segundos.</p>';
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>Conectar WhatsApp</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0d;color:#fff;font-family:Arial,sans-serif;padding:20px}main{width:min(100%,460px);background:#181818;border:1px solid #333;border-radius:20px;padding:26px;text-align:center}.title,.ok{font-size:22px;font-weight:800;margin-bottom:18px}.ok{color:#25d366}img{display:block;width:min(100%,340px);height:auto;margin:0 auto 18px;background:#fff;padding:12px;border-radius:14px}p{color:#ccc;line-height:1.5}small{color:#888}</style></head><body><main>${content}</main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (url.pathname === '/health') {
    sendJson(res, statusPayload(false));
    return;
  }

  if (url.pathname === '/control/status') {
    if (!controlAuthorized(req)) {
      sendJson(res, { error: 'Não autorizado.' }, 401);
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, { error: 'Método não permitido.' }, 405);
      return;
    }
    sendJson(res, statusPayload(true));
    return;
  }

  if (url.pathname === '/control/restart' || url.pathname === '/control/reset') {
    if (!controlAuthorized(req)) {
      sendJson(res, { error: 'Não autorizado.' }, 401);
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Método não permitido.' }, 405);
      return;
    }

    const clearSession = url.pathname.endsWith('/reset');
    restartWhatsApp({ clearSession });
    sendJson(res, {
      ok: true,
      accepted: true,
      action: clearSession ? 'reset' : 'restart',
      message: clearSession ? 'Sessão removida. Um novo QR Code será gerado.' : 'Reconexão iniciada.'
    }, 202);
    return;
  }

  if (url.pathname === '/control/send-order' || url.pathname === '/control/send-status') {
    if (!controlAuthorized(req)) {
      sendJson(res, { error: 'Não autorizado.' }, 401);
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Método não permitido.' }, 405);
      return;
    }
    try {
      const payload = await readRequestJson(req);
      const action = url.pathname.endsWith('send-order') ? 'send-order' : 'send-status';
      const result = await runTransactionalAction(action, payload);
      sendJson(res, { ok: true, ...result }, result.sent ? 200 : 502);
    } catch (error) {
      sendJson(res, { error: String(error?.message || error).slice(0, 240), sent: false }, 503);
    }
    return;
  }

  if (url.pathname === `/qr/${QR_ACCESS_TOKEN}`) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(qrPage());
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(connected ? 'WhatsApp transacional: conectado' : 'WhatsApp transacional: aguardando conexão');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

if (process.env.DISABLE_HTTP_SERVER !== '1') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Health: ${publicDomain()}/health`);
    console.log(`🔐 QR seguro: ${publicDomain()}/qr/${QR_ACCESS_TOKEN}`);
    queueConnectionSync();
  });
}

const connectionSyncTimer = setInterval(queueConnectionSync, 5000);
const commandPollTimer = setInterval(pollConnectionCommand, 3000);
const clientWatchTimer = setInterval(refreshClientState, 5000);
connectionSyncTimer.unref();
commandPollTimer.unref();
clientWatchTimer.unref();

function removeChromiumLocks() {
  const names = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);
  const sessionDir = sessionTokenTargets()[0];
  if (!fs.existsSync(sessionDir)) return;
  const pending = [sessionDir];
  try {
    while (pending.length) {
      const current = pending.pop();
      if (!fs.existsSync(current)) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const item = path.join(current, entry.name);
        if (names.has(entry.name)) fs.rmSync(item, { recursive: true, force: true });
        else if (entry.isDirectory()) pending.push(item);
      }
    }
  } catch (error) {
    console.warn('⚠️ Não foi possível limpar travas antigas:', error.message);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsApp();
  }, 15000);
  reconnectTimer.unref();
}

function normalizeQrImage(value) {
  const image = String(value || '');
  if (!image) return null;
  return image.startsWith('data:image') ? image : `data:image/png;base64,${image}`;
}

async function waitForClientReady(client, timeoutMs = 45000) {
  let timeout;
  try {
    await Promise.race([
      client.waitForPageLoad(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Tempo esgotado ao preparar o WhatsApp Web.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function refreshClientState() {
  if (!clientRef || clientWatchRunning) return;
  const client = clientRef;
  clientWatchRunning = true;

  try {
    const loggedIn = Boolean(await client.isLoggedIn());
    if (client !== clientRef) return;

    if (loggedIn) {
      const wasConnected = connected;
      connected = true;
      connectedAt ||= new Date().toISOString();
      qrImage = null;
      authState = 'inChat';
      lastError = '';
      if (!wasConnected) console.log('✅ WhatsApp conectado. Robô ativo.');
    } else {
      const state = await client.getConnectionState().catch(() => null);
      const qr = await client.getQrCode().catch(() => null);
      if (client !== clientRef) return;

      connected = false;
      connectedAt = null;
      const freshQr = normalizeQrImage(qr?.base64Image);
      if (freshQr) {
        qrImage = freshQr;
        authState = 'qr';
      } else if (state) {
        authState = String(state);
      }
    }

    consecutiveClientWatchFailures = 0;
    queueConnectionSync();
  } catch (error) {
    if (client !== clientRef) return;
    consecutiveClientWatchFailures += 1;
    lastError = String(error?.message || error);
    logBridgeWarning(`Falha ao verificar o WhatsApp (${lastError}).`);
    if (SUPERVISED && consecutiveClientWatchFailures >= 6) {
      console.error('❌ Cliente do WhatsApp parou de responder. Reiniciando a instância.');
      process.exit(1);
    }
  } finally {
    clientWatchRunning = false;
  }
}

async function startWhatsApp() {
  if (starting) return;
  starting = true;
  connected = false;
  authState = 'starting';
  lastError = '';
  queueConnectionSync();

  try {
    removeChromiumLocks();

    const puppeteerOptions = { timeout: 120000 };
    if (fs.existsSync(CHROME_PATH)) puppeteerOptions.executablePath = CHROME_PATH;

    const client = await wppconnect.create({
      session: SESSION_NAME,
      catchQR: (base64Qrimg, _asciiQR, attempts) => {
        qrImage = String(base64Qrimg).startsWith('data:image')
          ? base64Qrimg
          : `data:image/png;base64,${base64Qrimg}`;
        connected = false;
        connectedAt = null;
        authState = 'qr';
        queueConnectionSync();
        console.log(`📲 QR atualizado. Tentativa ${attempts}.`);
      },
      statusFind: (statusSession) => {
        authState = String(statusSession || 'unknown');
        if (['isLogged', 'qrReadSuccess', 'inChat'].includes(statusSession)) {
          connected = true;
          qrImage = null;
        } else if (/not.?logged|disconnected|desconnected|unpaired|unlaunched|qr|close|error|delete.?token/i.test(authState)) {
          connected = false;
          connectedAt = null;
        }
        queueConnectionSync();
        console.log(`🔐 Estado WhatsApp: ${authState}`);
      },
      headless: true,
      devtools: false,
      useChrome: true,
      debug: false,
      logQR: false,
      autoClose: 0,
      deviceSyncTimeout: 0,
      waitForLogin: false,
      disableWelcome: true,
      updatesLog: true,
      tokenStore: 'file',
      folderNameToken: TOKEN_DIR,
      puppeteerOptions,
      browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
    });

    clientRef = client;
    connected = false;
    connectedAt = null;
    authState = 'ready';
    consecutiveClientWatchFailures = 0;

    // Não registramos onMessage: esta integração não atende nem responde clientes.
    client.onStateChange((state) => {
      const value = String(state || 'unknown');
      authState = value;
      console.log(`🔄 Estado do WhatsApp: ${value}`);
      if (/UNPAIRED|CONFLICT|UNLAUNCHED|DISCONNECTED|NOT_LOGGED/i.test(value)) {
        connected = false;
        connectedAt = null;
      }
      queueConnectionSync();
    });
    await waitForClientReady(client);
    await refreshClientState();
    if (!connected) console.log('📲 Cliente pronto. Aguardando leitura do QR Code.');
  } catch (error) {
    lastError = String(error?.message || error);
    connected = false;
    connectedAt = null;
    authState = 'error';
    queueConnectionSync();
    console.error('❌ Erro ao iniciar WhatsApp:', lastError);
    if (SUPERVISED) {
      await syncConnectionState();
      process.exit(1);
    }
    scheduleReconnect();
  } finally {
    starting = false;
  }
}

let supervisorControlRunning = false;
process.on('message', async (message) => {
  if (!DIRECT_CONTROL) return;

  if (message?.type === 'transactional-message' && message.requestId) {
    try {
      const result = await runTransactionalAction(message.action, message.payload || {});
      if (typeof process.send === 'function') {
        process.send({ type: 'transactional-result', requestId: message.requestId, result });
      }
    } catch (error) {
      if (typeof process.send === 'function') {
        process.send({
          type: 'transactional-result',
          requestId: message.requestId,
          error: String(error?.message || error).slice(0, 240)
        });
      }
    }
    return;
  }

  if (message?.type !== 'robot-control' || supervisorControlRunning) return;
  const action = message.action === 'reset' ? 'reset' : message.action === 'restart' ? 'restart' : '';
  if (!action) return;

  supervisorControlRunning = true;
  try {
    const clearSession = action === 'reset';
    await stopWhatsApp({ logout: clearSession, clearSession });
    queueConnectionSync();
    if (typeof process.send === 'function') {
      try { process.send({ type: 'robot-control-accepted', action }); } catch (_) {}
    }
    process.exit(0);
  } catch (error) {
    lastError = String(error?.message || error);
    authState = 'error';
    queueConnectionSync();
    process.exit(1);
  }
});

process.on('unhandledRejection', (error) => {
  lastError = String(error?.message || error);
  console.error('❌ unhandledRejection:', lastError);
});

process.on('uncaughtException', (error) => {
  lastError = String(error?.message || error);
  console.error('❌ uncaughtException:', lastError);
});

startWhatsApp();
