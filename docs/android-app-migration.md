# GOZAR GAMES Android App Migration — Initial Audit

Date: 2026-11-14
Repository: `gozar-games/gozar-games`
Base branch: `main`
Audit branch: `docs/android-app-migration-plan`

## Goal

Create an Android app for GOZAR GAMES while keeping the Telegram Mini App available. Both clients should use the same player identity and server-side wallet/progress data. Existing Snake and Crossy Road games must remain unchanged during the initial migration. Battle Arena can be upgraded separately and incrementally.

## Repository inventory (main)

The repository currently contains 19 tracked files:

### Playable game entry points

| Game | Current entry | Implementation notes |
|---|---|---|
| Snake | `snake.html` | Standalone HTML/CSS/JavaScript page; loads Telegram WebApp SDK; returns to `/`. |
| Crossy Road | `crossy.html` | Standalone HTML page; uses a JavaScript module and imports Three.js 0.160.0 from jsDelivr; includes room/multiplayer API calls. |
| Battle Arena | `games/battle-arena/index.html` | Canvas + JavaScript prototype; loads `gozar-battle-arena-assets.zip`; calls Telegram-linked battle-progress API. |

The homepage `index.html` links to all three entries. It also loads the Telegram WebApp SDK and calls the wallet and daily-reward APIs using the `X-Telegram-Init-Data` header.

No separate Board Game entry point or board-game source file was found in the current `main` tree.

### Backend and infrastructure files

- `functions/api/wallet.js` — Telegram initData verification and wallet endpoint.
- `functions/api/daily-reward.js` — daily reward endpoint.
- `functions/api/battle-progress.js` — Battle Arena XP, level and match reward endpoint.
- `functions/api/intro-videos.js` and `functions/api/intro-video/[id].js` — intro media endpoints.
- `functions/api/rooms/create.js` and `functions/api/rooms/[code]/ws.js` — room creation and WebSocket endpoint.
- `functions/api/telegram-webhook.js` and `functions/api/setup-telegram-webhook.js` — Telegram bot/webhook integration.
- `multiplayer-worker/src/worker.js` and `multiplayer-worker/wrangler.toml` — multiplayer Worker.
- `backups/crossy-backup-2026-11-13.html` — dated Crossy backup.

## Important compatibility findings

1. **Telegram identity is currently the only demonstrated authentication path.** The homepage and game APIs rely on Telegram WebApp initData. A native Android WebView does not automatically receive valid Telegram initData.
2. **A shared account needs a secure linking flow.** Recommended flow: the user starts a short-lived, single-use linking request in the bot; the backend verifies the Telegram user and binds the request to a native app session. The bot token must remain server-side. Do not put bot secrets in the APK or trust user-supplied Telegram IDs.
3. **API URL handling needs a platform adapter.** Relative calls such as `/api/wallet` and `/api/battle-progress` resolve against the web origin in the Mini App, but a packaged Capacitor app has a different local origin. Introduce one configurable API base URL/service layer before packaging.
4. **Crossy Road has an external runtime dependency.** Three.js is imported from jsDelivr. For reliable packaged execution, vendor/pin this dependency locally or explicitly accept a network requirement and test failure/recovery behavior.
5. **Battle Arena loads a ZIP asset at runtime.** Confirm the ZIP extraction/loading implementation and ensure its path works from a packaged local asset origin.
6. **Online rooms need real-device testing.** WebSocket connectivity, reconnect, background/resume, and network changes must be tested inside the Android WebView.
7. **Shared wallet and progress must remain server-authoritative.** The native app must never award coins/XP locally or submit an unverified identity.

## Recommended target architecture

- **Game layer:** preserve the existing game pages first; later split reusable systems into shared modules.
- **Web client:** existing Cloudflare Pages / Telegram Mini App.
- **Android client:** Capacitor Android shell loading bundled local game assets.
- **Platform adapter:** detects Telegram vs native app, provides safe navigation, haptics/back behavior, and API base URL.
- **Authentication:** one-time Telegram-to-native linking code exchanged server-side for a revocable native session.
- **Backend:** keep Cloudflare Pages Functions and D1 as the shared source of truth for player identity, wallet and progression.

## Phased implementation plan

### Phase 1 — Safe foundation (next)
- Add Capacitor project configuration and Android wrapper in a separate directory/branch.
- Keep current web entry points and backend endpoints unchanged.
- Add a native shell smoke test using a minimal local page before moving all games.
- Verify Android build tooling and package identifiers.

### Phase 2 — Local game bundle
- Bundle homepage and the three existing game entry points.
- Replace hard-coded navigation with a platform-aware router.
- Resolve API calls through a configurable API base URL.
- Make Three.js and Battle Arena assets available locally.
- Test Snake, Crossy Road and Battle Arena separately on a physical Android device.

### Phase 3 — Shared account
- Design and implement one-time linking requests and native session issuance.
- Add server-side verification, expiry, single-use enforcement, revocation and rate limits.
- Migrate wallet/progress endpoints to accept the native session without weakening Telegram validation.
- Verify the same account sees the same balances and progress in both clients.

### Phase 4 — Release readiness
- Test app lifecycle, back navigation, keyboard/safe areas, offline/error states, WebSockets and performance.
- Produce a signed release APK/AAB only after the user approves the release path.
- Keep the Telegram Mini App deployable independently.

## Scope and safety

- This is an audit and migration plan only.
- No existing game source, production API, database schema, Telegram configuration, or Cloudflare deployment was changed.
- Do not merge this branch into `main` until the plan is reviewed and the native shell has been tested.
