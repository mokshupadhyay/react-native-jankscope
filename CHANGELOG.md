# Changelog

## 0.1.0

First release. Run on an Android emulator and an iOS simulator, both release builds on the New Architecture; not yet run on a physical device. See [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md).

- Android collectors: a Choreographer frame callback for every vsync, `Window.addOnFrameMetricsAvailableListener` on a background `HandlerThread` (all stage durations, plus `GPU_DURATION` and `DEADLINE` on API 31+), the refresh rate re-read on every display change, React Native mount timing (`UIManagerListener.willMountItems` / `didMountItems` on Fabric, UI blocks around each batch on the old architecture), and re-attaching when the activity changes.
- iOS collectors: `CADisplayLink` at the screen's highest rate, a `CFRunLoopObserver` for main-thread busy time, and React Native mount timing (`RCTSurfacePresenterObserver` on Fabric, UI blocks around each `RCTUIManager` batch on the old architecture).
- JS-thread heartbeat with a learned idle-lateness baseline. JS-busy windows go to native in batches once per second.
- Attribution of every missed frame to `js`, `ui-mount`, `ui-other`, `render-gpu` or `unknown`, with the per-stage times kept.
- `Jankscope.start()`, `mark()`, `stop()`, `saveReport()` and `live()`. The report has janky %, dropped frames, hitch time ratio, slow and frozen frames scaled by the refresh rate, per-cause totals, the worst 20 frames, per-mark segments, raw frames and measured overhead.
- `<JankscopeOverlay />`: fps, janky % and last cause, one `Text` update per second.
- CLI: `jankscope pull`, `summary`, `compare` (medians, thresholds, exit 1 on a regression) and `html`.
- Android bridge module and TurboModule around one shared implementation; iOS module for both architectures.
