#import <React/RCTBridgeModule.h>
#import <QuartzCore/QuartzCore.h>

// Example only: blocks the main thread with a busy loop so jankscope can be
// checked against a known cause.
@interface ExampleHelpers : NSObject <RCTBridgeModule>
@end

@implementation ExampleHelpers

RCT_EXPORT_MODULE(ExampleHelpers)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(blockMainThread : (double)ms)
{
  CFTimeInterval end = CACurrentMediaTime() + ms / 1000.0;
  volatile unsigned long spin = 0;
  while (CACurrentMediaTime() < end) spin++;
}

@end
