const PUSH_TOKENS_KEY = "admin-push-tokens";
const FCM_TOKEN_CACHE_KEY = "fcm-access-token-cache";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function pushConfigured(env) {
  return Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);
}

function safePushToken(value) {
  const token = String(value || "").trim();
  if (token.length < 20 || token.length > 4096) return "";
  return /^[A-Za-z0-9_:.-]+$/.test(token) ? token : "";
}

async function readPushTokens(env) {
  if (!env.PROMOTIONS) return [];
  const raw = await env.PROMOTIONS.get(PUSH_TOKENS_KEY);
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => typeof entry === "string" ? { token: entry, updatedAt: "" } : entry)
      .filter((entry) => safePushToken(entry?.token));
  } catch {
    return [];
  }
}

async function writePushTokens(env, entries) {
  if (!env.PROMOTIONS) return;
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const token = safePushToken(entry?.token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    unique.push({ token, updatedAt: String(entry?.updatedAt || new Date().toISOString()) });
    if (unique.length >= 8) break;
  }
  await env.PROMOTIONS.put(PUSH_TOKENS_KEY, JSON.stringify(unique));
}

export async function handlePushRegistration(request, env) {
  if (!env.PROMOTIONS) {
    return new Response(JSON.stringify({ error: "Armazenamento não configurado." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  if (request.method === "GET") {
    const entries = await readPushTokens(env);
    return new Response(JSON.stringify({ ok: true, configured: pushConfigured(env), devices: entries.length }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  if (request.method !== "POST" && request.method !== "DELETE") {
    return new Response(JSON.stringify({ error: "Método não permitido." }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  let body;
  try { body = await request.json(); }
  catch {
    return new Response(JSON.stringify({ error: "Dados inválidos." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const token = safePushToken(body?.token);
  if (!token) {
    return new Response(JSON.stringify({ error: "Token de notificação inválido." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  let entries = await readPushTokens(env);
  if (request.method === "DELETE") {
    entries = entries.filter((entry) => entry.token !== token);
    await writePushTokens(env, entries);
    return new Response(JSON.stringify({ ok: true, registered: false, configured: pushConfigured(env) }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  entries = entries.filter((entry) => entry.token !== token);
  entries.unshift({ token, updatedAt: new Date().toISOString() });
  await writePushTokens(env, entries);

  return new Response(JSON.stringify({ ok: true, registered: true, configured: pushConfigured(env) }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function base64UrlBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlText(text) {
  return base64UrlBytes(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem) {
  const clean = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createSignedJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlText(JSON.stringify({
    iss: String(env.FCM_CLIENT_EMAIL),
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.FCM_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;
}

async function getAccessToken(env) {
  if (!pushConfigured(env)) return "";

  if (env.PROMOTIONS) {
    const cachedRaw = await env.PROMOTIONS.get(FCM_TOKEN_CACHE_KEY);
    try {
      const cached = cachedRaw ? JSON.parse(cachedRaw) : null;
      if (cached?.token && Number(cached.expiresAt || 0) > Date.now() + 60000) return cached.token;
    } catch {}
  }

  const assertion = await createSignedJwt(env);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Falha ao autenticar no Firebase (${response.status}).`);
  }

  const expiresIn = Math.max(300, Number(data.expires_in || 3600));
  const cached = { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  if (env.PROMOTIONS) {
    await env.PROMOTIONS.put(FCM_TOKEN_CACHE_KEY, JSON.stringify(cached), {
      expirationTtl: Math.max(300, Math.min(3500, expiresIn - 60))
    });
  }
  return data.access_token;
}

function notificationBody(order) {
  const customer = String(order?.customerName || "Cliente").trim() || "Cliente";
  const total = Number(order?.total || 0).toFixed(2).replace(".", ",");
  return `Confirme o novo pedido de ${customer} · R$ ${total}`;
}

async function sendToDevice(env, accessToken, token, order) {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID)}/messages:send`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: "Novo pedido!",
          body: notificationBody(order)
        },
        data: {
          type: "new_order",
          orderId: String(order?.id || ""),
          customerName: String(order?.customerName || ""),
          total: String(order?.total || 0)
        },
        android: {
          priority: "high",
          notification: {
            channel_id: "new_orders",
            sound: "default",
            tag: `order-${String(order?.id || Date.now())}`
          }
        }
      }
    })
  });

  if (response.ok) return { ok: true, stale: false };
  const text = await response.text().catch(() => "");
  const stale = response.status === 404 || /UNREGISTERED|registration-token-not-registered|Requested entity was not found/i.test(text);
  return { ok: false, stale, status: response.status, detail: text.slice(0, 500) };
}

export async function notifyNewOrder(env, order) {
  if (!pushConfigured(env) || !env.PROMOTIONS || !order?.id) return { sent: 0, skipped: true };

  const entries = await readPushTokens(env);
  if (!entries.length) return { sent: 0, skipped: true };

  const accessToken = await getAccessToken(env);
  if (!accessToken) return { sent: 0, skipped: true };

  const results = await Promise.all(entries.map(async (entry) => ({
    entry,
    result: await sendToDevice(env, accessToken, entry.token, order)
  })));

  const staleTokens = new Set(results.filter(({ result }) => result.stale).map(({ entry }) => entry.token));
  if (staleTokens.size) {
    await writePushTokens(env, entries.filter((entry) => !staleTokens.has(entry.token)));
  }

  return {
    sent: results.filter(({ result }) => result.ok).length,
    failed: results.filter(({ result }) => !result.ok).length,
    staleRemoved: staleTokens.size
  };
}
