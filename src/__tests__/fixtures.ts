import type { RawSession } from '../raw';
import { METRIC_STRIDE, TICK_STRIDE } from '../raw';

/** Builders for synthetic native sessions. All inputs in ms; stored as µs like the native side. */

export const us = (ms: number) => Math.round(ms * 1000);

export function rawSession(overrides: Partial<RawSession> = {}): RawSession {
  return {
    v: 1,
    platform: 'ios',
    startMs: 1000,
    stopMs: 2000,
    device: { model: 'Test', manufacturer: 'Test', os: 'ios', osVersion: '1', refreshRate: 60 },
    debug: false,
    newArch: true,
    ticks: [],
    metrics: [],
    mounts: [],
    jsBusy: [],
    refresh: [0, 60],
    lost: { ticks: 0, metrics: 0, mounts: 0, jsBusy: 0 },
    cost: { uiNs: 0, uiCalls: 0, bgNs: 0, bgCalls: 0 },
    ...overrides,
  };
}

export interface TickSpec {
  vsync: number;
  callback?: number;
  budget?: number;
  mainBusy?: number;
}

export function ticks(list: TickSpec[]): number[] {
  const out: number[] = [];
  for (const t of list) {
    const budget = t.budget ?? 1000 / 60;
    out.push(us(t.vsync), us(t.callback ?? t.vsync + 0.5), us(budget), t.mainBusy == null ? -1 : us(t.mainBusy), us(t.vsync + budget));
  }
  expect(out.length).toBe(list.length * TICK_STRIDE);
  return out;
}

/** Evenly spaced ticks from `from` for `count` vsyncs at `hz`. */
export function steadyTicks(from: number, count: number, hz = 60, mainBusy = 2): TickSpec[] {
  const period = 1000 / hz;
  return Array.from({ length: count }, (_, i) => ({ vsync: from + i * period, budget: period, mainBusy }));
}

export interface MetricSpec {
  vsync: number;
  intended?: number;
  delay?: number;
  input?: number;
  animation?: number;
  layout?: number;
  draw?: number;
  sync?: number;
  command?: number;
  swap?: number;
  total?: number;
  gpu?: number | null;
  deadline?: number | null;
}

export function metrics(list: MetricSpec[]): number[] {
  const out: number[] = [];
  for (const m of list) {
    const parts = [m.delay ?? 0.5, m.input ?? 0, m.animation ?? 1, m.layout ?? 0.5, m.draw ?? 1, m.sync ?? 0.5, m.command ?? 1, m.swap ?? 0.5];
    const total = m.total ?? parts.reduce((a, b) => a + b, 0);
    out.push(
      us(m.intended ?? m.vsync),
      us(m.vsync),
      ...parts.map(us),
      us(total),
      m.gpu == null ? -1 : us(m.gpu),
      m.deadline == null ? -1 : us(m.deadline),
      us(m.vsync + total + 1),
    );
  }
  expect(out.length).toBe(list.length * METRIC_STRIDE);
  return out;
}
