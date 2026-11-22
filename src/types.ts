/** The stage a missed frame is blamed on. See README, "How attribution works". */
export type JankCause = 'js' | 'ui-mount' | 'ui-other' | 'render-gpu' | 'unknown';

export const JANK_CAUSES: readonly JankCause[] = ['js', 'ui-mount', 'ui-other', 'render-gpu', 'unknown'];

export type JankscopePlatform = 'android' | 'ios';

/** Android FrameMetrics durations of one drawn frame, in milliseconds. */
export interface AndroidFrameStages {
  /** UNKNOWN_DELAY_DURATION: the UI thread was busy (or idle) before it started the frame. */
  delay: number;
  input: number;
  animation: number;
  layoutMeasure: number;
  draw: number;
  sync: number;
  commandIssue: number;
  swapBuffers: number;
  /** GPU_DURATION, API 31+; `null` below. */
  gpu: number | null;
  /** TOTAL_DURATION. */
  total: number;
  /** DEADLINE, API 31+; `null` below. */
  deadline: number | null;
}

/** Per-stage time of one frame, in milliseconds. */
export interface FrameStages {
  /** JS thread busy inside the frame's window, not counting the first frame budget of each busy window. */
  js: number;
  /** React Native mount work on the UI/main thread inside the frame's window. */
  mount: number;
  /** Other UI/main-thread work: main-thread busy time minus `mount`. */
  uiOther: number;
  /**
   * Android: max(SYNC + COMMAND_ISSUE + SWAP_BUFFERS, GPU_DURATION).
   * iOS: the part of a missed frame's lateness that main-thread work does not explain (unattributed).
   */
  render: number;
}

export interface Frame {
  /** Start of the frame's window, ms since the session started. */
  t: number;
  /** Time between this frame's vsync and the previous one, ms. */
  interval: number;
  /**
   * Android: TOTAL_DURATION of a drawn frame, or the vsync interval when the UI thread skipped vsyncs.
   * iOS: the CADisplayLink interval. Not comparable across platforms.
   */
  duration: number;
  /** One refresh period, ms. (Android 12+ judges a drawn frame against its DEADLINE, kept in `android.deadline`.) */
  budget: number;
  /** The UI side missed the deadline. */
  uiMissed: boolean;
  /** The UI was on time but the JS thread was busy for most of the frame. */
  jsStalled: boolean;
  janky: boolean;
  /** Refresh periods lost to this frame. */
  dropped: number;
  /** How late the frame was, ms (for JS stalls: JS busy time inside the frame). */
  hitch: number;
  cause: JankCause | null;
  stages: FrameStages;
  /** Android only: the FrameMetrics record, when the frame was drawn. */
  android?: AndroidFrameStages;
}

export interface CauseTotals {
  count: number;
  dropped: number;
  hitchMs: number;
}

export type CauseBreakdown = Record<JankCause, CauseTotals>;

export interface FrameMetricsSummary {
  frameCount: number;
  jankyFrames: number;
  droppedFrames: number;
  /** Janky frames / frames × 100, in [0, 100]. */
  jankyPct: number;
  hitchTimeMs: number;
  /** Hitch time per second of frames (ms/s), Apple's hitch time ratio. */
  hitchRatio: number;
  /** Frames slower than 16 ms at 60 Hz, scaled by the refresh rate. */
  slowFrames: number;
  /** Frames slower than 700 ms. */
  frozenFrames: number;
  slowThresholdMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  durationMs: number;
  causes: CauseBreakdown;
  /** The cause with the most hitch time, or `null` without janky frames. */
  primaryCause: JankCause | null;
}

export interface Segment extends FrameMetricsSummary {
  name: string;
  startMs: number;
  endMs: number;
}

export interface DeviceInfo {
  model: string;
  manufacturer: string;
  os: JankscopePlatform;
  osVersion: string;
  /** Highest refresh rate the display supports, Hz. */
  refreshRate: number;
}

export interface OverheadInfo {
  /** UI/main-thread time spent inside jankscope callbacks per frame, ms (wall clock, upper bound of CPU time). */
  uiMsPerFrame: number | null;
  /** Android: time per frame in the FrameMetrics listener on its background thread, ms. */
  backgroundMsPerFrame: number | null;
  /** JS thread time inside the heartbeat, ms per second of session. */
  heartbeatJsMsPerSecond: number;
  heartbeatIntervalMs: number;
  /** Median and 95th percentile of how late heartbeat ticks ran, ms. */
  heartbeatLatenessP50Ms: number;
  heartbeatLatenessP95Ms: number;
  /** Idle timer lateness subtracted from every heartbeat tick when the session stopped, ms. */
  heartbeatBaselineMs: number;
  /** JS time per `<JankscopeOverlay />` update, ms; `null` when no overlay ran. */
  overlayJsMsPerUpdate: number | null;
  overlayUpdates: number;
}

export interface Report {
  version: 1;
  label: string | null;
  platform: JankscopePlatform;
  device: DeviceInfo;
  buildType: 'debug' | 'release';
  architecture: 'new' | 'old';
  startedAt: string;
  summary: FrameMetricsSummary;
  worstFrames: Frame[];
  segments: Segment[];
  frames: Frame[];
  framesTruncated: boolean;
  overhead: OverheadInfo;
  /** Records the native ring buffers overwrote because `maxFrames` was reached. */
  lost: { ticks: number; metrics: number; mounts: number; jsBusy: number };
  /** The native session, with `stop({ includeRaw: true })`. Layout: src/raw.ts. */
  raw?: unknown;
}

export interface StartOptions {
  label?: string;
  /** Capacity of the native frame buffers. Default 20000 (about 5.5 minutes at 60 Hz). */
  maxFrames?: number;
  /** Heartbeat interval on the JS thread, ms. Default 16. */
  heartbeatIntervalMs?: number;
}

export interface StopOptions {
  /** Most frames kept in `report.frames`. Default 10000. */
  maxReportFrames?: number;
  /** Keep the native session (ticks, FrameMetrics records, mount and JS-busy windows) in `report.raw`. Default false. */
  includeRaw?: boolean;
}
