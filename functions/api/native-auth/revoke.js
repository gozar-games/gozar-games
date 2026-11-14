import { authenticate, revokeNativeSession } from "../../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const user = await authenticate(request, env);
    if (!user || user.auth_type !== "native") {
      return Response.json({ success: false, error: "Native session required" }, { status: 401, headers });
    }
    await revokeNativeSession(request, env.DB);
    return Response.json({ success: true }, { headers });
  } catch (error) {
    console.error("Native auth revoke error:", error);
    return Response.json({ success: false, error: "Could not revoke session" }, { status: 500, headers });
  }
}
