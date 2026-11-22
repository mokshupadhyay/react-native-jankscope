export interface HeartbeatOptions {
  intervalMs: number;
  /** Lateness beyond the baseline below this is timer jitter, not a busy JS thread. */
  minLatenessMs?: number;
  /** How often collected windows are handed to `flush`. */
  flushEveryMs?: number;
  /**
   * Samples above `baseline + outlierMs` are treated as busy and kept out of
   * the baseline. Default 33 (two 60 Hz frames).
   */
  outlierMs?: number;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Receives `[start, end, start, end, ...]` in the `now()` clock. */
  flush: (windows: number[]) => void;
}

const BASELINE_SAMPLES = 128;
const BASELINE_MIN_SAMPLES = 16;
const BASELINE_PERCENTILE = 0.25;
const BASELINE_REFRESH = 16;

/**
 * A timer loop on the JS thread that finds windows when the JS thread was busy.
 *
 * A timer never runs exactly on time: React Native dispatches timers from
 * frame callbacks, so even an idle JS thread sees a steady lateness (about 20
 * to 40 ms measured on an Android emulator). That idle lateness, the
 * baseline, is the 25th percentile of the recent samples that were not
 * outliers (the smallest sample during the first 16 ticks). A tick that runs later than due + baseline means the JS thread was
 * busy from (at the latest) due + baseline until the tick ran; that window is
 * recorded. The window start is an estimate, and windows shorter than the
 * timer jitter are lost. Windows are sent in batches, never once per frame.
 */
export class Heartbeat {
  private readonly options: Required<Omit<HeartbeatOptions, 'flush' | 'now' | 'setTimer' | 'clearTimer'>> &
    HeartbeatOptions;
  private handle: unknown = null;
  private due = 0;
  private lastFlush = 0;
  private pending: number[] = [];
  private running = false;
  private readonly samples: number[] = [];
  private sampleIndex = 0;
  private baselineMs = 0;
  private sinceBaseline = 0;
  /** Time spent inside ticks, ms. */
  costMs = 0;
  ticks = 0;
  /** Lateness of each tick, ms (the first 20000). */
  readonly lateness: number[] = [];

  constructor(options: HeartbeatOptions) {
    this.options = { minLatenessMs: 4, flushEveryMs: 1000, outlierMs: 33, ...options };
  }

  /** The current idle lateness, ms. */
  get baseline(): number {
    return this.baselineMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.options.now();
    this.lastFlush = now;
    this.schedule(now);
  }

  /** Stop and flush what is left. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.handle !== null) this.options.clearTimer(this.handle);
    this.handle = null;
    this.flushPending();
  }

  /** Windows not yet flushed (for the live overlay). */
  get unflushed(): readonly number[] {
    return this.pending;
  }

  private schedule(from: number): void {
    this.due = from + this.options.intervalMs;
    this.handle = this.options.setTimer(this.tick, this.options.intervalMs);
  }

  private addSample(late: number): void {
    const warm = this.samples.length >= BASELINE_MIN_SAMPLES;
    if (warm && late > this.baselineMs + this.options.outlierMs) return;
    if (this.samples.length < BASELINE_SAMPLES) this.samples.push(late);
    else this.samples[this.sampleIndex++ % BASELINE_SAMPLES] = late;
    this.sinceBaseline++;
    if (this.samples.length >= BASELINE_MIN_SAMPLES) {
      // Sorting is the costliest part of a tick, so the baseline is refreshed every 16 samples.
      if (this.sinceBaseline < BASELINE_REFRESH && this.samples.length > BASELINE_MIN_SAMPLES) return;
      this.sinceBaseline = 0;
      const sorted = this.samples.slice().sort((a, b) => a - b);
      this.baselineMs = sorted[Math.floor(BASELINE_PERCENTILE * (sorted.length - 1))];
    } else {
      // Until there are enough samples, the smallest lateness seen so far.
      this.baselineMs = Math.min(...this.samples);
    }
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    const now = this.options.now();
    const late = Math.max(0, now - this.due);
    if (this.lateness.length < 20000) this.lateness.push(late);
    const start = this.due + this.baselineMs;
    if (now - start > this.options.minLatenessMs) this.pending.push(start, now);
    this.addSample(late);
    this.ticks++;
    if (now - this.lastFlush >= this.options.flushEveryMs) {
      this.lastFlush = now;
      this.flushPending();
    }
    this.schedule(now);
    this.costMs += this.options.now() - now;
  };

  private flushPending(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.options.flush(batch);
  }
}
