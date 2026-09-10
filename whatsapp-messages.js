import { readBusinessContact } from "./business-contact-api.js";

const AUTOMATIC_STATUSES = new Set(["confirmado", "saiu_entrega", "cancelado"]);

function serviceConfig(env) {
  const url = String(env.ROBOT_SERVICE_URL || "").trim().replace(/\/$/, "");
  const token = String(env.ROBOT_CONTROL_TOKEN || env.ADMIN_PASSWORD || env.ADMIN_APP_TOKEN || "").trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return { url: parsed.toString().replace(/\/$/, ""), token };
  } catch {
    return null;
  }
}

async function postToRobot(env, path, payload) {
  const service = serviceConfig(env);
  if (!service) {
    return { sent: false, configured: false, reason: "Serviço do WhatsApp não configurado." };
  }

  try {
    const response = await fetch(`${service.url}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${service.token}`,
        "content-type": "application/json; charset=utf-8",
        accept: "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        sent: false,
        configured: true,
        reason: String(data?.error || `WhatsApp indisponível (${response.status}).`).slice(0, 240)
      };
    }
    return {
      sent: Boolean(data?.sent),
      configured: true,
      businessSent: Boolean(data?.businessSent),
      customerSent: Boolean(data?.customerSent),
      reason: data?.sent ? "" : String(data?.error || "Mensagem não confirmada pelo WhatsApp.").slice(0, 240)
    };
  } catch {
    return { sent: false, configured: true, reason: "O serviço do WhatsApp não respondeu a tempo." };
  }
}

export async function sendNewOrderMessages(env, order) {
  if (!order?.id) return { sent: false, reason: "Pedido inválido." };
  const contact = await readBusinessContact(env);
  return postToRobot(env, "/control/send-order", {
    businessPhone: contact.whatsappNumber,
    order
  });
}

export async function sendOrderStatusMessage(env, order) {
  const status = String(order?.status || "");
  if (!order?.id || !AUTOMATIC_STATUSES.has(status)) {
    return { sent: false, skipped: true, reason: "Este status não envia mensagem automática." };
  }
  return postToRobot(env, "/control/send-status", { order, status });
}
