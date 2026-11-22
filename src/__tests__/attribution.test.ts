import { attribute, type AttributionInput } from '../attribution';

const B = 1000 / 60;

type Overrides = Partial<Omit<AttributionInput, 'stages'>> & { stages?: Partial<AttributionInput['stages']> };

function input(overrides: Overrides): AttributionInput {
  return {
    platform: overrides.platform ?? 'android',
    budget: overrides.budget ?? B,
    uiMissed: overrides.uiMissed ?? true,
    jsStalled: overrides.jsStalled ?? false,
    stages: { js: 0, mount: 0, uiOther: 0, render: 0, ...overrides.stages },
  };
}

describe('attribute', () => {
  it('returns null for an on-time frame', () => {
    expect(attribute(input({ uiMissed: false, stages: { uiOther: 100 } }))).toBeNull();
  });

  it('blames js for an on-time UI frame while the JS thread stalled', () => {
    expect(attribute(input({ uiMissed: false, jsStalled: true, stages: { js: 16 } }))).toBe('js');
  });

  it('blames ui-other when other main-thread work dominates', () => {
    expect(attribute(input({ stages: { uiOther: 300, mount: 2, render: 3 } }))).toBe('ui-other');
  });

  it('blames ui-mount when mount is the larger part of main-thread work', () => {
    expect(attribute(input({ stages: { uiOther: 20, mount: 80, render: 3 } }))).toBe('ui-mount');
  });

  it('blames ui-mount on a tie between mount and other work', () => {
    expect(attribute(input({ stages: { uiOther: 10, mount: 10 } }))).toBe('ui-mount');
  });

  it('blames render-gpu on Android when render time dominates', () => {
    expect(attribute(input({ stages: { uiOther: 9, render: 30 } }))).toBe('render-gpu');
  });

  it('does not blame the UI thread for less than half a budget', () => {
    const half = B / 2;
    expect(attribute(input({ stages: { uiOther: half - 0.01, js: 0 } }))).toBe('unknown');
    expect(attribute(input({ stages: { uiOther: half } }))).toBe('ui-other');
  });

  it('blames js for a UI miss with idle UI and render but a busy JS thread', () => {
    expect(attribute(input({ stages: { js: 20, uiOther: 2, render: 2 } }))).toBe('js');
  });

  it('falls back to unknown on Android and unattributed render-gpu on iOS', () => {
    expect(attribute(input({ platform: 'android', stages: { uiOther: 1 } }))).toBe('unknown');
    expect(attribute(input({ platform: 'ios', stages: { uiOther: 1 } }))).toBe('render-gpu');
  });

  it('on iOS, prefers main-thread work over the unattributed remainder when it is larger', () => {
    expect(attribute(input({ platform: 'ios', stages: { uiOther: 40, render: 10 } }))).toBe('ui-other');
    expect(attribute(input({ platform: 'ios', stages: { uiOther: 10, render: 40 } }))).toBe('render-gpu');
  });

  it('scales the half-budget rule with the refresh rate', () => {
    const budget120 = 1000 / 120;
    expect(attribute(input({ budget: budget120, stages: { uiOther: 4.5 } }))).toBe('ui-other');
    expect(attribute(input({ budget: B, stages: { uiOther: 4.5 } }))).toBe('unknown');
  });
});
