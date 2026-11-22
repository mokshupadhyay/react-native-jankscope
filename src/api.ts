import { Heartbeat } from './heartbeat';
import { getNativeModule, isFabricRuntime } from './native';
import { buildFrames, type RawSession } from './raw';
import { buildReport, type Mark } from './report';
import type { Spec } from './specs/NativeJankscope';
import type { Frame, JankCause, Report, StartOptions, StopOptions } from './types';

export type JankscopeErrorCode = 'NOT_LINKED' | 'ALREADY_RUNNING' | 'NOT_RUNNING' | 'INVALID_FILE_NAME';

export class JankscopeError extends Error {
  readonly code: JankscopeErrorCode;

  constructor(code: JankscopeErrorCode, message: string) {
    super(message);
    this.name = 'JankscopeError';
    this.code = code;
    Object.setPrototypeOf(this, JankscopeError.prototype);
  }
}

export const DEFAULT_MAX_FRAMES = 20000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 16;

function jsNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/**
 * Offset from the JS clock to the native clock: `native = js + offset`. The
 * sample with the shortest round trip wins.
 */
export function measureClockOffset(native: Pick<Spec, 'nowMs'>, now: () => number = jsNow, samples = 7): number {
  let bestRoundTrip = Infinity;
  let offset = 0;
  for (let i = 0; i < samples; i++) {
    const before = now();
    const nativeNow = native.nowMs();
    const after = now();
    if (after - before < bestRoundTrip) {
      bestRoundTrip = after - before;
      offset = nativeNow - (before + after) / 2;
    }
  }
  return offset;
}

interface StartInfo {
  startMs: number;
}

interface Session {
  native: Spec;
  label: string | null;
  startedAt: string;
  startMs: number;
  offset: number;
  marks: Mark[];
  heartbeat: Heartbeat;
  heartbeatIntervalMs: number;
  /** Recent JS-busy windows in the native clock, for the live overlay. */
  recentJsBusy: number[];
  live: LiveState;
}

interface LiveState {
  lastTick: number[] | null;
  lastPeekAt: number;
  frames: number;
  janky: number;
  lastCause: JankCause | null;
}

export interface LiveStats {
  running: boolean;
  /** Frames shown per second since the previous call. */
  fps: number;
  /** Janky frames / frames × 100 since `start()`. */
  jankyPct: number;
  lastCause: JankCause | null;
}

let session: Session | null = null;
const overlayCost = { costMs: 0, updates: 0 };

function requireNative(): Spec {
  const native = getNativeModule();
  if (!native) {
    throw new JankscopeError(
      'NOT_LINKED',
      'The jankscope native module is not linked. Rebuild the app after installing react-native-jankscope.',
    );
  }
  return native;
}

function toFileName(report: Report, fileName?: string): string {
  if (fileName !== undefined) {
    if (!/^[A-Za-z0-9._-]{1,120}\.json$/.test(fileName) || fileName.startsWith('.')) {
      throw new JankscopeError(
        'INVALID_FILE_NAME',
        'fileName must be 1-120 letters, digits, ".", "_" or "-", end in ".json" and not start with ".".',
      );
    }
    return fileName;
  }
  const label = (report.label ?? 'session').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'session';
  const stamp = report.startedAt.replace(/[^0-9]/g, '').slice(0, 14);
  return `jankscope-${label}-${report.platform}-${stamp}.json`;
}

/** Record frames, attribute every missed frame, and report. */
export const Jankscope = {
  /** Start a session. Rejects with `ALREADY_RUNNING` while one is running. */
  async start(options: StartOptions = {}): Promise<void> {
    if (session) throw new JankscopeError('ALREADY_RUNNING', 'A jankscope session is already running.');
    const native = requireNative();
    const maxFrames = Math.max(100, Math.floor(options.maxFrames ?? DEFAULT_MAX_FRAMES));
    const heartbeatIntervalMs = Math.max(1, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
    const info = JSON.parse(await native.start(maxFrames)) as StartInfo;
    const offset = measureClockOffset(native);
    const recentJsBusy: number[] = [];
    const heartbeat = new Heartbeat({
      intervalMs: heartbeatIntervalMs,
      now: jsNow,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      flush: (windows) => {
        const shifted = windows.map((t) => t + offset);
        native.reportJsBusy(shifted);
        recentJsBusy.push(...shifted);
        // Keep about 5 seconds for the overlay.
        const horizon = shifted[shifted.length - 1] - 5000;
        let drop = 0;
        while (drop + 1 < recentJsBusy.length && recentJsBusy[drop + 1] < horizon) drop += 2;
        if (drop > 0) recentJsBusy.splice(0, drop);
      },
    });
    session = {
      native,
      label: options.label ?? null,
      startedAt: new Date().toISOString(),
      startMs: info.startMs,
      offset,
      marks: [],
      heartbeat,
      heartbeatIntervalMs,
      recentJsBusy,
      live: { lastTick: null, lastPeekAt: jsNow(), frames: 0, janky: 0, lastCause: null },
    };
    overlayCost.costMs = 0;
    overlayCost.updates = 0;
    heartbeat.start();
  },

  /** Start a named segment (scenario boundary). Ignored when no session is running. */
  mark(name: string): void {
    if (!session) return;
    session.marks.push({ name: String(name), t: jsNow() + session.offset - session.startMs });
  },

  isRunning(): boolean {
    return session !== null;
  },

  /** Stop the session and build its report. */
  async stop(options: StopOptions = {}): Promise<Report> {
    const current = session;
    if (!current) throw new JankscopeError('NOT_RUNNING', 'No jankscope session is running.');
    session = null;
    current.heartbeat.stop();
    const raw = JSON.parse(await current.native.stop()) as RawSession;
    return buildReport(raw, {
      label: current.label,
      marks: current.marks,
      startedAt: current.startedAt,
      jsDev: typeof __DEV__ !== 'undefined' && __DEV__,
      jsNewArch: isFabricRuntime(),
      heartbeat: {
        intervalMs: current.heartbeatIntervalMs,
        costMs: current.heartbeat.costMs,
        latenessMs: current.heartbeat.lateness.slice(),
        baselineMs: current.heartbeat.baseline,
      },
      overlay: { ...overlayCost },
      maxReportFrames: options.maxReportFrames,
      includeRaw: options.includeRaw,
    });
  },

  /**
   * Write the report as JSON to the app's storage (Android: external files
   * dir, falling back to the internal files dir; iOS: Documents), both under
   * `jankscope/`. The native side logs one line with the path. Resolves the path.
   */
  async saveReport(report: Report, fileName?: string): Promise<string> {
    const native = requireNative();
    return native.writeReport(toFileName(report, fileName), JSON.stringify(report));
  },

  /** Live numbers for the overlay. Frames are attributed with the same rules as the report. */
  async live(): Promise<LiveStats> {
    const current = session;
    if (!current) return { running: false, fps: 0, jankyPct: 0, lastCause: null };
    const raw = JSON.parse(await current.native.peek()) as RawSession;
    if (session !== current) return { running: false, fps: 0, jankyPct: 0, lastCause: null };
    const started = jsNow();
    const live = current.live;
    const newTicks = raw.ticks.length / 5;
    // Carry the last tick over so the first new tick has a previous one.
    if (live.lastTick) raw.ticks = live.lastTick.concat(raw.ticks);
    if (raw.ticks.length >= 5) live.lastTick = raw.ticks.slice(raw.ticks.length - 5);
    const unflushed = current.heartbeat.unflushed.map((t) => t + current.offset);
    raw.jsBusy = current.recentJsBusy.concat(unflushed).map((t) => (t - current.startMs) * 1000);
    const frames: Frame[] = buildFrames(raw);
    let lastCause: JankCause | null = null;
    for (const frame of frames) {
      live.frames++;
      if (frame.janky) {
        live.janky++;
        lastCause = frame.cause;
      }
    }
    if (lastCause) live.lastCause = lastCause;
    const seconds = Math.max(0.001, (started - live.lastPeekAt) / 1000);
    live.lastPeekAt = started;
    const shown = raw.platform === 'android' ? raw.metrics.length / 14 : newTicks;
    const stats: LiveStats = {
      running: true,
      fps: shown / seconds,
      jankyPct: live.frames > 0 ? (live.janky / live.frames) * 100 : 0,
      lastCause: live.lastCause,
    };
    overlayCost.costMs += jsNow() - started;
    return stats;
  },
};

/** Called by the overlay after it rendered an update, to count updates and their JS time. */
export function recordOverlayUpdate(ms: number): void {
  overlayCost.costMs += ms;
  overlayCost.updates++;
}

/** Test hook. */
export function resetJankscopeForTests(): void {
  session = null;
  overlayCost.costMs = 0;
  overlayCost.updates = 0;
}
