const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function safeDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10);
}

function emptyOrders(storageConfigured = true) {
  return {
    stats: { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: "" },
    recent: [],
    storageConfigured
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_PASSWORD) return json({ error: "Senha de administrador não configurada no Cloudflare." }, 500);

  const password = request.headers.get("x-admin-password") || "";
  if (password !== env.ADMIN_PASSWORD) return json({ error: "Senha incorreta." }, 401);

  // O login não deve falhar só porque o KV ainda não foi criado.
  // Assim a senha pode ser validada e o dono consegue entrar no painel.
  if (!env.PROMOTIONS) return json(emptyOrders(false));

  const statsRaw = await env.PROMOTIONS.get("order-stats");
  const recentRaw = await env.PROMOTIONS.get("recent-orders");
  let stats = { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: "" };
  let recent = [];
  try { if (statsRaw) stats = { ...stats, ...JSON.parse(statsRaw) }; } catch {}
  try { if (recentRaw) recent = JSON.parse(recentRaw); } catch {}
  return json({ stats, recent: Array.isArray(recent) ? recent : [], storageConfigured: true });
}

export async function onRequestPost({ request, env }) {
  if (!env.PROMOTIONS) return json({ ok: false, storageConfigured: false }, 202);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }

  const total = Math.max(0, Math.min(Number(body?.total) || 0, 10000));
  const itemCount = Math.max(0, Math.min(Number(body?.itemCount) || 0, 100));
  const localDate = safeDate(body?.localDate);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 30).map((item) => ({
    name: String(item?.name || "").slice(0, 80),
    qty: Math.max(1, Math.min(Number(item?.qty) || 1, 30))
  })) : [];

  const statsRaw = await env.PROMOTIONS.get("order-stats");
  let stats = { totalOrders: 0, totalValue: 0, todayOrders: 0, todayValue: 0, currentDate: localDate };
  try { if (statsRaw) stats = { ...stats, ...JSON.parse(statsRaw) }; } catch {}
  if (stats.currentDate !== localDate) {
    stats.currentDate = localDate;
    stats.todayOrders = 0;
    stats.todayValue = 0;
  }
  stats.totalOrders = (Number(stats.totalOrders) || 0) + 1;
  stats.totalValue = (Number(stats.totalValue) || 0) + total;
  stats.todayOrders = (Number(stats.todayOrders) || 0) + 1;
  stats.todayValue = (Number(stats.todayValue) || 0) + total;

  const recentRaw = await env.PROMOTIONS.get("recent-orders");
  let recent = [];
  try { if (recentRaw) recent = JSON.parse(recentRaw); } catch {}
  if (!Array.isArray(recent)) recent = [];
  recent.unshift({
    id: `P${Date.now().toString().slice(-7)}`,
    createdAt: new Date().toISOString(),
    localDate,
    total,
    itemCount,
    payment: String(body?.payment || "").slice(0, 30),
    deliveryType: String(body?.deliveryType || "").slice(0, 30),
    items
  });
  recent = recent.slice(0, 40);

  await Promise.all([
    env.PROMOTIONS.put("order-stats", JSON.stringify(stats)),
    env.PROMOTIONS.put("recent-orders", JSON.stringify(recent))
  ]);
  return json({ ok: true, storageConfigured: true });
}
