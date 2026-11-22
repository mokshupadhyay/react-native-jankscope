#import "Jankscope.h"

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <os/lock.h>
#import <sys/sysctl.h>

#include <string>
#include <vector>

#ifdef RCT_NEW_ARCH_ENABLED
#import <React/RCTSurfacePresenterStub.h>
#else
#import <React/RCTBridge.h>
#import <React/RCTUIManager.h>
#import <React/RCTUIManagerObserverCoordinator.h>
#import <React/RCTUIManagerUtils.h>
#endif

// Frame collectors for iOS. The JSON layout is documented in src/raw.ts.
//
// - A CADisplayLink on the main run loop, asking for the screen's highest
//   rate, records every vsync callback: the frame's timestamp, its target
//   timestamp and when the callback actually ran.
// - A CFRunLoopObserver (after waiting / before waiting) adds up how long the
//   main thread was busy between two display link callbacks.
// - React Native mount work: on Fabric, RCTSurfacePresenterObserver's
//   willMount / didMount callbacks; on the old architecture, a UI block
//   prepended and one appended to every UIManager batch.
//
// Render server and GPU time are not observable in the app's process.
// Times are microseconds since start() on CACurrentMediaTime().

namespace {

struct Ring {
  int stride = 1;
  size_t capacity = 1;
  std::vector<int64_t> data;
  uint64_t written = 0;
  uint64_t peeked = 0;

  void reset(int newStride, size_t newCapacity)
  {
    stride = newStride;
    capacity = newCapacity;
    data.assign((size_t)stride * capacity, 0);
    written = 0;
    peeked = 0;
  }

  void add(const int64_t *record)
  {
    size_t slot = (size_t)(written % capacity);
    std::copy(record, record + stride, data.begin() + (long)(slot * (size_t)stride));
    written++;
  }

  uint64_t lost() const
  {
    return written > capacity ? written - capacity : 0;
  }

  void append(std::string &out, bool sincePeek)
  {
    uint64_t oldest = lost();
    uint64_t from = sincePeek ? std::max(peeked, oldest) : oldest;
    bool first = true;
    for (uint64_t index = from; index < written; index++) {
      size_t base = (size_t)(index % capacity) * (size_t)stride;
      for (int i = 0; i < stride; i++) {
        if (!first) out.push_back(',');
        out += std::to_string(data[base + (size_t)i]);
        first = false;
      }
    }
    if (sincePeek) peeked = written;
  }
};

const int kTickStride = 5;

void AppendQuoted(std::string &out, NSString *value)
{
  out.push_back('"');
  const char *text = value.UTF8String ?: "";
  for (const char *c = text; *c; c++) {
    if (*c == '"' || *c == '\\') {
      out.push_back('\\');
      out.push_back(*c);
    } else if ((unsigned char)*c < 0x20) {
      char escaped[8];
      snprintf(escaped, sizeof(escaped), "\\u%04x", (unsigned char)*c);
      out += escaped;
    } else {
      out.push_back(*c);
    }
  }
  out.push_back('"');
}

NSString *ModelIdentifier()
{
  NSString *simulated = NSProcessInfo.processInfo.environment[@"SIMULATOR_MODEL_IDENTIFIER"];
  if (simulated.length > 0) return [simulated stringByAppendingString:@" (Simulator)"];
  size_t size = 0;
  sysctlbyname("hw.machine", NULL, &size, NULL, 0);
  if (size == 0) return @"unknown";
  std::vector<char> machine(size);
  sysctlbyname("hw.machine", machine.data(), &size, NULL, 0);
  return [NSString stringWithUTF8String:machine.data()] ?: @"unknown";
}

} // namespace

// CADisplayLink retains its target; this proxy keeps the module from being retained.
@interface JankscopeWeakProxy : NSObject
@property (nonatomic, weak) id target;
@end

@implementation JankscopeWeakProxy
- (void)onFrame:(CADisplayLink *)link
{
  [self.target performSelector:@selector(onFrame:) withObject:link];
}
@end

@interface Jankscope ()
#ifdef RCT_NEW_ARCH_ENABLED
    <RCTSurfacePresenterObserver>
#else
    <RCTUIManagerObserver>
#endif
- (void)onFrame:(CADisplayLink *)link;
@end

@implementation Jankscope {
  dispatch_queue_t _queue;
  os_unfair_lock _lock;
  Ring _ticks;
  Ring _mounts;
  Ring _jsBusy;
  // Written on the main thread; read under _lock.
  BOOL _running;
  CFTimeInterval _startTime;
  CFTimeInterval _stopTime;
  int64_t _uiNs;
  int64_t _uiCalls;
  NSInteger _maxFps;
  NSString *_model;
  NSString *_osVersion;
  // Main thread only.
  CADisplayLink *_displayLink;
  CFRunLoopObserverRef _observer;
  CFTimeInterval _busyStart;
  CFTimeInterval _busyTotal;
  CFTimeInterval _mountStart;
#ifdef RCT_NEW_ARCH_ENABLED
  __weak id<RCTSurfacePresenterStub> _surfacePresenter;
  BOOL _observingPresenter;
#else
  BOOL _observingUIManager;
  CFTimeInterval _paperMountStart;
#endif
}

RCT_EXPORT_MODULE(Jankscope)

// The bridge on the old architecture; an RCTBridgeProxy (or nil) on the bridgeless runtime.
@synthesize bridge = _bridge;

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _queue = dispatch_queue_create("jankscope", DISPATCH_QUEUE_SERIAL);
    _lock = OS_UNFAIR_LOCK_INIT;
    _ticks.reset(kTickStride, 1);
    _mounts.reset(2, 1);
    _jsBusy.reset(2, 1);
  }
  return self;
}

- (dispatch_queue_t)methodQueue
{
  return _queue;
}

static inline int64_t JankscopeMicros(CFTimeInterval time, CFTimeInterval start)
{
  return (int64_t)((time - start) * 1e6);
}

#pragma mark - Collectors (main thread)

- (void)onFrame:(CADisplayLink *)link
{
  CFTimeInterval now = CACurrentMediaTime();
  CFTimeInterval busy = _busyTotal + (_busyStart > 0 ? now - _busyStart : 0);
  _busyTotal = 0;
  if (_busyStart > 0) _busyStart = now;
  int64_t record[kTickStride] = {
      JankscopeMicros(link.timestamp, _startTime),
      JankscopeMicros(now, _startTime),
      (int64_t)((link.targetTimestamp - link.timestamp) * 1e6),
      (int64_t)(busy * 1e6),
      JankscopeMicros(link.targetTimestamp, _startTime),
  };
  os_unfair_lock_lock(&_lock);
  if (_running) _ticks.add(record);
  _uiNs += (int64_t)((CACurrentMediaTime() - now) * 1e9);
  _uiCalls++;
  os_unfair_lock_unlock(&_lock);
}

- (void)attachOnMain
{
  _busyStart = CACurrentMediaTime(); // start() itself runs inside a busy run loop iteration.
  _busyTotal = 0;
  __weak Jankscope *weakSelf = self;
  _observer = CFRunLoopObserverCreateWithHandler(
      kCFAllocatorDefault,
      kCFRunLoopAfterWaiting | kCFRunLoopBeforeWaiting,
      true,
      0,
      ^(CFRunLoopObserverRef observer, CFRunLoopActivity activity) {
        Jankscope *strongSelf = weakSelf;
        if (strongSelf == nil) return;
        CFTimeInterval now = CACurrentMediaTime();
        if (activity == kCFRunLoopAfterWaiting) {
          strongSelf->_busyStart = now;
        } else if (strongSelf->_busyStart > 0) {
          strongSelf->_busyTotal += now - strongSelf->_busyStart;
          strongSelf->_busyStart = 0;
        }
        CFTimeInterval spent = CACurrentMediaTime() - now;
        os_unfair_lock_lock(&strongSelf->_lock);
        strongSelf->_uiNs += (int64_t)(spent * 1e9);
        os_unfair_lock_unlock(&strongSelf->_lock);
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), _observer, kCFRunLoopCommonModes);

  JankscopeWeakProxy *proxy = [JankscopeWeakProxy new];
  proxy.target = self;
  _displayLink = [CADisplayLink displayLinkWithTarget:proxy selector:@selector(onFrame:)];
  if (@available(iOS 15.0, *)) {
    float rate = (float)_maxFps;
    _displayLink.preferredFrameRateRange = CAFrameRateRangeMake(rate, rate, rate);
  } else {
    _displayLink.preferredFramesPerSecond = _maxFps;
  }
  [_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  [self attachMountObserver];
}

- (void)detachOnMain
{
  [_displayLink invalidate];
  _displayLink = nil;
  if (_observer) {
    CFRunLoopRemoveObserver(CFRunLoopGetMain(), _observer, kCFRunLoopCommonModes);
    CFRelease(_observer);
    _observer = NULL;
  }
  [self detachMountObserver];
}

- (void)recordMountFrom:(CFTimeInterval)start
{
  CFTimeInterval end = CACurrentMediaTime();
  int64_t record[2] = {JankscopeMicros(start, _startTime), JankscopeMicros(end, _startTime)};
  os_unfair_lock_lock(&_lock);
  if (_running) _mounts.add(record);
  os_unfair_lock_unlock(&_lock);
}

#ifdef RCT_NEW_ARCH_ENABLED

// Called by the bridgeless runtime (RCTInstance) on modules that implement it.
- (void)setSurfacePresenter:(id<RCTSurfacePresenterStub>)surfacePresenter
{
  _surfacePresenter = surfacePresenter;
}

- (void)attachMountObserver
{
  if (_observingPresenter) return;
  id<RCTSurfacePresenterStub> presenter = _surfacePresenter;
  if (presenter == nil) {
    // Bridge mode with Fabric: the bridge carries the presenter.
    id bridge = self.bridge;
    if ([bridge respondsToSelector:@selector(surfacePresenter)]) presenter = [bridge surfacePresenter];
  }
  if (presenter == nil) return;
  _surfacePresenter = presenter;
  [presenter addObserver:self];
  _observingPresenter = YES;
}

- (void)detachMountObserver
{
  if (!_observingPresenter) return;
  [_surfacePresenter removeObserver:self];
  _observingPresenter = NO;
}

- (void)willMountComponentsWithRootTag:(NSInteger)rootTag
{
  _mountStart = CACurrentMediaTime();
}

- (void)didMountComponentsWithRootTag:(NSInteger)rootTag
{
  if (_mountStart <= 0) return;
  [self recordMountFrom:_mountStart];
  _mountStart = 0;
}

#else

- (void)attachMountObserver
{
  if (_observingUIManager || self.bridge.uiManager == nil) return;
  [self.bridge.uiManager.observerCoordinator addObserver:self];
  _observingUIManager = YES;
}

- (void)detachMountObserver
{
  if (!_observingUIManager) return;
  [self.bridge.uiManager.observerCoordinator removeObserver:self];
  _observingUIManager = NO;
}

// On the UIManager queue: bracket the batch that is about to run on the main thread.
- (void)uiManagerWillPerformMounting:(RCTUIManager *)manager
{
  __weak Jankscope *weakSelf = self;
  [manager prependUIBlock:^(__unused RCTUIManager *uiManager, __unused NSDictionary<NSNumber *, UIView *> *registry) {
    Jankscope *strongSelf = weakSelf;
    if (strongSelf) strongSelf->_paperMountStart = CACurrentMediaTime();
  }];
  [manager addUIBlock:^(__unused RCTUIManager *uiManager, __unused NSDictionary<NSNumber *, UIView *> *registry) {
    Jankscope *strongSelf = weakSelf;
    if (strongSelf == nil || strongSelf->_paperMountStart <= 0) return;
    [strongSelf recordMountFrom:strongSelf->_paperMountStart];
    strongSelf->_paperMountStart = 0;
  }];
}

#endif

#pragma mark - JSON

- (std::string)sessionJson:(BOOL)all stopTime:(CFTimeInterval)stopTime
{
  std::string out;
  os_unfair_lock_lock(&_lock);
  out.reserve(256 + (size_t)(std::min<uint64_t>(_ticks.written, _ticks.capacity)) * 48);
  char number[64];
  snprintf(number, sizeof(number), "%.3f", _startTime * 1000.0);
  out += "{\"v\":1,\"platform\":\"ios\",\"startMs\":";
  out += number;
  snprintf(number, sizeof(number), "%.3f", stopTime * 1000.0);
  out += ",\"stopMs\":";
  out += number;
  out += ",\"device\":{\"model\":";
  AppendQuoted(out, _model ?: @"unknown");
  out += ",\"manufacturer\":\"Apple\",\"os\":\"ios\",\"osVersion\":";
  AppendQuoted(out, _osVersion ?: @"");
  out += ",\"refreshRate\":" + std::to_string((long)_maxFps) + "}";
#if DEBUG
  out += ",\"debug\":true";
#else
  out += ",\"debug\":false";
#endif
#ifdef RCT_NEW_ARCH_ENABLED
  out += ",\"newArch\":true";
#else
  out += ",\"newArch\":false";
#endif
  out += ",\"ticks\":[";
  _ticks.append(out, !all);
  out += "],\"metrics\":[],\"mounts\":[";
  _mounts.append(out, !all);
  out += "],\"jsBusy\":[";
  _jsBusy.append(out, !all);
  out += "],\"refresh\":[0," + std::to_string((long)_maxFps) + "]";
  out += ",\"lost\":{\"ticks\":" + std::to_string(_ticks.lost()) + ",\"metrics\":0,\"mounts\":" +
      std::to_string(_mounts.lost()) + ",\"jsBusy\":" + std::to_string(_jsBusy.lost()) + "}";
  out += ",\"cost\":{\"uiNs\":" + std::to_string(_uiNs) + ",\"uiCalls\":" + std::to_string(_uiCalls) +
      ",\"bgNs\":0,\"bgCalls\":0}}";
  os_unfair_lock_unlock(&_lock);
  return out;
}

#pragma mark - Module API

RCT_EXPORT_METHOD(start
                  : (double)maxFrames resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  size_t capacity = (size_t)MAX(100.0, MIN(1000000.0, maxFrames));
  dispatch_async(dispatch_get_main_queue(), ^{
    os_unfair_lock_lock(&self->_lock);
    if (self->_running) {
      os_unfair_lock_unlock(&self->_lock);
      reject(@"ALREADY_RUNNING", @"A jankscope session is already running.", nil);
      return;
    }
    self->_ticks.reset(kTickStride, capacity);
    self->_mounts.reset(2, capacity);
    self->_jsBusy.reset(2, capacity);
    self->_uiNs = 0;
    self->_uiCalls = 0;
    self->_maxFps = MAX((NSInteger)60, UIScreen.mainScreen.maximumFramesPerSecond);
    self->_model = ModelIdentifier();
    self->_osVersion = UIDevice.currentDevice.systemVersion;
    self->_startTime = CACurrentMediaTime();
    self->_running = YES;
    os_unfair_lock_unlock(&self->_lock);
    [self attachOnMain];
    resolve([NSString stringWithFormat:@"{\"startMs\":%.3f}", self->_startTime * 1000.0]);
  });
}

RCT_EXPORT_METHOD(stop : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    os_unfair_lock_lock(&self->_lock);
    BOOL wasRunning = self->_running;
    self->_running = NO;
    self->_stopTime = CACurrentMediaTime();
    os_unfair_lock_unlock(&self->_lock);
    if (!wasRunning) {
      reject(@"NOT_RUNNING", @"No jankscope session is running.", nil);
      return;
    }
    [self detachOnMain];
    CFTimeInterval stopTime = self->_stopTime;
    dispatch_async(self->_queue, ^{
      std::string json = [self sessionJson:YES stopTime:stopTime];
      resolve([NSString stringWithUTF8String:json.c_str()]);
    });
  });
}

RCT_EXPORT_METHOD(peek : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  os_unfair_lock_lock(&_lock);
  BOOL running = _running;
  os_unfair_lock_unlock(&_lock);
  if (!running) {
    reject(@"NOT_RUNNING", @"No jankscope session is running.", nil);
    return;
  }
  std::string json = [self sessionJson:NO stopTime:CACurrentMediaTime()];
  resolve([NSString stringWithUTF8String:json.c_str()]);
}

RCT_EXPORT_SYNCHRONOUS_TYPED_METHOD(NSNumber *, nowMs)
{
  return @(CACurrentMediaTime() * 1000.0);
}

RCT_EXPORT_METHOD(reportJsBusy : (NSArray *)windows)
{
  os_unfair_lock_lock(&_lock);
  if (_running) {
    for (NSUInteger i = 0; i + 1 < windows.count; i += 2) {
      id start = windows[i];
      id end = windows[i + 1];
      if (![start isKindOfClass:[NSNumber class]] || ![end isKindOfClass:[NSNumber class]]) continue;
      int64_t record[2] = {
          JankscopeMicros([start doubleValue] / 1000.0, _startTime),
          JankscopeMicros([end doubleValue] / 1000.0, _startTime),
      };
      if (record[1] > record[0]) _jsBusy.add(record);
    }
  }
  os_unfair_lock_unlock(&_lock);
}

RCT_EXPORT_METHOD(writeReport
                  : (NSString *)fileName json
                  : (NSString *)json resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  NSRegularExpression *pattern =
      [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}\\.json$" options:0 error:nil];
  if (fileName == nil ||
      [pattern numberOfMatchesInString:fileName options:0 range:NSMakeRange(0, fileName.length)] != 1) {
    reject(@"INVALID_FILE_NAME", @"Invalid report file name.", nil);
    return;
  }
  NSURL *documents = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory
                                                            inDomains:NSUserDomainMask].firstObject;
  NSURL *dir = [documents URLByAppendingPathComponent:@"jankscope" isDirectory:YES];
  NSError *error = nil;
  if (![[NSFileManager defaultManager] createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:&error]) {
    reject(@"WRITE_FAILED", error.localizedDescription, error);
    return;
  }
  NSURL *file = [dir URLByAppendingPathComponent:fileName];
  if (![json writeToURL:file atomically:YES encoding:NSUTF8StringEncoding error:&error]) {
    reject(@"WRITE_FAILED", error.localizedDescription, error);
    return;
  }
  NSLog(@"[Jankscope] report saved: %@", file.path);
  resolve(file.path);
}

- (void)invalidate
{
  os_unfair_lock_lock(&_lock);
  BOOL wasRunning = _running;
  _running = NO;
  os_unfair_lock_unlock(&_lock);
  if (wasRunning) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self detachOnMain];
    });
  }
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeJankscopeSpecJSI>(params);
}
#endif

@end
