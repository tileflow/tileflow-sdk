#import <XCTest/XCTest.h>
#import <MapLibre/MLNNetworkConfiguration.h>
#import "TFAdmissionInstallation.h"
#import "TFAdmissionNetwork.h"
#import "TileflowNativeAdmission.h"

@interface TFAdmissionInstallation (RollbackTests)
- (instancetype)initWithConfiguration:(MLNNetworkConfiguration *)configuration scheduler:(id<TFAdmissionScheduler>)scheduler network:(nullable id<TFAdmissionNetwork>)network emit:(void (^)(NSDictionary *))emit;
@end
@interface TileflowNativeAdmission (RollbackTests)
- (TFAdmissionURLSessionNetwork *)createBootstrapNetwork;
- (void)installWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)removeInstallation:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
@end

@interface TFThrowingAdmissionConfiguration : MLNNetworkConfiguration
@property (nonatomic) BOOL failInstall;
@property (nonatomic) BOOL replaceInstall;
@property (nonatomic) NSURLSessionConfiguration *replacement;
@end
@implementation TFThrowingAdmissionConfiguration
- (void)setSessionConfiguration:(NSURLSessionConfiguration *)configuration {
	if ([configuration.protocolClasses containsObject:TFNativeAdmissionURLProtocol.class]) {
		if (self.replaceInstall) { [super setSessionConfiguration:self.replacement]; return; }
		[super setSessionConfiguration:configuration];
		if (self.failInstall) [NSException raise:@"FixtureFailure" format:@"Installation failed after mutation"];
	} else [super setSessionConfiguration:configuration];
}
@end

@interface TFRollbackModule : TileflowNativeAdmission
@property (nonatomic) BOOL failBootstrap;
@property (nonatomic) BOOL failEvent;
@end
@implementation TFRollbackModule
- (TFAdmissionURLSessionNetwork *)createBootstrapNetwork {
	if (self.failBootstrap) [NSException raise:@"FixtureFailure" format:@"Bootstrap construction failed"];
	return [super createBootstrapNetwork];
}
- (void)sendEventWithName:(NSString *)name body:(id)body {
	if (self.failEvent) [NSException raise:@"FixtureFailure" format:@"Event delivery failed"];
}
@end

@interface TFAdmissionRollbackTests : XCTestCase
@property (nonatomic) NSURLSessionConfiguration *saved;
@property (nonatomic) id<MLNNetworkConfigurationDelegate> savedDelegate;
@end
@implementation TFAdmissionRollbackTests
- (void)setUp {
	[super setUp];
	self.saved = MLNNetworkConfiguration.sharedManager.sessionConfiguration;
	self.savedDelegate = MLNNetworkConfiguration.sharedManager.delegate;
	MLNNetworkConfiguration.sharedManager.sessionConfiguration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	MLNNetworkConfiguration.sharedManager.delegate = nil;
}
- (void)tearDown {
	[[TFNativeAdmissionURLProtocol activeInstallation] remove];
	MLNNetworkConfiguration.sharedManager.sessionConfiguration = self.saved;
	MLNNetworkConfiguration.sharedManager.delegate = self.savedDelegate;
	[super tearDown];
}
- (void)testSetterFailureAfterMutationRestoresOnlyTheOwnedConfiguration {
	TFThrowingAdmissionConfiguration *manager = [TFThrowingAdmissionConfiguration new];
	NSURLSessionConfiguration *original = manager.sessionConfiguration;
	manager.failInstall = YES;
	XCTAssertThrows([[TFAdmissionInstallation alloc] initWithConfiguration:manager scheduler:[TFContinuousAdmissionScheduler new] network:nil emit:^(NSDictionary *event) {}]);
	XCTAssertEqual(manager.sessionConfiguration, original);
	XCTAssertNil([TFNativeAdmissionURLProtocol activeInstallation]);
}
- (void)testPartialInstallNeverRestoresOverAnInterveningConfiguration {
	TFThrowingAdmissionConfiguration *manager = [TFThrowingAdmissionConfiguration new];
	manager.replacement = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	manager.replaceInstall = YES;
	XCTAssertThrows([[TFAdmissionInstallation alloc] initWithConfiguration:manager scheduler:[TFContinuousAdmissionScheduler new] network:nil emit:^(NSDictionary *event) {}]);
	XCTAssertEqual(manager.sessionConfiguration, manager.replacement);
	XCTAssertNil([TFNativeAdmissionURLProtocol activeInstallation]);
}
- (void)testFailureAfterInstallationRollsBackAndAllowsAFreshExplicitAttempt {
	for (NSNumber *eventFailure in @[@NO, @YES]) {
		TFRollbackModule *module = [TFRollbackModule new]; [module startObserving];
		NSURLSessionConfiguration *original = MLNNetworkConfiguration.sharedManager.sessionConfiguration;
		module.failEvent = eventFailure.boolValue; module.failBootstrap = !eventFailure.boolValue;
		__block NSUInteger rejected = 0;
		[module installWithResolver:^(id result) { XCTFail(@"A partial installation cannot acknowledge success"); }
			rejecter:^(NSString *code, NSString *message, NSError *error) { rejected++; XCTAssertNil(error); XCTAssertEqualObjects(code, @"NATIVE_ADMISSION_UNAVAILABLE"); }];
		XCTAssertEqual(rejected, 1u);
		XCTAssertEqual(MLNNetworkConfiguration.sharedManager.sessionConfiguration, original);
		XCTAssertNil([TFNativeAdmissionURLProtocol activeInstallation]);
		module.failBootstrap = NO; module.failEvent = NO;
		__block NSString *identifier;
		[module installWithResolver:^(id result) { identifier = result[@"installation"]; }
			rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"A rolled-back module must be installable again"); }];
		XCTAssertNotNil(identifier);
		[module removeInstallation:identifier resolver:^(id result) { XCTAssertEqualObjects(result, (@{@"removed": @YES, @"ownershipLost": @NO})); }
			rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Removal failed"); }];
	}
}
- (void)testRejectedDuplicateInstallDoesNotRemoveTheExistingOwner {
	TFRollbackModule *module = [TFRollbackModule new]; [module startObserving];
	__block NSString *identifier;
	[module installWithResolver:^(id result) { identifier = result[@"installation"]; }
		rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Installation failed"); }];
	TFAdmissionInstallation *owner = [TFNativeAdmissionURLProtocol activeInstallation];
	__block BOOL rejected = NO;
	[module installWithResolver:^(id result) { XCTFail(@"Duplicate installation accepted"); }
		rejecter:^(NSString *code, NSString *message, NSError *error) { rejected = YES; }];
	XCTAssertTrue(rejected); XCTAssertTrue([owner ownsConfiguration]);
	[module removeInstallation:identifier resolver:^(id result) {} rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Removal failed"); }];
}
- (void)testInvalidationPreservesTheRealRemovalAcknowledgement {
	TFRollbackModule *module = [TFRollbackModule new]; [module startObserving];
	__block NSString *identifier;
	[module installWithResolver:^(id result) { identifier = result[@"installation"]; }
		rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Installation failed"); }];
	NSURLSessionConfiguration *replacement = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	MLNNetworkConfiguration.sharedManager.sessionConfiguration = replacement;
	[module invalidate]; [module invalidate];
	XCTestExpectation *barrier = [self expectationWithDescription:@"Serial teardown acknowledgement"];
	dispatch_async(dispatch_get_main_queue(), ^{
		[module removeInstallation:identifier resolver:^(id result) {
			XCTAssertEqualObjects(result, (@{@"removed": @NO, @"ownershipLost": @YES}));
			XCTAssertEqual(MLNNetworkConfiguration.sharedManager.sessionConfiguration, replacement);
			[barrier fulfill];
		} rejecter:^(NSString *code, NSString *message, NSError *error) { XCTFail(@"Teardown acknowledgement was lost"); [barrier fulfill]; }];
	});
	[self waitForExpectations:@[barrier] timeout:2];
}
@end
