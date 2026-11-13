export async function onRequestGet({ request, env, params }) {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return new Response("Video service unavailable", { status: 503 });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response("Not found", { status: 404 });

  try {
    const item = await env.DB.prepare(
      "SELECT file_id, media_type FROM intro_videos WHERE id = ? AND active = 1"
    ).bind(id).first();
    if (!item?.file_id) return new Response("Not found", { status: 404 });

    const fileResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(item.file_id)}`
    );
    const fileData = await fileResponse.json();
    if (!fileResponse.ok || !fileData.ok || !fileData.result?.file_path) {
      return new Response("Telegram file unavailable", { status: 502 });
    }

    const telegramUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const headers = {};
    const range = request.headers.get("Range");
    if (range) headers.Range = range;
    const media = await fetch(telegramUrl, { headers });
    if (!media.ok && media.status !== 206) return new Response("Could not fetch video", { status: 502 });

    const responseHeaders = new Headers({
      "Content-Type": item.media_type === "photo" ? (media.headers.get("Content-Type") || "image/jpeg") : (media.headers.get("Content-Type") || "video/mp4"),
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*"
    });
    for (const key of ["Content-Length", "Content-Range"]) {
      const value = media.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    return new Response(media.body, { status: media.status, headers: responseHeaders });
  } catch (error) {
    console.error("Intro video stream error:", error);
    return new Response("Video playback failed", { status: 500 });
  }
}
