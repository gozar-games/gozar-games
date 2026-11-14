import { createNativeSession, ensureNativeAuthTables, sha256Hex } from "../../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    if (!env.DB) {
      return Response.json({ success: false, error: "Authentication service unavailable" }, { status: 503, headers });
    }
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
      return Response.json({ success: false, error: "کد اتصال معتبر نیست." }, { status: 400, headers });
    }

    await ensureNativeAuthTables(env.DB);
    const now = Math.floor(Date.now() / 1000);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await sha256Hex(ip);
    await env.DB.prepare(`
      INSERT INTO native_link_attempts (ip_hash, window_start, attempts)
      VALUES (?, ?, 1)
      ON CONFLICT(ip_hash) DO UPDATE SET
        attempts = CASE
          WHEN native_link_attempts.window_start <= ? THEN 1
          ELSE native_link_attempts.attempts + 1
        END,
        window_start = CASE
          WHEN native_link_attempts.window_start <= ? THEN excluded.window_start
          ELSE native_link_attempts.window_start
        END
    `).bind(ipHash, now, now - 900, now - 900).run();
    const attempt = await env.DB.prepare(
      "SELECT attempts FROM native_link_attempts WHERE ip_hash = ?"
    ).bind(ipHash).first();
    if ((attempt?.attempts || 0) > 10) {
      return Response.json({ success: false, error: "تعداد تلاش‌ها زیاد است؛ ۱۵ دقیقه دیگر دوباره امتحان کن." }, { status: 429, headers });
    }

    const codeHash = await sha256Hex(code);
    const link = await env.DB.prepare(`
      SELECT telegram_id FROM native_link_codes
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
    `).bind(codeHash, now).first();

    if (!link?.telegram_id) {
      return Response.json({ success: false, error: "کد منقضی شده یا قبلاً استفاده شده است. در ربات کد تازه بگیر." }, { status: 401, headers });
    }

    const consumed = await env.DB.prepare(`
      UPDATE native_link_codes SET used_at = ?
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
    `).bind(now, codeHash, now).run();

    if (!consumed.meta?.changes) {
      return Response.json({ success: false, error: "این کد قبلاً استفاده شده است." }, { status: 409, headers });
    }

    const session = await createNativeSession(env.DB, link.telegram_id);
    return Response.json({
      success: true,
      token: session.token,
      expires_at: session.expiresAt
    }, { headers });
  } catch (error) {
    console.error("Native auth exchange error:", error);
    return Response.json({ success: false, error: "ساخت نشست امن انجام نشد." }, { status: 500, headers });
  }
}
