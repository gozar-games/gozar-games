(() => {
  'use strict';
  const API = 'https://gozar-games.pages.dev';
  const isHome = () => location.pathname === '/' || location.pathname === '/index.html';
  const hasSession = () => {
    try { return !!localStorage.getItem('gozar_native_session'); } catch { return false; }
  };

  function mount() {
    if (!isHome() || !document.body) return;
    if (!document.getElementById('gozarLoginFallbackButton')) {
      const button = document.createElement('button');
      button.id = 'gozarLoginFallbackButton';
      button.type = 'button';
      button.textContent = hasSession() ? 'مدیریت / تغییر حساب تلگرام' : 'اتصال حساب تلگرام';
      button.setAttribute('aria-label', 'اتصال حساب تلگرام');
      button.style.cssText = 'position:fixed;z-index:2147483000;bottom:calc(18px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);width:min(88vw,360px);min-height:52px;border:2px solid #ff5964;border-radius:15px;background:#c91425;color:#fff;font:900 15px Vazirmatn,Arial,sans-serif;box-shadow:0 8px 30px #000b;cursor:pointer';
      button.addEventListener('click', openDialog);
      document.body.appendChild(button);
    }
  }

  function openDialog() {
    if (document.getElementById('gozarLoginFallbackDialog')) return;
    const wrap = document.createElement('div');
    wrap.id = 'gozarLoginFallbackDialog';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:20px;background:#050505ed;color:white;font-family:Arial,sans-serif';
    if (hasSession()) {
      wrap.innerHTML = '<div style="width:min(100%,390px);padding:24px 20px;border:1px solid #2d8d57;border-radius:20px;background:linear-gradient(145deg,#102117,#0c0e12);text-align:center"><div style="font-size:42px">✅</div><h2>حساب تلگرام متصل است</h2><p style="font-size:13px;line-height:2;color:#ddd">نشست حساب روی این دستگاه ذخیره شده است.</p><button id="gozarFallbackLogout" style="width:100%;padding:14px;border:0;border-radius:12px;background:#ed1725;color:white;font-weight:900">خروج از حساب</button><button id="gozarFallbackClose" style="width:100%;margin-top:10px;padding:10px;border:1px solid #555;border-radius:10px;background:#171717;color:#ddd">بستن</button></div>';
      document.body.appendChild(wrap);
      wrap.querySelector('#gozarFallbackClose').addEventListener('click', () => wrap.remove());
      wrap.querySelector('#gozarFallbackLogout').addEventListener('click', async () => {
        try { await fetch(API + '/api/native-auth/revoke', { method: 'POST' }); } catch {}
        try { localStorage.removeItem('gozar_native_session'); } catch {}
        location.reload();
      });
      return;
    }
    wrap.innerHTML = '<div style="width:min(100%,390px);padding:24px 20px;border:1px solid #ed3342;border-radius:20px;background:linear-gradient(145deg,#211014,#0c0e12);text-align:center;box-shadow:0 20px 65px #000b"><div style="font-size:42px">🎮</div><h2 style="margin:8px 0">اتصال حساب تلگرام</h2><p style="font-size:13px;line-height:2;color:#ddd">در ربات @GozarGamesBot روی «اتصال اپ اندروید» بزن یا دستور /link را ارسال کن؛ سپس کد ۸ کاراکتری را اینجا وارد کن.</p><input id="gozarFallbackCode" maxlength="8" autocomplete="one-time-code" placeholder="کد ۸ کاراکتری" style="box-sizing:border-box;width:100%;margin:12px 0;padding:14px;border:1px solid #666;border-radius:12px;background:#090909;color:white;text-align:center;direction:ltr;font-size:22px;letter-spacing:5px;text-transform:uppercase"><button id="gozarFallbackSubmit" style="width:100%;padding:14px;border:0;border-radius:12px;background:#ed1725;color:white;font-weight:900">اتصال حساب</button><p id="gozarFallbackStatus" style="min-height:22px;color:#ff9da4;font-size:12px"></p><button id="gozarFallbackClose" style="width:100%;padding:10px;border:1px solid #555;border-radius:10px;background:#171717;color:#ddd">بستن</button><p style="font-size:11px;color:#999">کد یک‌بارمصرف ۵ دقیقه اعتبار دارد.</p></div>';
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#gozarFallbackCode');
    const submit = wrap.querySelector('#gozarFallbackSubmit');
    const status = wrap.querySelector('#gozarFallbackStatus');
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
    });
    wrap.querySelector('#gozarFallbackClose').addEventListener('click', () => wrap.remove());
    submit.addEventListener('click', async () => {
      const code = input.value.trim();
      if (code.length !== 8) { status.textContent = 'کد ۸ کاراکتری را کامل وارد کن.'; return; }
      submit.disabled = true;
      submit.textContent = 'در حال اتصال...';
      status.textContent = '';
      try {
        const response = await fetch(API + '/api/native-auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.token) throw new Error(data.error || 'اتصال انجام نشد.');
        localStorage.setItem('gozar_native_session', data.token);
        status.textContent = 'حساب متصل شد؛ در حال بارگذاری...';
        submit.textContent = 'متصل شد ✓';
        wrap.remove();
        location.reload();
      } catch (error) {
        status.textContent = error.message || 'ارتباط با سرور برقرار نشد.';
        submit.disabled = false;
        submit.textContent = 'اتصال حساب';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pageshow', mount);
})();