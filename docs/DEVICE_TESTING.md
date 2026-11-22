# Device testing

Version 0.1.0 has run on an Android emulator (Pixel 7 image, API 37, arm64, `-gpu host`) and an iOS simulator (iPhone 17 Pro, iOS 26.2). Both were release builds of the example app on the New Architecture with React Native 0.88.1; the results are in the README's [Validation](../README.md#validation) section. Nothing has run on a physical device, and the old architecture has not run anywhere. Work through this list before calling a release tested, and write down the device, OS version, React Native version, architecture and refresh rate for each run.

## Already checked (emulator and simulator)

- The release builds compile and link, the TurboModule loads, and a full session (start, marks, stop, save) works on both platforms.
- `jankscope pull` copies reports from the emulator (`adb pull` from external app storage) and the simulator (`simctl get_app_container`).
- Primary cause matches the injected cause for a blocked JS thread (`js`) and a blocked main thread (`ui-other`) on both, and for heavy mounting (`ui-mount`) on iOS. Heavy mounting on Android came out as `js` (see the README).
- Collection overhead per frame, heartbeat and overlay cost, as published in the README.

## Both platforms

Use the example app (`example/`, `npm run example:install`, then `sh scripts/example-android-release.sh <serial>` or `sh scripts/example-ios-release.sh <udid>`) in a release build. It runs every scenario on launch and saves a report.

1. Run the example app three times on each device and fill in the validation table with `node scripts/validation-table.mjs <reports>`. Check that `js-blocked` is `js`, `main-blocked` is `ui-other`, and record what `heavy-mount` gives.
2. `idle` should be close to 0% janky on a device. Emulator idle runs were 2.5–5.5% janky with most hitch time in RenderThread/GPU stages; confirm whether a device behaves like the simulator (0%).
3. Compare `report.overhead` with the README numbers. Note the device model, because UI-thread cost per frame depends on the CPU.
4. Check `report.overhead.heartbeatBaselineMs` and the lateness percentiles. On the emulator the idle baseline was 33 ms; on the simulator 0.65 ms. A device with a different timer path may differ.
5. Start a session, background the app for 10 seconds, return, and stop. From reading the code (not run): display links and Choreographer callbacks stop in the background, so the gap is likely counted as one long missed, frozen frame. Record what the report shows; if it does, a later version should skip background time.
6. Run a session longer than `maxFrames` frames (for example `maxFrames: 1000` for 30 seconds) and check that `report.lost` is non-zero and `jankscope summary` warns.
7. Turn the overlay on and off and compare janky % in the idle scenario with and without it.

## Android

1. **120 Hz and 90 Hz:** on a device with a high refresh rate (Pixel 7 Pro, Galaxy S2x), check `device.refreshRate`, that frames have `budget` 8.33 or 11.11 ms, and that changing the refresh rate in the display settings during a session (or an app forcing 60 Hz) changes the budget of later frames.
2. **API 31+ `DEADLINE` and `GPU_DURATION`:** check they are present in `frame.android` (not `null`).
3. **API 26–30:** check that frames still match vsyncs (`frame.android` present on drawn frames, sensible `interval`), and that `gpu` and `deadline` are `null`.
4. **API 24–25:** check that the session works and frames are placed by arrival time (approximate). These levels have not been run.
5. **Activity changes:** open a second React Native activity (or rotate with `configChanges` unset so the activity is recreated) during a session. FrameMetrics records must continue after the change.
6. **Old architecture:** build a React Native 0.81 app with `newArchEnabled=false` and run the scenarios. Check that `mount` windows are recorded (UI blocks around each batch) and that `architecture` is `old`. Not yet run.
7. **`run-as` fallback:** in a debuggable build on a device where external app storage is not writable, check that `saveReport` falls back to the internal files dir and `jankscope pull` reads it with `run-as`.
8. **Module teardown:** reload JavaScript (debug build) during a session. The app must not crash, and a new session must start.

## iOS

1. **ProMotion:** on an iPhone 13 Pro or later, with `CADisableMinimumFrameDurationOnPhone` set to `true` in `Info.plist`, check that `device.refreshRate` is 120 and that frame budgets are 8.33 ms during scrolling. Without the key, iOS caps the app at 60 Hz; record what jankscope reports then.
2. **Physical device build:** `pod install` and an Xcode build for a device, release configuration.
3. **Old architecture:** a React Native 0.81 app with `RCT_NEW_ARCH_ENABLED=0`. Check that the bridge module loads, that `mount` windows come from `uiManagerWillPerformMounting:`, and that `architecture` is `old`. Not yet built or run.
4. **Bridge mode with Fabric** (New Architecture without bridgeless, React Native 0.73–0.81): check that mount windows are recorded. The module looks for the surface presenter on the bridge in that mode; this path has not been run.
5. **Low Power Mode** limits the display to 60 Hz on ProMotion devices; check that budgets follow.

## Report

For each run, note: device, OS version, React Native version, architecture, refresh rate, build type, the scenario, the primary cause and per-cause hitch share, and `report.overhead`. Attach the report JSON when you open an issue.
