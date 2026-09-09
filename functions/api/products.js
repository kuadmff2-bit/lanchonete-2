const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

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

function normalizeProduct(item, index) {
  const category = item?.category === "bebida" ? "bebida" : "lanche";
  const price = Number(item?.price);
  const image = String(item?.image || "");
  return {
    id: String(item?.id || `p-${Date.now()}-${index}`).slice(0, 80),
    name: String(item?.name || "").trim().slice(0, 80),
    price: Number.isFinite(price) ? Math.max(0, Math.min(price, 10000)) : 0,
    description: String(item?.description || "").trim().slice(0, 220),
    category,
    available: item?.available !== false,
    image: image.startsWith("data:image/") && image.length <= 700000 ? image : ""
  };
}

export async function onRequestGet({ env }) {
  if (!env.PROMOTIONS) return json({ products: DEFAULT_PRODUCTS });
  const raw = await env.PROMOTIONS.get("products");
  if (!raw) return json({ products: DEFAULT_PRODUCTS });
  try {
    const parsed = JSON.parse(raw);
    return json({ products: Array.isArray(parsed) ? parsed : DEFAULT_PRODUCTS });
  } catch {
    return json({ products: DEFAULT_PRODUCTS });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.PROMOTIONS) return json({ error: "KV PROMOTIONS não configurado." }, 500);
  if (!env.ADMIN_PASSWORD) return json({ error: "Senha de administrador não configurada." }, 500);
  const password = request.headers.get("x-admin-password") || "";
  if (password !== env.ADMIN_PASSWORD) return json({ error: "Senha incorreta." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  if (!Array.isArray(body?.products)) return json({ error: "Lista de produtos inválida." }, 400);
  if (body.products.length > 60) return json({ error: "Limite de 60 produtos." }, 400);

  const products = body.products.map(normalizeProduct).filter((p) => p.name && p.price >= 0);
  await env.PROMOTIONS.put("products", JSON.stringify(products));
  return json({ ok: true, products });
}
