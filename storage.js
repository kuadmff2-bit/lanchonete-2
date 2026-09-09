let readyBinding = null;
let readyPromise = null;

const CREATE_STORAGE_TABLE = `
  CREATE TABLE IF NOT EXISTS app_storage (
    storage_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )
`;

function cleanKey(key) {
  return String(key || "").trim().slice(0, 512);
}

async function ensureD1(env) {
  if (!env.APP_DB) return false;
  if (readyBinding !== env.APP_DB || !readyPromise) {
    readyBinding = env.APP_DB;
    readyPromise = env.APP_DB.prepare(CREATE_STORAGE_TABLE).run().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  await readyPromise;
  return true;
}

export function storageConfigured(env) {
  return Boolean(env.APP_DB || env.PROMOTIONS);
}

export async function storageGet(env, key) {
  const storageKey = cleanKey(key);
  if (!storageKey) return null;

  if (env.APP_DB) {
    await ensureD1(env);
    const row = await env.APP_DB
      .prepare("SELECT value, expires_at, deleted FROM app_storage WHERE storage_key = ?1")
      .bind(storageKey)
      .first();

    if (row) {
      if (Number(row.deleted || 0) === 1) return null;
      const expiresAt = Number(row.expires_at || 0);
      if (expiresAt > 0 && expiresAt <= Date.now()) return null;
      return String(row.value ?? "");
    }

    if (env.PROMOTIONS) {
      const legacy = await env.PROMOTIONS.get(storageKey);
      if (legacy !== null) {
        try { await storagePut(env, storageKey, legacy); } catch (_) {}
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

  if (env.APP_DB) {
    await ensureD1(env);
    const ttlSeconds = Number(options?.expirationTtl || 0);
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    await env.APP_DB
      .prepare(`
        INSERT INTO app_storage (storage_key, value, expires_at, updated_at, deleted)
        VALUES (?1, ?2, ?3, ?4, 0)
        ON CONFLICT(storage_key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at,
          deleted = 0
      `)
      .bind(storageKey, String(value ?? ""), expiresAt, Date.now())
      .run();
    return;
  }

  if (!env.PROMOTIONS) throw new Error("Armazenamento não configurado.");
  await env.PROMOTIONS.put(storageKey, String(value ?? ""), options);
}

export async function storageDelete(env, key) {
  const storageKey = cleanKey(key);
  if (!storageKey) return;

  if (env.APP_DB) {
    await ensureD1(env);
    await env.APP_DB
      .prepare(`
        INSERT INTO app_storage (storage_key, value, expires_at, updated_at, deleted)
        VALUES (?1, '', NULL, ?2, 1)
        ON CONFLICT(storage_key) DO UPDATE SET
          value = '',
          expires_at = NULL,
          updated_at = excluded.updated_at,
          deleted = 1
      `)
      .bind(storageKey, Date.now())
      .run();
    return;
  }

  if (env.PROMOTIONS) await env.PROMOTIONS.delete(storageKey);
}

