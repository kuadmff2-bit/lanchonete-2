import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../worker-fcm.js";

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async delete(key) {
    this.values.delete(key);
  }
}

function request(path, options = {}) {
  return new Request(`https://cardapio.test${path}`, options);
}

async function body(response) {
  const data = await response.json();
  assert.ok(response.ok, data?.error || `HTTP ${response.status}`);
  return data;
}

const kv = new MemoryKv();
const env = {
  PROMOTIONS: kv,
  ADMIN_APP_TOKEN: "app-token-test",
  ROBOT_SERVICE_URL: "https://robot.test/instances/lanchonete-2-whatsapp",
  ROBOT_CONTROL_TOKEN: "robot-token-test",
  SITE_STYLE_VARIANT: "bold",
  SITE_DEFAULT_NAME: "Lanchonete 2",
  SITE_DEFAULT_SUBTITLE: "Peça pelo celular",
  SITE_DEFAULT_HERO_TITLE: "Escolheu. Pediu. Chegou.",
  SITE_DEFAULT_HERO_TEXT: "Faça seu pedido.",
  SITE_DEFAULT_PRIMARY: "#1746a2",
  SITE_DEFAULT_ACCENT: "#ffc857",
  SITE_DEFAULT_BACKGROUND: "#eef4ff",
  SITE_DEFAULT_SURFACE: "#ffffff",
  SITE_DEFAULT_TEXT: "#10204b"
};
const adminHeaders = {
  "user-agent": "Android LanchoneteAdminApp/1.3-l2",
  "x-admin-app-token": env.ADMIN_APP_TOKEN
};
const robotCalls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, options = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(env.ROBOT_SERVICE_URL)) return originalFetch(input, options);
  robotCalls.push({
    path: new URL(url).pathname,
    authorization: options?.headers?.authorization,
    payload: JSON.parse(String(options?.body || "{}"))
  });
  return Response.json({ sent: true, businessSent: true, customerSent: true });
};

try {
  const contact = await body(await worker.fetch(request("/api/business-contact", {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ whatsappNumber: "5592999999999" })
  }), env, {}));
  assert.equal(contact.whatsappNumber, "5592999999999", "O APK deve alterar o contato sem senha de administrador.");

  const orderPayload = {
    clientOrderId: "integration-order-1",
    localDate: "2026-09-09",
    customerName: "Cliente Teste",
    customerPhone: "5592988887777",
    payment: "Pix",
    deliveryType: "Entrega",
    address: "Rua de teste, 10",
    items: [{ id: "1", name: "X-Tudo", qty: 2 }]
  };
  const createdResponse = await worker.fetch(request("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(orderPayload)
  }), env, { waitUntil() {} });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);
  assert.equal(created.order.total, 30);
  assert.equal(created.messaging.sent, true);
  assert.equal(robotCalls.length, 1);
  assert.equal(robotCalls[0].path, "/instances/lanchonete-2-whatsapp/control/send-order");
  assert.equal(robotCalls[0].authorization, "Bearer robot-token-test");
  assert.equal(robotCalls[0].payload.businessPhone, "5592999999999");
  assert.equal(robotCalls[0].payload.order.customerPhone, "5592988887777");

  const duplicate = await body(await worker.fetch(request("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(orderPayload)
  }), env, {}));
  assert.equal(duplicate.duplicate, true);
  assert.equal(robotCalls.length, 1, "Pedido repetido não pode duplicar mensagens.");

  const orders = await body(await worker.fetch(request("/api/orders", { headers: adminHeaders }), env, {}));
  assert.equal(orders.recent.length, 1, "O APK deve abrir os pedidos usando somente sua chave.");

  const confirmed = await body(await worker.fetch(request(`/api/orders/${created.order.id}`, {
    method: "PATCH",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ status: "confirmado" })
  }), env, {}));
  assert.equal(confirmed.statusChanged, true);
  assert.equal(confirmed.messaging.sent, true);
  assert.equal(robotCalls.at(-1).path, "/instances/lanchonete-2-whatsapp/control/send-status");

  const repeated = await body(await worker.fetch(request(`/api/orders/${created.order.id}`, {
    method: "PATCH",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ status: "confirmado" })
  }), env, {}));
  assert.equal(repeated.statusChanged, false);
  assert.equal(robotCalls.length, 2, "Repetir o status não pode duplicar mensagens.");

  const branding = await body(await worker.fetch(request("/api/branding", {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Novo nome",
      primaryColor: "#ff00ff",
      backgroundColor: "#0000ff",
      textColor: "#0000ff"
    })
  }), env, {}));
  assert.equal(branding.name, "Novo nome");
  assert.equal(branding.primaryColor, "#1746a2");
  assert.equal(branding.backgroundColor, "#eef4ff");
  assert.equal(branding.textColor, "#10204b");

  const robotChat = await body(await worker.fetch(request("/api/robot/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Oi" })
  }), env, {}));
  assert.equal(robotChat.disabled, true);
  assert.equal(robotChat.reply, "");

  const siteScript = await readFile(new URL("../script.js", import.meta.url), "utf8");
  assert.match(siteScript, /if \(previewMode\)[\s\S]*não foi registrado, contabilizado nem enviado/);
  assert.doesNotMatch(siteScript, /window\.open\s*\(\s*["'`]https:\/\/wa\.me/);

  const robotSource = await readFile(new URL("../whatsapp-robot/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(robotSource, /\.onMessage\s*\(/, "O serviço não pode atender mensagens recebidas.");
  assert.match(robotSource, /sendText\(`\$\{normalized\}@c\.us`/);

  console.log("Integração validada: acesso sem senha, pedido, WhatsApp, status, prévia e paleta fixa.");
} finally {
  globalThis.fetch = originalFetch;
}
