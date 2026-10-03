#import <XCTest/XCTest.h>
#import "TFAdmissionEngine.h"

@protocol TFAdmissionOperationTest <TFAdmissionCancel, NSURLSessionDelegate>
- (void)start;
@end
@interface TFHeldNativeSession : NSObject
@property (nonatomic) NSUInteger invalidations;
- (void)invalidateAndCancel;
@end
@implementation TFHeldNativeSession
- (void)invalidateAndCancel { self.invalidations++; }
@end

@interface TFAdmissionNetworkTerminalTests : XCTestCase
@end
@implementation TFAdmissionNetworkTerminalTests
- (void)testCancellationDeliversFailureButRetainsCapacityUntilNativeSessionInvalidation {
	NSObject<TFAdmissionOperationTest> *operation = (id)[NSClassFromString(@"TFAdmissionSessionOperation") new];
	XCTAssertNotNil(operation);
	__block NSUInteger results = 0, cleanups = 0;
	TFAdmissionNetworkCompletion completion = ^(NSHTTPURLResponse *response, NSData *body) { results++; XCTAssertNil(response); XCTAssertNil(body); };
	dispatch_block_t cleanup = ^{ cleanups++; };
	[operation setValue:completion forKey:@"completion"];
	[operation setValue:cleanup forKey:@"cleanup"];
	TFHeldNativeSession *session = [TFHeldNativeSession new];
	[operation setValue:session forKey:@"session"];
	[operation cancel]; [operation cancel];
	XCTAssertEqual(results, 1u); XCTAssertEqual(cleanups, 0u);
	XCTAssertGreaterThan(session.invalidations, 0u);
	[operation URLSession:(NSURLSession *)session didBecomeInvalidWithError:nil];
	[operation URLSession:(NSURLSession *)session didBecomeInvalidWithError:nil];
	XCTAssertEqual(results, 1u); XCTAssertEqual(cleanups, 1u);
	XCTAssertNil([operation valueForKey:@"session"]);
	XCTAssertNil([operation valueForKey:@"request"]);
}
- (void)testCancellationBeforeQueueDrainReleasesOnlyWhenStartIsProcessed {
	NSObject<TFAdmissionOperationTest> *operation = (id)[NSClassFromString(@"TFAdmissionSessionOperation") new];
	__block NSUInteger results = 0, cleanups = 0;
	TFAdmissionNetworkCompletion completion = ^(NSHTTPURLResponse *response, NSData *body) { results++; };
	dispatch_block_t cleanup = ^{ cleanups++; };
	[operation setValue:completion forKey:@"completion"];
	[operation setValue:cleanup forKey:@"cleanup"];
	[operation cancel]; [operation cancel];
	XCTAssertEqual(results, 1u); XCTAssertEqual(cleanups, 0u);
	[operation start]; [operation start];
	XCTAssertEqual(results, 1u); XCTAssertEqual(cleanups, 1u);
}
@end
