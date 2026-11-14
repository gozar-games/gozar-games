import { authenticate } from "../_shared/auth.js";

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
