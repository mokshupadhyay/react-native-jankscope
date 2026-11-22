#import <Foundation/Foundation.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <RNJankscopeSpec/RNJankscopeSpec.h>

@interface Jankscope : NSObject <NativeJankscopeSpec>
#else
#import <React/RCTBridgeModule.h>

@interface Jankscope : NSObject <RCTBridgeModule>
#endif

@end
