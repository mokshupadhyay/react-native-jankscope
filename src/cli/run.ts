import { compareValues, formatCompareTable, parseThreshold, type CompareRow } from './compare';
import { renderHtml } from './html';
import { pull, type CliIO } from './pull';
import { CliError, COMPARE_METRICS, parseReport, summaryOf, type CompareMetric } from './reports';
import { formatSummary } from './summary';

export type { CliIO } from './pull';

export const USAGE = `Usage:
  jankscope pull --platform android|ios [--app <id>] [--device <serial|udid>] [--out <dir>]
  jankscope summary <report.json>
  jankscope compare <base> <head> [--threshold 10%] [--metric jankyPct|hitchRatio|p95FrameMs] [--segment <name>]
  jankscope compare --base a.json --base b.json --head c.json --head d.json [...]
  jankscope html <report.json> [-o report.html]

<base> and <head> are a report file, a comma-separated list of files, or a directory of reports.
compare exits 1 on a regression and 2 on a usage or input error.`;

interface Parsed {
  positional: string[];
  flags: Map<string, string[]>;
}

const VALUE_FLAGS = new Set(['platform', 'app', 'device', 'out', 'o', 'threshold', 'metric', 'segment', 'base', 'head']);

export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--?([A-Za-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      positional.push(arg);
      continue;
    }
    const name = match[1];
    if (name === 'help' || name === 'h') {
      flags.set('help', ['']);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new CliError(`unknown option ${arg}`);
    let value = match[2];
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new CliError(`${arg} needs a value`);
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { positional, flags };
}

const one = (parsed: Parsed, name: string): string | undefined => {
  const values = parsed.flags.get(name);
  return values ? values[values.length - 1] : undefined;
};

/** Report files of one side: files, comma-separated lists, or directories. */
function expandSide(io: CliIO, specs: string[]): string[] {
  const files: string[] = [];
  for (const spec of specs) {
    for (const part of spec.split(',').filter(Boolean)) {
      const entries = io.readDir(part);
      if (entries) {
        const json = entries.filter((name) => name.endsWith('.json')).sort();
        if (json.length === 0) throw new CliError(`${part}: no .json reports in the directory`);
        files.push(...json.map((name) => io.join(part, name)));
      } else {
        files.push(part);
      }
    }
  }
  return files;
}

function readReportFile(io: CliIO, file: string) {
  let text: string;
  try {
    text = io.readFile(file);
  } catch {
    throw new CliError(`${file}: cannot read the file`);
  }
  return parseReport(text, file);
}

function runCompare(io: CliIO, parsed: Parsed): number {
  let baseSpecs = parsed.flags.get('base') ?? [];
  let headSpecs = parsed.flags.get('head') ?? [];
  if (baseSpecs.length === 0 && headSpecs.length === 0) {
    if (parsed.positional.length !== 2) throw new CliError('compare needs <base> and <head>');
    baseSpecs = [parsed.positional[0]];
    headSpecs = [parsed.positional[1]];
  } else if (baseSpecs.length === 0 || headSpecs.length === 0 || parsed.positional.length > 0) {
    throw new CliError('use either <base> <head> or --base ... --head ...');
  }
  const threshold = parseThreshold(one(parsed, 'threshold') ?? '10%');
  const metrics: string[] = [];
  for (const value of parsed.flags.get('metric') ?? ['jankyPct']) metrics.push(...value.split(','));
  for (const metric of metrics) {
    if (!COMPARE_METRICS.includes(metric as CompareMetric)) {
      throw new CliError(`unknown --metric "${metric}": use ${COMPARE_METRICS.join(', ')}`);
    }
  }
  const segment = one(parsed, 'segment');
  const load = (specs: string[]) =>
    expandSide(io, specs).map((file) => summaryOf(readReportFile(io, file), segment, file));
  const base = load(baseSpecs);
  const head = load(headSpecs);
  const rows: CompareRow[] = metrics.map((metric) =>
    compareValues(
      metric as CompareMetric,
      base.map((s) => s[metric as CompareMetric]),
      head.map((s) => s[metric as CompareMetric]),
      threshold,
    ),
  );
  io.out(formatCompareTable(rows, threshold));
  const regressions = rows.filter((row) => row.status === 'regression');
  if (regressions.length > 0) {
    io.err(`jankscope: regression in ${regressions.map((row) => row.metric).join(', ')}`);
    return 1;
  }
  return 0;
}

/** Run the CLI. Returns the exit code. */
export function run(argv: string[], io: CliIO): number {
  try {
    const parsed = parseArgs(argv);
    const [command, ...rest] = parsed.positional;
    parsed.positional = rest;
    if (!command || parsed.flags.has('help')) {
      io.out(USAGE);
      return command || parsed.flags.has('help') ? 0 : 2;
    }
    switch (command) {
      case 'summary': {
        if (rest.length !== 1) throw new CliError('summary needs one report file');
        io.out(formatSummary(readReportFile(io, rest[0])));
        return 0;
      }
      case 'html': {
        if (rest.length !== 1) throw new CliError('html needs one report file');
        const out = one(parsed, 'o') ?? one(parsed, 'out') ?? rest[0].replace(/\.json$/i, '') + '.html';
        io.writeFile(out, renderHtml(readReportFile(io, rest[0])));
        io.out(`wrote ${out}`);
        return 0;
      }
      case 'compare':
        return runCompare(io, parsed);
      case 'pull': {
        const platform = one(parsed, 'platform');
        if (platform !== 'android' && platform !== 'ios') throw new CliError('pull needs --platform android|ios');
        const files = pull(io, {
          platform,
          app: one(parsed, 'app'),
          device: one(parsed, 'device'),
          outDir: one(parsed, 'out') ?? 'jankscope-reports',
        });
        if (files.length === 0) {
          io.err('jankscope: no reports found');
          return 1;
        }
        for (const file of files) io.out(file);
        return 0;
      }
      default:
        throw new CliError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`jankscope: ${error.message}`);
      return 2;
    }
    throw error;
  }
}
