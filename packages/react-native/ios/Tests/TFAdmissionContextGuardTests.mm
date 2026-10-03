#import <XCTest/XCTest.h>
#import "TFAdmissionEngine.h"
#import "TFAdmissionNetwork.h"

@interface TFGuardNetwork : NSObject <TFAdmissionNetwork>
@end
@implementation TFGuardNetwork
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	[NSException raise:@"UnexpectedNetwork" format:@"This fixture must not acquire resources"];
	return nil;
}
@end
@interface TFAdmissionContextGuardTests : XCTestCase
@end
@implementation TFAdmissionContextGuardTests
- (void)testContextGuardsRetainOnlyTheirOriginalLifetime {
	TFAdmissionEngine *engine = [[TFAdmissionEngine alloc] initWithInstallation:@"installation" scheduler:[TFContinuousAdmissionScheduler new] network:[TFGuardNetwork new] owns:^BOOL { return YES; } emit:^(NSDictionary *event) {}];
	NSString *first = [engine registerMap:nil resources:@[]], *second = [engine registerMap:nil resources:@[]];
	TFAdmissionStartGuard one = [engine contextGuard:first], two = [engine contextGuard:second];
	XCTAssertTrue(one()); XCTAssertTrue(two());
	[engine lifecycle:NO]; XCTAssertFalse(one()); XCTAssertFalse(two());
	[engine lifecycle:YES]; XCTAssertTrue(one()); XCTAssertTrue(two());
	[engine retire:first]; XCTAssertFalse(one()); XCTAssertTrue(two());
	XCTAssertThrows([engine contextGuard:first]);
	[engine close]; XCTAssertFalse(one()); XCTAssertFalse(two());
}
@end
