const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const wppconnect = require('@wppconnect-team/wppconnect');

const PORT = Number(process.env.PORT || 3000);
const ROBOT_API_BASE = String(process.env.ROBOT_API_BASE || 'https://lanchonete-2.kuadmff2.workers.dev').replace(/\/$/, '');
const ROBOT_WEBHOOK_TOKEN = String(process.env.ROBOT_WEBHOOK_TOKEN || '');
const SESSION_NAME = String(process.env.WPP_SESSION || 'lanchonete-2-whatsapp');
const TOKEN_DIR = String(process.env.WPP_TOKEN_PATH || path.join(process.cwd(), 'tokens'));
const QR_ACCESS_TOKEN = String(process.env.QR_ACCESS_TOKEN || crypto.randomBytes(20).toString('hex'));
const ROBOT_CONTROL_TOKEN = String(process.env.ROBOT_CONTROL_TOKEN || QR_ACCESS_TOKEN);
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';

let clientRef = null;
let connected = false;
let qrImage = null;
let authState = 'starting';
let lastError = '';
let reconnectTimer = null;
let starting = false;
let connectedAt = null;

fs.mkdirSync(TOKEN_DIR, { recursive: true });

function publicDomain() {
  return process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`;
}

function safePhone(msg) {
  const candidates = [
    msg?.sender?.id?.user,
    msg?.sender?.id?._serialized,
    msg?.from,
    msg?.chatId,
  ].filter(Boolean);

  for (const candidate of candidates) {
    let digits = String(candidate).split('@')[0].replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (/^55\d{10,11}$/.test(digits)) return digits;
  }
  return '';
}

function shouldIgnore(msg) {
  const from = String(msg?.from || '');
  if (!from) return true;
  if (msg?.fromMe) return true;
  if (msg?.isGroupMsg || from.endsWith('@g.us')) return true;
  if (from === 'status@broadcast' || from.endsWith('@broadcast')) return true;
  return false;
}

async function callRobotApi(msg) {
  const body = String(msg?.body || '').trim();
  if (!body) return null;

  const headers = { 'content-type': 'application/json' };
  if (ROBOT_WEBHOOK_TOKEN) headers['x-robot-token'] = ROBOT_WEBHOOK_TOKEN;

  const response = await fetch(`${ROBOT_API_BASE}/api/robot/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contactId: String(msg.from || safePhone(msg)),
      phone: safePhone(msg),
      message: body,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Robot API HTTP ${response.status}`);
  }
  return data;
}

async function handleMessage(msg) {
  if (!clientRef || shouldIgnore(msg)) return;

  try {
    const result = await callRobotApi(msg);
    if (!result) return;

    // Quando o robô estiver desligado no painel, não envia a frase técnica ao cliente.
    if (result.disabled) return;

    const reply = String(result.reply || '').trim();
    if (reply) {
      await clientRef.sendText(msg.from, reply);
      console.log(`🤖 Resposta enviada para ${safePhone(msg) || msg.from}. Estado: ${result.state || 'n/a'}`);
    }
  } catch (error) {
    lastError = String(error?.message || error);
    console.error('❌ Falha ao processar mensagem:', lastError);
  }
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

function assertSafeTokenDirectory() {
  const resolved = path.resolve(TOKEN_DIR);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === '/app' || resolved.length < root.length + 4) {
    throw new Error('WPP_TOKEN_PATH aponta para um diretório inseguro.');
  }
  return resolved;
}

function clearStoredSession() {
  const resolved = assertSafeTokenDirectory();
  fs.mkdirSync(resolved, { recursive: true });
  for (const entry of fs.readdirSync(resolved)) {
    fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
  }
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
    content = '<div class="ok">✅ WhatsApp conectado</div><p>O robô já está recebendo mensagens.</p>';
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

  if (url.pathname === `/qr/${QR_ACCESS_TOKEN}`) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(qrPage());
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(connected ? 'Lanchonete WhatsApp Robot: conectado' : 'Lanchonete WhatsApp Robot: aguardando conexão');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health: ${publicDomain()}/health`);
  console.log(`🔐 QR seguro: ${publicDomain()}/qr/${QR_ACCESS_TOKEN}`);
});

function removeChromiumLocks() {
  const names = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);
  const pending = [TOKEN_DIR];
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

async function startWhatsApp() {
  if (starting) return;
  starting = true;
  connected = false;
  authState = 'starting';
  lastError = '';

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
        console.log(`📲 QR atualizado. Tentativa ${attempts}.`);
      },
      statusFind: (statusSession) => {
        authState = String(statusSession || 'unknown');
        if (['isLogged', 'qrReadSuccess', 'inChat'].includes(statusSession)) {
          connected = true;
          qrImage = null;
        }
        console.log(`🔐 Estado WhatsApp: ${authState}`);
      },
      headless: true,
      devtools: false,
      useChrome: true,
      debug: false,
      logQR: false,
      autoClose: 0,
      deviceSyncTimeout: 0,
      waitForLogin: true,
      disableWelcome: true,
      updatesLog: true,
      tokenStore: 'file',
      folderNameToken: TOKEN_DIR,
      puppeteerOptions,
      browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
    });

    clientRef = client;
    connected = true;
    connectedAt = new Date().toISOString();
    qrImage = null;
    authState = 'inChat';
    console.log('✅ WhatsApp conectado. Robô ativo.');

    client.onMessage(handleMessage);
    client.onStateChange((state) => {
      const value = String(state || 'unknown');
      authState = value;
      console.log(`🔄 Estado do WhatsApp: ${value}`);
      if (/UNPAIRED|CONFLICT|UNLAUNCHED|DISCONNECTED|NOT_LOGGED/i.test(value)) {
        connected = false;
        connectedAt = null;
      }
    });
  } catch (error) {
    lastError = String(error?.message || error);
    connected = false;
    connectedAt = null;
    authState = 'error';
    console.error('❌ Erro ao iniciar WhatsApp:', lastError);
    scheduleReconnect();
  } finally {
    starting = false;
  }
}

process.on('unhandledRejection', (error) => {
  lastError = String(error?.message || error);
  console.error('❌ unhandledRejection:', lastError);
});

process.on('uncaughtException', (error) => {
  lastError = String(error?.message || error);
  console.error('❌ uncaughtException:', lastError);
});

startWhatsApp();
