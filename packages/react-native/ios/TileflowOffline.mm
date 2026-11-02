#import <TileflowReactNativeSpec/TileflowReactNativeSpec.h>

#import "TFBridgeSwift.h"

// The native offline store and network switch. Arguments and regions are converted in Swift.
@interface TileflowOffline : NativeTileflowOfflineSpecBase <NativeTileflowOfflineSpec>
@end

typedef void (^TFResolveBlock)(id _Nullable);
typedef void (^TFRejectBlock)(NSString *, NSString *, NSDictionary *);

static TFRejectBlock TFReject(RCTPromiseRejectBlock reject)
{
  return ^(NSString *code, NSString *message, NSDictionary *info) {
    reject(code, message, [NSError errorWithDomain:@"dev.tileflow.offline" code:0 userInfo:info]);
  };
}

static TFResolveBlock TFResolve(RCTPromiseResolveBlock resolve)
{
  return ^(id value) {
    resolve(value);
  };
}

@implementation TileflowOffline {
  TFOfflineModuleImpl *_impl;
}

RCT_EXPORT_MODULE(TileflowOffline)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _impl = [TFOfflineModuleImpl new];
    __weak TileflowOffline *weakSelf = self;
    _impl.onEvent = ^(NSDictionary *event) {
      [weakSelf emitOnRegionEvent:event];
    };
  }
  return self;
}

- (void)estimateRegion:(NSDictionary *)options
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [_impl estimateRegion:options resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)loadRegion:(NSString *)id
           options:(NSDictionary *)options
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [_impl loadRegion:id options:options resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)updateRegionMetadata:(NSString *)id
                    metadata:(NSDictionary *)metadata
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  [_impl updateRegionMetadata:id metadata:metadata resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)allRegions:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl allRegions:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)region:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl region:id resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)pauseRegion:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl pauseRegion:id resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)resumeRegion:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl resumeRegion:id resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)cancelRegion:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl cancelRegion:id resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)removeRegion:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl removeRegion:id resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)automaticUpdatesEnabled:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl automaticUpdatesEnabled:TFResolve(resolve) reject:TFReject(reject)];
}

- (void)setAutomaticUpdates:(BOOL)enabled
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  [_impl setAutomaticUpdates:enabled resolve:TFResolve(resolve) reject:TFReject(reject)];
}

- (NSNumber *)isNetworkEnabled
{
  return @([_impl isNetworkEnabled]);
}

- (void)setNetworkEnabled:(BOOL)enabled
{
  [_impl setNetworkEnabled:enabled];
}

- (void)startObserving
{
  [_impl startObserving];
}

- (void)stopObserving
{
  [_impl stopObserving];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeTileflowOfflineSpecJSI>(params);
}

@end
