import { attribute } from './attribution';
import { IntervalSet } from './intervals';
import type { AndroidFrameStages, DeviceInfo, Frame, JankscopePlatform } from './types';

/**
 * Tick record, one per vsync callback: CADisplayLink on iOS, a Choreographer
 * frame callback on Android.
 * `[vsync, callback, budget, mainBusy, target]`, times in µs since the session
 * started, `budget` and `mainBusy` in µs, `-1` when unknown.
 */
export const TICK_STRIDE = 5;

/**
 * Android FrameMetrics record:
 * `[intendedVsync, vsync, delay, input, animation, layoutMeasure, draw, sync,
 * commandIssue, swapBuffers, total, gpu, deadline, receivedAt]` in µs, `-1` when
 * the API level does not report the value.
 */
export const METRIC_STRIDE = 14;

/** What the native module returns from `stop()` (JSON). */
export interface RawSession {
  v: 1;
  platform: JankscopePlatform;
  /** Native monotonic clock, ms. */
  startMs: number;
  stopMs: number;
  device: DeviceInfo;
  /** Debuggable app (Android) or DEBUG build (iOS). */
  debug: boolean;
  newArch: boolean;
  ticks: number[];
  metrics: number[];
  /** `[start, end]` µs pairs of React Native mount work on the UI thread. */
  mounts: number[];
  /** `[start, end]` µs pairs of JS-busy windows sent by the heartbeat. */
  jsBusy: number[];
  /** `[time µs, Hz]` pairs, one per refresh rate change (the first is the rate at start). */
  refresh: number[];
  lost: { ticks: number; metrics: number; mounts: number; jsBusy: number };
  /** Time inside the collectors: UI/main thread and Android's FrameMetrics thread, ns, and call counts. */
  cost: { uiNs: number; uiCalls: number; bgNs: number; bgCalls: number };
}

const US = 1000;
const ms = (us: number): number => us / US;
const optionalMs = (us: number): number | null => (us < 0 ? null : us / US);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** One refresh period of the session, used to trim JS-busy windows. */
export function nominalBudgetMs(raw: Pick<RawSession, 'ticks' | 'refresh' | 'device'>): number {
  const budgets: number[] = [];
  for (let i = 2; i < raw.ticks.length; i += TICK_STRIDE) if (raw.ticks[i] > 0) budgets.push(ms(raw.ticks[i]));
  if (budgets.length > 0) return median(budgets);
  const hz = raw.refresh.length >= 2 ? raw.refresh[1] : raw.device.refreshRate;
  return hz > 0 ? 1000 / hz : 1000 / 60;
}

interface Tick {
  vsync: number;
  callback: number;
  budget: number;
  mainBusy: number | null;
}

function readTicks(raw: RawSession): Tick[] {
  const ticks: Tick[] = [];
  for (let i = 0; i + TICK_STRIDE <= raw.ticks.length; i += TICK_STRIDE) {
    ticks.push({
      vsync: ms(raw.ticks[i]),
      callback: ms(raw.ticks[i + 1]),
      budget: ms(raw.ticks[i + 2]),
      mainBusy: optionalMs(raw.ticks[i + 3]),
    });
  }
  ticks.sort((a, b) => a.vsync - b.vsync);
  return ticks;
}

interface Metric extends AndroidFrameStages {
  intendedVsync: number | null;
  vsync: number | null;
  receivedAt: number;
}

function readMetrics(raw: RawSession): Metric[] {
  const list: Metric[] = [];
  const m = raw.metrics;
  for (let i = 0; i + METRIC_STRIDE <= m.length; i += METRIC_STRIDE) {
    list.push({
      intendedVsync: optionalMs(m[i]),
      vsync: optionalMs(m[i + 1]),
      delay: Math.max(0, ms(m[i + 2])),
      input: Math.max(0, ms(m[i + 3])),
      animation: Math.max(0, ms(m[i + 4])),
      layoutMeasure: Math.max(0, ms(m[i + 5])),
      draw: Math.max(0, ms(m[i + 6])),
      sync: Math.max(0, ms(m[i + 7])),
      commandIssue: Math.max(0, ms(m[i + 8])),
      swapBuffers: Math.max(0, ms(m[i + 9])),
      total: Math.max(0, ms(m[i + 10])),
      gpu: optionalMs(m[i + 11]),
      deadline: optionalMs(m[i + 12]),
      receivedAt: ms(m[i + 13]),
    });
  }
  return list;
}

function stagesOf(metric: Metric): AndroidFrameStages {
  return {
    delay: metric.delay,
    input: metric.input,
    animation: metric.animation,
    layoutMeasure: metric.layoutMeasure,
    draw: metric.draw,
    sync: metric.sync,
    commandIssue: metric.commandIssue,
    swapBuffers: metric.swapBuffers,
    gpu: metric.gpu,
    total: metric.total,
    deadline: metric.deadline,
  };
}

/** Index of the tick whose vsync is within `tolerance` ms of `vsync`, or -1. */
function findTick(ticks: Tick[], vsync: number, tolerance: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const delta = ticks[mid].vsync - vsync;
    if (Math.abs(delta) <= tolerance) return mid;
    if (delta < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

interface FrameParts {
  t: number;
  interval: number;
  duration: number;
  budget: number;
  uiMissed: boolean;
  js: number;
  mount: number;
  mainBusy: number;
  render: number;
  /** Lowest number of dropped refresh periods implied by the UI side. */
  uiDropped: number;
  /** Lateness of a UI miss, ms; default `duration - budget`. */
  uiHitch?: number;
  android?: AndroidFrameStages;
}

function finishFrame(platform: JankscopePlatform, p: FrameParts): Frame {
  const uiOther = Math.max(0, p.mainBusy - p.mount);
  const stages = { js: p.js, mount: p.mount, uiOther, render: p.render };
  const jsStalled = p.js >= 0.5 * Math.min(p.interval, p.budget);
  const janky = p.uiMissed || jsStalled;
  const dropped = p.uiMissed ? Math.max(1, p.uiDropped) : jsStalled ? 1 : 0;
  const hitch = p.uiMissed ? Math.max(0, p.uiHitch ?? p.duration - p.budget) : jsStalled ? p.js : 0;
  const frame: Frame = {
    t: p.t,
    interval: p.interval,
    duration: p.duration,
    budget: p.budget,
    uiMissed: p.uiMissed,
    jsStalled,
    janky,
    dropped,
    hitch,
    cause: attribute({ platform, budget: p.budget, uiMissed: p.uiMissed, jsStalled, stages }),
    stages,
  };
  if (p.android) frame.android = p.android;
  return frame;
}

/** A frame skipped at least one vsync when its interval is over 1.5 budgets. */
const SKIP_FACTOR = 1.5;

function buildIosFrames(raw: RawSession, ticks: Tick[], mounts: IntervalSet, js: IntervalSet): Frame[] {
  const frames: Frame[] = [];
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1];
    const cur = ticks[i];
    const budget = prev.budget > 0 ? prev.budget : cur.budget;
    if (!(budget > 0)) continue;
    const interval = cur.vsync - prev.vsync;
    const uiMissed = interval > SKIP_FACTOR * budget;
    // A display link callback that runs late keeps the timestamp of the vsync
    // it was scheduled for; the gap shows at the *next* timestamp. So the work
    // behind a missed frame was measured by the previous callback: a missed
    // frame reads main-thread busy time and mounts over both callbacks.
    const before = i >= 2 ? ticks[i - 2] : null;
    const mainBusy = (cur.mainBusy ?? 0) + (uiMissed ? prev.mainBusy ?? 0 : 0);
    const mountFrom = uiMissed && before ? before.callback : prev.callback;
    const mountTo = cur.callback;
    frames.push(
      finishFrame(raw.platform, {
        t: prev.vsync,
        interval,
        duration: interval,
        budget,
        uiMissed,
        js: js.overlap(prev.vsync, cur.vsync),
        mount: mounts.overlap(mountFrom, mountTo),
        mainBusy,
        render: uiMissed ? Math.max(0, interval - budget - mainBusy) : 0,
        uiDropped: Math.round(interval / budget) - 1,
      }),
    );
  }
  return frames;
}

function buildAndroidFrames(raw: RawSession, ticks: Tick[], mounts: IntervalSet, js: IntervalSet): Frame[] {
  const metrics = readMetrics(raw);
  const byTick: Array<Metric | undefined> = new Array(ticks.length);
  const unmatched: Metric[] = [];
  for (const metric of metrics) {
    const index = metric.vsync == null ? -1 : findTick(ticks, metric.vsync, 0.5);
    if (index > 0 && byTick[index] === undefined) byTick[index] = metric;
    else unmatched.push(metric);
  }

  const frames: Frame[] = [];
  // End of the UI thread's work for the previous tick: the start of the next window.
  let lastUiEnd = ticks.length > 0 ? ticks[0].callback : 0;
  // End of the latest frame already counted. A frame that was held up by the
  // previous frame's work is late only by what goes past that end, so one
  // long stall is not counted twice (once as the long frame, once as the
  // next vsync it delayed).
  let lastFrameEnd = -Infinity;
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1];
    const cur = ticks[i];
    const metric = byTick[i];
    // The refresh period decides skipped vsyncs and dropped frames. DEADLINE
    // (API 31+) only decides whether a drawn frame finished late: it can be
    // longer than one period when the pipeline is buffered.
    const budget = prev.budget > 0 ? prev.budget : cur.budget;
    if (!(budget > 0)) continue;
    const interval = cur.vsync - prev.vsync;
    const jsMs = js.overlap(prev.vsync, cur.vsync);
    const windowStart = lastUiEnd;
    if (metric) {
      const deadline = metric.deadline != null && metric.deadline > 0 ? metric.deadline : budget;
      const uiWork = metric.input + metric.animation + metric.layoutMeasure + metric.draw;
      const uiEnd = cur.vsync + uiWork;
      lastUiEnd = uiEnd;
      const start = metric.intendedVsync ?? cur.vsync;
      const end = start + metric.total;
      const own = end - Math.max(start + deadline, lastFrameEnd + budget);
      lastFrameEnd = Math.max(lastFrameEnd, end);
      frames.push(
        finishFrame(raw.platform, {
          t: prev.vsync,
          interval,
          duration: Math.max(metric.total, interval > SKIP_FACTOR * budget ? interval : 0),
          budget,
          uiMissed: own > 0,
          js: jsMs,
          mount: mounts.overlap(windowStart, uiEnd),
          mainBusy: metric.delay + uiWork,
          render: Math.max(metric.sync + metric.commandIssue + metric.swapBuffers, metric.gpu ?? 0),
          uiDropped: Math.ceil(own / budget - 1e-9),
          uiHitch: own,
          android: stagesOf(metric),
        }),
      );
      continue;
    }
    lastUiEnd = cur.callback;
    // Nothing was drawn for this vsync. It is a frame only when the UI thread
    // skipped vsyncs (it was busy) or the JS thread stalled.
    const own = cur.vsync - Math.max(prev.vsync + budget, lastFrameEnd + budget);
    const skipped = own > (SKIP_FACTOR - 1) * budget;
    const jsStalled = jsMs >= 0.5 * Math.min(interval, budget);
    if (skipped) lastFrameEnd = Math.max(lastFrameEnd, cur.vsync);
    if (!skipped && !jsStalled) continue;
    frames.push(
      finishFrame(raw.platform, {
        t: prev.vsync,
        interval,
        duration: interval,
        budget,
        uiMissed: skipped,
        js: jsMs,
        mount: mounts.overlap(windowStart, cur.callback),
        mainBusy: skipped ? own : Math.max(0, cur.callback - cur.vsync),
        render: 0,
        uiDropped: Math.ceil(own / budget - 1e-9),
        uiHitch: own,
      }),
    );
  }

  // Frames that no tick matched (before the first tick, or API 24-25 without
  // vsync timestamps). Their window is estimated from the metric alone.
  const fallbackBudget = nominalBudgetMs(raw);
  for (const metric of unmatched) {
    const budget = fallbackBudget;
    const deadline = metric.deadline != null && metric.deadline > 0 ? metric.deadline : budget;
    const start = metric.intendedVsync ?? metric.receivedAt - metric.total;
    const late = metric.vsync != null && metric.intendedVsync != null ? metric.vsync - metric.intendedVsync : 0;
    const uiWork = metric.input + metric.animation + metric.layoutMeasure + metric.draw;
    const interval = budget + Math.max(0, late);
    const skipped = interval > SKIP_FACTOR * budget;
    const lateFinish = metric.total - deadline;
    frames.push(
      finishFrame(raw.platform, {
        t: start,
        interval,
        duration: Math.max(metric.total, skipped ? interval : 0),
        budget,
        uiMissed: skipped || lateFinish > 0,
        js: js.overlap(start - budget, start),
        mount: mounts.overlap(start, start + metric.delay + uiWork),
        mainBusy: metric.delay + uiWork,
        render: Math.max(metric.sync + metric.commandIssue + metric.swapBuffers, metric.gpu ?? 0),
        uiDropped: Math.max(Math.round(interval / budget) - 1, Math.ceil(lateFinish / budget - 1e-9)),
        uiHitch: Math.max(skipped ? interval - budget : 0, lateFinish),
        android: stagesOf(metric),
      }),
    );
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

/** Turn a native session into attributed frames, oldest first. */
export function buildFrames(raw: RawSession): Frame[] {
  const ticks = readTicks(raw);
  const mounts = new IntervalSet(raw.mounts.map(ms));
  // A JS task shorter than one refresh period delays nothing visible, so the
  // first period of every busy window is not counted.
  const js = new IntervalSet(raw.jsBusy.map(ms)).trimStarts(nominalBudgetMs(raw));
  return raw.platform === 'ios' ? buildIosFrames(raw, ticks, mounts, js) : buildAndroidFrames(raw, ticks, mounts, js);
}
