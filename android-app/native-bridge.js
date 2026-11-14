(() => {
  'use strict';

  // The packaged app uses local HTML, while Cloudflare Pages remains the shared API.
  // Telegram Mini App pages never load this bridge, so their origin and requests stay unchanged.
  const API_ORIGIN = 'https://gozar-games.pages.dev';
  const apiOrigin = new URL(API_ORIGIN).origin;
  const originalFetch = window.fetch.bind(window);

  function resolveApiUrl(value) {
    const url = new URL(value, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return new URL(url.pathname + url.search + url.hash, apiOrigin).toString();
    }
    return url.toString();
  }

  const NativeWebSocket = window.WebSocket;
  function GozarWebSocket(url, protocols) {
    const resolved = new URL(url, window.location.href);
    if (resolved.origin === window.location.origin) {
      resolved.protocol = 'wss:';
      resolved.host = new URL(API_ORIGIN).host;
    }
    return protocols === undefined
      ? new NativeWebSocket(resolved.toString())
      : new NativeWebSocket(resolved.toString(), protocols);
  }
  GozarWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(GozarWebSocket, NativeWebSocket);
  GozarWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  GozarWebSocket.OPEN = NativeWebSocket.OPEN;
  GozarWebSocket.CLOSING = NativeWebSocket.CLOSING;
  GozarWebSocket.CLOSED = NativeWebSocket.CLOSED;
  window.WebSocket = GozarWebSocket;

  window.GOZAR_PLATFORM = Object.freeze({
    kind: 'android',
    apiOrigin,
    isNative: true
  });

  // Supply the small WebApp surface the existing pages use for readiness checks.
  // Identity is never taken from this object: the server trusts only the native session.
  if (!window.Telegram?.WebApp?.initData) {
    window.Telegram = window.Telegram || {};
    window.Telegram.WebApp = {
      initData: 'native-app-session',
      initDataUnsafe: { user: { id: 0, first_name: 'بازیکن GOZAR' } },
      ready() {},
      expand() {},
      close() {},
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} }
    };
  }

  function getSessionToken() {
    try { return localStorage.getItem('gozar_native_session') || ''; }
    catch { return ''; }
  }

  function addNativeSession(input, init) {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const resolved = resolveApiUrl(requestUrl);
    const isApi = new URL(resolved).origin === apiOrigin &&
      new URL(resolved).pathname.startsWith('/api/');
    if (!isApi || !getSessionToken()) return { resolved, init };

    const baseHeaders = input instanceof Request
      ? new Headers(input.headers)
      : new Headers();
    const headers = new Headers(init?.headers || baseHeaders);
    headers.set('X-Gozar-Native-Session', getSessionToken());
    return { resolved, init: { ...(init || {}), headers } };
  }

  window.fetch = async function(input, init) {
    try {
      const prepared = addNativeSession(input, init);
      const request = input instanceof Request
        ? new Request(prepared.resolved, input)
        : prepared.resolved;
      const response = await originalFetch(
        input instanceof Request ? new Request(request, prepared.init) : prepared.resolved,
        input instanceof Request ? undefined : prepared.init
      );
      if (response.status === 401 && getSessionToken()) {
        const path = new URL(prepared.resolved).pathname;
        if (path.startsWith('/api/') && path !== '/api/native-auth/exchange') {
          try { localStorage.removeItem('gozar_native_session'); } catch {}
          if (location.pathname === '/' || location.pathname === '/index.html') showNativeLogin();
          else location.replace('/');
        }
      }
      return response;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  function addNativeAccountControls() {
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    if (!getSessionToken() || document.getElementById('gozarNativeAccount')) return;
    const header = document.querySelector('.header');
    if (!header) return;
    const control = document.createElement('button');
    control.id = 'gozarNativeAccount';
    control.type = 'button';
    control.textContent = 'اتصال فعال · خروج';
    control.style.cssText = 'border:1px solid #5a3035;border-radius:10px;background:#211316;color:#ffb2b7;padding:8px 10px;font:700 10px Vazirmatn,sans-serif;max-width:125px';
    control.addEventListener('click', async () => {
      control.disabled = true;
      control.textContent = 'در حال خروج...';
      try {
        await window.fetch('/api/native-auth/revoke', { method: 'POST' });
      } catch {}
      try { localStorage.removeItem('gozar_native_session'); } catch {}
      location.reload();
    });
    header.appendChild(control);
  }

  function showNativeLogin() {
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    if (getSessionToken() || document.getElementById('gozarNativeLogin')) return;

    const root = document.createElement('div');
    root.id = 'gozarNativeLogin';
    root.innerHTML = `
      <style>
        #gozarNativeLogin{position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;padding:20px;background:#050505ed;font-family:Arial,sans-serif;color:#fff}
        #gozarNativeLogin .card{width:min(100%,390px);padding:23px 19px;border:1px solid #8c2731;border-radius:20px;background:linear-gradient(145deg,#211014,#0c0e12);box-shadow:0 20px 65px #000b;text-align:center}
        #gozarNativeLogin h2{font-size:22px;margin:0 0 9px;font-weight:900}
        #gozarNativeLogin p{font-size:13px;line-height:2;color:#c5c5c5;margin:8px 0}
        #gozarNativeLogin input{width:100%;box-sizing:border-box;margin:12px 0;padding:14px 10px;border:1px solid #555;border-radius:12px;background:#090909;color:#fff;text-align:center;direction:ltr;font-size:22px;letter-spacing:5px;text-transform:uppercase}
        #gozarNativeLogin button{width:100%;border:0;border-radius:12px;background:#ed1725;color:#fff;padding:13px;font-size:14px;font-weight:900}
        #gozarNativeLogin .hint{font-size:11px;color:#999;margin-top:12px}
        #gozarNativeLogin .status{min-height:22px;color:#ff9da4;font-size:12px;margin-top:10px}
      </style>
      <div class="card">
        <div style="font-size:42px;margin-bottom:10px">🎮</div>
        <h2>ورود به GOZAR GAMES</h2>
        <p>برای استفاده از همان حساب، کیف پول و XP تلگرامت، ربات <b>@GozarGamesBot</b> را باز کن و دستور <b>/link</b> را بفرست.</p>
        <p>کد یک‌بارمصرفی که ربات می‌دهد را در این قسمت وارد کن.</p>
        <input id="gozarLinkCode" maxlength="8" autocomplete="one-time-code" placeholder="کد ۸ رقمی">
        <button id="gozarLinkSubmit" type="button">اتصال حساب تلگرام</button>
        <div class="status" id="gozarLinkStatus"></div>
        <div class="hint">کد فقط ۵ دقیقه اعتبار دارد و فقط یک بار قابل استفاده است.</div>
      </div>`;

    document.body.appendChild(root);
    const input = root.querySelector('#gozarLinkCode');
    const status = root.querySelector('#gozarLinkStatus');
    const button = root.querySelector('#gozarLinkSubmit');
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
    });
    button.addEventListener('click', async () => {
      const code = input.value.trim();
      if (code.length !== 8) {
        status.textContent = 'کد ۸ کاراکتری ربات را وارد کن.';
        return;
      }
      button.disabled = true;
      button.textContent = 'در حال اتصال...';
      status.textContent = '';
      try {
        const response = await originalFetch(apiOrigin + '/api/native-auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.token) {
          throw new Error(data.error || 'اتصال حساب انجام نشد.');
        }
        localStorage.setItem('gozar_native_session', data.token);
        status.textContent = 'حساب با موفقیت متصل شد.';
        location.reload();
      } catch (error) {
        status.textContent = error.message || 'ارتباط با سرور برقرار نشد.';
        button.disabled = false;
        button.textContent = 'اتصال حساب تلگرام';
      }
    });
  }

  function initializeNativeHome() {
    if (getSessionToken()) addNativeAccountControls();
    else showNativeLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNativeHome, { once: true });
  } else {
    initializeNativeHome();
  }
})();
