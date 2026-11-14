
async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(message)
    )
  );
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTelegram(initData, botToken) {
  if (
    typeof initData !== "string" ||
    initData.length === 0 ||
    initData.length > 8192
  ) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const keys = Array.from(params.keys());

  if (new Set(keys).size !== keys.length) return null;

  const hash = params.get("hash");
  const authDateText = params.get("auth_date");
  const userText = params.get("user");

  if (
    !hash ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    !authDateText ||
    !userText
  ) {
    return null;
  }

  const authDate = Number(authDateText);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(authDate) ||
    authDate <= 0 ||
    authDate > now + 30 ||
    now - authDate > 300
  ) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmac(
    new TextEncoder().encode("WebAppData"),
    botToken
  );

  const calculatedHash = toHex(
    await hmac(secretKey, dataCheckString)
  );

  let difference = 0;

  for (let i = 0; i < 64; i++) {
    difference |=
      calculatedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }

  if (difference !== 0) return null;

  try {
    const user = JSON.parse(userText);

    if (
      !user ||
      !Number.isSafeInteger(user.id) ||
      user.id <= 0
    ) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

function getTehranDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function dayDifference(first, second) {
  const a = new Date(`${first}T00:00:00Z`);
  const b = new Date(`${second}T00:00:00Z`);

  return Math.round((b - a) / 86400000);
}

const rewards = [5, 10, 20, 30, 45, 60, 90];

function getReward(streak) {
  return streak <= 7 ? rewards[streak - 1] : 30;
}

function getNextStreak(player, today) {
  if (!player?.last_reward_date) return 1;

  const difference = dayDifference(
    player.last_reward_date,
    today
  );

  if (!Number.isInteger(difference) || difference <= 0) {
    return null;
  }

  return difference <= 2
    ? (player.daily_streak || 0) + 1
    : 1;
}

// GET: نمایش وضعیت جایزه روزانه
export async function onRequestGet({ request, env }) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    const user = await authenticate(request, env);

    if (!user) {
      return Response.json(
        {
          success: false,
          error: "Authentication required"
        },
        { status: 401, headers }
      );
    }

    const today = getTehranDate();
    const telegramId = String(user.id);

    const player = await env.DB.prepare(`
      SELECT coins, daily_streak, last_reward_date
      FROM players
      WHERE telegram_id = ?
    `)
      .bind(telegramId)
      .first();

    const claimed = player?.last_reward_date === today;

    const nextStreak = claimed
      ? player.daily_streak
      : getNextStreak(player, today);

    if (nextStreak === null) {
      return Response.json(
        { success: false, error: "Invalid reward date" },
        { status: 409, headers }
      );
    }

    return Response.json(
      {
        success: true,
        claimed,
        daily_streak: player?.daily_streak || 0,
        next_streak: nextStreak,
        reward: getReward(nextStreak),
        coins: player?.coins || 0,
        date: today
      },
      { headers }
    );

  } catch (error) {
    console.error("Daily reward GET error:", error);

    return Response.json(
      {
        success: false,
        error: "Daily reward service unavailable"
      },
      { status: 500, headers }
    );
  }
}

// POST: دریافت جایزه روزانه
export async function onRequestPost({ request, env }) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    const user = await authenticate(request, env);

    if (!user) {
      return Response.json(
        {
          success: false,
          error: "Authentication required"
        },
        { status: 401, headers }
      );
    }

    const telegramId = String(user.id);
    const today = getTehranDate();

    const player = await env.DB.prepare(`
      SELECT coins, daily_streak, last_reward_date
      FROM players
      WHERE telegram_id = ?
    `)
      .bind(telegramId)
      .first();

    const previousDate = player?.last_reward_date || null;

    if (previousDate === today) {
      return Response.json(
        {
          success: false,
          already_claimed: true,
          message: "Today's reward has already been claimed"
        },
        { status: 409, headers }
      );
    }

    const nextStreak = getNextStreak(player, today);

    if (nextStreak === null) {
      return Response.json(
        { success: false, error: "Invalid reward date" },
        { status: 409, headers }
      );
    }

    const reward = getReward(nextStreak);
    const missedDays = previousDate
      ? Math.min(dayDifference(previousDate, today) - 1, 2)
      : 0;

    const username = user.username || null;

    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO players (
          telegram_id,
          username,
          coins,
          daily_streak,
          last_reward_date,
          missed_days
        )
        VALUES (?, ?, ?, ?, ?, ?)

        ON CONFLICT(telegram_id) DO UPDATE SET
          username = COALESCE(excluded.username, players.username),
          coins = players.coins + excluded.coins,
          daily_streak = excluded.daily_streak,
          last_reward_date = excluded.last_reward_date,
          missed_days = excluded.missed_days,
          updated_at = CURRENT_TIMESTAMP

        WHERE players.last_reward_date IS ?
      `).bind(
        telegramId,
        username,
        reward,
        nextStreak,
        today,
        missedDays,
        previousDate
      ),

      env.DB.prepare(`
        INSERT INTO coin_transactions (
          telegram_id,
          amount,
          type,
          reason
        )
        SELECT ?, ?, 'daily_reward', ?
        WHERE changes() > 0
      `).bind(
        telegramId,
        reward,
        `Daily reward day ${nextStreak} - ${today}`
      )
    ]);

    if (!results[0]?.meta?.changes) {
      return Response.json(
        {
          success: false,
          already_claimed: true,
          message: "Today's reward has already been claimed"
        },
        { status: 409, headers }
      );
    }

    const updatedPlayer = await env.DB.prepare(`
      SELECT coins, daily_streak, last_reward_date
      FROM players
      WHERE telegram_id = ?
    `)
      .bind(telegramId)
      .first();

    if (!updatedPlayer) {
      throw new Error("Updated player not found");
    }

    return Response.json(
      {
        success: true,
        reward,
        daily_streak: updatedPlayer.daily_streak,
        coins: updatedPlayer.coins,
        date: today,
        message: "Daily reward claimed successfully"
      },
      { headers }
    );

  } catch (error) {
    console.error("Daily reward POST error:", error);

    return Response.json(
      {
        success: false,
        error: "Daily reward service unavailable"
      },
      { status: 500, headers }
    );
  }
}
