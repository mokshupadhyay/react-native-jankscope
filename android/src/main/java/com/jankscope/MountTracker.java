package com.jankscope;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UIManager;
import com.facebook.react.bridge.UIManagerListener;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.uimanager.UIManagerHelper;
import com.facebook.react.uimanager.common.UIManagerType;

/**
 * Times React Native mount work on the UI thread.
 *
 * <ul>
 *   <li>Fabric: {@code willMountItems} / {@code didMountItems} bracket each batch
 *       of mount items the MountItemDispatcher executes on the UI thread. View
 *       preallocation runs outside these callbacks and is not counted.</li>
 *   <li>Old architecture: {@code willDispatchViewUpdates} runs on the native
 *       modules thread before a batch is handed to the UI thread; a UI block
 *       prepended and one appended to that batch mark its start and end on the
 *       UI thread. (React Native 0.82+ turned these UI blocks into no-ops, but
 *       those releases always use Fabric.)</li>
 * </ul>
 */
// UIManagerModule, UIBlock and NativeViewHierarchyManager are deprecated legacy-architecture
// classes; they are named in full because Java 8 warns about imports of deprecated classes.
@SuppressWarnings("deprecation")
final class MountTracker implements UIManagerListener {
  private final ReactApplicationContext context;
  private final boolean fabric;
  private final JankscopeModuleImpl owner;
  @Nullable private UIManager attached;
  // UI thread only.
  private long fabricStart = -1;
  private long paperStart = -1;

  MountTracker(ReactApplicationContext context, boolean fabric, JankscopeModuleImpl owner) {
    this.context = context;
    this.fabric = fabric;
    this.owner = owner;
  }

  /** On the UI thread. Safe to call again; attaches once to the current UIManager. */
  void attach() {
    UiThreadUtil.assertOnUiThread();
    UIManager manager;
    try {
      manager = UIManagerHelper.getUIManager(context, fabric ? UIManagerType.FABRIC : UIManagerType.LEGACY);
    } catch (RuntimeException notReady) {
      return;
    }
    if (manager == null || manager == attached) return;
    detach();
    manager.addUIManagerEventListener(this);
    attached = manager;
  }

  void detach() {
    UIManager manager = attached;
    attached = null;
    fabricStart = -1;
    paperStart = -1;
    if (manager != null) manager.removeUIManagerEventListener(this);
  }

  @Override
  public void willMountItems(UIManager uiManager) {
    if (owner.isRunning()) fabricStart = System.nanoTime();
  }

  @Override
  public void didMountItems(UIManager uiManager) {
    long start = fabricStart;
    fabricStart = -1;
    if (start < 0 || !owner.isRunning()) return;
    long end = System.nanoTime();
    owner.recordMount(start, end);
  }

  @Override
  public void willDispatchViewUpdates(UIManager uiManager) {
    if (!owner.isRunning() || !(uiManager instanceof com.facebook.react.uimanager.UIManagerModule)) return;
    com.facebook.react.uimanager.UIManagerModule module = (com.facebook.react.uimanager.UIManagerModule) uiManager;
    module.prependUIBlock(startBlock);
    module.addUIBlock(endBlock);
  }

  @Override
  public void didDispatchMountItems(UIManager uiManager) {}

  @Override
  public void didScheduleMountItems(UIManager uiManager) {}

  private final com.facebook.react.uimanager.UIBlock startBlock = new com.facebook.react.uimanager.UIBlock() {
    @Override
    public void execute(com.facebook.react.uimanager.NativeViewHierarchyManager manager) {
      paperStart = System.nanoTime();
    }
  };

  private final com.facebook.react.uimanager.UIBlock endBlock = new com.facebook.react.uimanager.UIBlock() {
    @Override
    public void execute(com.facebook.react.uimanager.NativeViewHierarchyManager manager) {
      long start = paperStart;
      paperStart = -1;
      if (start >= 0 && owner.isRunning()) owner.recordMount(start, System.nanoTime());
    }
  };
}
