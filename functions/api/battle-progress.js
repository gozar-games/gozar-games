async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(message)
  ));
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTelegram(initData, botToken) {
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
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 30 || now - authDate > 300) return null;

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

async function authenticate(request, env) {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) throw new Error("Server configuration missing");
  const initData = request.headers.get("X-Telegram-Init-Data");
  if (!initData) return null;
  return verifyTelegram(initData, env.TELEGRAM_BOT_TOKEN);
}

async function ensureTables(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS battle_progress (
        telegram_id TEXT PRIMARY KEY,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        best_wave INTEGER NOT NULL DEFAULT 0,
        total_kills INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS battle_match_rewards (
        telegram_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        xp_awarded INTEGER NOT NULL DEFAULT 0,
        kills INTEGER NOT NULL DEFAULT 0,
        wave INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (telegram_id, match_id)
      )
    `)
  ]);
}

function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export async function onRequestGet({ request, env }) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const user = await authenticate(request, env);
    if (!user) return Response.json({ success: false, error: "Telegram authentication required" }, { status: 401, headers });

    await ensureTables(env.DB);
    const telegramId = String(user.id);
    const [progress, wallet] = await Promise.all([
      env.DB.prepare("SELECT xp, level, best_wave, total_kills FROM battle_progress WHERE telegram_id = ?")
        .bind(telegramId).first(),
      env.DB.prepare("SELECT coins FROM players WHERE telegram_id = ?").bind(telegramId).first()
    ]);

    const xp = progress?.xp || 0;
    return Response.json({
      success: true,
      progress: {
        xp,
        level: levelForXp(xp),
        next_level_xp: levelForXp(xp) * levelForXp(xp) * 100,
        best_wave: progress?.best_wave || 0,
        total_kills: progress?.total_kills || 0,
        coins: wallet?.coins || 0
      }
    }, { headers });
  } catch (error) {
    console.error("Battle progress GET error:", error);
    return Response.json({ success: false, error: "Battle progress service unavailable" }, { status: 500, headers });
  }
}

export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const user = await authenticate(request, env);
    if (!user) return Response.json({ success: false, error: "Telegram authentication required" }, { status: 401, headers });

    const body = await request.json();
    const matchId = typeof body.match_id === "string" ? body.match_id : "";
    const kills = Number(body.kills);
    const wave = Number(body.wave);
    if (!/^[a-zA-Z0-9-]{12,64}$/.test(matchId) ||
        !Number.isSafeInteger(kills) || kills < 0 || kills > 500 ||
        !Number.isSafeInteger(wave) || wave < 1 || wave > 100) {
      return Response.json({ success: false, error: "Invalid match result" }, { status: 400, headers });
    }

    await ensureTables(env.DB);
    const telegramId = String(user.id);
    // XP is calculated on the server and capped per match and per UTC day.
    const requestedXp = Math.min(500, kills * 5 + wave * 20);
    const daily = await env.DB.prepare(`
      SELECT COALESCE(SUM(xp_awarded), 0) AS xp
      FROM battle_match_rewards
      WHERE telegram_id = ? AND date(created_at) = date('now')
    `).bind(telegramId).first();
    const xpAwarded = Math.max(0, Math.min(requestedXp, 1000 - (daily?.xp || 0)));

    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO battle_match_rewards
          (telegram_id, match_id, xp_awarded, kills, wave)
        SELECT ?, ?, ?, ?, ?
        WHERE ? > 0
          AND (SELECT COALESCE(SUM(xp_awarded), 0)
               FROM battle_match_rewards
               WHERE telegram_id = ? AND date(created_at) = date('now')) + ? <= 1000
      `).bind(telegramId, matchId, xpAwarded, kills, wave, xpAwarded, telegramId, xpAwarded),
      env.DB.prepare(`
        INSERT INTO battle_progress
          (telegram_id, xp, level, best_wave, total_kills, updated_at)
        SELECT ?, ?, 1, ?, ?, CURRENT_TIMESTAMP
        WHERE changes() > 0
        ON CONFLICT(telegram_id) DO UPDATE SET
          xp = battle_progress.xp + excluded.xp,
          best_wave = MAX(battle_progress.best_wave, excluded.best_wave),
          total_kills = battle_progress.total_kills + excluded.total_kills,
          updated_at = CURRENT_TIMESTAMP
      `).bind(telegramId, xpAwarded, wave, kills)
    ]);

    if (!results[0]?.meta?.changes) {
      return Response.json({ success: false, duplicate_or_daily_cap: true, message: "Match already saved or daily XP limit reached" }, { status: 409, headers });
    }

    const progress = await env.DB.prepare(
      "SELECT xp, best_wave, total_kills FROM battle_progress WHERE telegram_id = ?"
    ).bind(telegramId).first();
    const xp = progress?.xp || 0;
    const level = levelForXp(xp);
    await env.DB.prepare(
      "UPDATE battle_progress SET level = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?"
    ).bind(level, telegramId).run();

    return Response.json({
      success: true,
      xp_awarded: xpAwarded,
      progress: {
        xp,
        level,
        next_level_xp: level * level * 100,
        best_wave: progress?.best_wave || 0,
        total_kills: progress?.total_kills || 0
      }
    }, { headers });
  } catch (error) {
    console.error("Battle progress POST error:", error);
    return Response.json({ success: false, error: "Battle progress service unavailable" }, { status: 500, headers });
  }
}
