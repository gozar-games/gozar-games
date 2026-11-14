const LINK_CODE_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function ensureNativeAuthTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS native_link_codes (
      code_hash TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_native_link_codes_user
      ON native_link_codes(telegram_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS native_sessions (
      token_hash TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_native_sessions_user
      ON native_sessions(telegram_id, expires_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS native_link_attempts (
      ip_hash TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    )`)
  ]);
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  ));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(message)
  ));
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyTelegram(initData, botToken, maxAgeSeconds = 300) {
  if (typeof initData !== "string" || !initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const keys = Array.from(params.keys());
  if (new Set(keys).size !== keys.length) return null;

  const hash = params.get("hash");
  const authDateText = params.get("auth_date");
  const userText = params.get("user");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || !authDateText || !userText) return null;

  const authDate = Number(authDateText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 ||
      authDate > now + 30 || now - authDate > maxAgeSeconds) return null;

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calculatedHash = toHex(await hmac(secretKey, dataCheckString));
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= calculatedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  if (difference !== 0) return null;

  try {
    const user = JSON.parse(userText);
    return user && Number.isSafeInteger(user.id) && user.id > 0 ? user : null;
  } catch {
    return null;
  }
}

export async function authenticate(request, env, options = {}) {
  if (!env.DB) throw new Error("Database is not configured");
  await ensureNativeAuthTables(env.DB);

  const nativeToken = request.headers.get("X-Gozar-Native-Session") || "";
  if (nativeToken) {
    if (nativeToken.length < 32 || nativeToken.length > 256) return null;
    const tokenHash = await sha256Hex(nativeToken);
    const now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare(`
      SELECT telegram_id FROM native_sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).bind(tokenHash, now).first();

    if (session?.telegram_id) {
      const player = await env.DB.prepare(
        "SELECT username FROM players WHERE telegram_id = ?"
      ).bind(session.telegram_id).first();
      const id = Number(session.telegram_id);
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      return { id, username: player?.username || null, auth_type: "native" };
    }
  }

  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token is not configured");
  const initData = request.headers.get("X-Telegram-Init-Data");
  if (!initData) return null;
  const user = await verifyTelegram(
    initData,
    env.TELEGRAM_BOT_TOKEN,
    options.telegramMaxAgeSeconds ?? 300
  );
  return user ? { ...user, auth_type: "telegram" } : null;
}

export async function createNativeLinkCode(db, telegramId) {
  await ensureNativeAuthTables(db);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, byte => alphabet[byte & 31]).join("");
  const now = Math.floor(Date.now() / 1000);
  const codeHash = await sha256Hex(code);

  await db.batch([
    db.prepare(`
      UPDATE native_link_codes SET used_at = ?
      WHERE telegram_id = ? AND used_at IS NULL
    `).bind(now, String(telegramId)),
    db.prepare(`
      INSERT INTO native_link_codes (code_hash, telegram_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(codeHash, String(telegramId), now + LINK_CODE_TTL_SECONDS, now)
  ]);

  return { code, expiresAt: now + LINK_CODE_TTL_SECONDS };
}

export async function createNativeSession(db, telegramId) {
  await ensureNativeAuthTables(db);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(bytes);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  const tokenHash = await sha256Hex(token);
  await db.prepare(`
    INSERT INTO native_sessions (token_hash, telegram_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(tokenHash, String(telegramId), now, expiresAt).run();
  return { token, expiresAt };
}

export async function revokeNativeSession(request, db) {
  const token = request.headers.get("X-Gozar-Native-Session") || "";
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    UPDATE native_sessions SET revoked_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `).bind(now, tokenHash).run();
  return !!result.meta?.changes;
}
