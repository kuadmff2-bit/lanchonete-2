const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const children = new Map();
const states = new Map();
const startupTimers = [];
const pendingMessages = new Map();
let shuttingDown = false;

function normalizeInstance(item, index) {
  const name = String(item?.name || `instancia-${index + 1}`);
  const rawSlug = String(item?.slug || item?.WPP_SESSION || item?.LANCHONETE_WPP_SESSION || name);
  const slug = rawSlug.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`Identificador inválido para ${name}.`);
  return {
    ...item,
    name,
    slug,
    ROBOT_CONTROL_TOKEN: String(item?.ROBOT_CONTROL_TOKEN || process.env.ROBOT_CONTROL_TOKEN || ''),
  };
}

function readInstances() {
  const raw = String(process.env.ROBOT_INSTANCES_JSON || '').trim();
  if (!raw) {
    const session = process.env.WPP_SESSION || process.env.LANCHONETE_WPP_SESSION || 'lanchonete';
    return [normalizeInstance({ name: session, WPP_SESSION: session }, 0)];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 4) {
    throw new Error('ROBOT_INSTANCES_JSON deve conter de 1 a 4 configurações.');
  }
  return parsed.map(normalizeInstance);
}

const instances = readInstances();

function startInstance(instance) {
  const { slug: _slug, ...childEnvironment } = instance;
  const child = fork(path.join(__dirname, 'index.js'), [], {
    env: {
      ...process.env,
      ...childEnvironment,
      DISABLE_HTTP_SERVER: '1',
      ROBOT_SUPERVISED: '1',
      ROBOT_DIRECT_CONTROL: '1',
    },
    detached: process.platform !== 'win32',
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  children.set(instance.name, child);
  states.set(instance.slug, {
    ok: true,
    connected: false,
    qrReady: false,
    qrImage: null,
    authState: 'starting',
    connectedAt: null,
    lastError: null,
  });
  console.log(`🚀 Iniciando ${instance.name}.`);
  child.on('message', (message) => {
    if (message?.type === 'transactional-result' && message.requestId) {
      const pending = pendingMessages.get(String(message.requestId));
      if (!pending) return;
      pendingMessages.delete(String(message.requestId));
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(String(message.error)));
      else pending.resolve(message.result || { sent: false });
      return;
    }
    if (message?.type !== 'robot-state' || !message.state || typeof message.state !== 'object') return;
    states.set(instance.slug, {
      ok: true,
      connected: Boolean(message.state.connected),
      qrReady: Boolean(message.state.qrReady && message.state.qrImage),
      qrImage: message.state.qrImage || null,
      authState: String(message.state.authState || 'starting'),
      connectedAt: message.state.connectedAt || null,
      lastError: message.state.lastError || null,
    });
  });
  child.on('exit', (code, signal) => {
    for (const [requestId, pending] of pendingMessages) {
      if (pending.instanceName !== instance.name) continue;
      pendingMessages.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(new Error('A instância do WhatsApp reiniciou durante o envio.'));
    }
    children.delete(instance.name);
    terminateProcessTree(child, 'SIGKILL');
    states.set(instance.slug, {
      ok: true,
      connected: false,
      qrReady: false,
      qrImage: null,
      authState: shuttingDown ? 'stopped' : 'restarting',
      connectedAt: null,
      lastError: null,
    });
    console.warn(`⚠️ ${instance.name} encerrou (${signal || code || 0}).`);
    if (!shuttingDown) setTimeout(() => startInstance(instance), 5000).unref();
  });
}

function terminateProcessTree(child, signal) {
  if (!child?.pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (_) {}
  }
  try { child.kill(signal); } catch (_) {}
}

for (const [index, instance] of instances.entries()) {
  if (index === 0) {
    startInstance(instance);
    continue;
  }
  startupTimers.push(setTimeout(() => {
    if (!shuttingDown) startInstance(instance);
  }, index * 12000));
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function controlAuthorized(req, instance) {
  const authorization = String(req.headers.authorization || '');
  const supplied = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const expected = String(instance.ROBOT_CONTROL_TOKEN || '');
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
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
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function forwardTransactional(instance, action, payload) {
  const child = children.get(instance.name);
  if (!child?.connected) return Promise.reject(new Error('A instância do WhatsApp está reiniciando.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMessages.delete(requestId);
      reject(new Error('O WhatsApp não confirmou o envio a tempo.'));
    }, 18000);
    pendingMessages.set(requestId, { resolve, reject, timer, instanceName: instance.name });
    try {
      child.send({ type: 'transactional-message', requestId, action, payload });
    } catch (error) {
      pendingMessages.delete(requestId);
      clearTimeout(timer);
      reject(error);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const controlMatch = url.pathname.match(/^\/instances\/([^/]+)\/control\/(status|restart|reset|send-order|send-status)$/);

  if (controlMatch) {
    let slug = '';
    try { slug = decodeURIComponent(controlMatch[1]); } catch (_) {}
    const action = controlMatch[2];
    const instance = instances.find((item) => item.slug === slug);
    if (!instance) {
      sendJson(res, { error: 'Instância não encontrada.' }, 404);
      return;
    }
    if (!controlAuthorized(req, instance)) {
      sendJson(res, { error: 'Não autorizado.' }, 401);
      return;
    }

    if (action === 'status') {
      if (req.method !== 'GET') {
        sendJson(res, { error: 'Método não permitido.' }, 405);
        return;
      }
      sendJson(res, states.get(instance.slug) || {
        ok: true,
        connected: false,
        qrReady: false,
        authState: 'starting',
      });
      return;
    }

    if (action === 'send-order' || action === 'send-status') {
      if (req.method !== 'POST') {
        sendJson(res, { error: 'Método não permitido.' }, 405);
        return;
      }
      try {
        const payload = await readRequestJson(req);
        const result = await forwardTransactional(instance, action, payload);
        sendJson(res, { ok: true, ...result }, result.sent ? 200 : 502);
      } catch (error) {
        sendJson(res, { error: String(error?.message || error).slice(0, 240), sent: false }, 503);
      }
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, { error: 'Método não permitido.' }, 405);
      return;
    }
    const child = children.get(instance.name);
    if (!child?.connected) {
      sendJson(res, { error: 'A instância está reiniciando.' }, 503);
      return;
    }
    const previousState = states.get(instance.slug);
    states.set(instance.slug, {
      ok: true,
      connected: false,
      qrReady: false,
      qrImage: null,
      authState: action === 'reset' ? 'resetting' : 'restarting',
      connectedAt: null,
      lastError: null,
    });
    try {
      child.send({ type: 'robot-control', action });
    } catch (_) {
      if (previousState) states.set(instance.slug, previousState);
      sendJson(res, { error: 'A instância está reiniciando.' }, 503);
      return;
    }
    sendJson(res, { ok: true, accepted: true, action }, 202);
    return;
  }

  if (url.pathname !== '/' && url.pathname !== '/health') {
    sendJson(res, { error: 'Not found' }, 404);
    return;
  }

  const running = instances.map((instance) => ({
    name: instance.name,
    running: Boolean(children.get(instance.name)?.connected),
  }));
  const ok = running.every((item) => item.running);
  sendJson(res, { ok, instances: running }, ok ? 200 : 503);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Supervisor ativo na porta ${PORT} com ${instances.length} instância(s).`);
});

function stop(signal) {
  shuttingDown = true;
  for (const timer of startupTimers) clearTimeout(timer);
  for (const child of children.values()) terminateProcessTree(child, signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
