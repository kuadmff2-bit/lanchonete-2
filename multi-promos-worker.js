import { storageConfigured, storageGet, storagePut } from "./storage.js";

const PROMOTIONS_KEY = "promotions-v2";
const LEGACY_PROMOTION_KEY = "current-promotion";
const MAX_PROMOTIONS = 24;
const MAX_RECENT_ORDERS = 80;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}
function safeText(value, max = 120) { return String(value ?? "").trim().slice(0, max); }
function safePrice(value) { const number = Number(value); return Number.isFinite(number) ? Number(Math.max(0, Math.min(number, 10000)).toFixed(2)) : 0; }
function safeDate(value) { const text = String(value || ""); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10); }
function normalizeCustomerPhone(value) { let digits = String(value || "").replace(/\D/g, "").slice(0, 15); if (digits.length === 10 || digits.length === 11) digits = `55${digits}`; return /^55\d{10,11}$/.test(digits) ? digits : ""; }
function normalizePromotion(item, index = 0) {
  const image = String(item?.image || "");
  return {
    id: safeText(item?.id, 100) || `PROMO-${Date.now()}-${index}-${Math.floor(Math.random() * 900 + 100)}`,
    active: item?.active !== false,
    title: safeText(item?.title, 80),
    description: safeText(item?.description, 240),
    image: image.startsWith("data:image/") && image.length <= 1500000 ? image : "",
    price: safePrice(item?.price),
    orderEnabled: item?.orderEnabled !== false,
    updatedAt: safeText(item?.updatedAt, 80) || new Date().toISOString()
  };
}

export async function readPromotions(env) {
  if (!storageConfigured(env)) return [];
  const raw = await storageGet(env, PROMOTIONS_KEY);
  if (raw) {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed.map(normalizePromotion).filter((promo) => promo.title).slice(0, MAX_PROMOTIONS); } catch {}
  }
  const legacyRaw = await storageGet(env, LEGACY_PROMOTION_KEY);
  if (!legacyRaw) return [];
  try {
    const legacy = JSON.parse(legacyRaw);
    if (!legacy || typeof legacy !== "object" || !legacy.title) return [];
    const migrated = [normalizePromotion(legacy, 0)];
    await storagePut(env, PROMOTIONS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch { return []; }
}

async function authorizeAdmin(request, env, ctx, appWorker) {
  const url = new URL("/api/auth", request.url);
  return appWorker.fetch(new Request(url, { method: "GET", headers: request.headers }), env, ctx);
}
function authHeaders(authResponse) { const cookie = authResponse?.headers?.get("set-cookie"); return cookie ? { "set-cookie": cookie } : {}; }

export async function handlePromotionsApi(request, env, ctx, appWorker) {
  if (request.method === "GET") return json({ promotions: await readPromotions(env), storageConfigured: storageConfigured(env) });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const auth = await authorizeAdmin(request, env, ctx, appWorker);
  if (!auth.ok) return auth;
  if (!storageConfigured(env)) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500, authHeaders(auth));
  let body;
  try { body = await request.json(); } catch { return json({ error: "Dados de promoções inválidos." }, 400, authHeaders(auth)); }
  if (!Array.isArray(body?.promotions)) return json({ error: "Lista de promoções inválida." }, 400, authHeaders(auth));
  if (body.promotions.length > MAX_PROMOTIONS) return json({ error: `Limite de ${MAX_PROMOTIONS} promoções.` }, 400, authHeaders(auth));
  const ids = new Set();
  const promotions = [];
  for (let index = 0; index < body.promotions.length; index += 1) {
    const promo = normalizePromotion(body.promotions[index], index);
    if (!promo.title) return json({ error: "Toda promoção precisa de um título." }, 400, authHeaders(auth));
    if (promo.orderEnabled && promo.price <= 0) return json({ error: `Informe um valor maior que zero para ${promo.title}.` }, 400, authHeaders(auth));
    if (ids.has(promo.id)) promo.id = `PROMO-${Date.now()}-${index}-${Math.floor(Math.random() * 900 + 100)}`;
    ids.add(promo.id);
    promotions.push({ ...promo, updatedAt: new Date().toISOString() });
  }
  await storagePut(env, PROMOTIONS_KEY, JSON.stringify(promotions));
  return json({ ok: true, promotions, storageConfigured: true }, 200, authHeaders(auth));
}

async function readStats(env) {
  const raw = await storageGet(env, "order-stats");
  const base = { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: "" };
  try { return raw ? { ...base, ...JSON.parse(raw) } : base; } catch { return base; }
}
async function readRecentOrders(env) { const raw = await storageGet(env, "recent-orders"); try { const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function addOrderToStats(stats, order) {
  if (stats.currentDate !== order.localDate) { stats.currentDate = order.localDate; stats.todayOrders = 0; stats.todayValue = 0; }
  stats.totalOrders = (Number(stats.totalOrders) || 0) + 1;
  stats.totalValue = Number(((Number(stats.totalValue) || 0) + Number(order.total || 0)).toFixed(2));
  stats.todayOrders = (Number(stats.todayOrders) || 0) + 1;
  stats.todayValue = Number(((Number(stats.todayValue) || 0) + Number(order.total || 0)).toFixed(2));
  return stats;
}
async function catalogProducts(request, env, ctx, appWorker) {
  const url = new URL("/api/products", request.url);
  const response = await appWorker.fetch(new Request(url, { method: "GET" }), env, ctx);
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.products) ? data.products : [];
}

export async function createOrderWithPromotion(request, env, ctx, appWorker, suppliedBody = null) {
  if (!storageConfigured(env)) return json({ error: "O sistema de pedidos está temporariamente indisponível." }, 503);
  let body = suppliedBody;
  if (!body) { try { body = await request.json(); } catch { return json({ error: "Dados do pedido inválidos." }, 400); } }
  const customerName = safeText(body?.customerName, 80);
  const customerPhone = normalizeCustomerPhone(body?.customerPhone);
  const deliveryType = body?.deliveryType === "Retirada" ? "Retirada" : "Entrega";
  const payment = ["Pix", "Cartão", "Dinheiro"].includes(body?.payment) ? body.payment : "";
  const localDate = safeDate(body?.localDate);
  const clientOrderId = safeText(body?.clientOrderId, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const requestedPromoId = safeText(body?.promoId, 100);
  const requestedItems = Array.isArray(body?.items) ? body.items : [];
  if (!customerName) return json({ error: "Informe o nome do cliente." }, 400);
  if (!customerPhone) return json({ error: "Informe um número de WhatsApp válido com DDD." }, 400);
  if (!payment) return json({ error: "Selecione a forma de pagamento." }, 400);
  if (deliveryType === "Entrega" && !safeText(body?.address, 160)) return json({ error: "Informe o endereço para entrega." }, 400);
  if (!requestedPromoId) return json({ error: "Promoção inválida." }, 400);
  if (requestedItems.length > 30) return json({ error: "Há itens demais no pedido." }, 400);
  if (clientOrderId) {
    const duplicateRaw = await storageGet(env, `order-dedupe:${clientOrderId}`);
    if (duplicateRaw) { try { return json({ ok: true, duplicate: true, order: JSON.parse(duplicateRaw), storageConfigured: true }); } catch {} }
  }
  const promotions = await readPromotions(env);
  const promo = promotions.find((item) => String(item.id) === requestedPromoId);
  const promoPrice = safePrice(promo?.price);
  if (!promo || !promo.active || !promo.orderEnabled || promoPrice <= 0) return json({ error: "Essa promoção mudou ou não está mais disponível. Atualize o cardápio e tente novamente." }, 409);
  const catalog = await catalogProducts(request, env, ctx, appWorker);
  const normalizedItems = [];
  for (const requested of requestedItems) {
    const requestedId = safeText(requested?.id, 80);
    const requestedName = safeText(requested?.name, 80);
    const product = catalog.find((item) => String(item.id) === requestedId) || catalog.find((item) => item.name === requestedName);
    const qty = Math.max(1, Math.min(Number(requested?.qty) || 1, 30));
    if (!product || product.available === false) return json({ error: `O item ${requestedName || "selecionado"} não está mais disponível. Atualize o cardápio e tente novamente.` }, 409);
    const unitPrice = safePrice(product.price);
    normalizedItems.push({ id: String(product.id), name: String(product.name), qty, unitPrice, subtotal: Number((unitPrice * qty).toFixed(2)), type: "product" });
  }
  normalizedItems.unshift({ id: `promo:${promo.id}`, name: `Promoção: ${promo.title}`, qty: 1, unitPrice: promoPrice, subtotal: promoPrice, type: "promotion", promotionId: String(promo.id) });
  const itemCount = normalizedItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const total = Number(normalizedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0).toFixed(2));
  if (itemCount <= 0 || total <= 0 || total > 10000) return json({ error: "O valor do pedido é inválido." }, 400);
  const now = new Date().toISOString();
  const order = { id: `P${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`, clientOrderId, createdAt: now, updatedAt: now, localDate, status: "novo", customerName, customerPhone, deliveryType, deliveryFee: 0, address: deliveryType === "Entrega" ? safeText(body?.address, 160) : "", reference: deliveryType === "Entrega" ? safeText(body?.reference, 120) : "", payment, changeFor: payment === "Dinheiro" ? safeText(body?.changeFor, 40) : "", note: safeText(body?.note, 300), promotionId: String(promo.id), total, itemCount, items: normalizedItems };
  const [stats, recent] = await Promise.all([readStats(env), readRecentOrders(env)]);
  addOrderToStats(stats, order); recent.unshift(order);
  const writes = [storagePut(env, "order-stats", JSON.stringify(stats)), storagePut(env, "recent-orders", JSON.stringify(recent.slice(0, MAX_RECENT_ORDERS)))];
  if (clientOrderId) writes.push(storagePut(env, `order-dedupe:${clientOrderId}`, JSON.stringify(order), { expirationTtl: 86400 }));
  await Promise.all(writes);
  return json({ ok: true, order, storageConfigured: true }, 201);
}
