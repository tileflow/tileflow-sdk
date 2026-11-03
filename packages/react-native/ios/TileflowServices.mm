#import <TileflowReactNativeSpec/TileflowReactNativeSpec.h>

#import "TFBridgeSwift.h"

// Search, Routing, Elevation and GeoIP through the native clients. Requests and answers are
// converted in Swift; credentials stay in the app's native configuration.
@interface TileflowServices : NativeTileflowServicesSpecBase <NativeTileflowServicesSpec>
@end

@implementation TileflowServices {
  TFServicesModuleImpl *_impl;
}

RCT_EXPORT_MODULE(TileflowServices)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _impl = [TFServicesModuleImpl new];
  }
  return self;
}

- (NSDictionary *)configuredServices
{
  return [_impl configuredServices];
}

- (void)call:(NSString *)service
   operation:(NSString *)operation
     request:(NSDictionary *)request
     resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject
{
  [_impl call:service
      operation:operation
        request:request
        resolve:^(id value) {
          resolve(value);
        }
         reject:^(NSString *code, NSString *message, NSDictionary *info) {
           reject(code, message, [NSError errorWithDomain:@"dev.tileflow.services" code:0 userInfo:info]);
         }];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeTileflowServicesSpecJSI>(params);
}

@end
