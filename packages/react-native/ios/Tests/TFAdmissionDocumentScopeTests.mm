#import <XCTest/XCTest.h>
#import "TFAdmissionDocumentScope.h"
#import "TFAdmissionNetwork.h"

@interface TFDocumentScopeNetwork : NSObject <TFAdmissionNetwork, TFAdmissionCancel>
@end
@implementation TFDocumentScopeNetwork
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	XCTFail(@"Unexpected resource acquisition."); return self;
}
- (void)cancel {}
@end
@interface TFAdmissionDocumentScopeTests : XCTestCase
@end
@implementation TFAdmissionDocumentScopeTests
- (void)testCancellationCompletesOnceAndRetirementDoesNotInvalidateAnotherScope {
	TFAdmissionEngine *engine = [[TFAdmissionEngine alloc] initWithInstallation:@"installation" scheduler:[TFContinuousAdmissionScheduler new] network:[TFDocumentScopeNetwork new] owns:^BOOL { return YES; } emit:^(NSDictionary *event) {}];
	NSString *url = @"https://api.example.test/maps/map_0123456789abcdef/style.json";
	NSArray *resources = @[@{@"url": url, @"scope": @"style"}];
	NSString *first = [engine registerMap:@"map_0123456789abcdef" resources:resources];
	NSString *second = [engine registerMap:@"map_0123456789abcdef" resources:resources];
	TFNativeDocumentScope *one = TFCreateAdmissionDocumentScope(engine, first);
	TFNativeDocumentScope *two = TFCreateAdmissionDocumentScope(engine, second);
	__block NSUInteger completions = 0;
	id<TFAdmissionCancel> request = one.load([NSURLRequest requestWithURL:[NSURL URLWithString:url]], ^(NSHTTPURLResponse *response, NSData *body) {
		XCTAssertNil(response); XCTAssertNil(body); completions++;
	});
	[request cancel]; [request cancel];
	XCTAssertEqual(completions, 1u);
	[engine retire:first];
	XCTAssertFalse(one.active()); XCTAssertTrue(two.active());
	[engine close];
}
@end
