#import <XCTest/XCTest.h>
#import "TFAdmissionEngine.h"

@interface TFCatalogCancel : NSObject <TFAdmissionCancel>
@end
@implementation TFCatalogCancel
- (void)cancel {}
@end
@interface TFCatalogScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic) NSMutableArray<dispatch_block_t> *queue;
- (void)flush;
@end
@implementation TFCatalogScheduler
- (instancetype)init { if ((self = [super init])) _queue = [NSMutableArray array]; return self; }
- (NSTimeInterval)nowMs { return 0; }
- (void)enqueue:(dispatch_block_t)block { [self.queue addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)delay perform:(dispatch_block_t)block { return [TFCatalogCancel new]; }
- (void)flush { while (self.queue.count) { dispatch_block_t block = self.queue.firstObject; [self.queue removeObjectAtIndex:0]; block(); } }
@end
@interface TFCatalogNetwork : NSObject <TFAdmissionNetwork>
@property (nonatomic) NSMutableArray<NSURLRequest *> *requests;
@end
@implementation TFCatalogNetwork
- (instancetype)init { if ((self = [super init])) _requests = [NSMutableArray array]; return self; }
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	if (guard()) [self.requests addObject:request];
	return [TFCatalogCancel new];
}
@end

@interface TFAdmissionCatalogEngineTests : XCTestCase
@end
@implementation TFAdmissionCatalogEngineTests
- (void)testCatalogExtensionKeepsIdentityAndRequiresOneIndependentVerdict {
	TFCatalogScheduler *scheduler = [TFCatalogScheduler new];
	TFCatalogNetwork *network = [TFCatalogNetwork new];
	NSMutableArray *events = [NSMutableArray array];
	TFAdmissionEngine *engine = [[TFAdmissionEngine alloc] initWithInstallation:@"installation" scheduler:scheduler network:network owns:^BOOL { return YES; } emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSString *mapId = @"map_0123456789abcdef";
	NSDictionary *template = @{@"url": @"https://tiles.example.test/world/{z}/{x}/{y}.pbf", @"scope": @"tile", @"tilesetId": @"world", @"template": @"tile"};
	NSString *first = [engine registerMap:mapId resources:@[]], *second = [engine registerMap:mapId resources:@[template]];
	XCTAssertEqual([engine extendContext:first resources:@[template]], 1u);
	XCTAssertEqual([engine extendContext:first resources:@[template]], 1u);
	NSMutableDictionary *conflict = [template mutableCopy]; conflict[@"tilesetId"] = @"other";
	XCTAssertThrows([engine extendContext:first resources:@[conflict]]);
	NSString *url = @"https://tiles.example.test/world/2/3/1.pbf";
	__block NSUInteger failed = 0;
	for (NSString *context in @[first, second]) {
		NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[url stringByAppendingFormat:@"?__tf_native_context=%@", context]]];
		[engine request:request response:^(NSHTTPURLResponse *response, NSData *body) {} failure:^{ failed++; } delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) { XCTFail(@"Unexpected delegation"); return [TFCatalogCancel new]; }];
	}
	[scheduler flush];
	XCTAssertEqual(events.count, 2u);
	NSDictionary *batch = events.firstObject, *ticket = [batch[@"tickets"] firstObject];
	XCTAssertEqualObjects(ticket[@"url"], url);
	NSDictionary *authority = @{@"grant": [@"tf_native_v1." stringByAppendingString:@"fixture.signature"], @"mapId": mapId, @"resourceOrigins": @[@"https://tiles.example.test"], @"resourceScopes": @[@"tile"], @"tilesetIds": @[@"world"]};
	XCTAssertEqual([engine completeContext:first generation:1 batch:batch[@"batch"] results:@[@{@"ticket": ticket[@"ticket"], @"kind": @"grant", @"validForMs": @900000, @"authority": authority}]], 1u);
	XCTAssertEqual(network.requests.count, 1u);
	XCTAssertEqualObjects(network.requests.firstObject.URL.absoluteString, url);
	XCTAssertEqual(failed, 0u);
	[engine retire:first];
	XCTAssertThrows([engine extendContext:first resources:@[template]]);
	XCTAssertEqual([engine extendContext:second resources:@[template]], 1u);
}
@end
