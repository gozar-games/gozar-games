import { authenticate } from "../_shared/auth.js";

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
        coins_awarded INTEGER NOT NULL DEFAULT 0,
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
    const user = await authenticate(request, env, { telegramMaxAgeSeconds: 86400 });
    if (!user) return Response.json({ success: false, error: "Authentication required" }, { status: 401, headers });

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
    const user = await authenticate(request, env, { telegramMaxAgeSeconds: 86400 });
    if (!user) return Response.json({ success: false, error: "Authentication required" }, { status: 401, headers });

    const body = await request.json();
    const matchId = typeof body.match_id === "string" ? body.match_id : "";
    const kills = Number(body.kills);
    const wave = Number(body.wave);
    const requestedSpend = Number(body.spent_coins || 0);
    const requestedCoins = Number(body.earned_coins || 0);
    if (!/^[a-zA-Z0-9-]{12,64}$/.test(matchId) ||
        !Number.isSafeInteger(kills) || kills < 0 || kills > 500 ||
        !Number.isSafeInteger(wave) || wave < 1 || wave > 100 ||
        !Number.isSafeInteger(requestedSpend) || requestedSpend < 0 || requestedSpend > 2500 ||
        !Number.isSafeInteger(requestedCoins) || requestedCoins < 0 || requestedCoins > 500) {
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
    const dailyCoins = await env.DB.prepare(`
      SELECT COALESCE(SUM(coins_awarded), 0) AS coins
      FROM battle_match_rewards
      WHERE telegram_id = ? AND date(created_at) = date('now')
    `).bind(telegramId).first();
    const coinsAwarded = Math.max(0, Math.min(requestedCoins, 2500 - (dailyCoins?.coins || 0)));
    const username = user.username || null;
    const currentWallet = await env.DB.prepare(
      "SELECT coins FROM players WHERE telegram_id = ?"
    ).bind(telegramId).first();
    const spentCoins = Math.min(requestedSpend, (currentWallet?.coins || 0) + coinsAwarded);
    const netCoins = coinsAwarded - spentCoins;

    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO battle_match_rewards
          (telegram_id, match_id, xp_awarded, coins_awarded, kills, wave)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE (? > 0 OR ? > 0)
          AND (SELECT COALESCE(SUM(xp_awarded), 0)
               FROM battle_match_rewards
               WHERE telegram_id = ? AND date(created_at) = date('now')) + ? <= 1000
          AND (SELECT COALESCE(SUM(coins_awarded), 0)
               FROM battle_match_rewards
               WHERE telegram_id = ? AND date(created_at) = date('now')) + ? <= 2500
      `).bind(telegramId, matchId, xpAwarded, coinsAwarded, kills, wave, xpAwarded, coinsAwarded, telegramId, xpAwarded, telegramId, coinsAwarded),
      env.DB.prepare(`
        INSERT INTO players
          (telegram_id, username, coins, daily_streak, last_reward_date, missed_days)
        SELECT ?, ?, ?, 0, NULL, 0
        WHERE changes() > 0
        ON CONFLICT(telegram_id) DO UPDATE SET
          username = COALESCE(excluded.username, players.username),
          coins = players.coins + excluded.coins,
          updated_at = CURRENT_TIMESTAMP
      `).bind(telegramId, username, netCoins),
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
      coins_awarded: coinsAwarded,
      coins_spent: spentCoins,
      wallet_coins: (currentWallet?.coins || 0) + netCoins,
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
