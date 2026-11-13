const PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>اتصال ربات GOZAR</title>
<style>
body{font-family:system-ui;background:#101014;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}
main{width:min(100%,420px);background:#1c1c23;border:1px solid #393943;border-radius:18px;padding:24px;box-sizing:border-box}
h2{margin-top:0}p{color:#c8c8d0;line-height:1.8}
input,button{width:100%;box-sizing:border-box;padding:14px;border-radius:10px;font-size:16px;margin-top:12px}
input{background:#101014;color:white;border:1px solid #555}
button{background:#e32636;color:white;border:0;font-weight:700}
small{color:#aaa}
</style></head>
<body><main><h2>اتصال ربات GOZAR GAMES</h2>
<p>همان رمزی را وارد کن که در Cloudflare با نام <b>TELEGRAM_WEBHOOK_SECRET</b> ذخیره کردی. این رمز فقط برای اتصال استفاده می‌شود.</p>
<form method="POST">
<input name="secret" type="password" minlength="32" maxlength="128" pattern="[A-Za-z0-9_-]{32,128}" placeholder="رمز Webhook" required autocomplete="off">
<button type="submit">اتصال ربات</button>
</form><small>توکن ربات را اینجا وارد نکن.</small></main></body></html>`;

export async function onRequestGet() {
  return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("تنظیمات TELEGRAM_BOT_TOKEN یا TELEGRAM_WEBHOOK_SECRET در Cloudflare ناقص است.", { status: 503 });
  }

  const form = await request.formData();
  const supplied = String(form.get("secret") || "");
  if (supplied !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("رمز واردشده با Secret ذخیره‌شده در Cloudflare مطابقت ندارد. به صفحه قبل برگرد و دوباره امتحان کن.", { status: 403 });
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(supplied)) {
    return new Response("رمز باید بین ۳۲ تا ۱۲۸ کاراکتر و فقط شامل حروف انگلیسی، عدد، خط تیره یا زیرخط باشد.", { status: 400 });
  }

  const webhookUrl = "https://gozar-games.pages.dev/api/telegram-webhook";
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: supplied,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    })
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    return new Response("تلگرام اتصال را نپذیرفت: " + (result.description || "خطای نامشخص"), { status: 502 });
  }

  return new Response("اتصال Webhook با موفقیت انجام شد. حالا به تلگرام برگرد و در چت Gozar Games دستور /start را بفرست.", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}
