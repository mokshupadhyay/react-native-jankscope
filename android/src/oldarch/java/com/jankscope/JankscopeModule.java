package com.jankscope;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;

/** Legacy bridge module with the same surface as the TurboModule spec. */
public class JankscopeModule extends ReactContextBaseJavaModule {
  public static final String NAME = JankscopeModuleImpl.NAME;

  private final JankscopeModuleImpl impl;

  public JankscopeModule(ReactApplicationContext context) {
    super(context);
    impl = new JankscopeModuleImpl(context, false);
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void start(double maxFrames, Promise promise) {
    impl.start(maxFrames, promise);
  }

  @ReactMethod
  public void stop(Promise promise) {
    impl.stop(promise);
  }

  @ReactMethod
  public void peek(Promise promise) {
    impl.peek(promise);
  }

  /** Synchronous, so the JS side can line its clock up with the native one. */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public double nowMs() {
    return impl.nowMs();
  }

  @ReactMethod
  public void reportJsBusy(ReadableArray windows) {
    impl.reportJsBusy(windows);
  }

  @ReactMethod
  public void writeReport(String fileName, String json, Promise promise) {
    impl.writeReport(fileName, json, promise);
  }

  /*
   * Teardown. React Native 0.65 and later call invalidate(); 0.60 to 0.64
   * call onCatalystInstanceDestroy(), and 0.60 to 0.63 have no invalidate()
   * to override. Neither method is marked @Override so that this file
   * compiles on the whole supported range. impl.invalidate() runs once even
   * when a release calls both.
   */

  public void invalidate() {
    impl.invalidate();
  }

  @SuppressWarnings({"deprecation", "removal"}) // Deprecated in newer releases; the only teardown hook on 0.60-0.64.
  public void onCatalystInstanceDestroy() {
    impl.invalidate();
  }
}
