# GOZAR GAMES Android wrapper

This directory contains the first Capacitor Android shell and the scripts that package the existing web games. The Telegram Mini App remains the primary live client and is not modified by this wrapper.

## Included in the local bundle

- Home page
- Snake
- Crossy Road, with Three.js 0.160.0 bundled locally
- Battle Arena and its ZIP asset archive

The build copies the current game pages into `android-app/www` and injects `native-bridge.js` only into those packaged copies. The original root HTML files remain unchanged.

## Build

From the repository root:

```bash
npm install
npm run build:web
npm run check:android-web
npx cap add android
npx cap sync android
npx cap open android
```

To build a local debug APK after Android Studio and the Android SDK are installed:

```bash
cd android
./gradlew assembleDebug
```

GitHub Actions also has a manual / branch-triggered debug APK workflow. Its APK is an unsigned debug build, not a Play Store release.

## Important current limitations

1. The bridge routes relative `/api/*` requests and room WebSockets to the production Cloudflare Pages origin. The Android login screen asks the player to send `/link` to `@GozarGamesBot`, then exchanges the short-lived one-time code for a 30-day native session.
2. The server stores only a SHA-256 hash of the native session token; link codes expire after five minutes, are single-use, and exchange attempts are rate-limited. A revoke endpoint is available at `POST /api/native-auth/revoke`.
3. The Pages middleware allows the Capacitor `https://localhost` origin and the production Pages origin to call APIs. Wallet, daily reward, and Battle Arena progress accept either verified Telegram initData or a valid native session.
4. The account-linking flow is implemented in this branch but has not yet been deployed or exercised against the live Telegram bot and D1 database. Do not assume it is live until the branch is merged and Cloudflare Pages has deployed it.
5. Google Fonts remain online dependencies; the games should still be tested on a physical Android device with and without connectivity.
6. Multiplayer WebSockets, background/resume, device back navigation, the game asset ZIP, and real wallet/XP synchronization must be verified on real Android hardware before release.

Do not publish this debug APK as a production release. Shared-account authentication and server-side session support are the next required implementation phase.
