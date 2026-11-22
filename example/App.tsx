import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Jankscope, JankscopeOverlay, type Report } from 'react-native-jankscope';

/**
 * Scenarios that cause known jank, so jankscope's attribution can be checked.
 * The app runs all of them once on launch inside one session, each inside a
 * `Jankscope.mark()`, with an idle gap after each so late frames do not spill
 * into the next segment. The report is saved and summarized on screen.
 */

const SCENARIO_MS = 6000;
const GAP_MS = 1500;

type ScenarioId =
  | 'idle'
  | 'js-blocked'
  | 'main-blocked'
  | 'rerender-storm'
  | 'heavy-mount'
  | 'many-animated'
  | 'heavy-mount-styled';

export const SCENARIOS: Array<{ id: ScenarioId; title: string; expected: string }> = [
  { id: 'idle', title: '1. Idle animation baseline', expected: 'none' },
  { id: 'js-blocked', title: '2. JS thread blocked (300 ms busy loop every second)', expected: 'js' },
  { id: 'main-blocked', title: '3. Main thread blocked (300 ms native busy loop every second)', expected: 'ui-other' },
  { id: 'rerender-storm', title: '4. Re-render storm (400 components every frame)', expected: 'js' },
  { id: 'heavy-mount', title: '5. Heavy mount (1500 plain views, mounted and unmounted)', expected: 'ui-mount' },
  { id: 'many-animated', title: '6. 300 views animated with the native driver', expected: '-' },
  {
    id: 'heavy-mount-styled',
    title: '7. Heavy mount of styled views (1500 coloured, rounded views with a child)',
    expected: '- (draw cost of new views counts as ui-other)',
  },
];

const helpers = NativeModules.ExampleHelpers as { blockMainThread(ms: number): void } | undefined;

function busyWait(ms: number) {
  const end = Date.now() + ms;
  let spin = 0;
  while (Date.now() < end) spin++;
  return spin;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spins forever on the native driver: frames keep being drawn on both platforms. */
function Spinner() {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />;
}

function StormCell({ tick, index }: { tick: number; index: number }) {
  // Some work per render so the storm is JS-bound.
  let x = 0;
  for (let i = 0; i < 200; i++) x += Math.sqrt(i + tick + index);
  return <View style={[styles.cell, { opacity: 0.5 + ((tick + index) % 10) / 20 + (x % 1) * 0 }]} />;
}

function RerenderStorm() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let id = 0;
    const step = () => {
      setTick((t) => t + 1);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <View style={styles.grid}>
      {Array.from({ length: 400 }, (_, i) => (
        <StormCell key={i} tick={tick} index={i} />
      ))}
    </View>
  );
}

/**
 * Mounts and unmounts many native views every 750 ms. `collapsable={false}`
 * keeps React Native from flattening them away. Plain views are cheap to draw,
 * so the frame's UI time is mostly mount work; styled views also cost a lot to
 * draw the first time, which shows up as draw time (ui-other), not mount.
 */
function HeavyMount({ styled }: { styled: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setShown((s) => !s), 750);
    return () => clearInterval(id);
  }, []);
  if (!shown) return null;
  return (
    <View style={styles.grid}>
      {Array.from({ length: 1500 }, (_, i) =>
        styled ? (
          <View key={i} style={[styles.mountCell, { backgroundColor: i % 2 ? '#4b7bec' : '#20bf6b' }]}>
            <View style={styles.mountInner} />
          </View>
        ) : (
          <View key={i} collapsable={false} style={styles.plainCell} />
        ),
      )}
    </View>
  );
}

function ManyAnimated() {
  const values = useRef(Array.from({ length: 300 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = values.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1, duration: 600 + (i % 7) * 50, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 600 + (i % 7) * 50, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [values]);
  return (
    <View style={styles.grid}>
      {values.map((value, i) => (
        <Animated.View
          key={i}
          style={[styles.cell, { transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, 12] }) }, { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) }] }]}
        />
      ))}
    </View>
  );
}

function ScenarioView({ id }: { id: ScenarioId | null }) {
  useEffect(() => {
    if (id === 'js-blocked') {
      const timer = setInterval(() => busyWait(300), 1000);
      return () => clearInterval(timer);
    }
    if (id === 'main-blocked') {
      const timer = setInterval(() => helpers?.blockMainThread(300), 1000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [id]);
  if (id === 'rerender-storm') return <RerenderStorm />;
  if (id === 'heavy-mount') return <HeavyMount styled={false} />;
  if (id === 'heavy-mount-styled') return <HeavyMount styled />;
  if (id === 'many-animated') return <ManyAnimated />;
  return null;
}

let runCount = 0;

// Run state lives outside the component: if Android recreates the activity,
// React remounts App while a run is still going, and the new mount must
// attach to that run instead of starting a second session.
interface RunState {
  scenario: ScenarioId | null;
  status: string;
  report: Report | null;
}
let runState: RunState = { scenario: null, status: 'starting', report: null };
let inFlight = false;
let autoStarted = false;
const listeners = new Set<(state: RunState) => void>();
function update(patch: Partial<RunState>) {
  runState = { ...runState, ...patch };
  listeners.forEach((listener) => listener(runState));
}

async function runAll() {
  if (inFlight) return;
  inFlight = true;
  update({ report: null });
  try {
    await sleep(1500);
    await Jankscope.start({ label: `example-${Platform.OS}` });
    for (const entry of SCENARIOS) {
      update({ status: `running ${entry.title}`, scenario: entry.id });
      Jankscope.mark(entry.id);
      await sleep(SCENARIO_MS);
      update({ scenario: null });
      Jankscope.mark(`gap:${entry.id}`);
      await sleep(GAP_MS);
    }
    const result = await Jankscope.stop({ includeRaw: true });
    runCount++;
    const path = await Jankscope.saveReport(
      result,
      `example-${Platform.OS}-${result.buildType}-${Date.now()}-${runCount}.json`,
    );
    for (const segment of result.segments) {
      if (segment.name.startsWith('gap:')) continue;
      console.log(
        `[jankscope-example] ${segment.name}: frames=${segment.frameCount} janky=${segment.jankyFrames} (${segment.jankyPct.toFixed(1)}%) primary=${segment.primaryCause ?? 'none'}`,
      );
    }
    update({ report: result, status: `saved ${path}` });
  } catch (error) {
    update({ status: `error: ${String(error)}` });
    if (Jankscope.isRunning()) await Jankscope.stop().catch(() => undefined);
  } finally {
    inFlight = false;
    update({ scenario: null });
  }
}

export default function App() {
  const [{ scenario, status, report }, setState] = useState<RunState>(runState);

  useEffect(() => {
    listeners.add(setState);
    setState(runState);
    if (!autoStarted) {
      autoStarted = true;
      runAll();
    }
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>jankscope example</Text>
      <Spinner />
      <Text style={styles.status}>{status}</Text>
      <Pressable style={styles.button} onPress={runAll}>
        <Text style={styles.buttonText}>Run all scenarios again</Text>
      </Pressable>
      {report ? (
        <ScrollView style={styles.results}>
          <Text style={styles.mono}>
            {`${report.device.model} · ${report.buildType} · ${report.architecture} arch\n`}
            {`janky ${report.summary.jankyPct.toFixed(1)}% · hitch ${report.summary.hitchRatio.toFixed(1)} ms/s\n\n`}
            {report.segments
              .filter((s) => !s.name.startsWith('gap:'))
              .map((s) => {
                const expected = SCENARIOS.find((e) => e.id === s.name)?.expected ?? '-';
                return `${s.name.padEnd(15)} ${String(s.jankyFrames).padStart(4)} janky  primary ${s.primaryCause ?? 'none'} (expected ${expected})`;
              })
              .join('\n')}
          </Text>
        </ScrollView>
      ) : (
        <View style={styles.stage}>
          <ScenarioView id={scenario} />
        </View>
      )}
      <JankscopeOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 56, paddingHorizontal: 12, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: '600' },
  status: { marginVertical: 6, fontSize: 12, color: '#333' },
  spinner: { width: 32, height: 32, backgroundColor: '#e8a33d', marginVertical: 8 },
  button: { backgroundColor: '#1d232a', padding: 8, borderRadius: 6, alignSelf: 'flex-start' },
  buttonText: { color: '#fff' },
  stage: { flex: 1, marginTop: 8, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: 14, height: 14, margin: 1, backgroundColor: '#7b5cd6' },
  mountCell: { width: 8, height: 8, margin: 1, borderRadius: 2 },
  plainCell: { width: 8, height: 8, margin: 1 },
  mountInner: { flex: 1, margin: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  results: { flex: 1, marginTop: 8 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 },
});
