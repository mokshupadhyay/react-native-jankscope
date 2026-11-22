import type { FrameMetricsSummary, Report } from '../types';

export type CompareMetric = 'jankyPct' | 'hitchRatio' | 'p95FrameMs';
export const COMPARE_METRICS: readonly CompareMetric[] = ['jankyPct', 'hitchRatio', 'p95FrameMs'];

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
    Object.setPrototypeOf(this, CliError.prototype);
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Parse and shape-check a report file. Throws `CliError` with the file name. */
export function parseReport(text: string, file: string): Report {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`${file}: not valid JSON`);
  }
  const report = value as Partial<Report> | null;
  if (!report || typeof report !== 'object' || report.version !== 1) {
    throw new CliError(`${file}: not a jankscope report (version 1)`);
  }
  const summary = report.summary as Partial<FrameMetricsSummary> | undefined;
  if (!summary || !COMPARE_METRICS.every((metric) => isNumber(summary[metric])) || !isNumber(summary.frameCount)) {
    throw new CliError(`${file}: the report has no summary numbers`);
  }
  if (!Array.isArray(report.segments) || !Array.isArray(report.frames) || !Array.isArray(report.worstFrames)) {
    throw new CliError(`${file}: the report has no segments, frames or worstFrames`);
  }
  return report as Report;
}

/** The summary of the whole session, or of the segment named `segment`. */
export function summaryOf(report: Report, segment: string | undefined, file: string): FrameMetricsSummary {
  if (segment === undefined) return report.summary;
  const found = report.segments.find((entry) => entry.name === segment);
  if (!found) throw new CliError(`${file}: no segment named "${segment}"`);
  return found;
}
