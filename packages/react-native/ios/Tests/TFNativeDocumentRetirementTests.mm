#import <XCTest/XCTest.h>
#import "TFNativeDocumentRegistry.h"

@interface TFRetirementDocumentCancel : NSObject <TFAdmissionCancel>
@property (nonatomic) NSUInteger calls;
@end
@implementation TFRetirementDocumentCancel
- (void)cancel { self.calls++; }
@end
@interface TFRetirementDocumentScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic, strong) NSMutableArray<dispatch_block_t> *blocks;
- (void)flush;
@end
@implementation TFRetirementDocumentScheduler
- (instancetype)init { if ((self = [super init])) _blocks = [NSMutableArray array]; return self; }
- (NSTimeInterval)nowMs { return 0; }
- (void)enqueue:(dispatch_block_t)block { [self.blocks addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block { return [TFRetirementDocumentCancel new]; }
- (void)flush { while (self.blocks.count) { dispatch_block_t block = self.blocks.firstObject; [self.blocks removeObjectAtIndex:0]; block(); } }
@end

@interface TFNativeDocumentRetirementTests : XCTestCase
@end
@implementation TFNativeDocumentRetirementTests
- (void)testInstallationRetirementRejectsEveryProtectedPhaseButNotIndependentDocuments {
	TFRetirementDocumentScheduler *scheduler = [TFRetirementDocumentScheduler new];
	NSMutableArray<TFAdmissionNetworkCompletion> *completions = [NSMutableArray array];
	NSMutableArray<TFRetirementDocumentCancel *> *cancellations = [NSMutableArray array];
	TFNativeDocumentRegistry *registry = [[TFNativeDocumentRegistry alloc] initWithScheduler:scheduler load:^id<TFAdmissionCancel>(NSURLRequest *request, TFNativeDocumentScope *scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion) {
		[completions addObject:[completion copy]];
		TFRetirementDocumentCancel *cancel = [TFRetirementDocumentCancel new];
		[cancellations addObject:cancel];
		return cancel;
	}];
	NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://maps.example.test/style.json"]];
	TFNativeDocumentScope *scope = [[TFNativeDocumentScope alloc] initWithContext:@"context_1" active:^BOOL { return YES; } load:^id<TFAdmissionCancel>(NSURLRequest *input, TFAdmissionNetworkCompletion completion) { return [TFRetirementDocumentCancel new]; }];
	NSString *waiting = [registry open:request maximumBytes:2 scope:scope];
	NSString *delivered = [registry open:request maximumBytes:2 scope:scope];
	NSString *independent = [registry open:request maximumBytes:2 scope:nil];
	NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:request.URL statusCode:200 HTTPVersion:nil headerFields:nil];
	NSData *body = [@"{}" dataUsingEncoding:NSUTF8StringEncoding];
	completions[1](response, body); completions[2](response, body); [scheduler flush];
	__block NSUInteger failures = 0;
	[registry response:waiting completion:^(NSDictionary *header) { if (!header) failures++; }];
	[registry response:delivered completion:^(NSDictionary *header) { XCTAssertNotNil(header); }];
	[registry response:independent completion:^(NSDictionary *header) { XCTAssertNotNil(header); }];
	[registry retireProtected]; [registry retireProtected];
	XCTAssertEqual(failures, 1u);
	XCTAssertEqual(cancellations[0].calls, 1u);
	XCTAssertThrows([registry chunk:delivered maximumBytes:2]);
	XCTAssertEqualObjects([registry chunk:independent maximumBytes:2][@"last"], @YES);
	completions[0](response, body); [scheduler flush];
	XCTAssertThrows([registry chunk:waiting maximumBytes:2]);
	[registry close]; [registry close];
}
@end
