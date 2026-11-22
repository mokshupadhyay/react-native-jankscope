# jankscope example app

Not shipped. A React Native 0.88.1 app (New Architecture) that causes known jank on purpose, so jankscope's attribution can be checked. On launch it starts a session, runs each scenario in `App.tsx` for 6 seconds inside its own `Jankscope.mark()`, saves the report and prints one line per segment.

`helpers/` is an example-only native module with `blockMainThread(ms)`, a busy loop on the UI/main thread.

From the repository root:

```sh
npm run example:install                              # pack the library and install it here
sh scripts/example-android-release.sh emulator-5554  # release build, install, launch
sh scripts/example-ios-release.sh <simulator udid>
npx jankscope pull --platform android --app com.jankscopeexample --out reports
npx jankscope pull --platform ios --app org.reactjs.native.example.JankscopeExample --out reports
node scripts/validation-table.mjs reports/*.json
```
