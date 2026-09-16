#import <XCTest/XCTest.h>
#import <MapLibre/MLNNetworkConfiguration.h>
#import "TFAdmissionInstallation.h"
#import "TileflowNativeAdmission.h"

@interface TileflowNativeAdmission (BootstrapOwnershipTests)
- (void)installWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)removeInstallation:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
@end
@interface TFQuietOwnershipModule : TileflowNativeAdmission
@end
@implementation TFQuietOwnershipModule
- (void)sendEventWithName:(NSString *)name body:(id)body {}
@end

@interface TFAdmissionBootstrapOwnershipTests : XCTestCase
@end
@implementation TFAdmissionBootstrapOwnershipTests
- (void)testBootstrapGuardCapturesItsEngineRatherThanReadingMutableModuleStateFromNetworkThreads {
	MLNNetworkConfiguration *manager = MLNNetworkConfiguration.sharedManager;
	NSURLSessionConfiguration *saved = manager.sessionConfiguration;
	id<MLNNetworkConfigurationDelegate> savedDelegate = manager.delegate;
	manager.sessionConfiguration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	manager.delegate = nil;
	TFQuietOwnershipModule *module = [TFQuietOwnershipModule new];
	[module startObserving];
	__block NSString *identifier;
	TFAdmissionInstallation *installation;
	@try {
		[module installWithResolver:^(id result) { identifier = result[@"installation"]; }
			rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Installation failed"); }];
		installation = [TFNativeAdmissionURLProtocol activeInstallation];
		id bootstrap = [module valueForKey:@"bootstrapRequests"];
		TFAdmissionStartGuard guard = [bootstrap valueForKey:@"owns"];
		XCTAssertNotNil(installation); XCTAssertNotNil(guard);
		if (!guard) return;
		// Model module state being replaced while a native guard is retained.
		// The original engine, not that mutable pointer, owns this request.
		[module setValue:nil forKey:@"installation"];
		XCTAssertTrue(guard());
		[module setValue:installation forKey:@"installation"];
		[module removeInstallation:identifier resolver:^(id result) {}
			rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Removal failed"); }];
		XCTAssertFalse(guard());
	} @finally {
		[installation remove];
		manager.sessionConfiguration = saved; manager.delegate = savedDelegate;
	}
}
@end
