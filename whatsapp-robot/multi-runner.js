const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const children = new Map();
const startupTimers = [];
let shuttingDown = false;

function readInstances() {
  const raw = String(process.env.ROBOT_INSTANCES_JSON || '').trim();
  if (!raw) return [{ name: process.env.WPP_SESSION || process.env.LANCHONETE_WPP_SESSION || 'lanchonete' }];

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 4) {
    throw new Error('ROBOT_INSTANCES_JSON deve conter de 1 a 4 configurações.');
  }
  return parsed.map((item, index) => ({ ...item, name: String(item?.name || `instancia-${index + 1}`) }));
}

const instances = readInstances();

function startInstance(instance) {
  const child = fork(path.join(__dirname, 'index.js'), [], {
    env: {
      ...process.env,
      ...instance,
      DISABLE_HTTP_SERVER: '1',
    },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  children.set(instance.name, child);
  console.log(`🚀 Iniciando ${instance.name}.`);
  child.on('exit', (code, signal) => {
    children.delete(instance.name);
    console.warn(`⚠️ ${instance.name} encerrou (${signal || code || 0}).`);
    if (!shuttingDown) setTimeout(() => startInstance(instance), 5000).unref();
  });
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/' && url.pathname !== '/health') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const running = instances.map((instance) => ({
    name: instance.name,
    running: Boolean(children.get(instance.name)?.connected),
  }));
  const ok = running.every((item) => item.running);
  res.writeHead(ok ? 200 : 503, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify({ ok, instances: running }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Supervisor ativo na porta ${PORT} com ${instances.length} instância(s).`);
});

function stop(signal) {
  shuttingDown = true;
  for (const timer of startupTimers) clearTimeout(timer);
  for (const child of children.values()) child.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
