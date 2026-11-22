/**
 * Checks on the native sources that compiling alone does not make: every
 * method of the TurboModule spec exists in both Android wrappers and in the
 * iOS module, and the collectors use the APIs the README describes.
 * Compiling is checked by scripts/android-compile-check.sh and an Xcode build.
 */
const fs = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const path = require('path') as { resolve(...parts: string[]): string };
const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

const spec = read('src/specs/NativeJankscope.ts');
const methods = (spec.match(/^\s+\w+\(.*\): .*;$/gm) || []).map((line) => /(\w+)\(/.exec(line)![1]);
const newArch = read('android/src/newarch/java/com/jankscope/JankscopeModule.java');
const oldArch = read('android/src/oldarch/java/com/jankscope/JankscopeModule.java');
const impl = read('android/src/main/java/com/jankscope/JankscopeModuleImpl.java');
const ios = read('ios/Jankscope.mm');

it('lists the spec methods', () => {
  expect(methods).toEqual(['start', 'stop', 'peek', 'nowMs', 'reportJsBusy', 'writeReport']);
});

it.each(methods)('implements %s in both Android wrappers and on iOS', (method) => {
  expect(newArch).toMatch(new RegExp(`@Override\\s+public \\w+ ${method}\\(`));
  expect(oldArch).toMatch(new RegExp(`@ReactMethod(\\(isBlockingSynchronousMethod = true\\))?\\s+public \\w+ ${method}\\(`));
  expect(ios).toMatch(new RegExp(`RCT_EXPORT_(METHOD\\(${method}\\b|SYNCHRONOUS_TYPED_METHOD\\(NSNumber \\*, ${method}\\))`));
});

it('records every FrameMetrics stage the README lists', () => {
  for (const metric of [
    'INTENDED_VSYNC_TIMESTAMP', 'VSYNC_TIMESTAMP', 'UNKNOWN_DELAY_DURATION', 'INPUT_HANDLING_DURATION',
    'ANIMATION_DURATION', 'LAYOUT_MEASURE_DURATION', 'DRAW_DURATION', 'SYNC_DURATION', 'COMMAND_ISSUE_DURATION',
    'SWAP_BUFFERS_DURATION', 'TOTAL_DURATION', 'GPU_DURATION', 'DEADLINE',
  ]) {
    expect(impl).toContain(`FrameMetrics.${metric}`);
  }
  expect(impl).toContain('addOnFrameMetricsAvailableListener');
  expect(impl).toContain('registerDisplayListener');
});

it('uses CADisplayLink at the maximum rate and a run loop observer on iOS', () => {
  expect(ios).toContain('preferredFrameRateRange = CAFrameRateRangeMake(rate, rate, rate)');
  expect(ios).toContain('kCFRunLoopAfterWaiting | kCFRunLoopBeforeWaiting');
  expect(ios).toContain('willMountComponentsWithRootTag');
  expect(ios).toContain('uiManagerWillPerformMounting');
});
