import type { FrameStages, JankCause, JankscopePlatform } from './types';

export interface AttributionInput {
  platform: JankscopePlatform;
  budget: number;
  uiMissed: boolean;
  jsStalled: boolean;
  stages: FrameStages;
}

/**
 * Primary cause of a missed frame, or `null` for a frame that was on time.
 * The rules are documented in the README ("How attribution works"); keep both in sync.
 *
 * 1. On time on the UI side but the JS thread stalled: `js`.
 * 2. UI/main-thread work (mount + other) of at least half a budget, and at least
 *    as much as render time: `ui-mount` if mount is the larger part, else `ui-other`.
 * 3. Android: render time (sync + command issue + swap, or GPU) of at least half a budget: `render-gpu`.
 * 4. JS busy for at least half a budget inside the frame: `js`.
 * 5. iOS: `render-gpu` (unattributed: the main and JS threads were mostly idle).
 *    Android: `unknown`.
 */
export function attribute(input: AttributionInput): JankCause | null {
  const { budget, stages } = input;
  if (!input.uiMissed) return input.jsStalled ? 'js' : null;
  const half = budget / 2;
  const main = stages.mount + stages.uiOther;
  if (main >= half && main >= stages.render) {
    return stages.mount >= stages.uiOther ? 'ui-mount' : 'ui-other';
  }
  if (input.platform === 'android' && stages.render >= half) return 'render-gpu';
  if (stages.js >= half) return 'js';
  return input.platform === 'ios' ? 'render-gpu' : 'unknown';
}
