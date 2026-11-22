import fc from 'fast-check';
import { compareValues, relativeChange } from '../cli/compare';
import { buildFrames } from '../raw';
import { summarize } from '../report';
import { JANK_CAUSES, type Frame } from '../types';
import { metrics, rawSession, ticks, us } from './fixtures';

/**
 * Property tests. docs/MUTATION_EVIDENCE.md records that each property fails
 * when the code it guards is broken (scripts/mutation-check.mjs).
 */

const B = 1000 / 60;
const causeArb = fc.constantFrom(...JANK_CAUSES);

const frameArb: fc.Arbitrary<Frame> = fc
  .record({
    t: fc.double({ min: 0, max: 60000, noNaN: true }),
    janky: fc.boolean(),
    hitch: fc.double({ min: 0, max: 2000, noNaN: true }),
    dropped: fc.integer({ min: 0, max: 120 }),
    cause: causeArb,
    budget: fc.constantFrom(1000 / 60, 1000 / 90, 1000 / 120),
    duration: fc.double({ min: 0, max: 2000, noNaN: true }),
  })
  .map((r) => ({
    t: r.t,
    interval: r.duration,
    duration: r.duration,
    budget: r.budget,
    uiMissed: r.janky,
    jsStalled: false,
    janky: r.janky,
    dropped: r.janky ? Math.max(1, r.dropped) : 0,
    hitch: r.janky ? r.hitch : 0,
    cause: r.janky ? r.cause : null,
    stages: { js: 0, mount: 0, uiOther: 0, render: 0 },
  }));

/** A synthetic native session: vsync gaps, main-thread busy time, mounts and JS-busy windows. */
const rawArb = fc
  .record({
    platform: fc.constantFrom<'ios' | 'android'>('ios', 'android'),
    gaps: fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 2, maxLength: 120 }),
    busy: fc.array(fc.double({ min: 0, max: 400, noNaN: true }), { minLength: 120, maxLength: 120 }),
    drawn: fc.array(fc.boolean(), { minLength: 120, maxLength: 120 }),
    totals: fc.array(fc.double({ min: 1, max: 300, noNaN: true }), { minLength: 120, maxLength: 120 }),
    mounts: fc.array(fc.tuple(fc.double({ min: 0, max: 20000, noNaN: true }), fc.double({ min: 0, max: 300, noNaN: true })), { maxLength: 20 }),
    js: fc.array(fc.tuple(fc.double({ min: 0, max: 20000, noNaN: true }), fc.double({ min: 0, max: 800, noNaN: true })), { maxLength: 20 }),
  })
  .map((r) => {
    let vsync = 0;
    const tickList = r.gaps.map((gap, i) => {
      vsync += gap === 1 ? B : gap <= 25 ? B : (gap - 24) * B; // mostly on time, some skips
      return { vsync, mainBusy: r.busy[i] % (B * 3) };
    });
    const metricList = r.platform === 'android'
      ? tickList.filter((_, i) => r.drawn[i]).map((t, i) => ({ vsync: t.vsync, total: r.totals[i] % 60, sync: (r.totals[i] % 60) / 3 }))
      : [];
    return rawSession({
      platform: r.platform,
      ticks: ticks(tickList),
      metrics: metrics(metricList),
      mounts: ([] as number[]).concat(...r.mounts.map(([s, d]) => [us(s), us(s + d)])),
      jsBusy: ([] as number[]).concat(...r.js.map(([s, d]) => [us(s), us(s + d)])),
    });
  });

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

describe('properties', () => {
  it('P1: total hitch time, janky frames and dropped frames equal the sums over causes', () => {
    const check = (frames: Frame[]) => {
      const s = summarize(frames, 10000, 60);
      const hitch = JANK_CAUSES.reduce((sum, c) => sum + s.causes[c].hitchMs, 0);
      const count = JANK_CAUSES.reduce((sum, c) => sum + s.causes[c].count, 0);
      const dropped = JANK_CAUSES.reduce((sum, c) => sum + s.causes[c].dropped, 0);
      return close(hitch, s.hitchTimeMs) && count === s.jankyFrames && dropped === s.droppedFrames;
    };
    fc.assert(fc.property(fc.array(frameArb, { maxLength: 300 }), check), { numRuns: 300 });
    fc.assert(fc.property(rawArb, (raw) => check(buildFrames(raw))), { numRuns: 200 });
  });

  it('P2: janky % is within [0, 100]', () => {
    fc.assert(
      fc.property(fc.array(frameArb, { maxLength: 300 }), (frames) => {
        const { jankyPct } = summarize(frames, 10000, 60);
        return jankyPct >= 0 && jankyPct <= 100;
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(rawArb, (raw) => {
        const { jankyPct } = summarize(buildFrames(raw), 10000, 60);
        return jankyPct >= 0 && jankyPct <= 100;
      }),
      { numRuns: 200 },
    );
  });

  it('P3: compare is symmetric in the sign of the change', () => {
    const value = fc.double({ min: -1000, max: 1000, noNaN: true });
    fc.assert(
      fc.property(value, value, (a, b) => Math.sign(relativeChange(a, b)) === -Math.sign(relativeChange(b, a))),
      { numRuns: 1000 },
    );
    const side = fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 9 });
    fc.assert(
      fc.property(side, side, fc.double({ min: 0, max: 50, noNaN: true }), (base, head, limit) => {
        const forward = compareValues('jankyPct', base, head, { kind: 'absolute', value: limit });
        const backward = compareValues('jankyPct', head, base, { kind: 'absolute', value: limit });
        const flipped = { regression: 'improvement', improvement: 'regression', unchanged: 'unchanged' } as const;
        return (
          Math.sign(forward.delta) === -Math.sign(backward.delta) &&
          Math.sign(forward.changePct) === -Math.sign(backward.changePct) &&
          backward.status === flipped[forward.status]
        );
      }),
      { numRuns: 500 },
    );
  });
});
