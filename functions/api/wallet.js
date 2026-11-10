export async function onRequestGet(context) {
  const { request, env } = context;

  return new Response(
    JSON.stringify({
      success: true,
      message: "GOZAR COINS wallet API is running"
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
