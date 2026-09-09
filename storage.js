const STORAGE_OBJECT_NAME = "lanchonete-app";

function cleanKey(key) {
  return String(key || "").trim().slice(0, 512);
}

function durableStorageStub(env) {
  if (!env.APP_STORAGE) return null;
  const id = env.APP_STORAGE.idFromName(STORAGE_OBJECT_NAME);
  return env.APP_STORAGE.get(id);
}

async function durableStorageRequest(env, method, key, body) {
  const stub = durableStorageStub(env);
  if (!stub) return null;

  const response = await stub.fetch(
    new Request(`https://app-storage.internal/value?key=${encodeURIComponent(key)}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha no armazenamento persistente (${response.status})${detail ? `: ${detail.slice(0, 180)}` : "."}`);
  }

  return response.status === 204 ? null : response.json();
}

function canMigrateLegacyValue(key) {
  return !(
    key.startsWith("admin-session:")
    || key.startsWith("robot-session:")
    || key.startsWith("order-dedupe:")
    || key === "fcm-access-token-cache"
    || key === "robot-connection-state"
    || key === "robot-connection-command"
  );
}

export function storageConfigured(env) {
  return Boolean(env.APP_STORAGE || env.PROMOTIONS);
}

export async function storageGet(env, key) {
  const storageKey = cleanKey(key);
  if (!storageKey) return null;

  if (env.APP_STORAGE) {
    const result = await durableStorageRequest(env, "GET", storageKey);
    if (result?.found) return result.deleted ? null : String(result.value ?? "");

    if (env.PROMOTIONS && canMigrateLegacyValue(storageKey)) {
      const legacy = await env.PROMOTIONS.get(storageKey);
      if (legacy !== null) {
        await storagePut(env, storageKey, legacy);
        return legacy;
      }
    }
    return null;
  }

  return env.PROMOTIONS ? env.PROMOTIONS.get(storageKey) : null;
}

export async function storagePut(env, key, value, options = {}) {
  const storageKey = cleanKey(key);
  if (!storageKey) throw new Error("Chave de armazenamento inválida.");

  if (env.APP_STORAGE) {
    const ttlSeconds = Math.max(0, Number(options?.expirationTtl || 0));
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    await durableStorageRequest(env, "PUT", storageKey, {
      value: String(value ?? ""),
      expiresAt
    });
    return;
  }

  if (!env.PROMOTIONS) throw new Error("Armazenamento não configurado.");
  await env.PROMOTIONS.put(storageKey, String(value ?? ""), options);
}

export async function storageDelete(env, key) {
  const storageKey = cleanKey(key);
  if (!storageKey) return;

  if (env.APP_STORAGE) {
    await durableStorageRequest(env, "DELETE", storageKey);
    return;
  }

  if (env.PROMOTIONS) await env.PROMOTIONS.delete(storageKey);
}
