const TOMBSTONE_TTL_MS = 31 * 24 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function cleanKey(value) {
  return String(value || "").trim().slice(0, 512);
}

export class AppStorage {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/value") return json({ error: "Rota inválida." }, 404);

    const key = cleanKey(url.searchParams.get("key"));
    if (!key) return json({ error: "Chave inválida." }, 400);

    if (request.method === "GET") {
      const record = await this.storage.get(key);
      if (!record || typeof record !== "object") return json({ found: false });

      const now = Date.now();
      const purgeAt = Number(record.purgeAt || 0);
      if (record.deleted && purgeAt > 0 && purgeAt <= now) {
        await this.storage.delete(key);
        return json({ found: false });
      }

      const expiresAt = Number(record.expiresAt || 0);
      if (!record.deleted && expiresAt > 0 && expiresAt <= now) {
        await this.storage.put(key, {
          deleted: true,
          updatedAt: now,
          purgeAt: now + TOMBSTONE_TTL_MS
        });
        return json({ found: true, deleted: true });
      }

      return json({
        found: true,
        deleted: Boolean(record.deleted),
        value: record.deleted ? undefined : String(record.value ?? "")
      });
    }

    if (request.method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Valor inválido." }, 400);
      }

      const expiresAt = Math.max(0, Number(body?.expiresAt || 0));
      await this.storage.put(key, {
        value: String(body?.value ?? ""),
        expiresAt,
        deleted: false,
        updatedAt: Date.now()
      });
      return json({ ok: true });
    }

    if (request.method === "DELETE") {
      const now = Date.now();
      await this.storage.put(key, {
        deleted: true,
        updatedAt: now,
        purgeAt: now + TOMBSTONE_TTL_MS
      });
      return json({ ok: true });
    }

    return json({ error: "Método não permitido." }, 405);
  }
}
