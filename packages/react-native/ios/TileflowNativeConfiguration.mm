#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import "TFMobileConfiguration.h"

@interface TileflowNativeConfiguration : NSObject <RCTBridgeModule, RCTInvalidating>
@end

@implementation TileflowNativeConfiguration {
	BOOL _invalidated;
}
RCT_EXPORT_MODULE(TileflowNativeConfiguration)
+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_REMAP_METHOD(readConfiguration,
	readConfigurationWithResolver:(RCTPromiseResolveBlock)resolve
	rejecter:(RCTPromiseRejectBlock)reject) {
	@synchronized (self) {
		if (_invalidated) {
			reject(@"NATIVE_CONFIGURATION_UNAVAILABLE", @"Native application configuration is unavailable.", nil);
			return;
		}
		static TFMobileConfigurationCache *applicationConfiguration;
		static dispatch_once_t once;
		dispatch_once(&once, ^{ applicationConfiguration = [TFMobileConfigurationCache new]; });
		TFMobileConfiguration *configuration = [applicationConfiguration read:^{
			NSBundle *bundle = NSBundle.mainBundle;
			return [TFMobileConfiguration fromInfo:bundle.infoDictionary localized:bundle.localizedInfoDictionary error:nil];
		} error:nil];
		if (!configuration) {
			reject(@"NATIVE_CONFIGURATION_INVALID", @"Native application configuration is invalid.", nil);
			return;
		}
		// One bounded private promise, never constants, notifications or renderer events.
		resolve(@{@"apiOrigin": configuration.apiOrigin, @"credential": configuration.credential});
	}
}

- (void)invalidate {
	@synchronized (self) { _invalidated = YES; }
}
@end
