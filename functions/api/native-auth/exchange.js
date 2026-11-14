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
    const codeHash = await sha256Hex(code);
    const now = Math.floor(Date.now() / 1000);
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
