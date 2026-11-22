# Mutation evidence for the property tests

The property tests in [`src/__tests__/properties.test.ts`](../src/__tests__/properties.test.ts) use [fast-check](https://github.com/dubzzz/fast-check). A property is only useful if it fails when the code it guards is wrong. [`scripts/mutation-check.mjs`](../scripts/mutation-check.mjs) checks that: it first runs each property on the unchanged code (all must pass), then applies one mutation at a time to the source, runs only the property that guards it, and restores the file afterwards (in a `finally`, also when the run fails).

```sh
node scripts/mutation-check.mjs
```

## Properties

| | Property | Inputs |
| --- | --- | --- |
| P1 | Total hitch time, janky frames and dropped frames equal the sums of the per-cause totals. | Arbitrary frames (300 runs), and frames built by `buildFrames()` from synthetic iOS and Android sessions with vsync skips, main-thread busy time, FrameMetrics records, mount windows and JS-busy windows (200 runs). |
| P2 | Janky % is within [0, 100]. | The same two generators. |
| P3 | `compare` is symmetric in the sign of the change: swapping base and head flips the sign of `relativeChange` (1000 runs) and, for `compareValues` with an absolute threshold, flips the sign of `delta` and `changePct` and turns a regression into an improvement and back (500 runs). | Arbitrary values in [-1000, 1000]; sides of 1 to 9 runs. |

## Result (run on 2026-11-22)

All three properties passed on the unchanged code, and every mutation was detected ("killed").

| Property | Mutation | File | Result | Counterexample fast-check found (shrunk, truncated) |
| --- | --- | --- | --- | --- |
| P1 | A cause gets half of each frame's hitch time (`entry.hitchMs += frame.hitch / 2`) | `src/report.ts` | killed | one janky frame with `hitch: 0.000002` |
| P1 | Janky frames with cause `unknown` are not counted | `src/report.ts` | killed | one janky frame with `cause: "unknown"` |
| P2 | Janky % divides dropped frames instead of janky frames | `src/report.ts` | killed | one janky frame with `dropped: 2` (200%) |
| P3 | The change drops its direction (`Math.abs(head - base)`) | `src/cli/compare.ts` | killed | `[0, 5e-324]` |
| P3 | The change is divided by a signed base (`delta / base`) | `src/cli/compare.ts` | killed | `[0, -5e-324]` |
| P3 | An improvement must be twice the threshold to count | `src/cli/compare.ts` | killed | base `[0]`, head `[0, 3e-323]`, threshold `1e-323` |

The output of that run:

```text
baseline P1: passes
baseline P2: passes
baseline P3: passes
KILLED   P1 "a cause loses half of each frame's hitch time" (src/report.ts)
KILLED   P1 "janky frames without a cause are not counted under unknown" (src/report.ts)
KILLED   P2 "janky % counts dropped frames instead of janky frames" (src/report.ts)
KILLED   P3 "the change ignores its direction" (src/cli/compare.ts)
KILLED   P3 "the change is divided by a signed base" (src/cli/compare.ts)
KILLED   P3 "an improvement is reported as unchanged" (src/cli/compare.ts)
all mutations killed
```

## Limits

- The mutations are hand-written, six in total, aimed at the code each property claims to guard. This is not a full mutation-testing run (no tool generated mutants over the whole code base), so it says nothing about code outside these three properties. The attribution rules are covered by example-based tests in `attribution.test.ts` and `frames.test.ts`, not by these properties.
- The counterexamples are what fast-check reported on that run. With a different seed they can differ; the result (killed) is what the script checks.
