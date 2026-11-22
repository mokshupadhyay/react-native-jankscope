import { CliError } from './reports';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** What the CLI needs from Node. Injected so that tests run without devices or files. */
export interface CliIO {
  exec(command: string, args: string[]): ExecResult;
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  /** File names in a directory, or `null` when it does not exist. */
  readDir(path: string): string[] | null;
  mkdir(path: string): void;
  copyFile(from: string, to: string): void;
  join(...parts: string[]): string;
  out(text: string): void;
  err(text: string): void;
}

const REPORT_FILE = /^[A-Za-z0-9._-]+\.json$/;
const APP_ID = /^[A-Za-z0-9._-]+$/;

export interface PullOptions {
  platform: 'android' | 'ios';
  app?: string;
  /** adb serial or simulator UDID. */
  device?: string;
  outDir: string;
}

function checkApp(app: string): string {
  if (!APP_ID.test(app)) throw new CliError(`invalid --app "${app}"`);
  return app;
}

/** Android package names from "report saved" log lines, newest last. */
export function appsFromLogcat(log: string): string[] {
  const apps: string[] = [];
  const re = /report saved: \S*?\/(?:Android\/data|data\/user\/\d+|data\/data)\/([A-Za-z0-9._-]+)\//g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(log)) !== null) if (!apps.includes(match[1])) apps.push(match[1]);
  return apps;
}

function pullAndroid(io: CliIO, options: PullOptions): string[] {
  const adb = (args: string[]) => io.exec('adb', options.device ? ['-s', options.device, ...args] : args);
  let apps = options.app ? [checkApp(options.app)] : [];
  if (apps.length === 0) {
    const log = adb(['logcat', '-d', '-s', 'Jankscope:I']);
    if (log.code !== 0) throw new CliError(`adb logcat failed: ${log.stderr.trim()}`);
    apps = appsFromLogcat(log.stdout);
    if (apps.length === 0) throw new CliError('no saved report in logcat; pass --app <package name>');
  }
  const pulled: string[] = [];
  for (const app of apps) {
    // External app storage first: adb can read it for release builds too.
    const external = `/sdcard/Android/data/${app}/files/jankscope`;
    const list = adb(['shell', 'ls', external]);
    const names = list.code === 0 ? list.stdout.split(/\s+/).filter((n) => REPORT_FILE.test(n)) : [];
    if (names.length > 0) {
      for (const name of names) {
        const target = io.join(options.outDir, name);
        const result = adb(['pull', `${external}/${name}`, target]);
        if (result.code !== 0) throw new CliError(`adb pull ${name} failed: ${result.stderr.trim()}`);
        pulled.push(target);
      }
      continue;
    }
    // Internal storage: run-as works for debuggable builds only.
    const internal = adb(['shell', 'run-as', app, 'ls', 'files/jankscope']);
    const internalNames =
      internal.code === 0 ? internal.stdout.split(/\s+/).filter((n) => REPORT_FILE.test(n)) : [];
    for (const name of internalNames) {
      const result = adb(['exec-out', 'run-as', app, 'cat', `files/jankscope/${name}`]);
      if (result.code !== 0) throw new CliError(`reading ${name} failed: ${result.stderr.trim()}`);
      const target = io.join(options.outDir, name);
      io.writeFile(target, result.stdout);
      pulled.push(target);
    }
  }
  return pulled;
}

/** `DataContainer = "file:///..."` entries of `xcrun simctl listapps`. */
export function dataContainersFromListapps(text: string): string[] {
  const out: string[] = [];
  const re = /DataContainer\s*=\s*"file:\/\/([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) out.push(decodeURIComponent(match[1]).replace(/\/$/, ''));
  return out;
}

function pullIos(io: CliIO, options: PullOptions): string[] {
  const device = options.device ?? 'booted';
  let containers: string[];
  if (options.app) {
    const result = io.exec('xcrun', ['simctl', 'get_app_container', device, checkApp(options.app), 'data']);
    if (result.code !== 0) throw new CliError(`simctl get_app_container failed: ${result.stderr.trim()}`);
    containers = [result.stdout.trim()];
  } else {
    const result = io.exec('xcrun', ['simctl', 'listapps', device]);
    if (result.code !== 0) throw new CliError(`simctl listapps failed: ${result.stderr.trim()}`);
    containers = dataContainersFromListapps(result.stdout);
  }
  const pulled: string[] = [];
  for (const container of containers) {
    const dir = io.join(container, 'Documents', 'jankscope');
    for (const name of (io.readDir(dir) ?? []).filter((n) => REPORT_FILE.test(n))) {
      const target = io.join(options.outDir, name);
      io.copyFile(io.join(dir, name), target);
      pulled.push(target);
    }
  }
  return pulled;
}

/** Copy saved reports from a device or simulator into `outDir`. Resolves the local paths. */
export function pull(io: CliIO, options: PullOptions): string[] {
  io.mkdir(options.outDir);
  return options.platform === 'android' ? pullAndroid(io, options) : pullIos(io, options);
}
