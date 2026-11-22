import { compareValues, median, parseThreshold, relativeChange } from '../cli/compare';
import { escapeHtml, renderHtml, timelineBars } from '../cli/html';
import { appsFromLogcat, dataContainersFromListapps } from '../cli/pull';
import { CliError } from '../cli/reports';
import { run, type CliIO } from '../cli/run';
import { buildReport } from '../report';
import type { Report } from '../types';
import { rawSession, steadyTicks, ticks, us } from './fixtures';

function makeReport(jsBusyMs: number, label = 'r'): Report {
  const raw = rawSession({
    ticks: ticks(steadyTicks(0, 121)),
    jsBusy: jsBusyMs > 0 ? [us(100), us(100 + jsBusyMs)] : [],
    stopMs: 3000,
  });
  return buildReport(raw, {
    label,
    marks: [{ name: 'scroll', t: 0 }],
    startedAt: '2026-11-22T10:00:00.000Z',
    jsDev: false,
    jsNewArch: true,
    heartbeat: { intervalMs: 16, costMs: 1 },
    overlay: { costMs: 0, updates: 0 },
  });
}

interface FakeIO extends CliIO {
  files: Map<string, string>;
  stdout: string[];
  stderr: string[];
  calls: string[][];
}

function fakeIO(files: Record<string, string> = {}, exec: (cmd: string, args: string[]) => { code: number; stdout: string; stderr: string } = () => ({ code: 1, stdout: '', stderr: 'no' })): FakeIO {
  const map = new Map(Object.entries(files));
  const io: FakeIO = {
    files: map,
    stdout: [],
    stderr: [],
    calls: [],
    exec(cmd, args) {
      io.calls.push([cmd, ...args]);
      return exec(cmd, args);
    },
    readFile(path) {
      const text = map.get(path);
      if (text === undefined) throw new Error('ENOENT');
      return text;
    },
    writeFile(path, contents) {
      map.set(path, contents);
    },
    readDir(path) {
      const prefix = path.replace(/\/$/, '') + '/';
      const names = [...map.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
      return names.length > 0 ? names.filter((n) => !n.includes('/')) : null;
    },
    mkdir() {},
    copyFile(from, to) {
      map.set(to, io.readFile(from));
    },
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
    out: (text) => io.stdout.push(text),
    err: (text) => io.stderr.push(text),
  };
  return io;
}

describe('compare helpers', () => {
  it('takes the median, averaging the middle pair for an even count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(CliError);
  });

  it('computes the relative change, with infinities from zero', () => {
    expect(relativeChange(10, 12)).toBeCloseTo(20);
    expect(relativeChange(10, 8)).toBeCloseTo(-20);
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange(0, 1)).toBe(Infinity);
    expect(relativeChange(0, -1)).toBe(-Infinity);
  });

  it('parses relative and absolute thresholds', () => {
    expect(parseThreshold('10%')).toEqual({ kind: 'relative', percent: 10 });
    expect(parseThreshold('2.5')).toEqual({ kind: 'absolute', value: 2.5 });
    expect(() => parseThreshold('ten')).toThrow(CliError);
    expect(() => parseThreshold('-5%')).toThrow(CliError);
  });

  it('flags a rise beyond the threshold as a regression and a fall as an improvement', () => {
    const t = parseThreshold('10%');
    expect(compareValues('jankyPct', [10, 10, 10], [11.5, 12, 30], t).status).toBe('regression');
    expect(compareValues('jankyPct', [10], [10.9], t).status).toBe('unchanged');
    expect(compareValues('jankyPct', [10], [11], t).status).toBe('unchanged'); // exactly at the limit
    expect(compareValues('jankyPct', [10], [8], t).status).toBe('improvement');
    expect(compareValues('p95FrameMs', [16], [18], parseThreshold('1')).status).toBe('regression');
  });

  it('compares medians, so one outlier run does not decide', () => {
    const row = compareValues('hitchRatio', [5, 5, 50], [5, 5, 5], parseThreshold('10%'));
    expect(row.baseMedian).toBe(5);
    expect(row.status).toBe('unchanged');
  });
});

describe('jankscope compare', () => {
  const base = JSON.stringify(makeReport(0));
  const worse = JSON.stringify(makeReport(500));

  it('exits 0 without a regression and prints a table', () => {
    const io = fakeIO({ 'a.json': base, 'b.json': base });
    expect(run(['compare', 'a.json', 'b.json'], io)).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/jankyPct \(%\)\s+0\.00 \(n=1\)\s+0\.00 \(n=1\)\s+0\.0%\s+unchanged/);
  });

  it('exits 1 on a regression', () => {
    const io = fakeIO({ 'a.json': base, 'b.json': worse });
    expect(run(['compare', 'a.json', 'b.json', '--metric', 'hitchRatio'], io)).toBe(1);
    expect(io.stdout.join('\n')).toContain('REGRESSION');
    expect(io.stderr.join('\n')).toContain('regression in hitchRatio');
  });

  it('accepts several files per side, as lists, directories or --base/--head', () => {
    const io = fakeIO({
      'base/1.json': base,
      'base/2.json': base,
      'base/3.json': worse,
      'head/1.json': worse,
      'head/2.json': worse,
    });
    expect(run(['compare', 'base', 'head'], io)).toBe(1);
    expect(io.stdout.join('\n')).toContain('(n=3)');
    const io2 = fakeIO({ 'a.json': base, 'b.json': base, 'c.json': base });
    expect(run(['compare', '--base', 'a.json', '--base', 'b.json', '--head', 'c.json'], io2)).toBe(0);
    expect(io2.stdout.join('\n')).toContain('(n=2)');
    const io3 = fakeIO({ 'a.json': base, 'b.json': base, 'c.json': worse });
    expect(run(['compare', 'a.json,b.json', 'c.json', '--metric', 'jankyPct,p95FrameMs'], io3)).toBe(1);
  });

  it('compares one segment with --segment', () => {
    const io = fakeIO({ 'a.json': base, 'b.json': worse });
    expect(run(['compare', 'a.json', 'b.json', '--segment', 'scroll'], io)).toBe(1);
    expect(run(['compare', 'a.json', 'b.json', '--segment', 'nope'], io)).toBe(2);
    expect(io.stderr.join('\n')).toContain('no segment named "nope"');
  });

  it('honours --threshold', () => {
    const io = fakeIO({ 'a.json': base, 'b.json': worse });
    expect(run(['compare', 'a.json', 'b.json', '--threshold', '100'], io)).toBe(0);
  });

  it('exits 2 on usage and input errors', () => {
    const io = fakeIO({ 'a.json': base, 'bad.json': '{nope', 'other.json': '{"version":2}' });
    expect(run(['compare', 'a.json'], io)).toBe(2);
    expect(run(['compare', 'a.json', 'missing.json'], io)).toBe(2);
    expect(run(['compare', 'a.json', 'bad.json'], io)).toBe(2);
    expect(run(['compare', 'a.json', 'other.json'], io)).toBe(2);
    expect(run(['compare', 'a.json', 'a.json', '--metric', 'fps'], io)).toBe(2);
    expect(run(['compare', 'a.json', 'a.json', '--wat'], io)).toBe(2);
    expect(run(['frobnicate'], io)).toBe(2);
    expect(run([], io)).toBe(2);
    expect(run(['--help'], io)).toBe(0);
  });
});

describe('jankscope summary and html', () => {
  it('prints the main numbers and the cause breakdown', () => {
    const io = fakeIO({ 'r.json': JSON.stringify(makeReport(500, 'feed')) });
    expect(run(['summary', 'r.json'], io)).toBe(0);
    const text = io.stdout.join('\n');
    expect(text).toContain('jankscope report: feed');
    expect(text).toMatch(/janky:\s+\d+ frames/);
    expect(text).toMatch(/causes:\n\s+js\s+\d+ frames/);
    expect(text).toContain('primary cause: js');
  });

  it('writes a self-contained HTML report', () => {
    const io = fakeIO({ 'r.json': JSON.stringify(makeReport(500)) });
    expect(run(['html', 'r.json', '-o', 'out.html'], io)).toBe(0);
    const html = io.files.get('out.html')!;
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<svg class="timeline"');
    expect(html).toContain('Worst frames');
    expect(html).not.toMatch(/<script|<link|src="http|href="http/);
    expect((html.match(/<rect /g) || []).length).toBe(120);
  });

  it('escapes text from the report', () => {
    const report = makeReport(0, '<img src=x onerror=alert(1)>');
    report.segments[0].name = '"><script>alert(1)</script>';
    const html = renderHtml(report);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&#39;');
  });

  it('groups long sessions into at most 1500 timeline bars that keep the worst frame', () => {
    const frames = makeReport(500).frames;
    const many = ([] as typeof frames).concat(...Array.from({ length: 30 }, () => frames));
    const bars = timelineBars(many, 100);
    expect(bars.length).toBeLessThanOrEqual(100);
    expect(bars.some((bar) => bar.cause === 'js')).toBe(true);
  });
});

describe('jankscope pull', () => {
  const report = JSON.stringify(makeReport(0));

  it('pulls from the Android external files dir with adb -s', () => {
    const io = fakeIO({}, (_cmd, args) => {
      if (args.includes('ls')) return { code: 0, stdout: 'a.json\nnot-a-report.txt\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
    expect(run(['pull', '--platform', 'android', '--app', 'com.example', '--device', 'emulator-5554', '--out', 'out'], io)).toBe(0);
    expect(io.calls).toContainEqual(['adb', '-s', 'emulator-5554', 'pull', '/sdcard/Android/data/com.example/files/jankscope/a.json', 'out/a.json']);
  });

  it('falls back to run-as for internal storage', () => {
    const io = fakeIO({}, (_cmd, args) => {
      if (args.includes('run-as') && args.includes('ls')) return { code: 0, stdout: 'b.json\n', stderr: '' };
      if (args.includes('cat')) return { code: 0, stdout: report, stderr: '' };
      return { code: 1, stdout: '', stderr: 'No such file' };
    });
    expect(run(['pull', '--platform', 'android', '--app', 'com.example'], io)).toBe(0);
    expect(io.files.get('jankscope-reports/b.json')).toBe(report);
  });

  it('finds the app from the logcat line when --app is missing', () => {
    expect(
      appsFromLogcat(
        'I Jankscope: report saved: /storage/emulated/0/Android/data/com.a/files/jankscope/x.json\nI Jankscope: report saved: /data/user/0/com.b/files/jankscope/y.json\n',
      ),
    ).toEqual(['com.a', 'com.b']);
  });

  it('copies from the simulator data container', () => {
    const io = fakeIO({ '/sim/data/Documents/jankscope/r.json': report }, (_cmd, args) =>
      args[1] === 'get_app_container' ? { code: 0, stdout: '/sim/data\n', stderr: '' } : { code: 1, stdout: '', stderr: '' },
    );
    expect(run(['pull', '--platform', 'ios', '--app', 'org.example.App'], io)).toBe(0);
    expect(io.files.get('jankscope-reports/r.json')).toBe(report);
    expect(io.calls[0]).toEqual(['xcrun', 'simctl', 'get_app_container', 'booted', 'org.example.App', 'data']);
  });

  it('reads data containers from simctl listapps', () => {
    expect(dataContainersFromListapps('DataContainer = "file:///Users/x/Data%20A/";\nDataContainer = "file:///y/";')).toEqual([
      '/Users/x/Data A',
      '/y',
    ]);
  });

  it('rejects an app id that could inject arguments', () => {
    const io = fakeIO();
    expect(run(['pull', '--platform', 'android', '--app', 'com.x;rm -rf /'], io)).toBe(2);
    expect(run(['pull', '--platform', 'windows'], io)).toBe(2);
    expect(io.calls).toHaveLength(0);
  });
});
