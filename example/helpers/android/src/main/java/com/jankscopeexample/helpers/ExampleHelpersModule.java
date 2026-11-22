package com.jankscopeexample.helpers;

import android.os.SystemClock;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;

/** Example only: blocks the UI thread with a busy loop so jankscope can be checked against a known cause. */
public class ExampleHelpersModule extends ReactContextBaseJavaModule {
  public ExampleHelpersModule(ReactApplicationContext context) {
    super(context);
  }

  @NonNull
  @Override
  public String getName() {
    return "ExampleHelpers";
  }

  @ReactMethod
  public void blockMainThread(final double ms) {
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        long end = SystemClock.uptimeMillis() + (long) ms;
        long spin = 0;
        while (SystemClock.uptimeMillis() < end) spin++;
        if (spin == Long.MIN_VALUE) android.util.Log.d("ExampleHelpers", "unreachable");
      }
    });
  }
}
