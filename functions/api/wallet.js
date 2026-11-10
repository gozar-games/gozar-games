
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

  // Reject duplicate parameters
  const keys = Array.from(params.keys());

  if (new Set(keys).size !== keys.length) {
    return null;
  }

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

  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (authDate > now + 30 || now - authDate > 300) {
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

  if (difference !== 0) {
    return null;
  }

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

export async function onRequestGet({ request, env }) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
      throw new Error("Server configuration missing");
    }

    const initData = request.headers.get(
      "X-Telegram-Init-Data"
    );

    if (!initData) {
      return Response.json(
        {
          success: false,
          error: "Telegram authentication required"
        },
        { status: 401, headers }
      );
    }

    const user = await verifyTelegram(
      initData,
      env.TELEGRAM_BOT_TOKEN
    );

    if (!user) {
      return Response.json(
        {
          success: false,
          error: "Invalid Telegram authentication"
        },
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
