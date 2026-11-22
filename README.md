# react-native-jankscope

Find out why each frame of a React Native app dropped, on Android and iOS, in release builds. jankscope records every frame, decides whether it missed its deadline, and blames the stage that took the time: the JS thread, React Native mount work, other UI/main-thread work, or render/GPU. It writes a session report, shows a small live overlay, and ships a CLI that compares reports in CI.

- **Per-frame causes.** Each missed frame gets one primary cause, `js`, `ui-mount`, `ui-other`, `render-gpu` or `unknown`, and keeps the time of every stage, so you can see the full split.
- **Both platforms, release builds.** Android uses FrameMetrics and Choreographer. iOS uses CADisplayLink and a run loop observer. Nothing depends on a debug build or a connected debugger.
- **Reports.** Janky %, dropped frames, Apple's hitch time ratio, Android vitals-style slow and frozen frames scaled to the refresh rate, per-cause totals, the 20 worst frames, a segment per `mark()`, and the raw frames.
- **CI.** `npx jankscope compare base head` compares medians over several runs and exits 1 on a regression.

Other tools answer different questions. react-native-performance-stats shows FPS, React Native DevTools shows a JS timeline, @shopify/react-native-performance times flows, react-native-performance and Rozenite record marks and measures, and Flashlight measures CPU and FPS on Android. jankscope records why each frame dropped.

**Status of version 0.1.0:** run on an Android emulator (API 37) and an iOS simulator (iOS 26.2), release builds on the New Architecture with React Native 0.88.1. In those runs the primary cause matched the injected cause for a blocked JS thread and a blocked main thread on both platforms, and for heavy mounting on iOS. On Android, heavy mounting was not attributed to `ui-mount`; see [Validation](#validation). The JavaScript has unit and property tests. The Android Java compiles for both architectures against React Native 0.81.5 and 0.88.1. The old architecture has not been run on any device or simulator, and nothing has been run on a physical device yet. [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md) lists what is still to check.

## Install

```sh
npm install react-native-jankscope
cd ios && pod install
```

- **New Architecture:** codegen generates the TurboModule from `src/specs` during the app build (`codegenConfig` in `package.json`). Nothing else to do. React Native 0.82 and later always use this path.
- **Old architecture:** autolinking registers the bridge module. Nothing else to do.

The Android side picks the source set from your app's `newArchEnabled` Gradle property. iOS uses `RCT_NEW_ARCH_ENABLED`, as for any native module. Android needs API 24 or later (FrameMetrics). You need a development build or a bare app; Expo Go cannot load the native module, and `start()` rejects with `NOT_LINKED`.

**120 Hz on iPhone:** iOS caps third-party apps at 60 Hz on ProMotion iPhones unless the app's `Info.plist` sets `CADisableMinimumFrameDurationOnPhone` to `true`. jankscope asks CADisplayLink for the screen's highest rate, but it cannot lift that cap for you. This has not been checked on a ProMotion device; the simulator runs at 60 Hz.

## Usage

```tsx
import { Jankscope, JankscopeOverlay } from 'react-native-jankscope';

await Jankscope.start({ label: 'feed' });

Jankscope.mark('scroll');      // starts the "scroll" segment
// ... the user scrolls ...
Jankscope.mark('open-detail'); // ends "scroll", starts "open-detail"

const report = await Jankscope.stop();
console.log(report.summary.jankyPct, report.summary.primaryCause);
await Jankscope.saveReport(report); // logs one line with the path
```

```tsx
// Optional: fps, janky % since start() and the last cause, refreshed once per second.
<JankscopeOverlay />
```

| Call | Result |
| --- | --- |
| `Jankscope.start({ label?, maxFrames?, heartbeatIntervalMs? })` | Starts a session. `maxFrames` (default 20000) is the capacity of each native ring buffer; older records are overwritten and counted in `report.lost`. `heartbeatIntervalMs` defaults to 16. Rejects with `ALREADY_RUNNING` or `NOT_LINKED`. |
| `Jankscope.mark(name)` | Starts a segment named `name` that lasts until the next mark or `stop()`. |
| `Jankscope.stop({ maxReportFrames?, includeRaw? })` | Resolves the `Report`. `report.frames` keeps the first `maxReportFrames` frames (default 10000; `framesTruncated` says when it cut). `includeRaw: true` also keeps the native session in `report.raw`. |
| `Jankscope.saveReport(report, fileName?)` | Writes the JSON and resolves its path. Android writes to `<external files dir>/jankscope/`, falling back to the internal files dir; iOS writes to `Documents/jankscope/`. The native side logs `report saved: <path>` (Android tag `Jankscope`, iOS `[Jankscope]`). `fileName` must match `[A-Za-z0-9._-]+\.json`. |
| `Jankscope.live()` | The overlay's numbers: `{ running, fps, jankyPct, lastCause }`. |
| `Jankscope.isRunning()` | `true` while a session runs. |

The report also exports the functions it is built from (`buildFrames`, `attribute`, `summarize`, `segmentFrames`, `buildReport`), which helps when you want to re-analyze a raw session.

## What it measures

### Android

- **Every vsync** through a Choreographer frame callback that re-posts itself, also when nothing is drawn. When the UI thread is blocked, the callback skips vsyncs, and that gap is a missed frame even if nothing was drawn.
- **Every drawn frame** through `Window.addOnFrameMetricsAvailableListener` on the current activity's window, on a background `HandlerThread`. It records `INTENDED_VSYNC_TIMESTAMP`, `VSYNC_TIMESTAMP`, `UNKNOWN_DELAY_DURATION`, `INPUT_HANDLING`, `ANIMATION`, `LAYOUT_MEASURE`, `DRAW`, `SYNC`, `COMMAND_ISSUE`, `SWAP_BUFFERS` and `TOTAL_DURATION`, plus `GPU_DURATION` and `DEADLINE` on API 31+. The two timestamps need API 26; on API 24 and 25, frames are placed by the time the record arrived, which is less exact.
- **The refresh rate** from `Display.getRefreshRate()`, read again on every `DisplayManager` change, so 60, 90 and 120 Hz periods are all correct. The report's `device.refreshRate` is the highest rate in `Display.getSupportedModes()`.
- **React Native mount work** on the UI thread. On Fabric, `UIManagerListener.willMountItems` / `didMountItems` bracket each batch the mount item dispatcher runs. On the old architecture, a UI block is prepended and another appended to every UIManager batch from `willDispatchViewUpdates`. View preallocation runs outside these callbacks and is not counted.
- When the activity changes (or is recreated), the FrameMetrics listener moves to the new window on the next `onHostResume`. Everything is detached on `stop()` and on module `invalidate`.

### iOS

- **Every vsync** through a `CADisplayLink` on the main run loop, with `preferredFrameRateRange` set to the screen's `maximumFramesPerSecond`. Each callback records `timestamp`, `targetTimestamp` and when the callback ran. A missed deadline (a hitch) shows as a gap between successive timestamps of more than 1.5 frame periods.
- **Main-thread busy time** through a `CFRunLoopObserver` for `kCFRunLoopAfterWaiting` and `kCFRunLoopBeforeWaiting`: the time from waking up to going back to sleep, summed between two display link callbacks.
- **React Native mount work.** On Fabric, `RCTSurfacePresenterObserver`'s `willMountComponentsWithRootTag:` / `didMountComponentsWithRootTag:`. On the old architecture, UI blocks around each `RCTUIManager` mounting batch.
- **Render server and GPU time are not observable in the app's process.** A missed frame while the main and JS threads were mostly idle is reported as `render-gpu`, which on iOS means "unattributed": the time went somewhere outside the app's main and JS threads.

### JS thread (both platforms)

A timer loop on the JS thread (`setTimeout` every `heartbeatIntervalMs`, default 16 ms). When a tick runs later than it should, the JS thread was busy, and the window from the due time until the tick ran is recorded. Windows go to native in batches once per second, never once per frame.

Timers never run exactly on time. On the Android emulator, idle and busy ticks together ran a median of 34–35 ms late, and the learned idle baseline was 33 ms (0.65 ms on the iOS simulator), because React Native dispatches timers from frame callbacks. The heartbeat therefore learns an idle baseline: the 25th percentile of recent lateness samples that were not outliers. It only counts lateness beyond that baseline. The report gives the baseline and the lateness percentiles in `overhead`. The JS and native clocks are aligned at `start()` by calling the synchronous `nowMs()` seven times and keeping the sample with the shortest round trip.

## How attribution works

The report is built in JavaScript from the raw native records (`src/raw.ts`, `src/attribution.ts`). All times are in ms. `B` is one refresh period (16.7 ms at 60 Hz, 8.3 ms at 120 Hz).

**Frames.** On iOS, every display link interval is a frame. On Android, every drawn frame is a frame, and so is every vsync with nothing drawn when the UI thread skipped vsyncs or the JS thread stalled. Idle vsyncs with nothing drawn are not frames.

**Missed frames.** A frame is janky when either of these is true:

- **The UI side missed the deadline.** iOS: the timestamp gap is over `1.5 × B`. Android: a drawn frame finished after its deadline (`DEADLINE` on API 31+, else `B`), counted from its intended vsync; or, with nothing drawn, the vsync came over `0.5 × B` later than expected. On Android, a frame is only late by the time that goes past the end of the frame before it plus `B`, so one long stall is not counted twice (once as the long frame and once as the next vsync it delayed). Dropped frames are the refresh periods lost, and hitch time is how late the frame was.
- **The JS thread stalled.** The UI was on time, but JS-busy windows covered at least half of the frame. The first `B` of every busy window is ignored, because a JS task shorter than one frame delays nothing visible. Such a frame counts 1 dropped frame, and its hitch time is the JS-busy time inside it.

**Stage times** of every frame:

| Stage | Android | iOS |
| --- | --- | --- |
| `js` | JS-busy time inside the frame's vsync interval, without the first `B` of each busy window | same |
| `mount` | React Native mount time inside the frame's UI-thread window | React Native mount time between display link callbacks (for a missed frame, over the two callbacks before the gap) |
| `uiOther` | UI-thread time minus `mount`. UI-thread time is `UNKNOWN_DELAY + INPUT + ANIMATION + LAYOUT_MEASURE + DRAW` for a drawn frame, or the skipped time when nothing was drawn | main-thread busy time minus `mount` |
| `render` | `max(SYNC + COMMAND_ISSUE + SWAP_BUFFERS, GPU_DURATION)` | for a missed frame: the lateness that main-thread busy time does not explain, `interval − B − mainBusy` (unattributed) |

Android frames also keep the raw FrameMetrics stages in `frame.android`, so `ui-other` can be split into input, animation, layout/measure and draw.

**Primary cause** of a missed frame, rules applied in order:

1. The UI was on time and the JS thread stalled: **`js`**.
2. `mount + uiOther ≥ B/2` and `mount + uiOther ≥ render`: **`ui-mount`** if `mount ≥ uiOther`, else **`ui-other`**.
3. Android, `render ≥ B/2`: **`render-gpu`**.
4. `js ≥ B/2`: **`js`** (the UI missed while the UI thread was idle and the JS thread was busy, for example while it was waiting on a commit).
5. Otherwise **`render-gpu`** on iOS (unattributed: the main and JS threads were mostly idle), **`unknown`** on Android.

A segment's `primaryCause` is the cause with the most hitch time in it.

### Limits

- **`js` is inferred, not observed.** The heartbeat only knows when its own timer ran late. A JS-stall frame means "the JS thread could not run for most of this frame", not that the screen was waiting for a commit. In a screen with no JS-driven updates, a busy JS thread still produces `js` frames, although the user sees no difference.
- **Busy-window starts are estimates.** A window starts at the due time plus the learned baseline, so its start can be off by up to one heartbeat interval plus the timer jitter. JS tasks shorter than the jitter are not seen.
- **A newly mounted view's first draw is `ui-other` on Android.** FrameMetrics reports the drawing of new views as `DRAW`, separate from the mount callbacks. In the heavy-mount scenario on the emulator, `DRAW` took about as long as the mount itself, so frames split between `ui-mount` and `ui-other`.
- **Mount timing covers the mount batch only.** View preallocation on Android, and the shadow tree, layout and commit on the JS thread, are not mount time. The commit's cost lands in `js`.
- **iOS has no per-frame render time.** `render-gpu` on iOS is whatever main-thread work does not explain. Core Animation commits, render server work and GPU work are not measured. An on-time iOS frame is never "slow", because there is no render duration to compare.
- **Main-thread busy time on iOS** counts every run loop iteration, including work that is not React Native (timers, other SDKs). That is the intent of `ui-other`.
- **Android API 24 and 25** have no vsync timestamps in FrameMetrics, so drawn frames cannot be matched to vsyncs and their timing is approximate.
- **Emulators and simulators are not devices.** The validation below ran on an emulator with host GPU translation and a simulator. On the emulator, idle frames sometimes missed in RenderThread/GPU stages. That is the emulator's GPU path (an inference: the same idle scenario had no misses on the iOS simulator).

## Report

`report.summary` (and each entry of `report.segments`) has:

| Field | Meaning |
| --- | --- |
| `frameCount`, `jankyFrames`, `jankyPct` | Frames, missed frames, and missed / frames × 100 |
| `droppedFrames` | Refresh periods lost to missed frames |
| `hitchTimeMs`, `hitchRatio` | Total lateness, and lateness per second of session (ms/s, Apple's hitch time ratio) |
| `slowFrames`, `slowThresholdMs` | Frames over 16 ms at 60 Hz, scaled to the refresh period (8 ms at 120 Hz). Android checks a drawn frame's `TOTAL_DURATION`; on iOS only missed frames can be slow. |
| `frozenFrames` | Frames over 700 ms |
| `p50FrameMs`, `p95FrameMs`, `p99FrameMs` | Frame duration percentiles. Android: `TOTAL_DURATION`, or the interval when vsyncs were skipped. iOS: the display link interval. Do not compare across platforms. |
| `causes` | `{ count, dropped, hitchMs }` for each cause |
| `primaryCause` | The cause with the most hitch time |

The report also has `device` (model, OS, refresh rate), `buildType` (`debug` when the app is debuggable/`DEBUG` or `__DEV__` is set), `architecture`, `worstFrames` (20, by hitch time, with stage times), `segments`, `frames`, `overhead` and `lost`.

## Overhead

Measured in release builds of the example app, three runs of about 53 seconds each on each platform. All six scenarios ran, with the overlay on. The UI-thread figures are wall-clock time inside jankscope's own callbacks, which is an upper bound of their CPU time. They do not include the system's own cost of delivering a vsync callback or a FrameMetrics record.

| | Android emulator (API 37, arm64) | iOS simulator (iPhone 17 Pro, iOS 26.2) |
| --- | --- | --- |
| UI/main thread, per frame | 0.010–0.015 ms (Choreographer callback) | 0.0015–0.0018 ms (display link callback and run loop observer) |
| FrameMetrics thread, per frame | 0.016–0.018 ms | — |
| JS thread, heartbeat (16 ms interval) | 2.3–3.0 ms per second (0.2–0.3%) | 2.0–2.1 ms per second (0.2%) |
| JS thread, overlay update (once per second) | 2.4–3.4 ms per update | 0.40–0.42 ms per update |

These numbers come from an emulator and a simulator, not from phones; measure on your target devices before relying on them. Each run's figures are in `report.overhead` and in [docs/validation/table.md](docs/validation/table.md). The overlay's own React commit (one `Text` per second) is not in its JS figure. It appears in the report like any other mount.

## Validation

The example app ([`example/`](example), React Native 0.88.1, New Architecture) runs these scenarios for 6 seconds each, inside one session, each in its own `mark()` with a 1.5-second idle gap after it. A spinner animated with the native driver runs throughout, so Android keeps drawing frames.

1. `idle`: the spinner only.
2. `js-blocked`: a 300 ms busy loop in JavaScript every second.
3. `main-blocked`: a 300 ms busy loop on the UI/main thread every second, from an example-only native method ([`example/helpers`](example/helpers)).
4. `rerender-storm`: 400 components re-rendered on every animation frame.
5. `heavy-mount`: 1500 plain views (`collapsable={false}`), mounted and unmounted every 750 ms.
6. `many-animated`: 300 views animated with the native driver.
7. `heavy-mount-styled`: like 5, with coloured, rounded views and a child each.

Three release-build runs per platform. Primary cause per segment, and the share of the segment's hitch time per cause (js / mount / other / render / unknown):

| Scenario | Injected | Android emulator: primary (3 runs) | Android hitch share, run 1 | iOS simulator: primary (3 runs) | iOS hitch share, run 1 |
| --- | --- | --- | --- | --- | --- |
| idle | none | render-gpu, render-gpu, js (2.5–5.5% janky) | 30 / 0 / 6 / 64 / 0 | none, none, none (0% janky) | — |
| js-blocked | `js` | **js, js, js** | 94 / 0 / 0 / 6 / 0 | **js, js, js** | 100 / 0 / 0 / 0 / 0 |
| main-blocked | `ui-other` | **ui-other, ui-other, ui-other** | 5 / 0 / 93 / 2 / 0 | **ui-other, ui-other, ui-other** | 0 / 0 / 100 / 0 / 0 |
| heavy-mount | `ui-mount` | js, js, js (not matched) | 57 / 10 / 30 / 4 / 0 | **ui-mount, ui-mount, ui-mount** | 0 / 96 / 0 / 4 / 0 |
| rerender-storm | — | js, js, js | 86 / 9 / 2 / 3 / 0 | none (0% janky) | — |
| many-animated | — | js, js, js | 52 / 5 / 37 / 6 / 0 | js, js, js (1.4% janky) | 52 / 0 / 48 / 0 / 0 |
| heavy-mount-styled | — | ui-other ×3 | 25 / 0 / 74 / 0 / 0 | ui-mount ×3 | 3 / 97 / 0 / 0 / 0 |

The full table, with frame counts, janky % and hitch ratio for every run, is in [docs/validation/table.md](docs/validation/table.md), made with `node scripts/validation-table.mjs docs/validation/*.json`. The six reports are in [docs/validation](docs/validation), and two of them are rendered with `jankscope html`.

**Heavy mount on Android did not match.** Two things combine:

- Rendering 1500 components on the JS thread (React render, shadow tree, layout, commit) took longer than mounting them. Those frames are correctly `js`.
- On the UI thread, the mount batches took 621, 698 and 697 ms in total over the three runs. The first `DRAW` of the new views (418–549 ms) landed in the same frames, so those frames split between `ui-mount` and `ui-other` by a small margin. Under the rules above, `DRAW` is `ui-other`.

That is a limit of the rules, not a measurement error. To see mount cost on Android, read `causes['ui-mount']` and the `mount` stage of the worst frames, not only `primaryCause`.

## CLI

Node 18 or later, from the same package:

```sh
npx jankscope pull --platform android --app com.example.app [--device emulator-5554] [--out dir]
npx jankscope pull --platform ios --app com.example.app [--device <simulator udid>]
npx jankscope summary report.json
npx jankscope compare base.json head.json [--threshold 10%] [--metric jankyPct|hitchRatio|p95FrameMs] [--segment scroll]
npx jankscope html report.json -o report.html
```

- **`pull`** copies saved reports into `--out` (default `jankscope-reports`). On Android it reads `/sdcard/Android/data/<app>/files/jankscope` with `adb pull`, which also works for release builds, and falls back to `adb exec-out run-as <app>` (debuggable builds only) for the internal files dir. Without `--app`, it finds the app in the `report saved:` lines of `adb logcat`. On iOS it uses `xcrun simctl get_app_container <device> <app> data` (default device `booted`), or without `--app`, every app from `simctl listapps`. Pass `--device` when more than one device is connected. It copies every report in the folder, so clear the folder between runs.
- **`summary`** prints the main numbers, the cause breakdown and the segments.
- **`compare`** takes the median of the metric over the reports on each side and compares head against base. Each side is a file, a comma-separated list, a directory of reports, or repeated `--base` / `--head` options. `--threshold 10%` is relative to the base median; `--threshold 2` is in the metric's unit. Every metric is "lower is better". `--metric` can be repeated or comma-separated, and `--segment` compares one segment instead of the whole session. Exit codes: 0 no regression, 1 regression, 2 usage or input error. A base median of 0 makes any rise an infinite relative change; use an absolute threshold for metrics that are often 0.
- **`html`** writes one self-contained page with no scripts and no external resources: a frame timeline coloured by cause (at most 1500 bars; with more frames, each bar shows the worst frame of its group), the cause breakdown, the segments and the worst frames. Text from the report is HTML-escaped.

### In CI

Run the same scenario several times on the base and the head build, then compare medians:

```sh
# after each run of the base build
npx jankscope pull --platform android --app com.example.app --device "$SERIAL" --out reports/base
# after each run of the head build
npx jankscope pull --platform android --app com.example.app --device "$SERIAL" --out reports/head

npx jankscope compare reports/base reports/head --metric jankyPct,hitchRatio --threshold 10% --segment scroll
```

```text
metric             base (median)  head (median)  change  status
-----------------  -------------  -------------  ------  ---------
jankyPct (%)       4.24 (n=2)     4.13 (n=1)     -2.6%   unchanged
hitchRatio (ms/s)  133.3 (n=2)    130.6 (n=1)    -2.0%   unchanged
```

Use a release build, the same device, and at least three runs per side. A single run is noisy: on the emulator, the idle scenario ranged from 2.5% to 5.5% janky across three runs.

## Development

```sh
npm install
npm run typecheck
npm test                                     # jest: unit, property and CLI tests
npm run build
node scripts/mutation-check.mjs              # see docs/MUTATION_EVIDENCE.md
sh scripts/android-compile-check.sh 0.88.1   # javac against android.jar and the cached react-android AAR
sh scripts/android-compile-check.sh 0.81.5
sh scripts/android-jvm-test.sh               # plain-JVM test of the ring buffer
sh scripts/example-android-release.sh emulator-5554
sh scripts/example-ios-release.sh <simulator udid>
```

`npm run example:install` packs the library and installs it in the example app.
