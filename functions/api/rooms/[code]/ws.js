export async function onRequest({ request, env, params }) {
  if (!env.ROOMS) {
    return new Response("Multiplayer service is not configured", {
      status: 503
    });
  }

  const code = String(params.code || "").toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return new Response("Invalid room code", {
      status: 400
    });
  }

  const roomId = env.ROOMS.idFromName(code);
  const room = env.ROOMS.get(roomId);

  const url = new URL(request.url);
  const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  url.pathname = isWebSocket ? "/ws" : "/exists";

  return room.fetch(
    new Request(url.toString(), isWebSocket ? request : { method: "GET" })
  );
}
