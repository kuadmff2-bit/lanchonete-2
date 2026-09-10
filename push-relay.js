import { storageConfigured, storageGet } from "./storage.js";

const PUSH_TOKENS_KEY = "admin-push-tokens";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function safeText(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function safePushToken(value) {
  const token = String(value || "").trim();
  if (token.length < 20 || token.length > 4096) return "";
  return /^[A-Za-z0-9_:.-]+$/.test(token) ? token : "";
}

function directFirebaseConfigured(env) {
  return Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);
}

function relayClientConfigured(env) {
  return Boolean(String(env.PUSH_RELAY_URL || "").trim() && String(env.PUSH_RELAY_TOKEN || "").trim());
}

function cleanOrder(order) {
  const id = safeText(order?.id, 120);
  if (!id) return null;
  return {
    id,
    customerName: safeText(order?.customerName || "Cliente", 120) || "Cliente",
    total: Number(order?.total || 0)
  };
}

async function readLocalTokens(env) {
  if (!storageConfigured(env)) return [];
  const raw = await storageGet(env, PUSH_TOKENS_KEY);
  try {
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const unique = [];
    const seen = new Set();
    for (const entry of list) {
      const token = safePushToken(typeof entry === "string" ? entry : entry?.token);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      unique.push(token);
      if (unique.length >= 8) break;
    }
    return unique;
  } catch {
    return [];
  }
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
  const assertion = await createSignedJwt(env);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth2:grant-type:jwt-bearer",
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
  return String(data.access_token);
}

function notificationBody(order) {
  const total = Number(order?.total || 0).toFixed(2).replace(".", ",");
  return `Confirme o novo pedido de ${order?.customerName || "Cliente"} · R$ ${total}`;
}

async function sendFirebaseMessage(env, accessToken, token, order) {
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
          orderId: String(order.id),
          customerName: String(order.customerName || ""),
          total: String(order.total || 0)
        },
        android: {
          priority: "high",
          notification: {
            channel_id: "new_orders",
            sound: "default",
            tag: `order-${String(order.id)}`
          }
        }
      }
    })
  });

  if (response.ok) return { ok: true, stale: false };
  const detail = await response.text().catch(() => "");
  const stale = response.status === 404
    || /UNREGISTERED|registration-token-not-registered|Requested entity was not found/i.test(detail);
  return { ok: false, stale, status: response.status, detail: detail.slice(0, 400) };
}

export async function handlePushRelay(request, env) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const expected = String(env.PUSH_RELAY_TOKEN || "").trim();
  const supplied = String(request.headers.get("x-push-relay-token") || "").trim();
  if (expected.length < 32 || !supplied || supplied !== expected) {
    return json({ error: "Relay não autorizado." }, 401);
  }
  if (!directFirebaseConfigured(env)) {
    return json({ error: "Firebase do relay não configurado." }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Dados inválidos." }, 400); }

  const token = safePushToken(body?.token);
  const order = cleanOrder(body?.order);
  if (!token || !order) return json({ error: "Payload de push inválido." }, 400);

  try {
    const accessToken = await getAccessToken(env);
    const result = await sendFirebaseMessage(env, accessToken, token, order);
    if (result.ok) return json({ ok: true, stale: false });
    return json({ ok: false, stale: result.stale, status: result.status || null }, result.stale ? 410 : 502);
  } catch (error) {
    return json({ error: safeText(error?.message, 400) || "Falha ao enviar push." }, 502);
  }
}

async function sendToRelay(env, token, order) {
  try {
    const response = await fetch(String(env.PUSH_RELAY_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-push-relay-token": String(env.PUSH_RELAY_TOKEN)
      },
      body: JSON.stringify({ token, order }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && Boolean(data.ok), stale: Boolean(data.stale) };
  } catch {
    return { ok: false, stale: false };
  }
}

export async function notifyNewOrderViaRelay(env, order) {
  if (directFirebaseConfigured(env)) return { sent: 0, skipped: true, reason: "direct-firebase-present" };
  if (!relayClientConfigured(env) || !storageConfigured(env)) return { sent: 0, skipped: true, reason: "relay-not-configured" };

  const clean = cleanOrder(order);
  if (!clean) return { sent: 0, skipped: true, reason: "invalid-order" };

  const tokens = await readLocalTokens(env);
  if (!tokens.length) return { sent: 0, skipped: true, reason: "no-devices" };

  const results = await Promise.all(tokens.map((token) => sendToRelay(env, token, clean)));
  return {
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    stale: results.filter((result) => result.stale).length,
    via: "relay"
  };
}
