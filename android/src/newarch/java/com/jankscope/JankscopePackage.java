package com.jankscope;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;

import java.util.HashMap;
import java.util.Map;

/**
 * `TurboReactPackage` is deprecated in favor of `BaseReactPackage` (0.74+),
 * but it is the base class available on every New Architecture release. It
 * is named in full because Java 8 warns about imports of deprecated classes.
 */
@SuppressWarnings("deprecation")
public class JankscopePackage extends com.facebook.react.TurboReactPackage {
  @Nullable
  @Override
  public NativeModule getModule(String name, ReactApplicationContext context) {
    return JankscopeModule.NAME.equals(name) ? new JankscopeModule(context) : null;
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return new ReactModuleInfoProvider() {
      @Override
      public Map<String, ReactModuleInfo> getReactModuleInfos() {
        Map<String, ReactModuleInfo> infos = new HashMap<>();
        infos.put(JankscopeModule.NAME, new ReactModuleInfo(
            JankscopeModule.NAME,
            JankscopeModule.class.getName(),
            false, // canOverrideExistingModule
            false, // needsEagerInit
            false, // hasConstants
            false, // isCxxModule
            true)); // isTurboModule
        return infos;
      }
    };
  }
}
