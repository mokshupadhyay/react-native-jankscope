import { CliError, type CompareMetric } from './reports';

export type Threshold = { kind: 'relative'; percent: number } | { kind: 'absolute'; value: number };

/** `"10%"` is relative to the base median; `"2"` is in the metric's own unit. */
export function parseThreshold(text: string): Threshold {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(%?)\s*$/.exec(text);
  if (!match) throw new CliError(`invalid --threshold "${text}": use a number like 10% or 2`);
  const value = Number(match[1]);
  return match[2] === '%' ? { kind: 'relative', percent: value } : { kind: 'absolute', value };
}

/** Median; the mean of the two middle values for an even count. */
export function median(values: number[]): number {
  if (values.length === 0) throw new CliError('median of no values');
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Change from `base` to `head` in percent of |base|. A change from 0 is
 * +Infinity or -Infinity, and 0 when both are 0.
 */
export function relativeChange(base: number, head: number): number {
  const delta = head - base;
  if (delta === 0) return 0;
  if (base === 0) return delta > 0 ? Infinity : -Infinity;
  return (delta / Math.abs(base)) * 100;
}

export type CompareStatus = 'regression' | 'improvement' | 'unchanged';

export interface CompareRow {
  metric: CompareMetric;
  baseMedian: number;
  headMedian: number;
  baseCount: number;
  headCount: number;
  delta: number;
  changePct: number;
  status: CompareStatus;
}

/** Every metric is "lower is better": a rise beyond the threshold is a regression. */
export function compareValues(
  metric: CompareMetric,
  baseValues: number[],
  headValues: number[],
  threshold: Threshold,
): CompareRow {
  const baseMedian = median(baseValues);
  const headMedian = median(headValues);
  const delta = headMedian - baseMedian;
  const changePct = relativeChange(baseMedian, headMedian);
  const size = threshold.kind === 'relative' ? changePct : delta;
  const limit = threshold.kind === 'relative' ? threshold.percent : threshold.value;
  const status: CompareStatus = size > limit ? 'regression' : size < -limit ? 'improvement' : 'unchanged';
  return {
    metric,
    baseMedian,
    headMedian,
    baseCount: baseValues.length,
    headCount: headValues.length,
    delta,
    changePct,
    status,
  };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '+inf' : '-inf';
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2);
}

function formatChange(row: CompareRow): string {
  if (!Number.isFinite(row.changePct)) return row.changePct > 0 ? '+inf%' : '-inf%';
  const sign = row.changePct > 0 ? '+' : '';
  return `${sign}${row.changePct.toFixed(1)}%`;
}

const UNITS: Record<CompareMetric, string> = { jankyPct: '%', hitchRatio: 'ms/s', p95FrameMs: 'ms' };

/** A plain-text table, one row per metric. */
export function formatCompareTable(rows: CompareRow[], threshold: Threshold): string {
  const header = ['metric', 'base (median)', 'head (median)', 'change', 'status'];
  const body = rows.map((row) => [
    `${row.metric} (${UNITS[row.metric]})`,
    `${formatNumber(row.baseMedian)} (n=${row.baseCount})`,
    `${formatNumber(row.headMedian)} (n=${row.headCount})`,
    formatChange(row),
    row.status === 'regression' ? 'REGRESSION' : row.status,
  ]);
  const widths = header.map((title, i) => Math.max(title.length, ...body.map((cells) => cells[i].length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').replace(/\s+$/, '');
  const limit = threshold.kind === 'relative' ? `${threshold.percent}%` : `${threshold.value}`;
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line), '', `threshold: ${limit}`].join(
    '\n',
  );
}
