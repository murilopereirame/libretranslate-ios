# LibreTranslate for iOS

A React Native (Expo) app for any [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) server: self-hosted or public.

## Features

- Translate text with auto-detect, or pick the source language yourself
- Language list loaded from the server (`GET /languages`); the target list only shows pairs the server supports
- Translate as you type (debounced) or with a button
- Detected language with confidence, swap languages, paste, copy
- Alternative translations (`alternatives` parameter, 0-3)
- Character counter using the server's limit (`GET /frontend/settings`)
- History of recent translations (stored on device)
- Settings: server URL, optional API key (saved in the iOS Keychain), "Test connection"
- Light and dark mode

## API endpoints used

| Endpoint | Used for |
| --- | --- |
| `GET /languages` | Language list and supported pairs |
| `GET /frontend/settings` | Character limit, whether an API key is required |
| `POST /translate` | Translation (`q`, `source`, `target`, `format`, `alternatives`, `api_key`) |
| `POST /detect` | Available in the client (`src/api/libretranslate.ts`) |
| `POST /suggest` | Available in the client |

## Run it

Requirements: Node 20+, and for iOS a Mac with Xcode, or the Expo Go app on an iPhone.

```bash
npm install
npm run ios        # opens the iOS simulator (Mac + Xcode)
npx expo start     # then scan the QR code with Expo Go on an iPhone
```

Open **Settings** in the app and enter your server URL, e.g. `http://192.168.1.10:5000` for a self-hosted server on your network, or `https://libretranslate.com` with an API key.

To run your own server: `docker run -ti --rm -p 5000:5000 libretranslate/libretranslate`

## Build for TestFlight / the App Store

```bash
npx eas-cli@latest build --platform ios
npx eas-cli@latest submit --platform ios
```

Change `ios.bundleIdentifier` in `app.json` (currently `com.example.libretranslate`) before building.

`app.json` allows plain `http://` servers (an App Transport Security exception) so self-hosted servers on a LAN work. If you only use HTTPS servers, you can remove `NSAllowsArbitraryLoads`.

## Develop

```bash
npm run typecheck
npm test
```

Code layout:

- `src/api/libretranslate.ts`: typed API client
- `src/state/AppContext.tsx`: settings, language list, history
- `src/app/`: screens (Expo Router): `index` (translate), `languages`, `history`, `settings`
