import appWorker from "./worker-admin-app.js";
import { handlePushRelay, notifyNewOrderViaRelay } from "./push-relay.js";
import { notifyNewOrder } from "./push.js";
import { sendNewOrderMessages } from "./whatsapp-messages.js";
import { createOrderWithPromotion, handlePromotionsApi } from "./multi-promos-worker.js";
export { AppStorage } from "./durable-storage.js";

function withRobotControlToken(env) {
  if (!env?.ADMIN_PASSWORD) return env;
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "ROBOT_CONTROL_TOKEN") return target.ADMIN_PASSWORD;
      return Reflect.get(target, property, receiver);
    }
  });
}
function json(data, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders } }); }
function replaceJsonBody(response, data) { const headers = new Headers(response.headers); headers.set("content-type", "application/json; charset=utf-8"); headers.set("cache-control", "no-store"); return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers }); }
function directPushConfigured(env) { return Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY); }
async function notifyCustomOrder(env, order) { return directPushConfigured(env) ? notifyNewOrder(env, order) : notifyNewOrderViaRelay(env, order); }
async function authorizeAdmin(request, env, ctx) { const authUrl = new URL("/api/auth", request.url); return appWorker.fetch(new Request(authUrl, { method: "GET", headers: request.headers }), env, ctx); }
function authHeaders(authResponse) { const cookie = authResponse.headers.get("set-cookie"); return cookie ? { "set-cookie": cookie } : {}; }
function robotServiceConfig(env) {
  const rawUrl = String(env.ROBOT_SERVICE_URL || "").trim().replace(/\/$/, "");
  const token = String(env.ROBOT_CONTROL_TOKEN || env.ADMIN_PASSWORD || "").trim();
  if (!rawUrl || !token) return null;
  try { const parsed = new URL(rawUrl); return parsed.protocol === "https:" ? { url: parsed.toString().replace(/\/$/, ""), token } : null; } catch { return null; }
}
async function handleRobotConnectionV2(request, env, ctx) {
  const auth = await authorizeAdmin(request, env, ctx);
  if (!auth.ok) return auth;
  const responseHeaders = authHeaders(auth);
  const service = robotServiceConfig(env);
  if (!service) return json({ configured: false, connected: false, qrReady: false, pairingCode: null, authState: "not_configured", message: "O serviço 24 horas do WhatsApp ainda não foi vinculado a este sistema." }, 200, responseHeaders);
  let path = "/control/status"; let method = "GET"; let body = null;
  if (request.method === "POST") {
    let payload; try { payload = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400, responseHeaders); }
    if (payload?.action === "pair-code") { path = "/control/pair-code"; method = "POST"; body = JSON.stringify({ phoneNumber: String(payload?.phoneNumber || "") }); }
    else if (payload?.action === "reset") { path = "/control/reset"; method = "POST"; }
    else if (payload?.action === "restart") { path = "/control/restart"; method = "POST"; }
    else return json({ error: "Ação inválida." }, 400, responseHeaders);
  } else if (request.method !== "GET") return json({ error: "Método não permitido." }, 405, responseHeaders);
  try {
    const remote = await fetch(`${service.url}${path}`, { method, headers: { authorization: `Bearer ${service.token}`, accept: "application/json", ...(body ? { "content-type": "application/json; charset=utf-8" } : {}) }, body, signal: AbortSignal.timeout(15000) });
    const data = await remote.json().catch(() => ({}));
    if (!remote.ok) return json({ configured: true, connected: false, qrReady: false, pairingCode: null, authState: "unreachable", error: String(data?.error || `WhatsApp indisponível (${remote.status}).`).slice(0, 300) }, 502, responseHeaders);
    if (request.method === "POST") return json({ configured: true, ok: true, accepted: true, action: data?.action || null, message: data?.message || "Solicitação enviada ao WhatsApp." }, 202, responseHeaders);
    const qrImage = typeof data?.qrImage === "string" && data.qrImage.startsWith("data:image/") && data.qrImage.length <= 600000 ? data.qrImage : "";
    const pairingCode = typeof data?.pairingCode === "string" ? data.pairingCode.replace(/\s+/g, "").slice(0, 32) : "";
    return json({ configured: true, connected: Boolean(data?.connected), qrReady: Boolean(qrImage), qrImage, pairingCode: pairingCode || null, authState: String(data?.authState || "unknown").slice(0, 80), connectedAt: data?.connectedAt || null, lastError: data?.lastError || null }, 200, responseHeaders);
  } catch { return json({ configured: true, connected: false, qrReady: false, pairingCode: null, authState: "unreachable", error: "Não foi possível falar com o serviço 24 horas do WhatsApp." }, 502, responseHeaders); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const runtimeEnv = withRobotControlToken(env);
    if (url.pathname === "/api/push/relay") return handlePushRelay(request, runtimeEnv);
    if (url.pathname === "/api/promos") return handlePromotionsApi(request, runtimeEnv, ctx, appWorker);
    if (url.pathname === "/api/robot/connection") return handleRobotConnectionV2(request, runtimeEnv, ctx);
    if (url.pathname === "/api/orders" && request.method === "POST") {
      const body = await request.clone().json().catch(() => null);
      if (body?.promoId) {
        const response = await createOrderWithPromotion(request, runtimeEnv, ctx, appWorker, body);
        if (!response.ok) return response;
        const data = await response.clone().json().catch(() => ({}));
        if (!data?.order || data?.duplicate) return response;
        const pushTask = notifyCustomOrder(runtimeEnv, data.order).catch(() => null);
        if (ctx?.waitUntil) ctx.waitUntil(pushTask); else await pushTask;
        const messaging = await sendNewOrderMessages(runtimeEnv, data.order);
        return replaceJsonBody(response, { ...data, messaging });
      }
    }
    const response = await appWorker.fetch(request, runtimeEnv, ctx);
    if (url.pathname === "/api/orders" && request.method === "POST" && response.ok) {
      const data = await response.clone().json().catch(() => ({}));
      if (data?.order && !data?.duplicate) {
        const task = notifyNewOrderViaRelay(runtimeEnv, data.order).catch(() => null);
        if (ctx?.waitUntil) ctx.waitUntil(task); else await task;
      }
    }
    return response;
  }
};
