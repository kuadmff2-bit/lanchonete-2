import baseWorker from "./worker.js";
import { handlePushRegistration, notifyNewOrder } from "./push.js";
import { handleBusinessContact } from "./business-contact-api.js";
import { sendNewOrderMessages, sendOrderStatusMessage } from "./whatsapp-messages.js";
import { storageConfigured, storageDelete, storageGet, storagePut } from "./storage.js";

const ROBOT_CONNECTION_STATE_KEY = "robot-connection-state";
const ROBOT_CONNECTION_COMMAND_KEY = "robot-connection-command";

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

function replaceJsonBody(response, data) {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function safeText(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function robotTokenConfigured(env) {
  return Boolean(env.ROBOT_WEBHOOK_TOKEN || env.ROBOT_WEBHOOK_TOKEN_SHA256);
}

async function robotTokenAuthorized(request, env) {
  const supplied = request.headers.get("x-robot-token") || "";
  if (!supplied) return false;
  if (env.ROBOT_WEBHOOK_TOKEN && supplied === String(env.ROBOT_WEBHOOK_TOKEN)) return true;
  const expectedHash = String(env.ROBOT_WEBHOOK_TOKEN_SHA256 || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(expectedHash) && await sha256Hex(supplied) === expectedHash;
}

async function authorizeWithBaseWorker(request, env, ctx) {
  const authUrl = new URL("/api/auth", request.url);
  return baseWorker.fetch(new Request(authUrl, { method: "GET", headers: request.headers }), env, ctx);
}

function adminAuthHeaders(authResponse) {
  const setCookie = authResponse.headers.get("set-cookie");
  return setCookie ? { "set-cookie": setCookie } : {};
}

function robotServiceConfig(env, request) {
  const rawUrl = String(env.ROBOT_SERVICE_URL || "").trim().replace(/\/$/, "");
  const token = String(
    env.ROBOT_CONTROL_TOKEN
    || env.ADMIN_PASSWORD
    || request?.headers?.get("x-admin-password")
    || request?.headers?.get("x-admin-app-token")
    || ""
  ).trim();
  if (!rawUrl || !token) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return null;
    return { url: parsed.toString().replace(/\/$/, ""), token };
  } catch {
    return null;
  }
}

async function handleRemoteRobotConnection(request, env, ctx) {
  const authResponse = await authorizeWithBaseWorker(request, env, ctx);
  if (!authResponse.ok) return authResponse;
  const responseHeaders = adminAuthHeaders(authResponse);
  const service = robotServiceConfig(env, request);
  if (!service) {
    return json({
      configured: false,
      connected: false,
      qrReady: false,
      authState: "not_configured",
      message: "O serviço 24 horas do WhatsApp ainda não foi vinculado a este sistema."
    }, 200, responseHeaders);
  }

  let remotePath = "/control/status";
  let remoteMethod = "GET";
  let action = "status";
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Dados inválidos." }, 400, responseHeaders); }
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
      headers: { authorization: `Bearer ${service.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(12000)
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
          : "Reconexão do WhatsApp iniciada."
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

function cleanConnectionState(data) {
  const qrImage = typeof data?.qrImage === "string"
    && data.qrImage.startsWith("data:image/")
    && data.qrImage.length <= 600000
    ? data.qrImage
    : "";
  return {
    configured: true,
    connected: Boolean(data?.connected),
    qrReady: Boolean(qrImage),
    qrImage,
    authState: safeText(data?.authState, 80) || "starting",
    connectedAt: safeText(data?.connectedAt, 80) || null,
    lastError: safeText(data?.lastError, 400) || null,
    updatedAt: safeText(data?.updatedAt, 80) || new Date().toISOString()
  };
}

async function handleRobotConnection(request, env, ctx) {
  if (String(env.ROBOT_SERVICE_URL || "").trim() || !robotTokenConfigured(env)) {
    return handleRemoteRobotConnection(request, env, ctx);
  }

  const authResponse = await authorizeWithBaseWorker(request, env, ctx);
  if (!authResponse.ok) return authResponse;
  const responseHeaders = adminAuthHeaders(authResponse);
  if (!storageConfigured(env)) return json({ error: "Armazenamento ainda não configurado." }, 500, responseHeaders);

  if (request.method === "GET") {
    const raw = await storageGet(env, ROBOT_CONNECTION_STATE_KEY);
    if (!raw) {
      return json({ configured: true, connected: false, qrReady: false, authState: "starting" }, 200, responseHeaders);
    }
    try {
      const state = cleanConnectionState(JSON.parse(raw));
      const age = Date.now() - Date.parse(state.updatedAt || "");
      if (Number.isFinite(age) && age > 60000) {
        state.connected = false;
        state.qrReady = false;
        state.qrImage = "";
        state.authState = "unreachable";
        state.lastError = "O serviço do WhatsApp parou de atualizar o estado.";
      }
      return json(state, 200, responseHeaders);
    } catch {
      return json({ configured: true, connected: false, qrReady: false, authState: "starting" }, 200, responseHeaders);
    }
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, responseHeaders);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Dados inválidos." }, 400, responseHeaders); }
  const action = body?.action === "reset" ? "reset" : body?.action === "restart" ? "restart" : "";
  if (!action) return json({ error: "Ação inválida." }, 400, responseHeaders);

  const command = { id: crypto.randomUUID(), action, createdAt: new Date().toISOString() };
  await storagePut(env, ROBOT_CONNECTION_COMMAND_KEY, JSON.stringify(command), { expirationTtl: 600 });
  return json({ configured: true, ok: true, accepted: true, action }, 202, responseHeaders);
}

async function handleRobotConnectionSync(request, env) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!robotTokenConfigured(env) || !await robotTokenAuthorized(request, env)) return json({ error: "Token do robô inválido." }, 401);
  if (!storageConfigured(env)) return json({ error: "Armazenamento não configurado." }, 503);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Dados inválidos." }, 400); }
  const state = cleanConnectionState({ ...body, updatedAt: new Date().toISOString() });
  await storagePut(env, ROBOT_CONNECTION_STATE_KEY, JSON.stringify(state), { expirationTtl: 300 });
  return json({ ok: true });
}

async function handleRobotConnectionCommand(request, env) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  if (!robotTokenConfigured(env) || !await robotTokenAuthorized(request, env)) return json({ error: "Token do robô inválido." }, 401);
  if (!storageConfigured(env)) return json({ error: "Armazenamento não configurado." }, 503);

  const raw = await storageGet(env, ROBOT_CONNECTION_COMMAND_KEY);
  if (!raw) return json({ command: null });
  try {
    const command = JSON.parse(raw);
    const after = safeText(new URL(request.url).searchParams.get("after"), 80);
    await storageDelete(env, ROBOT_CONNECTION_COMMAND_KEY);
    return json({ command: command?.id && command.id !== after ? command : null });
  } catch {
    return json({ command: null });
  }
}

async function handleTransactionalSettings(request, env, ctx) {
  if (request.method === "GET") {
    return json({ enabled: true, transactionalOnly: true, repliesToIncomingMessages: false });
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const authResponse = await authorizeWithBaseWorker(request, env, ctx);
  if (!authResponse.ok) return authResponse;
  return json({
    ok: true,
    settings: { enabled: true, transactionalOnly: true, repliesToIncomingMessages: false }
  }, 200, adminAuthHeaders(authResponse));
}

function publicFirebaseConfig(env) {
  const config = {
    apiKey: String(env.FCM_ANDROID_API_KEY || ""),
    appId: String(env.FCM_ANDROID_APP_ID || ""),
    projectId: String(env.FCM_PROJECT_ID || ""),
    senderId: String(env.FCM_SENDER_ID || "")
  };
  return json({ ...config, configured: Boolean(config.apiKey && config.appId && config.projectId && config.senderId) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/business-contact") return handleBusinessContact(request, env);
    if (url.pathname === "/api/robot") return handleTransactionalSettings(request, env, ctx);
    if (url.pathname === "/api/robot/chat") {
      if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
      return json({ reply: "", disabled: true, transactionalOnly: true });
    }
    if (url.pathname === "/api/robot/connection/sync") return handleRobotConnectionSync(request, env);
    if (url.pathname === "/api/robot/connection/command") return handleRobotConnectionCommand(request, env);
    if (url.pathname === "/api/robot/connection") return handleRobotConnection(request, env, ctx);
    if (url.pathname === "/api/push/config" && request.method === "GET") return publicFirebaseConfig(env);
    if (url.pathname === "/api/push/register") {
      const authResponse = await authorizeWithBaseWorker(request, env, ctx);
      if (!authResponse.ok) return authResponse;
      return handlePushRegistration(request, env);
    }

    if (url.pathname === "/api/orders" && request.method === "POST") {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.clone().json().catch(() => ({}));
      if (!data?.order) return response;
      if (data.duplicate) {
        return replaceJsonBody(response, { ...data, messaging: { sent: true, duplicate: true } });
      }

      const pushTask = notifyNewOrder(env, data.order).catch(() => null);
      if (ctx?.waitUntil) ctx.waitUntil(pushTask);
      else await pushTask;
      const messaging = await sendNewOrderMessages(env, data.order);
      return replaceJsonBody(response, { ...data, messaging });
    }

    if (/^\/api\/orders\/[^/]+$/.test(url.pathname) && request.method === "PATCH") {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.clone().json().catch(() => ({}));
      if (!data?.order || data.statusChanged === false) {
        return replaceJsonBody(response, { ...data, messaging: { sent: true, duplicate: true } });
      }
      const messaging = await sendOrderStatusMessage(env, data.order);
      return replaceJsonBody(response, { ...data, messaging });
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
