package com.jankscope;

import android.app.Activity;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.view.Choreographer;
import android.view.Display;
import android.view.FrameMetrics;
import android.view.Window;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.UiThreadUtil;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * Shared implementation behind the old- and new-architecture modules.
 *
 * <ul>
 *   <li>A Choreographer frame callback records every vsync the UI thread
 *       handles (also when nothing is drawn), so skipped vsyncs show up.</li>
 *   <li>{@code Window.addOnFrameMetricsAvailableListener} (API 24+) records the
 *       stage durations of every drawn frame on a background HandlerThread.</li>
 *   <li>{@link MountTracker} records React Native mount work on the UI thread.</li>
 *   <li>A DisplayManager listener re-reads the refresh rate when it changes.</li>
 * </ul>
 *
 * Times are microseconds since {@code start()} on {@link System#nanoTime()},
 * the clock FrameMetrics and Choreographer use. The JSON layout is documented
 * in src/raw.ts.
 */
final class JankscopeModuleImpl implements LifecycleEventListener {
  static final String NAME = "Jankscope";
  static final String TAG = "Jankscope";

  private static final int TICK_STRIDE = 5;
  private static final int METRIC_STRIDE = 14;
  private static final Pattern FILE_NAME = Pattern.compile("[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}\\.json");

  private final ReactApplicationContext context;
  private final boolean newArchitecture;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final HandlerThread metricsThread = new HandlerThread("jankscope-frame-metrics");
  private final Handler metricsHandler;
  private final MountTracker mountTracker;

  // Session state. `running` and the rings are read from several threads.
  private volatile boolean running;
  private volatile long startNs;
  private volatile long budgetUs = 16667;
  private RecordRing ticks = new RecordRing(TICK_STRIDE, 1);
  private RecordRing metrics = new RecordRing(METRIC_STRIDE, 1);
  private RecordRing mounts = new RecordRing(2, 1);
  private RecordRing jsBusy = new RecordRing(2, 1);
  private RecordRing refresh = new RecordRing(2, 64);
  private final AtomicLong uiNs = new AtomicLong();
  private final AtomicLong uiCalls = new AtomicLong();
  private final AtomicLong bgNs = new AtomicLong();
  private final AtomicLong bgCalls = new AtomicLong();

  // UI-thread state.
  @Nullable private Choreographer choreographer;
  @Nullable private Window attachedWindow;
  @Nullable private Object frameMetricsListener;
  @Nullable private Display display;
  @Nullable private DisplayManager.DisplayListener displayListener;
  private final long[] tickRecord = new long[TICK_STRIDE];
  private boolean invalidated;

  JankscopeModuleImpl(ReactApplicationContext context, boolean newArchitecture) {
    this.context = context;
    this.newArchitecture = newArchitecture;
    metricsThread.start();
    metricsHandler = new Handler(metricsThread.getLooper());
    mountTracker = new MountTracker(context, newArchitecture, this);
    context.addLifecycleEventListener(this);
  }

  long toUs(long nanos) {
    return (nanos - startNs) / 1000;
  }

  /** Called by MountTracker on the UI thread. */
  void recordMount(long startNanos, long endNanos) {
    if (!running) return;
    mounts.add(new long[] {toUs(startNanos), toUs(endNanos)});
  }

  void addUiCost(long nanos) {
    uiNs.addAndGet(nanos);
    uiCalls.incrementAndGet();
  }

  boolean isRunning() {
    return running;
  }

  // ---------------------------------------------------------------- module API

  double nowMs() {
    return System.nanoTime() / 1e6;
  }

  void start(double maxFrames, final Promise promise) {
    if (running || invalidated) {
      promise.reject("ALREADY_RUNNING", "A jankscope session is already running.");
      return;
    }
    final int capacity = (int) Math.max(100, Math.min(1_000_000, maxFrames));
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        try {
          ticks = new RecordRing(TICK_STRIDE, capacity);
          metrics = new RecordRing(METRIC_STRIDE, capacity);
          mounts = new RecordRing(2, capacity);
          jsBusy = new RecordRing(2, capacity);
          refresh = new RecordRing(2, 64);
          uiNs.set(0);
          uiCalls.set(0);
          bgNs.set(0);
          bgCalls.set(0);
          startNs = System.nanoTime();
          running = true;
          attachToActivity(context.getCurrentActivity());
          mountTracker.attach();
          choreographer = Choreographer.getInstance();
          choreographer.postFrameCallback(frameCallback);
          StringBuilder out = new StringBuilder(256);
          out.append("{\"startMs\":").append(startNs / 1e6).append('}');
          promise.resolve(out.toString());
        } catch (RuntimeException error) {
          running = false;
          promise.reject("START_FAILED", error.getMessage(), error);
        }
      }
    });
  }

  void stop(final Promise promise) {
    if (!running) {
      promise.reject("NOT_RUNNING", "No jankscope session is running.");
      return;
    }
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        final long stopNs = System.nanoTime();
        detachAll();
        running = false;
        // Serialize off the UI thread, after FrameMetrics callbacks already queued.
        metricsHandler.post(new Runnable() {
          @Override
          public void run() {
            try {
              promise.resolve(sessionJson(stopNs, true));
            } catch (RuntimeException error) {
              promise.reject("STOP_FAILED", error.getMessage(), error);
            }
          }
        });
      }
    });
  }

  void peek(final Promise promise) {
    if (!running) {
      promise.reject("NOT_RUNNING", "No jankscope session is running.");
      return;
    }
    promise.resolve(sessionJson(System.nanoTime(), false));
  }

  void reportJsBusy(ReadableArray windows) {
    if (!running) return;
    long[] record = new long[2];
    long startNanos = startNs;
    for (int i = 0; i + 1 < windows.size(); i += 2) {
      record[0] = (long) (windows.getDouble(i) * 1e6 - startNanos) / 1000;
      record[1] = (long) (windows.getDouble(i + 1) * 1e6 - startNanos) / 1000;
      if (record[1] > record[0]) jsBusy.add(record);
    }
  }

  void writeReport(String fileName, String json, Promise promise) {
    if (fileName == null || !FILE_NAME.matcher(fileName).matches()) {
      promise.reject("INVALID_FILE_NAME", "Invalid report file name.");
      return;
    }
    File base = context.getExternalFilesDir(null);
    if (base == null) base = context.getFilesDir();
    File dir = new File(base, "jankscope");
    if (!dir.isDirectory() && !dir.mkdirs()) {
      dir = new File(context.getFilesDir(), "jankscope");
      if (!dir.isDirectory() && !dir.mkdirs()) {
        promise.reject("WRITE_FAILED", "Cannot create " + dir.getAbsolutePath());
        return;
      }
    }
    File file = new File(dir, fileName);
    OutputStream stream = null;
    try {
      stream = new FileOutputStream(file);
      stream.write(json.getBytes(Charset.forName("UTF-8")));
      stream.flush();
      Log.i(TAG, "report saved: " + file.getAbsolutePath());
      promise.resolve(file.getAbsolutePath());
    } catch (IOException error) {
      promise.reject("WRITE_FAILED", error.getMessage(), error);
    } finally {
      if (stream != null) {
        try {
          stream.close();
        } catch (IOException ignored) {
          // Already reported or written.
        }
      }
    }
  }

  void invalidate() {
    if (invalidated) return;
    invalidated = true;
    context.removeLifecycleEventListener(this);
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        running = false;
        detachAll();
        metricsThread.quitSafely();
      }
    });
  }

  // ------------------------------------------------------------- lifecycle

  @Override
  public void onHostResume() {
    if (!running) return;
    // A new activity (or a recreated one) has a new window: attach to it.
    attachToActivity(context.getCurrentActivity());
    mountTracker.attach();
  }

  @Override
  public void onHostPause() {}

  @Override
  public void onHostDestroy() {
    if (!running) return;
    detachWindow();
  }

  // ------------------------------------------------------------- collectors

  private final Choreographer.FrameCallback frameCallback = new Choreographer.FrameCallback() {
    @Override
    public void doFrame(long frameTimeNanos) {
      if (!running) return;
      long now = System.nanoTime();
      tickRecord[0] = toUs(frameTimeNanos);
      tickRecord[1] = toUs(now);
      tickRecord[2] = budgetUs;
      tickRecord[3] = -1;
      tickRecord[4] = -1;
      ticks.add(tickRecord);
      Choreographer target = choreographer;
      if (target != null) target.postFrameCallback(this);
      addUiCost(System.nanoTime() - now);
    }
  };

  private void attachToActivity(@Nullable Activity activity) {
    UiThreadUtil.assertOnUiThread();
    Window window = activity != null ? activity.getWindow() : null;
    if (window != null && window == attachedWindow) return;
    detachWindow();
    if (activity == null || window == null) return;
    attachDisplay(activity);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      FrameMetricsCollector listener = new FrameMetricsCollector();
      window.addOnFrameMetricsAvailableListener(listener, metricsHandler);
      frameMetricsListener = listener;
    }
    attachedWindow = window;
  }

  private void detachWindow() {
    Window window = attachedWindow;
    attachedWindow = null;
    if (window != null && frameMetricsListener != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      try {
        window.removeOnFrameMetricsAvailableListener((Window.OnFrameMetricsAvailableListener) frameMetricsListener);
      } catch (IllegalArgumentException ignored) {
        // Already removed with the window.
      }
    }
    frameMetricsListener = null;
    detachDisplay();
  }

  private void detachAll() {
    Choreographer target = choreographer;
    if (target != null) target.removeFrameCallback(frameCallback);
    choreographer = null;
    detachWindow();
    mountTracker.detach();
  }

  @SuppressWarnings("deprecation") // getDefaultDisplay() is the only option below API 30.
  private void attachDisplay(Activity activity) {
    display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        ? activity.getDisplay()
        : activity.getWindowManager().getDefaultDisplay();
    readRefreshRate();
    final DisplayManager manager = (DisplayManager) activity.getSystemService(Context.DISPLAY_SERVICE);
    if (manager == null || display == null) return;
    final int displayId = display.getDisplayId();
    displayListener = new DisplayManager.DisplayListener() {
      @Override
      public void onDisplayAdded(int id) {}

      @Override
      public void onDisplayRemoved(int id) {}

      @Override
      public void onDisplayChanged(int id) {
        if (id == displayId) readRefreshRate();
      }
    };
    manager.registerDisplayListener(displayListener, mainHandler);
  }

  private void detachDisplay() {
    DisplayManager.DisplayListener listener = displayListener;
    displayListener = null;
    if (listener == null) return;
    DisplayManager manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
    if (manager != null) manager.unregisterDisplayListener(listener);
  }

  private void readRefreshRate() {
    Display current = display;
    float hz = current != null ? current.getRefreshRate() : 60f;
    if (!(hz > 1f)) hz = 60f;
    long us = Math.round(1e6 / hz);
    if (us == budgetUs && refresh.size() > 0) return;
    budgetUs = us;
    refresh.add(new long[] {toUs(System.nanoTime()), Math.round(hz)});
  }

  private final class FrameMetricsCollector implements Window.OnFrameMetricsAvailableListener {
    private final long[] record = new long[METRIC_STRIDE];

    @Override
    public void onFrameMetricsAvailable(Window window, FrameMetrics frame, int dropCountSinceLastInvocation) {
      if (!running) return;
      long now = System.nanoTime();
      boolean timestamps = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
      boolean api31 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
      record[0] = timestamps ? toUs(frame.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP)) : -1;
      record[1] = timestamps ? toUs(frame.getMetric(FrameMetrics.VSYNC_TIMESTAMP)) : -1;
      record[2] = frame.getMetric(FrameMetrics.UNKNOWN_DELAY_DURATION) / 1000;
      record[3] = frame.getMetric(FrameMetrics.INPUT_HANDLING_DURATION) / 1000;
      record[4] = frame.getMetric(FrameMetrics.ANIMATION_DURATION) / 1000;
      record[5] = frame.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION) / 1000;
      record[6] = frame.getMetric(FrameMetrics.DRAW_DURATION) / 1000;
      record[7] = frame.getMetric(FrameMetrics.SYNC_DURATION) / 1000;
      record[8] = frame.getMetric(FrameMetrics.COMMAND_ISSUE_DURATION) / 1000;
      record[9] = frame.getMetric(FrameMetrics.SWAP_BUFFERS_DURATION) / 1000;
      record[10] = frame.getMetric(FrameMetrics.TOTAL_DURATION) / 1000;
      record[11] = api31 ? frame.getMetric(FrameMetrics.GPU_DURATION) / 1000 : -1;
      record[12] = api31 ? frame.getMetric(FrameMetrics.DEADLINE) / 1000 : -1;
      record[13] = toUs(now);
      metrics.add(record);
      bgNs.addAndGet(System.nanoTime() - now);
      bgCalls.incrementAndGet();
    }
  }

  // ------------------------------------------------------------- JSON

  private static void appendQuoted(StringBuilder out, @Nullable String value) {
    out.append('"');
    String text = value == null ? "" : value;
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (c == '"' || c == '\\') {
        out.append('\\').append(c);
      } else if (c < 0x20) {
        out.append(String.format("\\u%04x", (int) c));
      } else {
        out.append(c);
      }
    }
    out.append('"');
  }

  private int maxRefreshRate() {
    Display current = display;
    float best = current != null ? current.getRefreshRate() : 60f;
    if (current != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      for (Display.Mode mode : current.getSupportedModes()) best = Math.max(best, mode.getRefreshRate());
    }
    return Math.round(best > 1f ? best : 60f);
  }

  private String sessionJson(long stopNs, boolean all) {
    StringBuilder out = new StringBuilder((int) Math.min(64L * 1024 * 1024, 64 + ticks.size() * 40 + metrics.size() * 80));
    boolean debug = (context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    out.append("{\"v\":1,\"platform\":\"android\",\"startMs\":").append(startNs / 1e6);
    out.append(",\"stopMs\":").append(stopNs / 1e6);
    out.append(",\"device\":{\"model\":");
    appendQuoted(out, Build.MODEL);
    out.append(",\"manufacturer\":");
    appendQuoted(out, Build.MANUFACTURER);
    out.append(",\"os\":\"android\",\"osVersion\":");
    appendQuoted(out, Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
    out.append(",\"refreshRate\":").append(maxRefreshRate()).append('}');
    out.append(",\"debug\":").append(debug);
    out.append(",\"newArch\":").append(newArchitecture);
    appendRing(out, "ticks", ticks, all);
    appendRing(out, "metrics", metrics, all);
    appendRing(out, "mounts", mounts, all);
    appendRing(out, "jsBusy", jsBusy, all);
    out.append(",\"refresh\":[");
    refresh.appendAll(out);
    out.append(']');
    out.append(",\"lost\":{\"ticks\":").append(ticks.lost());
    out.append(",\"metrics\":").append(metrics.lost());
    out.append(",\"mounts\":").append(mounts.lost());
    out.append(",\"jsBusy\":").append(jsBusy.lost()).append('}');
    out.append(",\"cost\":{\"uiNs\":").append(uiNs.get());
    out.append(",\"uiCalls\":").append(uiCalls.get());
    out.append(",\"bgNs\":").append(bgNs.get());
    out.append(",\"bgCalls\":").append(bgCalls.get()).append("}}");
    return out.toString();
  }

  private static void appendRing(StringBuilder out, String name, RecordRing ring, boolean all) {
    out.append(",\"").append(name).append("\":[");
    if (all) ring.appendAll(out);
    else ring.appendSincePeek(out);
    out.append(']');
  }
}
