export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ success: false, error: "Database unavailable" }, { status: 503 });
  try {
    const result = await env.DB.prepare(
      "SELECT id, title, duration, media_type FROM intro_videos WHERE active = 1 ORDER BY sort_order, id"
    ).all();
    return Response.json(
      { success: true, videos: result.results || [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Intro video list error:", error);
    return Response.json({ success: false, error: "Could not load videos" }, { status: 500 });
  }
}
