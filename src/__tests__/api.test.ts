import { NativeModules } from 'react-native';
import { Jankscope, JankscopeError, measureClockOffset, resetJankscopeForTests } from '../api';
import { resetNativeModuleCache } from '../native';
import { rawSession, steadyTicks, ticks } from './fixtures';

interface FakeNative {
  start: jest.Mock;
  stop: jest.Mock;
  peek: jest.Mock;
  nowMs: jest.Mock;
  reportJsBusy: jest.Mock;
  writeReport: jest.Mock;
}

function install(): FakeNative {
  const raw = rawSession({ ticks: ticks(steadyTicks(0, 61)), startMs: 5000, stopMs: 6000 });
  const fake: FakeNative = {
    start: jest.fn(async () => JSON.stringify({ startMs: 5000 })),
    stop: jest.fn(async () => JSON.stringify(raw)),
    peek: jest.fn(async () => JSON.stringify({ ...raw, ticks: ticks(steadyTicks(0, 31)) })),
    nowMs: jest.fn(() => 5000),
    reportJsBusy: jest.fn(),
    writeReport: jest.fn(async (name: string) => `/data/jankscope/${name}`),
  };
  (NativeModules as { Jankscope?: unknown }).Jankscope = fake;
  resetNativeModuleCache();
  return fake;
}

afterEach(() => {
  resetJankscopeForTests();
  delete (NativeModules as { Jankscope?: unknown }).Jankscope;
  resetNativeModuleCache();
});

describe('Jankscope', () => {
  it('rejects with NOT_LINKED without the native module', async () => {
    resetNativeModuleCache();
    await expect(Jankscope.start()).rejects.toMatchObject({ code: 'NOT_LINKED' });
  });

  it('starts, marks, stops and builds a report', async () => {
    const fake = install();
    await Jankscope.start({ label: 'feed', maxFrames: 500 });
    expect(fake.start).toHaveBeenCalledWith(500);
    expect(Jankscope.isRunning()).toBe(true);
    Jankscope.mark('scroll');
    const report = await Jankscope.stop();
    expect(Jankscope.isRunning()).toBe(false);
    expect(report.label).toBe('feed');
    expect(report.summary.frameCount).toBe(60);
    expect(report.segments.map((s) => s.name)).toContain('scroll');
    expect(report.raw).toBeUndefined();
    expect(report.overhead.heartbeatIntervalMs).toBe(16);
  });

  it('keeps the raw session with includeRaw', async () => {
    install();
    await Jankscope.start();
    const report = await Jankscope.stop({ includeRaw: true });
    expect(report.raw).toMatchObject({ platform: 'ios', v: 1 });
  });

  it('allows one session at a time', async () => {
    install();
    await Jankscope.start();
    await expect(Jankscope.start()).rejects.toBeInstanceOf(JankscopeError);
    await Jankscope.stop();
    await expect(Jankscope.stop()).rejects.toMatchObject({ code: 'NOT_RUNNING' });
  });

  it('saves a report under a safe file name and rejects unsafe ones', async () => {
    const fake = install();
    await Jankscope.start({ label: 'my feed/../x' });
    const report = await Jankscope.stop();
    const path = await Jankscope.saveReport(report);
    expect(path).toMatch(/^\/data\/jankscope\/jankscope-my-feed-x-ios-\d{14}\.json$/);
    expect(JSON.parse(fake.writeReport.mock.calls[0][1]).version).toBe(1);
    await expect(Jankscope.saveReport(report, '../evil.json')).rejects.toMatchObject({ code: 'INVALID_FILE_NAME' });
    await expect(Jankscope.saveReport(report, 'a.txt')).rejects.toMatchObject({ code: 'INVALID_FILE_NAME' });
    await expect(Jankscope.saveReport(report, 'ok-1.json')).resolves.toBe('/data/jankscope/ok-1.json');
  });

  it('reports live numbers for the overlay', async () => {
    install();
    expect((await Jankscope.live()).running).toBe(false);
    await Jankscope.start();
    const stats = await Jankscope.live();
    expect(stats.running).toBe(true);
    expect(stats.jankyPct).toBe(0);
    await Jankscope.stop();
  });

  it('lines up the JS and native clocks with the fastest sample', () => {
    let js = 100;
    const now = () => (js += 1);
    const native = { nowMs: jest.fn(() => 10000 + js) };
    // JS clock reads 101, native reads 10101, JS reads 102: offset 10000 - 0.5.
    expect(measureClockOffset(native, now, 3)).toBeCloseTo(9999.5);
  });
});
