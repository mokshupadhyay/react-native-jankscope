// Break the code each property test guards, one mutation at a time, and check
// that the property fails. Every file is restored afterwards, also on errors.
// Usage: node scripts/mutation-check.mjs   (results go to stdout)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jest = require.resolve('jest/bin/jest');

const MUTATIONS = [
  {
    property: 'P1',
    name: 'a cause loses half of each frame\'s hitch time',
    file: 'src/report.ts',
    from: 'entry.hitchMs += frame.hitch;',
    to: 'entry.hitchMs += frame.hitch / 2;',
  },
  {
    property: 'P1',
    name: 'janky frames without a cause are not counted under unknown',
    file: 'src/report.ts',
    from: "const entry = causes[frame.cause ?? 'unknown'];\n    entry.count++;",
    to: "const entry = causes[frame.cause ?? 'unknown'];\n    if (frame.cause !== 'unknown') entry.count++;",
  },
  {
    property: 'P2',
    name: 'janky % counts dropped frames instead of janky frames',
    file: 'src/report.ts',
    from: 'jankyPct: frames.length > 0 ? (jankyFrames / frames.length) * 100 : 0,',
    to: 'jankyPct: frames.length > 0 ? (droppedFrames / frames.length) * 100 : 0,',
  },
  {
    property: 'P3',
    name: 'the change ignores its direction',
    file: 'src/cli/compare.ts',
    from: 'const delta = head - base;\n  if (delta === 0) return 0;',
    to: 'const delta = Math.abs(head - base);\n  if (delta === 0) return 0;',
  },
  {
    property: 'P3',
    name: 'the change is divided by a signed base',
    file: 'src/cli/compare.ts',
    from: 'return (delta / Math.abs(base)) * 100;',
    to: 'return (delta / base) * 100;',
  },
  {
    property: 'P3',
    name: 'an improvement is reported as unchanged',
    file: 'src/cli/compare.ts',
    from: ": size < -limit ? 'improvement' : 'unchanged';",
    to: ": size < -limit * 2 ? 'improvement' : 'unchanged';",
  },
];

function runProperty(property) {
  const result = spawnSync(
    process.execPath,
    [jest, 'src/__tests__/properties.test.ts', '-t', `${property}:`, '--ci', '--silent'],
    { encoding: 'utf8', timeout: 180000 },
  );
  return { failed: result.status !== 0, output: `${result.stdout}${result.stderr}` };
}

let survived = 0;
const baseline = ['P1', 'P2', 'P3'].map((p) => [p, runProperty(p).failed]);
for (const [p, failed] of baseline) {
  console.log(`baseline ${p}: ${failed ? 'FAILS (fix the code first)' : 'passes'}`);
  if (failed) process.exit(1);
}
for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, 'utf8');
  if (!original.includes(mutation.from)) {
    console.log(`SKIPPED ${mutation.property} "${mutation.name}": pattern not found in ${mutation.file}`);
    survived++;
    continue;
  }
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const { failed, output } = runProperty(mutation.property);
    const counterexample = /Counterexample: (.*)/.exec(output);
    console.log(
      `${failed ? 'KILLED  ' : 'SURVIVED'} ${mutation.property} "${mutation.name}" (${mutation.file})` +
        (counterexample ? `\n         counterexample: ${counterexample[1].slice(0, 160)}` : ''),
    );
    if (!failed) survived++;
  } finally {
    writeFileSync(mutation.file, original);
  }
}
console.log(survived === 0 ? 'all mutations killed' : `${survived} mutation(s) survived`);
process.exit(survived === 0 ? 0 : 1);
