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

1. The bridge routes relative `/api/*` requests and room WebSockets to the production Cloudflare Pages origin. The API still authenticates the Telegram Mini App today; the native account-linking/session flow is not implemented in this first shell.
2. Cross-origin API calls from the Capacitor origin need explicit CORS support in the Pages Functions before wallet, daily reward, and Battle Arena progress can work in the native app.
3. The native app does not yet have its own secure sign-in/link screen. Do not treat a user-entered Telegram ID as proof of identity.
4. Google Fonts remain online dependencies; the games should still be tested on a physical Android device with and without connectivity.
5. Multiplayer WebSockets, background/resume, device back navigation, and the game asset ZIP must be verified on real Android hardware before release.

Do not publish this debug APK as a production release. Shared-account authentication and server-side session support are the next required implementation phase.
