#import <XCTest/XCTest.h>
#import "TFAdmissionNetwork.h"

@interface TFAdmissionNetworkBoundsTests : XCTestCase
@end
@implementation TFAdmissionNetworkBoundsTests
- (void)testCancellingATimerReleasesCapturedWorkWithoutWaitingForTheDeadline {
	TFContinuousAdmissionScheduler *scheduler = [TFContinuousAdmissionScheduler new];
	__weak NSObject *retainedWork;
	id<TFAdmissionCancel> token;
	@autoreleasepool {
		NSObject *payload = [NSObject new]; retainedWork = payload;
		token = [scheduler after:30000 perform:^{ (void)[payload description]; }];
	}
	XCTAssertNotNil(retainedWork);
	[token cancel]; [token cancel];
	XCTAssertNil(retainedWork);
}
- (void)testReservationsBoundWorkBeforeDispatchAndSurviveCancellationUntilCleanup {
	dispatch_queue_t queue = dispatch_queue_create("dev.tileflow.test.held-network", DISPATCH_QUEUE_SERIAL);
	dispatch_suspend(queue);
	NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	configuration.protocolClasses = @[];
	TFAdmissionURLSessionNetwork *network = [[TFAdmissionURLSessionNetwork alloc] initWithConfiguration:configuration followsRedirects:NO
		responseByteLimit:65536 queueDepth:32 concurrency:4 workQueue:queue];
	NSMutableArray<id<TFAdmissionCancel>> *tokens = [NSMutableArray array];
	NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://api.tileflow.test/v1/sessions/start"]];
	__block NSUInteger completions = 0;
	TFAdmissionNetworkCompletion complete = ^(NSHTTPURLResponse *response, NSData *body) {
		XCTAssertNil(response); XCTAssertNil(body); completions++;
	};
	for (NSUInteger index = 0; index < 32; index++) [tokens addObject:[network start:request mayStart:^BOOL { return YES; } completion:complete]];
	XCTAssertEqual(completions, 0U);
	for (id<TFAdmissionCancel> token in tokens) [token cancel];
	XCTAssertEqual(completions, 32U);
	[network start:request mayStart:^BOOL { return YES; } completion:complete];
	XCTAssertEqual(completions, 33U);
	// No socket is reached: cancellation precedes the release of the queue.
	XCTestExpectation *cleaned = [self expectationWithDescription:@"Cancelled reservations cleaned"];
	dispatch_async(queue, ^{ dispatch_async(dispatch_get_main_queue(), ^{ [cleaned fulfill]; }); });
	dispatch_resume(queue);
	[self waitForExpectations:@[cleaned] timeout:5];
	[network close];
	[network start:request mayStart:^BOOL { return YES; } completion:complete];
	XCTAssertEqual(completions, 34U);
}
@end
