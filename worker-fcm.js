import baseWorker from "./worker.js";
import { handlePushRegistration, notifyNewOrder } from "./push.js";
import { handleBusinessContact } from "./business-contact-api.js";

const DEFAULT_ROBOT_SETTINGS = {
  enabled: false,
  greeting: "Olá! 👋 Sou o atendimento automático da Lanchonete 2. Como posso ajudar?",
  fallback: "Não consegui entender sua mensagem. Digite cardápio para ver os produtos ou atendente para falar com uma pessoa.",
  humanHandoff: true,
  businessHoursOnly: false,
  openTime: "18:00",
  closeTime: "23:59",
  menuText: "cardápio - Ver produtos e preços\ncarrinho - Ver seu pedido\nfinalizar - Finalizar o pedido\natendente - Falar com atendente",
  deliveryFee: 0,
  updatedAt: null
};

const ROBOT_SESSION_TTL = 60 * 60 * 3;
const MAX_ITEM_QTY = 30;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function safeText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function safeTime(value, fallback) {
  const text = String(value || "");
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function plain(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function safeDeliveryFee(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Number(Math.max(0, Math.min(amount, 1000)).toFixed(2));
}

function currentManausTime() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Manaus",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour || 0) * 60 + Number(values.minute || 0);
}

function currentManausDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Manaus",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function withinBusinessHours(settings) {
  if (!settings.businessHoursOnly) return true;
  const [oh, om] = String(settings.openTime || "00:00").split(":").map(Number);
  const [ch, cm] = String(settings.closeTime || "23:59").split(":").map(Number);
  const now = currentManausTime();
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  return open <= close ? now >= open && now <= close : now >= open || now <= close;
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55\d{10,11}$/.test(digits) ? digits : "";
}

function sessionKey(contactId) {
  const clean = safeText(contactId, 140).replace(/[^a-zA-Z0-9@._+:-]/g, "_");
  return clean ? `robot-session:${clean}` : "";
}

function emptySession() {
  return {
    stage: "idle",
    cart: [],
    pendingProductId: "",
    customerName: "",
    deliveryType: "",
    address: "",
    payment: "",
    checkoutStartedAt: 0,
    updatedAt: new Date().toISOString()
  };
}

async function loadRobotSettings(env) {
  if (!env.PROMOTIONS) return { ...DEFAULT_ROBOT_SETTINGS, storageConfigured: false };
  const raw = await env.PROMOTIONS.get("robot-settings");
  if (!raw) return { ...DEFAULT_ROBOT_SETTINGS, storageConfigured: true };
  try {
    return { ...DEFAULT_ROBOT_SETTINGS, ...JSON.parse(raw), storageConfigured: true };
  } catch {
    return { ...DEFAULT_ROBOT_SETTINGS, storageConfigured: true };
  }
}

async function loadSession(env, key) {
  if (!env.PROMOTIONS || !key) return emptySession();
  const raw = await env.PROMOTIONS.get(key);
  if (!raw) return emptySession();
  try {
    const data = JSON.parse(raw);
    return { ...emptySession(), ...data, cart: Array.isArray(data?.cart) ? data.cart : [] };
  } catch {
    return emptySession();
  }
}

async function saveSession(env, key, session) {
  if (!env.PROMOTIONS || !key) return;
  const next = { ...session, updatedAt: new Date().toISOString() };
  await env.PROMOTIONS.put(key, JSON.stringify(next), { expirationTtl: ROBOT_SESSION_TTL });
}

async function clearSession(env, key) {
  if (env.PROMOTIONS && key) await env.PROMOTIONS.delete(key);
}

async function getAvailableProducts(request, env, ctx) {
  const url = new URL("/api/products", request.url);
  const response = await baseWorker.fetch(new Request(url, { method: "GET" }), env, ctx);
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.products) ? data.products.filter((item) => item && item.available !== false && item.name) : [];
}

function formatCatalog(products, origin) {
  if (!products.length) return "Nosso cardápio está sendo atualizado. Tente novamente em alguns minutos.";
  const lines = products.map((product, index) => `${index + 1}. ${product.name} — ${money(product.price)}`);
  return `🍔 *Acesse nosso cardápio digital:*\n${origin}/\n\n*Itens disponíveis:*\n${lines.join("\n")}\n\nEnvie o *número do item* que deseja pedir.`;
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.qty || 0), 0);
}

function formatCart(cart, deliveryFee = 0) {
  if (!cart.length) return "Seu pedido ainda está vazio.";
  const lines = cart.map((item) => `${item.qty}x ${item.name} — ${money(Number(item.unitPrice) * Number(item.qty))}`);
  const fee = safeDeliveryFee(deliveryFee);
  if (fee > 0) lines.push(`Taxa de entrega — ${money(fee)}`);
  return `${lines.join("\n")}\n\n*Total: ${money(cartTotal(cart) + fee)}*`;
}

function deliveryChoices(settings) {
  const fee = safeDeliveryFee(settings?.deliveryFee);
  return `Como você quer receber?\n\n*1* - Entrega${fee > 0 ? ` (+ ${money(fee)})` : ""}\n*2* - Retirada`;
}

function findProductFromMessage(text, products) {
  if (/^\d+$/.test(text)) {
    const index = Number(text) - 1;
    return index >= 0 && index < products.length ? { product: products[index], ambiguous: [] } : { product: null, ambiguous: [] };
  }

  const query = plain(text);
  if (!query) return { product: null, ambiguous: [] };
  const matches = products.filter((product) => {
    const name = plain(product.name);
    return name === query || name.includes(query) || query.includes(name);
  });
  if (matches.length === 1) return { product: matches[0], ambiguous: [] };
  return { product: null, ambiguous: matches };
}

function addToCart(cart, product, qty) {
  const id = String(product.id);
  const existing = cart.find((item) => String(item.id) === id);
  if (existing) {
    existing.qty = Math.min(MAX_ITEM_QTY, Number(existing.qty || 0) + qty);
    existing.unitPrice = Number(product.price || 0);
    existing.name = String(product.name);
  } else {
    cart.push({ id, name: String(product.name), qty, unitPrice: Number(product.price || 0) });
  }
  return cart;
}

async function authorizeWithBaseWorker(request, env, ctx) {
  const authUrl = new URL("/api/auth", request.url);
  const authRequest = new Request(authUrl, {
    method: "GET",
    headers: request.headers
  });
  return baseWorker.fetch(authRequest, env, ctx);
}

function robotServiceConfig(env) {
  const rawUrl = String(env.ROBOT_SERVICE_URL || "").trim().replace(/\/$/, "");
  const token = String(env.ROBOT_CONTROL_TOKEN || "").trim();
  if (!rawUrl || !token) return { configured: false, url: "", token: "" };

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return { configured: false, url: "", token: "" };
    return { configured: true, url: parsed.toString().replace(/\/$/, ""), token };
  } catch {
    return { configured: false, url: "", token: "" };
  }
}

function adminAuthHeaders(authResponse) {
  const setCookie = authResponse.headers.get("set-cookie");
  return setCookie ? { "set-cookie": setCookie } : {};
}

async function handleRobotConnection(request, env, ctx) {
  const authResponse = await authorizeWithBaseWorker(request, env, ctx);
  if (!authResponse.ok) return authResponse;

  const responseHeaders = adminAuthHeaders(authResponse);
  const service = robotServiceConfig(env);
  if (!service.configured) {
    return json({
      configured: false,
      connected: false,
      qrReady: false,
      authState: "not_configured",
      message: "O serviço 24 horas do robô ainda não foi vinculado a este sistema."
    }, 200, responseHeaders);
  }

  let remotePath = "/control/status";
  let remoteMethod = "GET";
  let action = "status";

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Dados inválidos." }, 400, responseHeaders);
    }

    action = body?.action === "reset" ? "reset" : body?.action === "restart" ? "restart" : "";
    if (!action) return json({ error: "Ação inválida." }, 400, responseHeaders);
    remotePath = action === "reset" ? "/control/reset" : "/control/restart";
    remoteMethod = "POST";
  } else if (request.method !== "GET") {
    return json({ error: "Método não permitido." }, 405, responseHeaders);
  }

  try {
    const remoteResponse = await fetch(`${service.url}${remotePath}`, {
      method: remoteMethod,
      headers: {
        authorization: `Bearer ${service.token}`,
        accept: "application/json"
      }
    });
    const data = await remoteResponse.json().catch(() => ({}));
    if (!remoteResponse.ok) {
      return json({
        configured: true,
        connected: false,
        qrReady: false,
        authState: "unreachable",
        error: safeText(data?.error, 300) || "O serviço do WhatsApp recusou a solicitação."
      }, 502, responseHeaders);
    }

    if (request.method === "POST") {
      return json({
        configured: true,
        ok: true,
        accepted: true,
        action,
        message: action === "reset"
          ? "Conexão anterior removida. Preparando um novo QR Code."
          : "Reconexão do robô iniciada."
      }, 202, responseHeaders);
    }

    const qrImage = typeof data?.qrImage === "string"
      && data.qrImage.startsWith("data:image/")
      && data.qrImage.length <= 600000
      ? data.qrImage
      : "";

    return json({
      configured: true,
      connected: Boolean(data?.connected),
      qrReady: Boolean(qrImage),
      qrImage,
      authState: safeText(data?.authState, 80) || "unknown",
      connectedAt: safeText(data?.connectedAt, 80) || null,
      lastError: safeText(data?.lastError, 400) || null
    }, 200, responseHeaders);
  } catch {
    return json({
      configured: true,
      connected: false,
      qrReady: false,
      authState: "unreachable",
      error: "Não foi possível falar com o serviço 24 horas do WhatsApp."
    }, 502, responseHeaders);
  }
}

async function handleRobotSettings(request, env, ctx) {
  if (request.method === "GET") {
    const settings = await loadRobotSettings(env);
    return json(settings);
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authResponse = await authorizeWithBaseWorker(request, env, ctx);
  if (!authResponse.ok) return authResponse;
  if (!env.PROMOTIONS) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }

  const settings = {
    enabled: Boolean(data.enabled),
    greeting: safeText(data.greeting, 500) || DEFAULT_ROBOT_SETTINGS.greeting,
    fallback: safeText(data.fallback, 500) || DEFAULT_ROBOT_SETTINGS.fallback,
    humanHandoff: data.humanHandoff !== false,
    businessHoursOnly: Boolean(data.businessHoursOnly),
    openTime: safeTime(data.openTime, DEFAULT_ROBOT_SETTINGS.openTime),
    closeTime: safeTime(data.closeTime, DEFAULT_ROBOT_SETTINGS.closeTime),
    menuText: safeText(data.menuText, 1200) || DEFAULT_ROBOT_SETTINGS.menuText,
    deliveryFee: safeDeliveryFee(data.deliveryFee),
    updatedAt: new Date().toISOString()
  };

  await env.PROMOTIONS.put("robot-settings", JSON.stringify(settings));
  const setCookie = authResponse.headers.get("set-cookie");
  return json({ ok: true, settings, storageConfigured: true }, 200, setCookie ? { "set-cookie": setCookie } : {});
}

async function createRobotOrder(request, env, ctx, session, phone, key, deliveryFee) {
  const clientOrderId = `robot-${phone}-${session.checkoutStartedAt || Date.now()}`;
  const payload = {
    clientOrderId,
    customerName: session.customerName,
    customerPhone: phone,
    deliveryType: session.deliveryType,
    address: session.deliveryType === "Entrega" ? session.address : "",
    reference: "",
    payment: session.payment,
    changeFor: "",
    note: "Pedido realizado pelo robô de atendimento.",
    deliveryFee,
    localDate: currentManausDate(),
    items: session.cart.map((item) => ({ id: item.id, qty: item.qty }))
  };

  const orderUrl = new URL("/api/orders", request.url);
  const orderRequest = new Request(orderUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.ROBOT_WEBHOOK_TOKEN ? { "x-robot-token": env.ROBOT_WEBHOOK_TOKEN } : {})
    },
    body: JSON.stringify(payload)
  });
  const response = await baseWorker.fetch(orderRequest, env, ctx);
  const data = await response.clone().json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, error: data.error || "Não foi possível registrar o pedido." };
  }

  if (data?.order && !data?.duplicate) {
    const task = notifyNewOrder(env, data.order).catch(() => null);
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
  }

  await clearSession(env, key);
  return { ok: true, order: data.order, duplicate: Boolean(data.duplicate) };
}

async function handleRobotConversation(request, env, ctx) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!env.PROMOTIONS) return json({ error: "Armazenamento do robô não configurado." }, 503);

  if (env.ROBOT_WEBHOOK_TOKEN) {
    const token = request.headers.get("x-robot-token") || "";
    if (token !== env.ROBOT_WEBHOOK_TOKEN) return json({ error: "Token do robô inválido." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }

  const contactId = safeText(body.contactId || body.phone, 140);
  const message = safeText(body.message, 500);
  const phone = normalizePhone(body.phone || contactId);
  const key = sessionKey(contactId);
  if (!key) return json({ error: "Identificador do cliente é obrigatório." }, 400);

  const settings = await loadRobotSettings(env);
  if (!settings.enabled) return json({ reply: "O atendimento automático está desligado.", disabled: true, handoff: true });
  if (!withinBusinessHours(settings)) {
    return json({
      reply: "Olá! Nosso atendimento automático está fora do horário configurado. Assim que possível, uma pessoa da equipe continuará com você.",
      handoff: true,
      outsideBusinessHours: true
    });
  }

  if (body.reset === true) {
    await clearSession(env, key);
    return json({ reply: "Atendimento reiniciado. Digite *cardápio* para começar um novo pedido.", state: "idle", cart: [] });
  }

  const products = await getAvailableProducts(request, env, ctx);
  let session = await loadSession(env, key);
  const text = plain(message);
  const origin = new URL(request.url).origin;

  const respond = async (reply, extra = {}) => {
    await saveSession(env, key, session);
    return json({ reply, state: session.stage, cart: session.cart, ...extra });
  };

  if (/^(cancelar|cancelar pedido|recomecar|reiniciar)$/.test(text)) {
    await clearSession(env, key);
    return json({ reply: "Pedido cancelado e atendimento reiniciado. Digite *cardápio* quando quiser começar novamente.", state: "idle", cart: [] });
  }

  if (/^(atendente|humano|falar com atendente|falar com humano)$/.test(text)) {
    return json({
      reply: settings.humanHandoff ? "Certo. Vou encaminhar seu atendimento para uma pessoa da equipe." : settings.fallback,
      state: session.stage,
      cart: session.cart,
      handoff: settings.humanHandoff
    });
  }

  if (/^(menu|oi|ola|bom dia|boa tarde|boa noite|iniciar|comecar)$/.test(text) && session.stage === "idle") {
    session.stage = "idle";
    return respond(`${settings.greeting}\n\n${settings.menuText}`);
  }

  if (/^(cardapio|cardápio|produtos|ver cardapio|ver cardápio|quero o cardapio|quero o cardápio)$/.test(message.trim().toLowerCase()) || /cardapio|cardápio/.test(message.trim().toLowerCase())) {
    session.stage = "select_item";
    session.pendingProductId = "";
    return respond(formatCatalog(products, origin));
  }

  if (/^(carrinho|meu pedido|ver pedido|pedido)$/.test(text) && session.cart.length) {
    return respond(`🛒 *Seu pedido até agora:*\n${formatCart(session.cart)}\n\nPara adicionar outro item, envie o número dele. Para concluir, envie *finalizar*.`);
  }

  if (text === "finalizar") {
    if (!session.cart.length) {
      session.stage = "select_item";
      return respond(`Seu pedido ainda está vazio.\n\n${formatCatalog(products, origin)}`);
    }
    session.stage = "checkout_name";
    session.checkoutStartedAt = session.checkoutStartedAt || Date.now();
    return respond(`✅ Vamos finalizar.\n\n${formatCart(session.cart)}\n\nQual é o *nome* para o pedido?`);
  }

  if (session.stage === "quantity") {
    if (!/^\d+$/.test(message.trim())) {
      const pending = products.find((item) => String(item.id) === String(session.pendingProductId));
      return respond(`Envie *somente um número* para a quantidade${pending ? ` de ${pending.name}` : ""}.\nExemplo: *2*`);
    }

    const qty = Number(message.trim());
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) {
      return respond(`A quantidade deve ser um número entre *1 e ${MAX_ITEM_QTY}*.`);
    }

    const product = products.find((item) => String(item.id) === String(session.pendingProductId));
    if (!product) {
      session.stage = "select_item";
      session.pendingProductId = "";
      return respond("Esse produto não está mais disponível. Digite *cardápio* para atualizar a lista.");
    }

    addToCart(session.cart, product, qty);
    session.pendingProductId = "";
    session.stage = "select_item";
    return respond(`✅ Adicionado: *${qty}x ${product.name}*\n\n🛒 *Seu pedido:*\n${formatCart(session.cart)}\n\nPara adicionar outro item, envie o *número do item*.\nPara concluir, envie *finalizar*.\nPara rever a lista, envie *cardápio*.`);
  }

  if (session.stage === "checkout_name") {
    if (!message.trim() || /^\d+$/.test(message.trim())) return respond("Digite o *nome* para o pedido.");
    session.customerName = safeText(message, 80);
    if (!phone) {
      session.stage = "checkout_phone";
      return respond("Qual é o número de WhatsApp com DDD?\nExemplo: *92999999999*");
    }
    session.stage = "checkout_delivery";
    return respond(deliveryChoices(settings));
  }

  if (session.stage === "checkout_phone") {
    const typedPhone = normalizePhone(message);
    if (!typedPhone) return respond("Envie um número de telefone válido com DDD.\nExemplo: *92999999999*");
    session.phone = typedPhone;
    session.stage = "checkout_delivery";
    return respond(deliveryChoices(settings));
  }

  if (session.stage === "checkout_delivery") {
    if (text === "1" || text === "entrega") {
      session.deliveryType = "Entrega";
      session.stage = "checkout_address";
      const fee = safeDeliveryFee(settings.deliveryFee);
      return respond(`Qual é o *endereço completo* para entrega?${fee > 0 ? `\n\nTaxa de entrega: *${money(fee)}*` : ""}`);
    }
    if (text === "2" || text === "retirada") {
      session.deliveryType = "Retirada";
      session.address = "";
      session.stage = "checkout_payment";
      return respond("Forma de pagamento:\n\n*1* - Pix\n*2* - Cartão\n*3* - Dinheiro");
    }
    return respond(`Escolha apenas uma opção:\n*1* - Entrega${safeDeliveryFee(settings.deliveryFee) > 0 ? ` (+ ${money(settings.deliveryFee)})` : ""}\n*2* - Retirada`);
  }

  if (session.stage === "checkout_address") {
    if (message.trim().length < 5) return respond("Digite um endereço mais completo para a entrega.");
    session.address = safeText(message, 160);
    session.stage = "checkout_payment";
    return respond("Forma de pagamento:\n\n*1* - Pix\n*2* - Cartão\n*3* - Dinheiro");
  }

  if (session.stage === "checkout_payment") {
    const paymentMap = { "1": "Pix", "pix": "Pix", "2": "Cartão", "cartao": "Cartão", "cartão": "Cartão", "3": "Dinheiro", "dinheiro": "Dinheiro" };
    const payment = paymentMap[text];
    if (!payment) return respond("Escolha uma forma de pagamento:\n*1* - Pix\n*2* - Cartão\n*3* - Dinheiro");
    session.payment = payment;

    const finalPhone = phone || normalizePhone(session.phone);
    if (!finalPhone) {
      session.stage = "checkout_phone";
      return respond("Antes de registrar o pedido, envie seu número de WhatsApp com DDD.");
    }

    const deliveryFee = session.deliveryType === "Entrega" ? safeDeliveryFee(settings.deliveryFee) : 0;
    const result = await createRobotOrder(request, env, ctx, session, finalPhone, key, deliveryFee);
    if (!result.ok) {
      return respond(`Não consegui registrar o pedido: ${result.error}\nDigite *finalizar* para tentar novamente ou *atendente* para pedir ajuda.`, { error: true });
    }

    const order = result.order || {};
    return json({
      reply: `✅ *Pedido confirmado!*\n\nNúmero: *${order.id || "registrado"}*\n${formatCart(session.cart, deliveryFee)}\n\nPagamento: *${session.payment}*\n${session.deliveryType === "Entrega" ? `Entrega: *${session.address}*` : "Retirada no local."}\n\nObrigado pelo pedido! 🍔`,
      state: "completed",
      cart: [],
      order,
      completed: true
    });
  }

  if (session.stage === "select_item" || session.stage === "idle") {
    const selection = findProductFromMessage(message, products);
    if (selection.product) {
      session.pendingProductId = String(selection.product.id);
      session.stage = "quantity";
      return respond(`Você escolheu *${selection.product.name}* (${money(selection.product.price)}).\n\nQuantas unidades?\nEnvie *somente o número*. Exemplo: *2*`);
    }
    if (selection.ambiguous.length > 1) {
      const options = selection.ambiguous.slice(0, 8).map((item) => {
        const index = products.findIndex((product) => String(product.id) === String(item.id));
        return `${index + 1}. ${item.name}`;
      }).join("\n");
      session.stage = "select_item";
      return respond(`Encontrei mais de uma opção. Escolha pelo número:\n\n${options}`);
    }
    session.stage = "select_item";
    return respond(`${settings.fallback}\n\n${formatCatalog(products, origin)}`);
  }

  return respond(settings.fallback);
}

function publicFirebaseConfig(env) {
  const config = {
    apiKey: String(env.FCM_ANDROID_API_KEY || ""),
    appId: String(env.FCM_ANDROID_APP_ID || ""),
    projectId: String(env.FCM_PROJECT_ID || ""),
    senderId: String(env.FCM_SENDER_ID || "")
  };
  return new Response(JSON.stringify({
    ...config,
    configured: Boolean(config.apiKey && config.appId && config.projectId && config.senderId)
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/business-contact") {
      return handleBusinessContact(request, env);
    }

    if (url.pathname === "/api/robot") {
      return handleRobotSettings(request, env, ctx);
    }

    if (url.pathname === "/api/robot/chat") {
      return handleRobotConversation(request, env, ctx);
    }

    if (url.pathname === "/api/robot/connection") {
      return handleRobotConnection(request, env, ctx);
    }

    if (url.pathname === "/api/push/config" && request.method === "GET") {
      return publicFirebaseConfig(env);
    }

    if (url.pathname === "/api/push/register") {
      const authResponse = await authorizeWithBaseWorker(request, env, ctx);
      if (!authResponse.ok) return authResponse;
      return handlePushRegistration(request, env);
    }

    if (url.pathname === "/api/orders" && request.method === "POST") {
      const response = await baseWorker.fetch(request, env, ctx);

      if (response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        if (data?.order && !data?.duplicate) {
          const task = notifyNewOrder(env, data.order).catch(() => null);
          if (ctx?.waitUntil) ctx.waitUntil(task);
          else await task;
        }
      }

      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
