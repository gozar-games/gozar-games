import { createNativeLinkCode } from "../_shared/auth.js";

const ADMIN_ID = "7634869996";

async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

function menu(isAdmin) {
  const rows = [
    [{ text: "🎮 اجرای بازی", web_app: { url: "https://gozar-games.pages.dev" } }],
    [{ text: "👤 پروفایل من", callback_data: "profile" }, { text: "🏆 رتبه‌بندی", callback_data: "ranking" }],
    [{ text: "🎬 تماشای ویدیوها", callback_data: "videos" }],
    [{ text: "📱 اتصال اپ اندروید", callback_data: "native_link" }]
  ];
  if (isAdmin) rows.push([{ text: "👑 پنل مدیریت", callback_data: "admin" }]);
  return { inline_keyboard: rows };
}

async function send(env, chatId, text, reply_markup) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup,
    disable_web_page_preview: true
  });
}

async function ensureTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS intro_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT NOT NULL,
      file_unique_id TEXT,
      title TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      media_type TEXT NOT NULL DEFAULT 'video',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  try { await env.DB.prepare("ALTER TABLE intro_videos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'").run(); } catch {}
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS intro_video_drafts (
      user_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function adminPanel(env, chatId) {
  await send(env, chatId, "👑 پنل مدیریت GOZAR GAMES\n\nبرای افزودن محتوا، کپشن را همراه عکس یا ویدیو بفرست تا همان نمایش داده شود؛ یا اول عنوان را به‌صورت پیام متنی بفرست و سپس عکس/ویدیو را ارسال کن.\n\nعکس‌ها به‌مدت ۵ ثانیه نمایش داده می‌شوند و ویدیوها تا پایان فایل پخش می‌شوند.\n\nبرای مدیریت محتوا از فهرست زیر استفاده کن.", {
    inline_keyboard: [
      [{ text: "📂 فهرست محتوا", callback_data: "admin_list" }],
      [{ text: "⬅️ منوی اصلی", callback_data: "home" }]
    ]
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB || !env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Missing Telegram bot configuration", { status: 503 });
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let update;
  try { update = await request.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  try {
    await ensureTable(env);
    const message = update.message;
    const callback = update.callback_query;

    if (message) {
      const chatId = message.chat.id;
      const userId = String(message.from?.id || "");
      const isAdmin = userId === ADMIN_ID;

      if (message.text?.startsWith("/start")) {
        await send(env, chatId, "🎮 به GOZAR GAMES خوش اومدی!\n\nاز منوی زیر استفاده کن.\nبرای اتصال اپ اندروید، دستور /link را بفرست.", menu(isAdmin));
      } else if (message.text?.trim().split(/\s+/)[0].split("@")[0] === "/link") {
        if (message.chat?.type !== "private") {
          await send(env, chatId, "برای امنیت، دستور /link را فقط در گفت‌وگوی خصوصی ربات بفرست.");
        } else if (!userId) {
          await send(env, chatId, "حساب تلگرام شناسایی نشد. دوباره تلاش کن.");
        } else {
          const link = await createNativeLinkCode(env.DB, userId);
          await send(env, chatId, "🔐 کد اتصال یک‌بارمصرف اپ GOZAR GAMES:\\n\\n" + link.code + "\\n\\nاین کد فقط ۵ دقیقه معتبر است و فقط یک بار استفاده می‌شود. آن را فقط داخل اپ رسمی GOZAR وارد کن؛ برای هیچ‌کس نفرست.");
        }
      } else if (isAdmin && message.video) {
        const video = message.video;
        const draft = await env.DB.prepare("SELECT title FROM intro_video_drafts WHERE user_id = ?").bind(userId).first();
        const caption = (message.caption || "").trim();
        const title = (caption || draft?.title || "GOZAR GAMES").slice(0, 100);
        await env.DB.prepare("DELETE FROM intro_video_drafts WHERE user_id = ?").bind(userId).run();
        const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM intro_videos").first();
        await env.DB.prepare("INSERT INTO intro_videos (file_id, file_unique_id, title, duration, media_type, sort_order) VALUES (?, ?, ?, ?, 'video', ?)")
          .bind(video.file_id, video.file_unique_id || null, title, video.duration || 0, (max?.n || 0) + 1).run();
        await send(env, chatId, "✅ ویدیو دریافت و به فهرست محتوا اضافه شد.\nبرای مدیریت و ترتیب پخش، پنل مدیریت را باز کن.", {
          inline_keyboard: [[{ text: "📂 مدیریت ویدیوها", callback_data: "admin_list" }]]
        });
      } else if (isAdmin && message.photo?.length) {
        // Prefer a reasonably sized Telegram variant instead of always storing the largest original.
        const photo = [...message.photo]
          .filter(p => p.file_size && p.file_size <= 700 * 1024 && p.width >= 480)
          .sort((a, b) => (b.width || 0) - (a.width || 0))[0]
          || [...message.photo].filter(p => p.file_size && p.file_size <= 700 * 1024).sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0]
          || message.photo[0];
        const draft = await env.DB.prepare("SELECT title FROM intro_video_drafts WHERE user_id = ?").bind(userId).first();
        const caption = (message.caption || "").trim();
        const title = (caption || draft?.title || "GOZAR GAMES").slice(0, 100);
        await env.DB.prepare("DELETE FROM intro_video_drafts WHERE user_id = ?").bind(userId).run();
        const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM intro_videos").first();
        await env.DB.prepare("INSERT INTO intro_videos (file_id, file_unique_id, title, duration, media_type, sort_order) VALUES (?, ?, ?, 0, 'photo', ?)")
          .bind(photo.file_id, photo.file_unique_id || null, title, (max?.n || 0) + 1).run();
        await send(env, chatId, "✅ عکس دریافت و به فهرست محتوا اضافه شد.", {
          inline_keyboard: [[{ text: "📂 مدیریت محتوا", callback_data: "admin_list" }]]
        });
      } else if (isAdmin && message.text) {
        const renameDraft = await env.DB.prepare("SELECT title FROM intro_video_drafts WHERE user_id = ?").bind(userId).first();
        if (renameDraft?.title?.startsWith("__rename__:")) {
          const targetId = Number(renameDraft.title.split(":")[1]);
          const newTitle = message.text.trim().slice(0, 100);
          if (newTitle && !newTitle.startsWith("/")) {
            await env.DB.prepare("UPDATE intro_videos SET title = ? WHERE id = ?").bind(newTitle, targetId).run();
            await env.DB.prepare("DELETE FROM intro_video_drafts WHERE user_id = ?").bind(userId).run();
            await send(env, chatId, "✅ عنوان ویدیو تغییر کرد.");
          } else {
            await send(env, chatId, "لطفاً عنوان معتبر بفرست.");
          }
        } else {
        const title = message.text.trim().slice(0, 100);
        if (!title || title.startsWith("/")) {
          await send(env, chatId, "عنوان ویدیو را به‌صورت یک پیام متنی معمولی بفرست.");
        } else {
          await env.DB.prepare("INSERT INTO intro_video_drafts (user_id, title) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP").bind(userId, title).run();
          await send(env, chatId, `✅ عنوان ذخیره شد: «${title}»\\nحالا ویدیوی مربوط به همین عنوان را ارسال کن.`);
        }
        }
      }
    }

    if (callback) {
      const chatId = callback.message.chat.id;
      const userId = String(callback.from?.id || "");
      const isAdmin = userId === ADMIN_ID;
      const data = callback.data || "";
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });

      if (data === "home") {
        await send(env, chatId, "منوی اصلی GOZAR GAMES", menu(isAdmin));
      } else if (data === "native_link") {
        if (callback.message.chat?.type !== "private") {
          await send(env, chatId, "برای امنیت، اتصال اپ را فقط در گفت‌وگوی خصوصی ربات انجام بده.");
        } else if (!userId) {
          await send(env, chatId, "حساب تلگرام شناسایی نشد. دوباره تلاش کن.");
        } else {
          const link = await createNativeLinkCode(env.DB, userId);
          await send(env, chatId, "🔐 کد اتصال یک‌بارمصرف اپ GOZAR GAMES:\\n\\n" + link.code + "\\n\\nاین کد فقط ۵ دقیقه معتبر است و فقط یک بار استفاده می‌شود. آن را فقط داخل اپ رسمی GOZAR وارد کن؛ برای هیچ‌کس نفرست.");
        }
      } else if (data === "admin" && isAdmin) {
        await adminPanel(env, chatId);
      } else if (data === "admin_list" && isAdmin) {
        const result = await env.DB.prepare("SELECT id, title, active, sort_order, media_type FROM intro_videos ORDER BY sort_order, id").all();
        if (!result.results?.length) {
          await send(env, chatId, "هنوز ویدیویی آپلود نشده است.", { inline_keyboard: [[{ text: "⬅️ پنل مدیریت", callback_data: "admin" }]] });
        } else {
          for (const item of result.results) {
            await send(env, chatId, `#${item.id} · ${item.media_type === "photo" ? "🖼 عکس" : "🎬 ویدیو"} · ${item.title}\nوضعیت: ${item.active ? "فعال" : "غیرفعال"} · ترتیب: ${item.sort_order}`, {
              inline_keyboard: [
                [{ text: item.active ? "⏸ غیرفعال‌کردن" : "▶️ فعال‌کردن", callback_data: `toggle:${item.id}` }],
                [{ text: "✏️ تغییر عنوان", callback_data: `renametitle:${item.id}` }],
                [{ text: "⬆️", callback_data: `moveup:${item.id}` }, { text: "⬇️", callback_data: `movedown:${item.id}` }, { text: "🗑 حذف", callback_data: `delete:${item.id}` }]
              ]
            });
          }
        }
      } else if (isAdmin && /^renametitle:\d+$/.test(data)) {
        const id = Number(data.split(":")[1]);
        await env.DB.prepare("INSERT INTO intro_video_drafts (user_id, title) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP").bind(userId, "__rename__:" + id).run();
        await send(env, chatId, "عنوان جدید این ویدیو را در یک پیام متنی بفرست.");
      } else if (isAdmin && /^(toggle|delete|moveup|movedown):\d+$/.test(data)) {
        const [action, rawId] = data.split(":");
        const id = Number(rawId);
        const item = await env.DB.prepare("SELECT id, active, sort_order FROM intro_videos WHERE id = ?").bind(id).first();
        if (item) {
          if (action === "toggle") await env.DB.prepare("UPDATE intro_videos SET active = ? WHERE id = ?").bind(item.active ? 0 : 1, id).run();
          if (action === "delete") await env.DB.prepare("DELETE FROM intro_videos WHERE id = ?").bind(id).run();
          if (action === "moveup" || action === "movedown") {
            const direction = action === "moveup" ? -1 : 1;
            const neighbor = await env.DB.prepare(`SELECT id, sort_order FROM intro_videos WHERE sort_order ${direction < 0 ? "<" : ">"} ? ORDER BY sort_order ${direction < 0 ? "DESC" : "ASC"} LIMIT 1`).bind(item.sort_order).first();
            if (neighbor) {
              await env.DB.batch([
                env.DB.prepare("UPDATE intro_videos SET sort_order = ? WHERE id = ?").bind(neighbor.sort_order, id),
                env.DB.prepare("UPDATE intro_videos SET sort_order = ? WHERE id = ?").bind(item.sort_order, neighbor.id)
              ]);
            }
          }
        }
        await send(env, chatId, "تغییرات انجام شد.", { inline_keyboard: [[{ text: "📂 بازگشت به فهرست", callback_data: "admin_list" }]] });
      } else if (data === "videos") {
        await send(env, chatId, "🎬 ویدیوهای GOZAR در مینی‌اپ نمایش داده می‌شوند.", {
          inline_keyboard: [[{ text: "🎮 باز کردن مینی‌اپ", web_app: { url: "https://gozar-games.pages.dev" } }]]
        });
      } else if (data === "profile" || data === "ranking") {
        await send(env, chatId, data === "profile" ? "پروفایل بازیکن در مینی‌اپ در دسترس است." : "رتبه‌بندی به‌زودی فعال می‌شود.", menu(isAdmin));
      }
    }
  } catch (error) {
    console.error("Telegram webhook error:", error);
  }

  return new Response("OK");
}
