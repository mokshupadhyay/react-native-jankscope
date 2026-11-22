import { buildReport, isFrozen, isSlow, percentile, segmentFrames, slowThresholdMs, summarize } from '../report';
import type { Frame, JankCause } from '../types';
import { rawSession, steadyTicks, ticks, us } from './fixtures';

const B = 1000 / 60;

export function frame(overrides: Partial<Frame> = {}): Frame {
  const budget = overrides.budget ?? B;
  return {
    t: 0,
    interval: budget,
    duration: budget,
    budget,
    uiMissed: false,
    jsStalled: false,
    janky: false,
    dropped: 0,
    hitch: 0,
    cause: null,
    stages: { js: 0, mount: 0, uiOther: 0, render: 0 },
    ...overrides,
  };
}

const janky = (cause: JankCause, hitch: number, extra: Partial<Frame> = {}) =>
  frame({ uiMissed: true, janky: true, cause, hitch, dropped: 1, duration: B + hitch, interval: B + hitch, ...extra });

const context = {
  label: 'test',
  marks: [],
  startedAt: '2026-11-22T10:00:00.000Z',
  jsDev: false,
  jsNewArch: true,
  heartbeat: { intervalMs: 16, costMs: 5 },
  overlay: { costMs: 0, updates: 0 },
};

describe('summarize', () => {
  it('computes janky %, dropped frames and the hitch time ratio', () => {
    const frames = [frame(), frame(), frame(), janky('js', 50), janky('ui-other', 150, { dropped: 9 })];
    const s = summarize(frames, 2000, 60);
    expect(s.frameCount).toBe(5);
    expect(s.jankyFrames).toBe(2);
    expect(s.jankyPct).toBeCloseTo(40);
    expect(s.droppedFrames).toBe(10);
    expect(s.hitchTimeMs).toBeCloseTo(200);
    expect(s.hitchRatio).toBeCloseTo(100); // 200 ms over 2 s
    expect(s.primaryCause).toBe('ui-other');
  });

  it('totals counts, dropped frames and hitch time per cause', () => {
    const frames = [janky('js', 10), janky('js', 20), janky('ui-mount', 5), janky('render-gpu', 1)];
    const { causes } = summarize(frames, 1000, 60);
    expect(causes.js).toEqual({ count: 2, dropped: 2, hitchMs: 30 });
    expect(causes['ui-mount']).toEqual({ count: 1, dropped: 1, hitchMs: 5 });
    expect(causes['render-gpu'].count).toBe(1);
    expect(causes['ui-other'].count).toBe(0);
    expect(causes.unknown.count).toBe(0);
  });

  it('returns zeros for no frames', () => {
    const s = summarize([], 0, 60);
    expect(s.jankyPct).toBe(0);
    expect(s.hitchRatio).toBe(0);
    expect(s.p95FrameMs).toBe(0);
    expect(s.primaryCause).toBeNull();
  });

  it('reports the nearest-rank percentiles of frame durations', () => {
    const durations = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(durations, 50)).toBe(50);
    expect(percentile(durations, 95)).toBe(95);
    expect(percentile(durations, 99)).toBe(99);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe('slow and frozen frames', () => {
  it('scales the 16 ms slow threshold with the refresh rate', () => {
    expect(slowThresholdMs(1000 / 60)).toBeCloseTo(16);
    expect(slowThresholdMs(1000 / 120)).toBeCloseTo(8);
    expect(slowThresholdMs(1000 / 90)).toBeCloseTo(10.667, 2);
  });

  it('counts an Android frame by TOTAL_DURATION against the scaled threshold', () => {
    const android = (budget: number, total: number) =>
      frame({ budget, android: { delay: 0, input: 0, animation: 0, layoutMeasure: 0, draw: 0, sync: 0, commandIssue: 0, swapBuffers: 0, gpu: null, total, deadline: null } });
    expect(isSlow(android(1000 / 60, 10))).toBe(false);
    expect(isSlow(android(1000 / 120, 10))).toBe(true);
    expect(isSlow(android(1000 / 60, 16.5))).toBe(true);
  });

  it('never counts an on-time iOS frame as slow, and counts a missed one', () => {
    expect(isSlow(frame({ duration: B }))).toBe(false);
    expect(isSlow(janky('ui-other', 20))).toBe(true);
  });

  it('counts frames over 700 ms as frozen', () => {
    expect(isFrozen(janky('ui-other', 700 - B))).toBe(false);
    expect(isFrozen(janky('ui-other', 701))).toBe(true);
    const s = summarize([janky('ui-other', 800), janky('js', 20), frame()], 3000, 60);
    expect(s.frozenFrames).toBe(1);
    expect(s.slowFrames).toBe(2);
  });
});

describe('segmentFrames', () => {
  it('splits frames at marks and keeps a (start) segment for frames before the first mark', () => {
    const frames = [frame({ t: 0 }), janky('js', 10, { t: 100 }), janky('ui-mount', 30, { t: 600 }), frame({ t: 900 })];
    const segments = segmentFrames(frames, [{ name: 'a', t: 50 }, { name: 'b', t: 500 }], 1000, 60);
    expect(segments.map((s) => s.name)).toEqual(['(start)', 'a', 'b']);
    expect(segments.map((s) => s.frameCount)).toEqual([1, 1, 2]);
    expect(segments[1].primaryCause).toBe('js');
    expect(segments[2].primaryCause).toBe('ui-mount');
    expect(segments[2].durationMs).toBe(500);
  });

  it('has one (start) segment without marks', () => {
    const segments = segmentFrames([frame()], [], 1000, 60);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBe('(start)');
  });
});

describe('buildReport', () => {
  const raw = rawSession({ ticks: ticks(steadyTicks(0, 61)), jsBusy: [us(100), us(400)], stopMs: 2000 });

  it('reports device, build type, architecture and the summary', () => {
    const report = buildReport(raw, context);
    expect(report.version).toBe(1);
    expect(report.buildType).toBe('release');
    expect(report.architecture).toBe('new');
    expect(report.summary.frameCount).toBe(60);
    expect(report.summary.primaryCause).toBe('js');
    expect(report.worstFrames.length).toBeLessThanOrEqual(20);
    expect(report.worstFrames.every((f) => f.janky)).toBe(true);
    expect(report.overhead.heartbeatJsMsPerSecond).toBeCloseTo(5);
  });

  it('is a debug build when either side says so', () => {
    expect(buildReport({ ...raw, debug: true }, context).buildType).toBe('debug');
    expect(buildReport(raw, { ...context, jsDev: true }).buildType).toBe('debug');
    expect(buildReport({ ...raw, newArch: false }, { ...context, jsNewArch: false }).architecture).toBe('old');
  });

  it('truncates the raw frames and says so', () => {
    const report = buildReport(raw, { ...context, maxReportFrames: 10 });
    expect(report.frames).toHaveLength(10);
    expect(report.framesTruncated).toBe(true);
    expect(report.summary.frameCount).toBe(60);
  });

  it('keeps the worst 20 frames sorted by hitch time', () => {
    const list = steadyTicks(0, 30);
    for (let i = 0; i < 25; i++) list.push({ vsync: list[list.length - 1].vsync + B + 20 + i * 3, mainBusy: 30 + i * 3 });
    const report = buildReport(rawSession({ ticks: ticks(list) }), context);
    expect(report.worstFrames).toHaveLength(20);
    for (let i = 1; i < 20; i++) expect(report.worstFrames[i - 1].hitch).toBeGreaterThanOrEqual(report.worstFrames[i].hitch);
  });
});
