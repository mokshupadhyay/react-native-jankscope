import { buildFrames } from '../raw';
import { metrics, rawSession, steadyTicks, ticks, us, type TickSpec } from './fixtures';

const B = 1000 / 60;

describe('buildFrames on iOS', () => {
  it('makes one on-time frame per display link interval', () => {
    const frames = buildFrames(rawSession({ ticks: ticks(steadyTicks(0, 61)) }));
    expect(frames).toHaveLength(60);
    expect(frames.every((f) => !f.janky && f.cause === null && f.dropped === 0 && f.hitch === 0)).toBe(true);
    expect(frames[0].budget).toBeCloseTo(B);
  });

  // As recorded on the simulator: the callback that runs into the block keeps
  // its vsync timestamp and runs late (measuring the busy time); the next
  // timestamp shows the gap.
  function blocked(busy: number, extraGap = 0): TickSpec[] {
    const list: TickSpec[] = steadyTicks(0, 10);
    const vsync = list[list.length - 1].vsync + B;
    list.push({ vsync, callback: vsync + busy + 2, mainBusy: busy });
    list.push({ vsync: vsync + busy + 2 + extraGap, mainBusy: 0.5 });
    return list;
  }

  it('attributes a long main-thread block to ui-other', () => {
    const frames = buildFrames(rawSession({ ticks: ticks(blocked(298)) }));
    const janky = frames.filter((f) => f.janky);
    expect(janky).toHaveLength(1);
    expect(janky[0].cause).toBe('ui-other');
    expect(janky[0].dropped).toBe(Math.round(300 / B) - 1);
    expect(janky[0].hitch).toBeCloseTo(300 - B);
    expect(janky[0].stages.uiOther).toBeCloseTo(298.5);
  });

  it('attributes a block that is mostly React Native mounting to ui-mount', () => {
    const list = blocked(210);
    const start = list[10].vsync + 1;
    const frames = buildFrames(rawSession({ ticks: ticks(list), mounts: [us(start), us(start + 180)] }));
    const janky = frames.filter((f) => f.janky);
    expect(janky).toHaveLength(1);
    expect(janky[0].cause).toBe('ui-mount');
    expect(janky[0].stages.mount).toBeCloseTo(180);
    expect(janky[0].stages.uiOther).toBeCloseTo(30.5);
  });

  it('marks frames inside a JS-busy window, after its first budget, as js', () => {
    const frames = buildFrames(rawSession({ ticks: ticks(steadyTicks(0, 61)), jsBusy: [us(100), us(400)] }));
    const janky = frames.filter((f) => f.janky);
    expect(janky.length).toBeGreaterThanOrEqual(16);
    expect(janky.length).toBeLessThanOrEqual(18);
    expect(janky.every((f) => f.cause === 'js' && f.jsStalled && !f.uiMissed && f.dropped === 1)).toBe(true);
    const hitch = janky.reduce((sum, f) => sum + f.hitch, 0);
    // 300 ms busy minus the first budget; frames less than half covered at the edges are not counted.
    expect(hitch).toBeGreaterThan(270);
    expect(hitch).toBeLessThanOrEqual(300 - B + 1e-6);
  });

  it('ignores a JS task shorter than one budget', () => {
    const frames = buildFrames(rawSession({ ticks: ticks(steadyTicks(0, 61)), jsBusy: [us(100), us(115)] }));
    expect(frames.some((f) => f.janky)).toBe(false);
  });

  it('blames unattributed render-gpu for a hitch with idle main and JS threads', () => {
    const list: TickSpec[] = steadyTicks(0, 10, 60, 1);
    list.push({ vsync: list[list.length - 1].vsync + 3 * B, mainBusy: 1 });
    const janky = buildFrames(rawSession({ ticks: ticks(list) })).filter((f) => f.janky);
    expect(janky).toHaveLength(1);
    expect(janky[0].cause).toBe('render-gpu');
    expect(janky[0].stages.render).toBeCloseTo(3 * B - B - 2);
  });

  it('uses the 120 Hz budget on a ProMotion display', () => {
    const list = steadyTicks(0, 121, 120);
    list.push({ vsync: list[list.length - 1].vsync + 2 * (1000 / 120), budget: 1000 / 120, mainBusy: 15 });
    const frames = buildFrames(rawSession({ ticks: ticks(list) }));
    const janky = frames.filter((f) => f.janky);
    expect(janky).toHaveLength(1);
    expect(janky[0].budget).toBeCloseTo(1000 / 120);
    expect(janky[0].dropped).toBe(1);
  });
});

describe('buildFrames on Android', () => {
  const android = (spec: Parameters<typeof rawSession>[0]) =>
    rawSession({ platform: 'android', device: { model: 'P', manufacturer: 'G', os: 'android', osVersion: '15', refreshRate: 60 }, ...spec });

  it('makes a frame for every drawn vsync and none for idle vsyncs', () => {
    const list = steadyTicks(0, 31);
    const drawn = list.filter((_, i) => i % 2 === 0 && i > 0).map((t) => ({ vsync: t.vsync }));
    const frames = buildFrames(android({ ticks: ticks(list), metrics: metrics(drawn) }));
    expect(frames).toHaveLength(drawn.length);
    expect(frames.every((f) => f.android != null && !f.janky)).toBe(true);
  });

  it('blames render-gpu for a frame whose RenderThread work missed the deadline', () => {
    const list = steadyTicks(0, 11);
    const frames = buildFrames(
      android({ ticks: ticks(list), metrics: metrics([{ vsync: list[5].vsync, sync: 20, command: 5, total: 30 }]) }),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].cause).toBe('render-gpu');
    expect(frames[0].duration).toBe(30);
    expect(frames[0].dropped).toBe(1);
    expect(frames[0].stages.render).toBeCloseTo(25.5);
  });

  it('uses GPU_DURATION as render time when it is longer', () => {
    const list = steadyTicks(0, 11);
    const [frame] = buildFrames(
      android({ ticks: ticks(list), metrics: metrics([{ vsync: list[5].vsync, total: 40, gpu: 35 }]) }),
    );
    expect(frame.stages.render).toBe(35);
    expect(frame.cause).toBe('render-gpu');
  });

  it('judges a drawn frame against DEADLINE when present, and drops by refresh periods', () => {
    const list = steadyTicks(0, 11);
    const frames = buildFrames(
      android({
        ticks: ticks(list),
        metrics: metrics([
          { vsync: list[3].vsync, total: 14, deadline: 12 },
          { vsync: list[5].vsync, total: 25, deadline: 2 * B },
          { vsync: list[7].vsync, total: 40, deadline: 2 * B },
        ]),
      }),
    );
    expect(frames.map((f) => f.uiMissed)).toEqual([true, false, true]);
    expect(frames[0].budget).toBeCloseTo(B);
    expect(frames[0].hitch).toBeCloseTo(2);
    expect(frames[2].hitch).toBeCloseTo(40 - 2 * B);
    expect(frames[2].dropped).toBe(1);
  });

  it('blames ui-other for a drawn frame delayed by a busy UI thread', () => {
    const list = steadyTicks(0, 10);
    const late = list[list.length - 1].vsync + B + 300;
    list.push({ vsync: late });
    const frames = buildFrames(
      android({ ticks: ticks(list), metrics: metrics([{ intended: list[9].vsync + B, vsync: late, delay: 299, total: 304 }]) }),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].cause).toBe('ui-other');
    expect(frames[0].duration).toBeCloseTo(B + 300);
  });

  it('blames ui-mount when the late frame was mostly mount work', () => {
    const list = steadyTicks(0, 10);
    const vsync = list[list.length - 1].vsync + B;
    list.push({ vsync });
    const frames = buildFrames(
      android({
        ticks: ticks(list),
        metrics: metrics([{ vsync, animation: 120, total: 125 }]),
        mounts: [us(vsync + 1), us(vsync + 115)],
      }),
    );
    expect(frames[0].cause).toBe('ui-mount');
    expect(frames[0].stages.mount).toBeCloseTo(114);
  });

  it('makes a frame from skipped vsyncs even when nothing was drawn', () => {
    const list = steadyTicks(0, 10);
    list.push({ vsync: list[list.length - 1].vsync + 200 });
    const frames = buildFrames(android({ ticks: ticks(list) }));
    expect(frames).toHaveLength(1);
    expect(frames[0].cause).toBe('ui-other');
    expect(frames[0].stages.uiOther).toBeCloseTo(200 - B);
  });

  it('makes js frames for idle vsyncs inside a JS-busy window', () => {
    const frames = buildFrames(android({ ticks: ticks(steadyTicks(0, 61)), jsBusy: [us(100), us(400)] }));
    expect(frames.length).toBeGreaterThanOrEqual(16);
    expect(frames.every((f) => f.cause === 'js')).toBe(true);
  });

  it('keeps metrics that no tick matched, estimated from the record', () => {
    const frames = buildFrames(android({ ticks: [], metrics: metrics([{ vsync: 50, total: 40, sync: 30 }]) }));
    expect(frames).toHaveLength(1);
    expect(frames[0].cause).toBe('render-gpu');
  });
});
