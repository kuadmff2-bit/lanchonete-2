const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  }
});

const DEFAULT_PRODUCTS = [
  { id: "1", name: "X-Tudo", price: 15, description: "O mais completo da casa.", category: "lanche", available: true, image: "" },
  { id: "2", name: "X-Calabresa", price: 12, description: "Lanche com sabor marcante de calabresa.", category: "lanche", available: true, image: "" },
  { id: "3", name: "X-Bacon", price: 12, description: "Clássico com bacon.", category: "lanche", available: true, image: "" },
  { id: "4", name: "X-Salsicha", price: 12, description: "Lanche reforçado com salsicha.", category: "lanche", available: true, image: "" },
  { id: "5", name: "X-Banana", price: 12, description: "Uma combinação diferente e saborosa.", category: "lanche", available: true, image: "" },
  { id: "6", name: "X-Salada", price: 9, description: "Clássico, leve e bem montado.", category: "lanche", available: true, image: "" },
  { id: "7", name: "X-Burguer", price: 7, description: "Hambúrguer simples e direto ao ponto.", category: "lanche", available: true, image: "" },
  { id: "8", name: "X-Egg / X-Pio", price: 7, description: "Opção com ovo.", category: "lanche", available: true, image: "" },
  { id: "9", name: "Misto Duplo", price: 7, description: "Misto em versão dupla.", category: "lanche", available: true, image: "" },
  { id: "10", name: "Queijo Duplo", price: 6, description: "Para quem gosta de muito queijo.", category: "lanche", available: true, image: "" },
  { id: "11", name: "Hambúrguer", price: 5, description: "Hambúrguer tradicional.", category: "lanche", available: true, image: "" },
  { id: "12", name: "Misto Quente", price: 5, description: "O clássico misto quente.", category: "lanche", available: true, image: "" },
  { id: "13", name: "Misto Simples", price: 5, description: "Simples, rápido e saboroso.", category: "lanche", available: true, image: "" }
];

const ADMIN_SESSION_COOKIE = "lanchonete_admin_session";
const ADMIN_SESSION_TTL = 60 * 60 * 24 * 30;
const ADMIN_APP_MARKER = "LanchoneteAdminApp/";
const ORDER_STATUSES = new Set(["novo", "confirmado", "preparando", "saiu_entrega", "finalizado", "cancelado"]);
const MAX_RECENT_ORDERS = 80;

function readCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function isAdminAppRequest(request) {
  return (request.headers.get("user-agent") || "").includes(ADMIN_APP_MARKER);
}

function sessionCookie(token) {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_SESSION_TTL}; HttpOnly; Secure; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

async function createAdminSession(env) {
  if (!env.PROMOTIONS) return "";
  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  await env.PROMOTIONS.put(`admin-session:${token}`, "1", { expirationTtl: ADMIN_SESSION_TTL });
  return token;
}

async function authorized(request, env) {
  if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_SHA256) {
    return { ok: false, response: json({ error: "Senha de administrador não configurada no Cloudflare." }, 500) };
  }

  const sessionToken = readCookie(request, ADMIN_SESSION_COOKIE);
  if (sessionToken && env.PROMOTIONS) {
    const validSession = await env.PROMOTIONS.get(`admin-session:${sessionToken}`);
    if (validSession === "1") return { ok: true, sessionToken, fromSession: true };
  }

  const password = request.headers.get("x-admin-password") || "";
  if (!await secretMatches(password, env.ADMIN_PASSWORD, env.ADMIN_PASSWORD_SHA256)) {
    return { ok: false, response: json({ error: "Senha incorreta." }, 401) };
  }

  let setCookie = "";
  if (isAdminAppRequest(request) && env.PROMOTIONS) {
    const token = await createAdminSession(env);
    if (token) setCookie = sessionCookie(token);
  }

  return { ok: true, setCookie, fromSession: false };
}

function authJson(data, auth, status = 200) {
  return json(data, status, auth?.setCookie ? { "set-cookie": auth.setCookie } : {});
}

function normalizeProduct(item, index) {
  const price = Number(item?.price);
  const image = String(item?.image || "");
  return {
    id: String(item?.id || `p-${Date.now()}-${index}`).slice(0, 80),
    name: String(item?.name || "").trim().slice(0, 80),
    price: Number.isFinite(price) ? Math.max(0, Math.min(price, 10000)) : 0,
    description: String(item?.description || "").trim().slice(0, 220),
    category: item?.category === "bebida" ? "bebida" : "lanche",
    available: item?.available !== false,
    image: image.startsWith("data:image/") && image.length <= 700000 ? image : ""
  };
}

function safeDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10);
}

function safeText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function normalizeCustomerPhone(value) {
  let digits = String(value || "").replace(/\D/g, "").slice(0, 15);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55\d{10,11}$/.test(digits) ? digits : "";
}

function safePrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(Math.max(0, Math.min(number, 10000)).toFixed(2));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretMatches(value, plainSecret, secretHash) {
  const supplied = String(value || "");
  if (!supplied) return false;
  if (plainSecret && supplied === String(plainSecret)) return true;
  const expectedHash = String(secretHash || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(expectedHash) && await sha256Hex(supplied) === expectedHash;
}

async function getProducts(env) {
  if (!env.PROMOTIONS) return DEFAULT_PRODUCTS;
  const raw = await env.PROMOTIONS.get("products");
  if (!raw) return DEFAULT_PRODUCTS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

async function getPromotion(env) {
  if (!env.PROMOTIONS) return null;
  const raw = await env.PROMOTIONS.get("current-promotion");
  if (!raw) return null;
  try {
    const promo = JSON.parse(raw);
    return promo && typeof promo === "object" ? promo : null;
  } catch {
    return null;
  }
}

async function readStats(env) {
  const raw = await env.PROMOTIONS.get("order-stats");
  const base = { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: "" };
  try { return raw ? { ...base, ...JSON.parse(raw) } : base; } catch { return base; }
}

async function readRecentOrders(env) {
  const raw = await env.PROMOTIONS.get("recent-orders");
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStatsDate(stats, localDate) {
  if (stats.currentDate !== localDate) {
    stats.currentDate = localDate;
    stats.todayOrders = 0;
    stats.todayValue = 0;
  }
  return stats;
}

function addOrderToStats(stats, order) {
  normalizeStatsDate(stats, order.localDate);
  stats.totalOrders = (Number(stats.totalOrders) || 0) + 1;
  stats.totalValue = Math.max(0, (Number(stats.totalValue) || 0) + Number(order.total || 0));
  if (stats.currentDate === order.localDate) {
    stats.todayOrders = (Number(stats.todayOrders) || 0) + 1;
    stats.todayValue = Math.max(0, (Number(stats.todayValue) || 0) + Number(order.total || 0));
  }
  return stats;
}

function removeOrderFromStats(stats, order) {
  stats.totalOrders = Math.max(0, (Number(stats.totalOrders) || 0) - 1);
  stats.totalValue = Math.max(0, (Number(stats.totalValue) || 0) - Number(order.total || 0));
  if (stats.currentDate === order.localDate) {
    stats.todayOrders = Math.max(0, (Number(stats.todayOrders) || 0) - 1);
    stats.todayValue = Math.max(0, (Number(stats.todayValue) || 0) - Number(order.total || 0));
  }
  return stats;
}

async function handleProducts(request, env) {
  if (request.method === "GET") {
    return json({ products: await getProducts(env), storageConfigured: Boolean(env.PROMOTIONS) });
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const auth = await authorized(request, env);
  if (!auth.ok) return auth.response;
  if (!env.PROMOTIONS) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  if (!Array.isArray(body?.products)) return json({ error: "Lista de produtos inválida." }, 400);
  if (body.products.length > 60) return json({ error: "Limite de 60 produtos." }, 400);

  const products = body.products.map(normalizeProduct).filter((p) => p.name);
  await env.PROMOTIONS.put("products", JSON.stringify(products));
  return authJson({ ok: true, products, storageConfigured: true }, auth);
}

async function handlePromo(request, env) {
  if (request.method === "GET") {
    if (!env.PROMOTIONS) return json({ active: false, orderEnabled: false, storageConfigured: false });
    const promo = await getPromotion(env);
    return json(promo ? { ...promo, storageConfigured: true } : { active: false, orderEnabled: false, storageConfigured: true });
  }

  if (request.method === "DELETE") {
    const auth = await authorized(request, env);
    if (!auth.ok) return auth.response;
    if (!env.PROMOTIONS) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);
    await env.PROMOTIONS.delete("current-promotion");
    return authJson({ ok: true, deleted: true, storageConfigured: true }, auth);
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const auth = await authorized(request, env);
  if (!auth.ok) return auth.response;
  if (!env.PROMOTIONS) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);

  let data;
  try { data = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  const previous = await getPromotion(env);
  const price = safePrice(data.price);
  const orderEnabled = Boolean(data.orderEnabled);
  const promo = {
    id: safeText(previous?.id, 100) || `PROMO-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    active: Boolean(data.active),
    title: safeText(data.title, 80),
    description: safeText(data.description, 240),
    image: String(data.image || ""),
    price,
    orderEnabled,
    updatedAt: new Date().toISOString()
  };

  if ((promo.active || promo.orderEnabled) && !promo.title) return json({ error: "Informe o título da promoção." }, 400);
  if (promo.orderEnabled && promo.price <= 0) return json({ error: "Informe um valor maior que zero para o pedido direto." }, 400);
  if (promo.image && !promo.image.startsWith("data:image/")) return json({ error: "Formato de imagem inválido." }, 400);
  if (promo.image.length > 1500000) return json({ error: "A imagem ficou muito grande." }, 413);

  await env.PROMOTIONS.put("current-promotion", JSON.stringify(promo));
  return authJson({ ok: true, promotion: promo, storageConfigured: true }, auth);
}

async function createOrder(request, env) {
  if (!env.PROMOTIONS) return json({ error: "O sistema de pedidos está temporariamente indisponível." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Dados do pedido inválidos." }, 400); }

  const customerName = safeText(body?.customerName, 80);
  const customerPhone = normalizeCustomerPhone(body?.customerPhone);
  const deliveryType = body?.deliveryType === "Retirada" ? "Retirada" : "Entrega";
  const trustedRobotOrder = await secretMatches(
    request.headers.get("x-robot-token"),
    env.ROBOT_WEBHOOK_TOKEN,
    env.ROBOT_WEBHOOK_TOKEN_SHA256
  );
  const deliveryFee = deliveryType === "Entrega" && trustedRobotOrder
    ? Math.min(safePrice(body?.deliveryFee), 1000)
    : 0;
  const payment = ["Pix", "Cartão", "Dinheiro"].includes(body?.payment) ? body.payment : "";
  const localDate = safeDate(body?.localDate);
  const clientOrderId = safeText(body?.clientOrderId, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const requestedPromoId = safeText(body?.promoId, 100);
  const requestedItems = Array.isArray(body?.items) ? body.items : [];

  if (!customerName) return json({ error: "Informe o nome do cliente." }, 400);
  if (!customerPhone) return json({ error: "Informe um número de WhatsApp válido com DDD." }, 400);
  if (!payment) return json({ error: "Selecione a forma de pagamento." }, 400);
  if (deliveryType === "Entrega" && !safeText(body?.address, 160)) return json({ error: "Informe o endereço para entrega." }, 400);
  if (requestedItems.length > 30) return json({ error: "Há itens demais no pedido." }, 400);
  if (requestedItems.length === 0 && !requestedPromoId) return json({ error: "O pedido está vazio ou inválido." }, 400);

  if (clientOrderId) {
    const duplicateRaw = await env.PROMOTIONS.get(`order-dedupe:${clientOrderId}`);
    if (duplicateRaw) {
      try {
        const existing = JSON.parse(duplicateRaw);
        return json({ ok: true, duplicate: true, order: existing, storageConfigured: true });
      } catch {}
    }
  }

  const catalog = await getProducts(env);
  const normalizedItems = [];

  for (const requested of requestedItems) {
    const requestedId = safeText(requested?.id, 80);
    const requestedName = safeText(requested?.name, 80);
    const product = catalog.find((p) => String(p.id) === requestedId) || catalog.find((p) => p.name === requestedName);
    const qty = Math.max(1, Math.min(Number(requested?.qty) || 1, 30));
    if (!product || product.available === false) {
      return json({ error: `O item ${requestedName || "selecionado"} não está mais disponível. Atualize o cardápio e tente novamente.` }, 409);
    }
    normalizedItems.push({
      id: String(product.id),
      name: String(product.name),
      qty,
      unitPrice: Number(product.price),
      subtotal: Number(product.price) * qty,
      type: "product"
    });
  }

  let promotionId = "";
  if (requestedPromoId) {
    const promo = await getPromotion(env);
    const promoPrice = safePrice(promo?.price);
    if (!promo || !promo.active || !promo.orderEnabled || !promo.id || String(promo.id) !== requestedPromoId || promoPrice <= 0) {
      return json({ error: "Essa promoção mudou ou não está mais disponível. Atualize a página e tente novamente." }, 409);
    }
    promotionId = String(promo.id);
    normalizedItems.unshift({
      id: `promo:${promotionId}`,
      name: `Promoção: ${safeText(promo.title, 80) || "Oferta especial"}`,
      qty: 1,
      unitPrice: promoPrice,
      subtotal: promoPrice,
      type: "promotion",
      promotionId
    });
  }

  if (deliveryFee > 0) {
    normalizedItems.push({
      id: "delivery-fee",
      name: "Taxa de entrega",
      qty: 1,
      unitPrice: deliveryFee,
      subtotal: deliveryFee,
      type: "delivery_fee"
    });
  }

  const itemCount = normalizedItems.reduce((sum, item) => sum + (item.type === "delivery_fee" ? 0 : item.qty), 0);
  const total = Number(normalizedItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
  if (itemCount <= 0 || total < 0 || total > 10000) return json({ error: "O valor do pedido é inválido." }, 400);

  const now = new Date().toISOString();
  const order = {
    id: `P${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`,
    clientOrderId,
    createdAt: now,
    updatedAt: now,
    localDate,
    status: "novo",
    customerName,
    customerPhone,
    deliveryType,
    deliveryFee,
    address: deliveryType === "Entrega" ? safeText(body?.address, 160) : "",
    reference: deliveryType === "Entrega" ? safeText(body?.reference, 120) : "",
    payment,
    changeFor: payment === "Dinheiro" ? safeText(body?.changeFor, 40) : "",
    note: safeText(body?.note, 300),
    promotionId,
    total,
    itemCount,
    items: normalizedItems
  };

  const [stats, recent] = await Promise.all([readStats(env), readRecentOrders(env)]);
  addOrderToStats(stats, order);
  recent.unshift(order);
  const trimmed = recent.slice(0, MAX_RECENT_ORDERS);

  const writes = [
    env.PROMOTIONS.put("order-stats", JSON.stringify(stats)),
    env.PROMOTIONS.put("recent-orders", JSON.stringify(trimmed))
  ];
  if (clientOrderId) writes.push(env.PROMOTIONS.put(`order-dedupe:${clientOrderId}`, JSON.stringify(order), { expirationTtl: 86400 }));
  await Promise.all(writes);

  return json({ ok: true, order, storageConfigured: true }, 201);
}

async function updateOrderStatus(request, env, orderId) {
  const auth = await authorized(request, env);
  if (!auth.ok) return auth.response;
  if (!env.PROMOTIONS) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const status = safeText(body?.status, 30);
  if (!ORDER_STATUSES.has(status)) return json({ error: "Status de pedido inválido." }, 400);

  const [stats, recent] = await Promise.all([readStats(env), readRecentOrders(env)]);
  const index = recent.findIndex((order) => String(order.id) === String(orderId));
  if (index < 0) return json({ error: "Pedido não encontrado no histórico recente." }, 404);

  const previous = recent[index];
  if (previous.status !== "cancelado" && status === "cancelado") removeOrderFromStats(stats, previous);
  if (previous.status === "cancelado" && status !== "cancelado") addOrderToStats(stats, previous);

  const updated = { ...previous, status, updatedAt: new Date().toISOString() };
  recent[index] = updated;

  await Promise.all([
    env.PROMOTIONS.put("order-stats", JSON.stringify(stats)),
    env.PROMOTIONS.put("recent-orders", JSON.stringify(recent.slice(0, MAX_RECENT_ORDERS)))
  ]);

  return authJson({ ok: true, order: updated, stats, recent, storageConfigured: true }, auth);
}

async function handleOrders(request, env, url) {
  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch) {
    if (request.method !== "PATCH") return json({ error: "Método não permitido." }, 405);
    return updateOrderStatus(request, env, decodeURIComponent(orderMatch[1]));
  }

  if (request.method === "GET") {
    const auth = await authorized(request, env);
    if (!auth.ok) return auth.response;
    if (!env.PROMOTIONS) {
      return authJson({
        stats: { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: "" },
        recent: [],
        storageConfigured: false
      }, auth);
    }
    const [stats, recent] = await Promise.all([readStats(env), readRecentOrders(env)]);
    return authJson({ stats, recent, storageConfigured: true }, auth);
  }

  if (request.method === "DELETE") {
    const auth = await authorized(request, env);
    if (!auth.ok) return auth.response;
    if (!env.PROMOTIONS) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);
    await Promise.all([
      env.PROMOTIONS.delete("order-stats"),
      env.PROMOTIONS.delete("recent-orders")
    ]);
    return authJson({
      ok: true,
      cleared: true,
      stats: { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: localDateKeyForWorker() },
      recent: [],
      storageConfigured: true
    }, auth);
  }

  if (request.method === "POST") return createOrder(request, env);
  return json({ error: "Método não permitido." }, 405);
}

function localDateKeyForWorker() {
  return new Date().toISOString().slice(0, 10);
}

async function handleLogout(request, env) {
  if (request.method !== "POST" && request.method !== "DELETE") return json({ error: "Método não permitido." }, 405);
  const sessionToken = readCookie(request, ADMIN_SESSION_COOKIE);
  if (sessionToken && env.PROMOTIONS) await env.PROMOTIONS.delete(`admin-session:${sessionToken}`);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "SAMEORIGIN");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/auth") {
      if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
      const auth = await authorized(request, env);
      if (!auth.ok) return auth.response;
      return authJson({ ok: true, storageConfigured: Boolean(env.PROMOTIONS) }, auth);
    }

    if (url.pathname === "/api/logout") return handleLogout(request, env);
    if (url.pathname === "/api/products") return handleProducts(request, env);
    if (url.pathname === "/api/promo") return handlePromo(request, env);
    if (url.pathname === "/api/orders" || url.pathname.startsWith("/api/orders/")) return handleOrders(request, env, url);

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
};
