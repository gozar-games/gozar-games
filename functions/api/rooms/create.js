function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

export async function onRequestPost({ request, env }) {
  if (!env.ROOMS) {
    return json({ error: "Multiplayer service is not configured" }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const name = String(body.name || "Player").trim().slice(0, 16);
  const roomCode = makeCode();
  const roomId = env.ROOMS.idFromName(roomCode);
  const room = env.ROOMS.get(roomId);

  try {
    const response = await room.fetch("https://room.internal/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      return json({ error: "Could not create room" }, 500);
    }

    return json({ code: roomCode });
  } catch {
    return json({ error: "Room service unavailable" }, 503);
  }
}
