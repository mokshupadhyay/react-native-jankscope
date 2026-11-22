import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Native frame collectors. Large results are JSON strings so that a session of
 * tens of thousands of frames crosses to JavaScript as one value; `src/raw.ts`
 * documents the layout.
 *
 * - `start(maxFrames)` attaches the collectors and resolves `{ startMs, device,
 *   debug, newArch }` (JSON). `maxFrames` is the capacity of each ring buffer.
 * - `stop()` detaches them and resolves the whole session (JSON).
 * - `peek()` resolves the ticks, FrameMetrics records and mount windows recorded
 *   since the previous `peek()` (JSON), for the live overlay.
 * - `nowMs()` returns the native monotonic clock used by every record, in ms.
 * - `reportJsBusy(windows)` adds `[start, end, ...]` JS-busy windows in the
 *   `nowMs()` clock.
 * - `writeReport(fileName, json)` writes a report and resolves its path.
 */
export interface Spec extends TurboModule {
  start(maxFrames: number): Promise<string>;
  stop(): Promise<string>;
  peek(): Promise<string>;
  nowMs(): number;
  reportJsBusy(windows: Array<number>): void;
  writeReport(fileName: string, json: string): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('Jankscope');
