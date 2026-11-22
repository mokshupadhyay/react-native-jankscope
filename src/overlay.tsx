import * as React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Jankscope, recordOverlayUpdate, type LiveStats } from './api';

export interface JankscopeOverlayProps {
  /** How often the numbers refresh, ms. Default 1000. */
  intervalMs?: number;
  style?: StyleProp<ViewStyle>;
}

function now(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export function formatLiveStats(stats: LiveStats): string {
  if (!stats.running) return 'jankscope: not running';
  return `${Math.round(stats.fps)} fps · ${stats.jankyPct.toFixed(1)}% janky · last: ${stats.lastCause ?? '-'}`;
}

/**
 * A one-line overlay: frames per second, janky percentage since `start()` and
 * the cause of the last janky frame. It re-renders one `Text` once per
 * `intervalMs` and draws nothing else, so its own cost is one small commit per
 * update. The JS time of each update is recorded in `report.overhead`.
 */
export function JankscopeOverlay({ intervalMs = 1000, style }: JankscopeOverlayProps): React.ReactElement {
  const [text, setText] = React.useState('jankscope: not running');
  React.useEffect(() => {
    let cancelled = false;
    let busy = false;
    const id = setInterval(() => {
      if (busy) return;
      busy = true;
      Jankscope.live()
        .then((stats) => {
          if (cancelled) return;
          const started = now();
          setText(formatLiveStats(stats));
          if (stats.running) recordOverlayUpdate(now() - started);
        })
        .catch(() => undefined)
        .then(() => {
          busy = false;
        });
    }, Math.max(100, intervalMs));
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);
  return (
    <View pointerEvents="none" style={[styles.box, style]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 48,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  text: { color: '#fff', fontSize: 11, fontVariant: ['tabular-nums'] },
});
