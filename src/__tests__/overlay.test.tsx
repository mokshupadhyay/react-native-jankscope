import * as React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { formatLiveStats, JankscopeOverlay } from '../overlay';

it('formats the live numbers on one line', () => {
  expect(formatLiveStats({ running: true, fps: 59.6, jankyPct: 3.14, lastCause: 'ui-mount' })).toBe(
    '60 fps · 3.1% janky · last: ui-mount',
  );
  expect(formatLiveStats({ running: false, fps: 0, jankyPct: 0, lastCause: null })).toBe('jankscope: not running');
});

it('renders one text and updates it on an interval', async () => {
  jest.useFakeTimers();
  await render(<JankscopeOverlay intervalMs={200} />);
  expect(screen.getByText('jankscope: not running')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  expect(screen.getByText('jankscope: not running')).toBeTruthy();
  jest.useRealTimers();
});
