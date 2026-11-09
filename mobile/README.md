# Boarded Up mobile (iOS / Android)

The phone version of the game: a Vite app that imports the game from `../client/src` and adds
twin-stick touch controls, wrapped in native shells with [Capacitor](https://capacitorjs.com).
App id: `app.topdownsurvival.game`. Landscape only.

| Path | Role |
|---|---|
| `src/main.ts` | Boots like `client/src/main.ts`, with a `TouchInput` passed to `Game`, the crosshair off and touch wording in `controlText` |
| `src/TouchInput.ts` | Extends the client's `Input`. Left stick holds WASD (8 directions, so prediction matches the server). Right stick puts the mouse 120 px ahead of the player and holds fire when pushed past 55%. With the right thumb off, aim follows movement. Buttons press keys. Outside play a tap is a click |
| `src/controls.ts` | Button and stick layout (CSS px, kept clear of the safe area) and drawing on the overlay canvas |
| `src/keyboard.ts` | A hidden `<input>` that brings up the phone keyboard for the name and room-code fields |
| `src/native.ts` | Capacitor only: hide the status bar, keep the screen awake, pause on background, Android back = Esc, haptics on your own hits and purchases |
| `ios/`, `android/` | Native projects from `npx cap add`. The copied web build (`App/App/public`, `assets/public`) is gitignored |

## Develop

```bash
npm install
npm run dev                      # http://localhost:5175 (and on your LAN); proxies /api and /ws to :8080
API_TARGET=http://localhost:8551 npm run dev   # against docker compose instead
npm run build                    # type-check + build to dist/
```

The desktop browser's device toolbar (touch emulation) is enough to try the controls. On a real
phone, open `http://<laptop LAN IP>:5175`.

**Live reload in the native app:** run the dev server, then
`CAP_DEV_URL=http://<laptop LAN IP>:5175 npx cap run android` (or `ios`). The app loads the dev
server over plain HTTP, and the Vite proxy forwards `/api` and `/ws`, so no CORS or TLS is needed.

## Release builds

Store builds talk to the real server directly, so build with its URL:

```bash
VITE_SERVER_URL=https://<your server> npm run sync   # build + copy into ios/ and android/
npx cap open ios        # Xcode: set the signing team, then Product > Archive
npx cap open android    # Android Studio: Build > Generate Signed Bundle
```

- The server must be on **HTTPS/WSS**: iOS blocks plain HTTP and Android blocks cleartext by default.
- Its `CORS_ORIGINS` must include `capacitor://localhost` (iOS) and `https://localhost` (Android). `docker-compose.yml` includes both by default. `WebConfig` (REST) and `WebSocketConfig` (`/ws`) both read it.
- The soundtrack (~57 MB) is bundled from `../client/public`.

## Needs on the build machine

- **iOS:** Xcode (`sudo xcode-select -s /Applications/Xcode.app` and `sudo xcodebuild -license accept` once), an Apple Developer account for devices and the App Store.
- **Android:** Android Studio (SDK + an emulator), a Play Console account for the store.
- Icons and splash screens are still Capacitor's defaults: put a 1024×1024 `assets/icon.png` (and `assets/splash.png`) here and run `npx @capacitor/assets generate`.
