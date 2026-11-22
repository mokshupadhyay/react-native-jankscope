import { JANK_CAUSES, type FrameMetricsSummary, type Report } from '../types';

const fixed = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

function causeLines(summary: FrameMetricsSummary): string[] {
  const total = summary.hitchTimeMs;
  return JANK_CAUSES.filter((cause) => summary.causes[cause].count > 0).map((cause) => {
    const entry = summary.causes[cause];
    const share = total > 0 ? (entry.hitchMs / total) * 100 : 0;
    return `  ${cause.padEnd(11)} ${String(entry.count).padStart(6)} frames  ${fixed(entry.hitchMs).padStart(9)} ms hitch  ${fixed(share).padStart(5)}%`;
  });
}

/** The main numbers, the cause breakdown and the segments of a report. */
export function formatSummary(report: Report): string {
  const s = report.summary;
  const lines = [
    `jankscope report${report.label ? `: ${report.label}` : ''}`,
    `device:   ${report.device.manufacturer} ${report.device.model}, ${report.platform} ${report.device.osVersion}, ${report.device.refreshRate} Hz`,
    `build:    ${report.buildType}, ${report.architecture} architecture`,
    `duration: ${fixed(s.durationMs / 1000, 2)} s, ${s.frameCount} frames`,
    `janky:    ${s.jankyFrames} frames (${fixed(s.jankyPct, 2)}%), ${s.droppedFrames} dropped`,
    `hitch:    ${fixed(s.hitchTimeMs)} ms, ${fixed(s.hitchRatio, 2)} ms/s`,
    `slow:     ${s.slowFrames} (> ${fixed(s.slowThresholdMs, 2)} ms), frozen: ${s.frozenFrames} (> 700 ms)`,
    `frame ms: p50 ${fixed(s.p50FrameMs, 2)}, p95 ${fixed(s.p95FrameMs, 2)}, p99 ${fixed(s.p99FrameMs, 2)}`,
    `primary cause: ${s.primaryCause ?? 'none'}`,
  ];
  const causes = causeLines(s);
  if (causes.length > 0) lines.push('causes:', ...causes);
  if (report.segments.length > 0) {
    lines.push('segments:');
    for (const segment of report.segments) {
      lines.push(
        `  ${segment.name}: ${segment.frameCount} frames, ${fixed(segment.jankyPct, 2)}% janky, ${fixed(segment.hitchRatio, 2)} ms/s, primary ${segment.primaryCause ?? 'none'}`,
      );
    }
  }
  const lost = report.lost.ticks + report.lost.metrics + report.lost.mounts + report.lost.jsBusy;
  if (lost > 0) lines.push(`warning: ${lost} records were overwritten; raise maxFrames`);
  if (report.framesTruncated) lines.push(`note: report.frames holds the first ${report.frames.length} frames only`);
  return lines.join('\n');
}
