import { storageConfigured, storageGet, storagePut } from "./storage.js";

const DEFAULT_WHATSAPP_NUMBER = "5592992973832";
const CONTACT_KEY = "business-contact";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

function normalizeWhatsAppNumber(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!/^55\d{10,11}$/.test(digits)) return "";
  return digits;
}

function formatWhatsAppNumber(value) {
  const digits = normalizeWhatsAppNumber(value);
  if (!digits) return "";
  const local = digits.slice(2);
  const ddd = local.slice(0, 2);
  const number = local.slice(2);
  if (number.length === 9) return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function adminPasswordMatches(value, env) {
  const supplied = String(value || "");
  if (!supplied) return false;
  if (env.ADMIN_PASSWORD && supplied === String(env.ADMIN_PASSWORD)) return true;
  const expectedHash = String(env.ADMIN_PASSWORD_SHA256 || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(expectedHash) && await sha256Hex(supplied) === expectedHash;
}

async function readContact(env) {
  if (!storageConfigured(env)) {
    return { whatsappNumber: DEFAULT_WHATSAPP_NUMBER, whatsappDisplay: formatWhatsAppNumber(DEFAULT_WHATSAPP_NUMBER), storageConfigured: false };
  }
  const raw = await storageGet(env, CONTACT_KEY);
  if (!raw) {
    return { whatsappNumber: DEFAULT_WHATSAPP_NUMBER, whatsappDisplay: formatWhatsAppNumber(DEFAULT_WHATSAPP_NUMBER), storageConfigured: true };
  }
  try {
    const parsed = JSON.parse(raw);
    const whatsappNumber = normalizeWhatsAppNumber(parsed?.whatsappNumber) || DEFAULT_WHATSAPP_NUMBER;
    return {
      whatsappNumber,
      whatsappDisplay: formatWhatsAppNumber(whatsappNumber),
      updatedAt: parsed?.updatedAt || null,
      storageConfigured: true
    };
  } catch {
    return { whatsappNumber: DEFAULT_WHATSAPP_NUMBER, whatsappDisplay: formatWhatsAppNumber(DEFAULT_WHATSAPP_NUMBER), storageConfigured: true };
  }
}

export async function readBusinessContact(env) {
  return readContact(env);
}

export async function handleBusinessContact(request, env) {
  if (request.method === "GET") return json(await readContact(env));
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!storageConfigured(env)) return json({ error: "Armazenamento ainda não configurado no Cloudflare." }, 500);
  const hasPasswordCredential = Boolean(env.ADMIN_PASSWORD || env.ADMIN_PASSWORD_SHA256);
  const hasAppCredential = Boolean(env.ADMIN_APP_TOKEN || env.ADMIN_APP_TOKEN_SHA256);
  if (!hasPasswordCredential && !hasAppCredential) return json({ error: "Acesso administrativo não configurado." }, 500);

  const isAdminApp = (request.headers.get("user-agent") || "").includes("LanchoneteAdminApp/");
  const appToken = request.headers.get("x-admin-app-token") || "";
  const password = request.headers.get("x-admin-password") || "";
  const allowed = (isAdminApp && await adminPasswordMatches(appToken, {
    ADMIN_PASSWORD: env.ADMIN_APP_TOKEN,
    ADMIN_PASSWORD_SHA256: env.ADMIN_APP_TOKEN_SHA256
  }))
    || await adminPasswordMatches(password, env);
  if (!allowed) return json({ error: "Senha incorreta." }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Dados inválidos." }, 400); }

  const whatsappNumber = normalizeWhatsAppNumber(body?.whatsappNumber);
  if (!whatsappNumber) {
    return json({ error: "Informe um WhatsApp válido com DDD. Ex.: (92) 99999-9999." }, 400);
  }

  const contact = {
    whatsappNumber,
    whatsappDisplay: formatWhatsAppNumber(whatsappNumber),
    updatedAt: new Date().toISOString()
  };
  await storagePut(env, CONTACT_KEY, JSON.stringify(contact));
  return json({ ok: true, ...contact, storageConfigured: true });
}

export { DEFAULT_WHATSAPP_NUMBER, normalizeWhatsAppNumber, formatWhatsAppNumber };
