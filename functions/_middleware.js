const ALLOWED_ORIGINS = new Set([
  "https://gozar-games.pages.dev",
  "https://localhost"
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data, X-Gozar-Native-Session",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export async function onRequest(context) {
  const origin = context.request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.has(origin);

  if (context.request.method === "OPTIONS") {
    if (!allowed) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = await context.next();
  if (!allowed) return response;

  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
