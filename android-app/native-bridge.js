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

  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string' || input instanceof URL) {
        const resolved = resolveApiUrl(String(input));
        return originalFetch(resolved, init);
      }
      if (input instanceof Request) {
        const resolved = resolveApiUrl(input.url);
        if (resolved !== input.url) {
          return originalFetch(new Request(resolved, input), init);
        }
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return originalFetch(input, init);
  };

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
})();
