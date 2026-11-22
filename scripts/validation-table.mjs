// Print the attribution validation table (Markdown) from example-app reports.
// Usage: node scripts/validation-table.mjs <report.json>...
import { readFileSync } from 'node:fs';

const EXPECTED = {
  idle: 'none',
  'js-blocked': 'js',
  'main-blocked': 'ui-other',
  'rerender-storm': '-',
  'heavy-mount': 'ui-mount',
  'many-animated': '-',
  'heavy-mount-styled': '-',
};
const CAUSES = ['js', 'ui-mount', 'ui-other', 'render-gpu', 'unknown'];
const files = process.argv.slice(2);
const reports = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
const fmt = (n, d = 1) => n.toFixed(d);
const share = (seg, cause) => (seg.hitchTimeMs > 0 ? (seg.causes[cause].hitchMs / seg.hitchTimeMs) * 100 : 0);

console.log('| platform | run | scenario | expected | primary | match | frames | janky % | hitch ms/s | hitch share js / mount / other / render / unknown |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const runs = {};
for (const report of reports) {
  runs[report.platform] = (runs[report.platform] ?? 0) + 1;
  for (const seg of report.segments) {
    const expected = EXPECTED[seg.name];
    if (expected === undefined) continue;
    const primary = seg.primaryCause ?? 'none';
    const match = expected === '-' ? '' : primary === expected ? 'yes' : 'NO';
    console.log(
      `| ${report.platform} | ${runs[report.platform]} | ${seg.name} | ${expected} | ${primary} | ${match} | ${seg.frameCount} | ${fmt(seg.jankyPct)} | ${fmt(seg.hitchRatio)} | ${CAUSES.map((c) => fmt(share(seg, c), 0)).join(' / ')} |`,
    );
  }
}
console.log('');
console.log('| platform | run | device | build | arch | UI-thread ms/frame | FrameMetrics thread ms/frame | heartbeat JS ms/s | heartbeat lateness p50 / p95 ms | overlay JS ms/update |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const counts = {};
for (const r of reports) {
  counts[r.platform] = (counts[r.platform] ?? 0) + 1;
  const o = r.overhead;
  console.log(
    `| ${r.platform} | ${counts[r.platform]} | ${r.device.model} (${r.device.osVersion}) | ${r.buildType} | ${r.architecture} | ${o.uiMsPerFrame} | ${o.backgroundMsPerFrame ?? '-'} | ${o.heartbeatJsMsPerSecond} | ${o.heartbeatLatenessP50Ms} / ${o.heartbeatLatenessP95Ms} | ${o.overlayJsMsPerUpdate ?? '-'} (${o.overlayUpdates} updates) |`,
  );
}
