import { authenticate } from "../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    if (!env.DB) {
      throw new Error("Server configuration missing");
    }

    const user = await authenticate(request, env, { telegramMaxAgeSeconds: 300 });

    if (!user) {
      return Response.json(
        { success: false, error: "Authentication required" },
        { status: 401, headers }
      );
    }

    const telegramId = String(user.id);

    const player = await env.DB.prepare(`
      SELECT telegram_id, username, coins
      FROM players
      WHERE telegram_id = ?
    `)
      .bind(telegramId)
      .first();

    return Response.json(
      {
        success: true,
        wallet: player || {
          telegram_id: telegramId,
          username: user.username || null,
          coins: 0
        }
      },
      { headers }
    );

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "Wallet service unavailable"
      },
      { status: 500, headers }
    );
  }
}
