import { Heartbeat } from '../heartbeat';

/** A fake JS thread: timers fire at due + lateness(), and `block` occupies the thread. */
function harness(lateness: (n: number) => number, interval = 16) {
  let clock = 0;
  let timer: { at: number; fn: () => void } | null = null;
  let fired = 0;
  const flushed: number[][] = [];
  const blocks: Array<[number, number]> = [];
  const heartbeat = new Heartbeat({
    intervalMs: interval,
    now: () => clock,
    setTimer: (fn, ms) => {
      timer = { at: clock + ms + lateness(fired++), fn };
      return timer;
    },
    clearTimer: () => {
      timer = null;
    },
    flush: (windows) => flushed.push(windows),
  });
  return {
    heartbeat,
    flushed,
    block(from: number, ms: number) {
      blocks.push([from, from + ms]);
    },
    runUntil(end: number) {
      heartbeat.start();
      while (timer && timer.at <= end) {
        let at = timer.at;
        // A timer cannot fire while the thread is blocked.
        for (const [s, e] of blocks) if (at >= s && at < e) at = e;
        clock = at;
        const fn = timer.fn;
        timer = null;
        fn();
      }
      clock = end;
      heartbeat.stop();
    },
    windows(): Array<[number, number]> {
      const flat = ([] as number[]).concat(...flushed);
      const out: Array<[number, number]> = [];
      for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
      return out;
    },
  };
}

describe('Heartbeat', () => {
  it('records nothing on an idle thread with on-time timers', () => {
    const h = harness(() => 0);
    h.runUntil(5000);
    expect(h.windows()).toEqual([]);
    expect(h.heartbeat.ticks).toBeGreaterThan(250);
  });

  it('learns a steady idle lateness and does not report it as busy', () => {
    // Timers driven by frame callbacks: 20 to 40 ms late on an idle thread.
    const h = harness((n) => 20 + ((n * 7) % 21));
    h.runUntil(10000);
    const busy = h.windows().filter(([, e]) => e > 1000); // after warm-up
    // Attribution ignores the first refresh period of every window, so jitter
    // windows shorter than one 60 Hz period never count as JS stalls.
    expect(Math.max(0, ...busy.map(([s, e]) => e - s))).toBeLessThan(1000 / 60);
    expect(h.heartbeat.baseline).toBeGreaterThanOrEqual(20);
    expect(h.heartbeat.baseline).toBeLessThanOrEqual(30);
  });

  it('reports a 300 ms block within one interval plus the baseline', () => {
    const h = harness(() => 5);
    h.block(2000, 300);
    h.runUntil(4000);
    const windows = h.windows();
    const hit = windows.find(([s, e]) => s < 2300 && e >= 2300);
    expect(hit).toBeDefined();
    expect(hit![1]).toBe(2300);
    expect(hit![1] - hit![0]).toBeGreaterThan(300 - 16 - 5 - 1);
    expect(hit![1] - hit![0]).toBeLessThanOrEqual(300);
  });

  it('keeps blocks out of the baseline', () => {
    const h = harness(() => 2);
    for (let t = 1000; t < 9000; t += 1000) h.block(t, 300);
    h.runUntil(10000);
    expect(h.heartbeat.baseline).toBeLessThan(5);
    expect(h.windows().filter(([s, e]) => e - s > 250)).toHaveLength(8);
  });

  it('flushes in batches, not per tick', () => {
    const h = harness(() => 0);
    for (let t = 500; t < 5000; t += 100) h.block(t, 30);
    h.runUntil(5000);
    expect(h.windows().length).toBeGreaterThanOrEqual(40);
    expect(h.flushed.length).toBeLessThanOrEqual(6);
  });

  it('measures its own cost', () => {
    const h = harness(() => 0);
    h.runUntil(1000);
    expect(h.heartbeat.costMs).toBe(0); // the fake clock does not move inside a tick
    expect(h.heartbeat.lateness.length).toBe(h.heartbeat.ticks);
  });
});
