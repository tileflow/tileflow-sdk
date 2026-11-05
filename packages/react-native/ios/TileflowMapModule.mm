#import <TileflowReactNativeSpec/TileflowReactNativeSpec.h>
#import "TFBridgeSwift.h"

using namespace facebook::react;

@interface TileflowMapModule : NativeTileflowMapModuleSpecBase <NativeTileflowMapModuleSpec>
@end

@implementation TileflowMapModule
RCT_EXPORT_MODULE(TileflowMapModule)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)call:(double)reactTag
  instanceId:(NSString *)instanceId
      method:(NSString *)method
     payload:(NSString *)payload
     resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [TFMapHostView callWithReactTag:reactTag
                       instanceId:instanceId
                           method:method
                          payload:payload
                          resolve:^(id value) { resolve(value); }
                           reject:^(NSString *code, NSString *message, NSDictionary *info) {
      reject(code, message, [NSError errorWithDomain:@"dev.tileflow.map" code:0 userInfo:info]);
    }];
  });
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeTileflowMapModuleSpecJSI>(params);
}
@end
