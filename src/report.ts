import { buildFrames, type RawSession } from './raw';
import {
  JANK_CAUSES,
  type CauseBreakdown,
  type Frame,
  type FrameMetricsSummary,
  type JankCause,
  type OverheadInfo,
  type Report,
  type Segment,
} from './types';

/** Android vitals: a frame over 16 ms at 60 Hz is slow, one over 700 ms is frozen. */
export const SLOW_FRAME_MS_AT_60HZ = 16;
export const FROZEN_FRAME_MS = 700;
const PERIOD_60HZ = 1000 / 60;

export function emptyCauses(): CauseBreakdown {
  const causes = {} as CauseBreakdown;
  for (const cause of JANK_CAUSES) causes[cause] = { count: 0, dropped: 0, hitchMs: 0 };
  return causes;
}

/** Slow-frame threshold for a frame budget: 16 ms at 60 Hz, scaled to the refresh period. */
export function slowThresholdMs(budget: number): number {
  return SLOW_FRAME_MS_AT_60HZ * (budget / PERIOD_60HZ);
}

/**
 * Slow: a frame that missed the UI deadline by more than the slow threshold,
 * or an Android frame whose TOTAL_DURATION exceeded it (Android vitals' rule).
 * iOS reports no render duration, so an on-time iOS frame is never slow.
 */
export function isSlow(frame: Frame): boolean {
  const threshold = slowThresholdMs(frame.budget);
  if (frame.uiMissed) return frame.duration > threshold;
  return frame.android != null && frame.android.total > threshold;
}

export function isFrozen(frame: Frame): boolean {
  return frame.duration > FROZEN_FRAME_MS;
}

/** Nearest-rank percentile of `values` (0 for an empty list). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export function primaryCauseOf(causes: CauseBreakdown): JankCause | null {
  let best: JankCause | null = null;
  for (const cause of JANK_CAUSES) {
    const entry = causes[cause];
    if (entry.count === 0) continue;
    if (best === null || entry.hitchMs > causes[best].hitchMs) best = cause;
  }
  return best;
}

const round = (value: number, digits = 3): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/**
 * Aggregate frames. `durationMs` is the wall time the frames cover, used for the
 * hitch time ratio; `refreshRate` only sets the reported `slowThresholdMs`.
 */
export function summarize(frames: Frame[], durationMs: number, refreshRate: number): FrameMetricsSummary {
  const causes = emptyCauses();
  let jankyFrames = 0;
  let droppedFrames = 0;
  let hitchTimeMs = 0;
  let slowFrames = 0;
  let frozenFrames = 0;
  const durations: number[] = [];
  for (const frame of frames) {
    durations.push(frame.duration);
    if (isSlow(frame)) slowFrames++;
    if (isFrozen(frame)) frozenFrames++;
    if (!frame.janky) continue;
    jankyFrames++;
    droppedFrames += frame.dropped;
    hitchTimeMs += frame.hitch;
    const entry = causes[frame.cause ?? 'unknown'];
    entry.count++;
    entry.dropped += frame.dropped;
    entry.hitchMs += frame.hitch;
  }
  const seconds = durationMs / 1000;
  return {
    frameCount: frames.length,
    jankyFrames,
    droppedFrames,
    jankyPct: frames.length > 0 ? (jankyFrames / frames.length) * 100 : 0,
    hitchTimeMs,
    hitchRatio: seconds > 0 ? hitchTimeMs / seconds : 0,
    slowFrames,
    frozenFrames,
    slowThresholdMs: slowThresholdMs(refreshRate > 0 ? 1000 / refreshRate : PERIOD_60HZ),
    p50FrameMs: percentile(durations, 50),
    p95FrameMs: percentile(durations, 95),
    p99FrameMs: percentile(durations, 99),
    durationMs,
    causes,
    primaryCause: primaryCauseOf(causes),
  };
}

export interface Mark {
  name: string;
  /** ms since the session started. */
  t: number;
}

/** Split frames at marks. Frames before the first mark form a `(start)` segment when there are any. */
export function segmentFrames(frames: Frame[], marks: Mark[], endMs: number, refreshRate: number): Segment[] {
  const sorted = marks.slice().sort((a, b) => a.t - b.t);
  const bounds: Array<{ name: string; start: number; end: number }> = [];
  const firstMark = sorted.length > 0 ? sorted[0].t : endMs;
  if (frames.some((frame) => frame.t < firstMark) || sorted.length === 0) {
    bounds.push({ name: '(start)', start: 0, end: firstMark });
  }
  sorted.forEach((mark, i) => {
    bounds.push({ name: mark.name, start: mark.t, end: i + 1 < sorted.length ? sorted[i + 1].t : endMs });
  });
  return bounds.map((bound) => {
    const inside = frames.filter((frame) => frame.t >= bound.start && frame.t < bound.end);
    return {
      name: bound.name,
      startMs: bound.start,
      endMs: bound.end,
      ...summarize(inside, Math.max(0, bound.end - bound.start), refreshRate),
    };
  });
}

export function worstFrames(frames: Frame[], count = 20): Frame[] {
  return frames
    .filter((frame) => frame.janky)
    .sort((a, b) => b.hitch - a.hitch || b.duration - a.duration || a.t - b.t)
    .slice(0, count);
}

function roundFrame(frame: Frame): Frame {
  const out: Frame = {
    ...frame,
    t: round(frame.t),
    interval: round(frame.interval),
    duration: round(frame.duration),
    budget: round(frame.budget),
    hitch: round(frame.hitch),
    stages: {
      js: round(frame.stages.js),
      mount: round(frame.stages.mount),
      uiOther: round(frame.stages.uiOther),
      render: round(frame.stages.render),
    },
  };
  return out;
}

export interface ReportContext {
  label: string | null;
  marks: Mark[];
  startedAt: string;
  jsDev: boolean;
  /** Fabric/bridgeless runtime as seen from JavaScript. */
  jsNewArch: boolean;
  heartbeat: { intervalMs: number; costMs: number; latenessMs?: number[]; baselineMs?: number };
  overlay: { costMs: number; updates: number };
  maxReportFrames?: number;
  includeRaw?: boolean;
}

function overheadOf(raw: RawSession, context: ReportContext, durationMs: number): OverheadInfo {
  const ticks = Math.max(1, Math.floor(raw.ticks.length / 5));
  return {
    uiMsPerFrame: raw.cost.uiCalls > 0 ? round(raw.cost.uiNs / 1e6 / ticks, 4) : null,
    backgroundMsPerFrame: raw.cost.bgCalls > 0 ? round(raw.cost.bgNs / 1e6 / raw.cost.bgCalls, 4) : null,
    heartbeatJsMsPerSecond: durationMs > 0 ? round(context.heartbeat.costMs / (durationMs / 1000), 4) : 0,
    heartbeatIntervalMs: context.heartbeat.intervalMs,
    heartbeatLatenessP50Ms: round(percentile(context.heartbeat.latenessMs ?? [], 50)),
    heartbeatLatenessP95Ms: round(percentile(context.heartbeat.latenessMs ?? [], 95)),
    heartbeatBaselineMs: round(context.heartbeat.baselineMs ?? 0),
    overlayJsMsPerUpdate:
      context.overlay.updates > 0 ? round(context.overlay.costMs / context.overlay.updates, 4) : null,
    overlayUpdates: context.overlay.updates,
  };
}

/** Build the session report from the native session and the JavaScript side's context. */
export function buildReport(raw: RawSession, context: ReportContext): Report {
  const frames = buildFrames(raw);
  const durationMs = Math.max(0, raw.stopMs - raw.startMs);
  const refreshRate = raw.refresh.length >= 2 ? raw.refresh[1] : raw.device.refreshRate;
  const maxFrames = context.maxReportFrames ?? 10000;
  const rounded = frames.map(roundFrame);
  return {
    version: 1,
    label: context.label,
    platform: raw.platform,
    device: raw.device,
    buildType: raw.debug || context.jsDev ? 'debug' : 'release',
    architecture: raw.newArch || context.jsNewArch ? 'new' : 'old',
    startedAt: context.startedAt,
    summary: summarize(frames, durationMs, refreshRate),
    worstFrames: worstFrames(rounded),
    segments: segmentFrames(frames, context.marks, durationMs, refreshRate),
    frames: rounded.length > maxFrames ? rounded.slice(0, maxFrames) : rounded,
    framesTruncated: rounded.length > maxFrames,
    overhead: overheadOf(raw, context, durationMs),
    lost: raw.lost,
    ...(context.includeRaw ? { raw } : {}),
  };
}
