#import <XCTest/XCTest.h>
#import "TFAdmissionNetwork.h"
#import "TFDocumentBounds.h"

@interface TFDocumentBoundsTests : XCTestCase
@end
@implementation TFDocumentBoundsTests
- (void)testARequestCanOnlyLowerTheConfiguredTransportLimit {
	NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://maps.example.test/manifest.json"]];
	XCTAssertEqual(TFDocumentResponseByteLimit(request, 8388608), 8388608u);
	TFDocumentSetByteLimit(request, 1024);
	XCTAssertEqual(TFDocumentResponseByteLimit(request, 8388608), 1024u);
	XCTAssertEqual(TFDocumentResponseByteLimit([request copy], 64), 64u);
	XCTAssertEqual(request.allHTTPHeaderFields.count, 0u);
	XCTAssertThrows(TFDocumentSetByteLimit(request, 0));
	XCTAssertThrows(TFDocumentSetByteLimit(request, 8388609));
}
- (void)testTheNetworkUsesThePerRequestBoundBeforeItsQueueStarts {
	dispatch_queue_t queue = dispatch_queue_create("test.document.bound", DISPATCH_QUEUE_SERIAL);
	dispatch_suspend(queue);
	TFAdmissionURLSessionNetwork *network = [[TFAdmissionURLSessionNetwork alloc] initWithConfiguration:NSURLSessionConfiguration.ephemeralSessionConfiguration followsRedirects:NO responseByteLimit:8388608 queueDepth:2 concurrency:1 workQueue:queue];
	NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://maps.example.test/manifest.json"]];
	TFDocumentSetByteLimit(request, 1024);
	id<TFAdmissionCancel> operation = [network start:request mayStart:^BOOL { return NO; } completion:^(NSHTTPURLResponse *response, NSData *body) {}];
	XCTAssertEqualObjects([(NSObject *)operation valueForKey:@"responseByteLimit"], @1024);
	[operation cancel];
	dispatch_resume(queue);
	[network close];
}
@end
