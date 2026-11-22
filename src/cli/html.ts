import { JANK_CAUSES, type Frame, type JankCause, type Report } from '../types';

export const CAUSE_COLORS: Record<JankCause | 'ok', string> = {
  ok: '#b8c4ce',
  js: '#e8a33d',
  'ui-mount': '#7b5cd6',
  'ui-other': '#d64f5c',
  'render-gpu': '#2f8fd6',
  unknown: '#6b6b6b',
};

/** Escape text for HTML element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fixed = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

interface Bar {
  t: number;
  duration: number;
  cause: JankCause | 'ok';
}

/** At most `maxBars` bars: frames are grouped by time and each group shows its worst frame. */
export function timelineBars(frames: Frame[], maxBars = 1500): Bar[] {
  if (frames.length <= maxBars) {
    return frames.map((f) => ({ t: f.t, duration: f.duration, cause: f.janky ? f.cause ?? 'unknown' : 'ok' }));
  }
  const bars: Bar[] = [];
  const size = Math.ceil(frames.length / maxBars);
  for (let i = 0; i < frames.length; i += size) {
    let worst = frames[i];
    for (let j = i + 1; j < Math.min(frames.length, i + size); j++) {
      const f = frames[j];
      if (f.janky && (!worst.janky || f.hitch > worst.hitch)) worst = f;
      else if (!worst.janky && f.duration > worst.duration) worst = f;
    }
    bars.push({ t: worst.t, duration: worst.duration, cause: worst.janky ? worst.cause ?? 'unknown' : 'ok' });
  }
  return bars;
}

function timelineSvg(report: Report): string {
  const bars = timelineBars(report.frames);
  const width = 1200;
  const height = 160;
  if (bars.length === 0) return '<p>No frames.</p>';
  const budget = report.frames[0].budget || 16.7;
  // Heights on a square-root scale, capped at 10 budgets, so long frames do not flatten the rest.
  const cap = budget * 10;
  const scale = (ms: number) => Math.sqrt(Math.min(ms, cap) / cap) * (height - 10);
  const step = width / bars.length;
  const rects = bars
    .map((bar, i) => {
      const h = Math.max(1, scale(bar.duration));
      return `<rect x="${fixed(i * step, 2)}" y="${fixed(height - h, 2)}" width="${fixed(Math.max(step, 0.5), 2)}" height="${fixed(h, 2)}" fill="${CAUSE_COLORS[bar.cause]}"><title>${escapeHtml(`${fixed(bar.t)} ms: ${fixed(bar.duration)} ms, ${bar.cause}`)}</title></rect>`;
    })
    .join('');
  const budgetY = height - scale(budget);
  return `<svg class="timeline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Frame timeline">${rects}<line x1="0" x2="${width}" y1="${fixed(budgetY, 2)}" y2="${fixed(budgetY, 2)}" stroke="#222" stroke-dasharray="4 3" stroke-width="1"/></svg>`;
}

function legend(): string {
  return (['ok', ...JANK_CAUSES] as Array<JankCause | 'ok'>)
    .map((cause) => `<span class="key"><i style="background:${CAUSE_COLORS[cause]}"></i>${escapeHtml(cause === 'ok' ? 'on time' : cause)}</span>`)
    .join(' ');
}

function causeTable(report: Report): string {
  const s = report.summary;
  const rows = JANK_CAUSES.map((cause) => {
    const entry = s.causes[cause];
    const share = s.hitchTimeMs > 0 ? (entry.hitchMs / s.hitchTimeMs) * 100 : 0;
    return `<tr><td><i class="dot" style="background:${CAUSE_COLORS[cause]}"></i>${escapeHtml(cause)}</td><td>${entry.count}</td><td>${entry.dropped}</td><td>${fixed(entry.hitchMs)}</td><td><span class="bar" style="width:${fixed(share * 2, 1)}px;background:${CAUSE_COLORS[cause]}"></span> ${fixed(share)}%</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>cause</th><th>frames</th><th>dropped</th><th>hitch ms</th><th>share of hitch time</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function worstTable(report: Report): string {
  if (report.worstFrames.length === 0) return '<p>No janky frames.</p>';
  const rows = report.worstFrames
    .map((f) => {
      const a = f.android;
      const detail = a
        ? `delay ${fixed(a.delay)} · input ${fixed(a.input)} · anim ${fixed(a.animation)} · layout ${fixed(a.layoutMeasure)} · draw ${fixed(a.draw)} · sync ${fixed(a.sync)} · cmd ${fixed(a.commandIssue)} · swap ${fixed(a.swapBuffers)}${a.gpu != null ? ` · gpu ${fixed(a.gpu)}` : ''}`
        : '';
      return `<tr><td>${fixed(f.t)}</td><td>${fixed(f.duration)}</td><td>${fixed(f.hitch)}</td><td>${f.dropped}</td><td><i class="dot" style="background:${CAUSE_COLORS[f.cause ?? 'unknown']}"></i>${escapeHtml(f.cause ?? 'unknown')}</td><td>${fixed(f.stages.js)}</td><td>${fixed(f.stages.mount)}</td><td>${fixed(f.stages.uiOther)}</td><td>${fixed(f.stages.render)}</td><td class="small">${escapeHtml(detail)}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>t ms</th><th>duration</th><th>hitch</th><th>dropped</th><th>cause</th><th>js</th><th>mount</th><th>ui other</th><th>render</th><th>Android stages (ms)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function segmentTable(report: Report): string {
  if (report.segments.length === 0) return '<p>No segments.</p>';
  const rows = report.segments
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.name)}</td><td>${fixed(s.startMs / 1000, 2)}–${fixed(s.endMs / 1000, 2)} s</td><td>${s.frameCount}</td><td>${fixed(s.jankyPct, 2)}%</td><td>${fixed(s.hitchRatio, 2)}</td><td>${fixed(s.p95FrameMs, 2)}</td><td>${escapeHtml(s.primaryCause ?? 'none')}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>segment</th><th>time</th><th>frames</th><th>janky</th><th>hitch ms/s</th><th>p95 ms</th><th>primary cause</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** A self-contained HTML page: no scripts, no external resources. */
export function renderHtml(report: Report): string {
  const s = report.summary;
  const title = `jankscope${report.label ? `: ${report.label}` : ''}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:24px;color:#1d232a}
h1{font-size:20px}h2{font-size:16px;margin-top:28px}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.facts div{background:#f3f5f7;border-radius:6px;padding:8px}.facts b{display:block;font-size:18px}
.timeline{width:100%;height:160px;background:#fafbfc;border:1px solid #e3e7eb}
table{border-collapse:collapse;margin-top:8px}td,th{padding:4px 8px;border-bottom:1px solid #e3e7eb;text-align:left;vertical-align:top}
.small{font-size:12px;color:#56606a}.key{margin-right:12px}.key i,.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.bar{display:inline-block;height:10px;vertical-align:middle}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="small">${escapeHtml(`${report.device.manufacturer} ${report.device.model} · ${report.platform} ${report.device.osVersion} · ${report.device.refreshRate} Hz · ${report.buildType} · ${report.architecture} architecture · ${report.startedAt}`)}</p>
<div class="facts">
<div>frames<b>${s.frameCount}</b></div>
<div>janky<b>${s.jankyFrames} (${fixed(s.jankyPct, 2)}%)</b></div>
<div>dropped<b>${s.droppedFrames}</b></div>
<div>hitch ratio<b>${fixed(s.hitchRatio, 2)} ms/s</b></div>
<div>slow / frozen<b>${s.slowFrames} / ${s.frozenFrames}</b></div>
<div>p95 frame<b>${fixed(s.p95FrameMs, 2)} ms</b></div>
<div>primary cause<b>${escapeHtml(s.primaryCause ?? 'none')}</b></div>
</div>
<h2>Frame timeline</h2>
<p class="small">Bar height: frame duration (square-root scale, capped at 10 budgets). Dashed line: one frame budget.${report.framesTruncated ? ` Only the first ${report.frames.length} frames are in the report.` : ''}</p>
${timelineSvg(report)}
<p>${legend()}</p>
<h2>Causes</h2>
${causeTable(report)}
<h2>Segments</h2>
${segmentTable(report)}
<h2>Worst frames</h2>
${worstTable(report)}
</body></html>
`;
}
