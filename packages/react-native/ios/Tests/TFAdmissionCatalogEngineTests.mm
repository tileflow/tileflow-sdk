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
- (TFAdmissionEngine *)engineWithScheduler:(TFCatalogScheduler *)scheduler network:(TFCatalogNetwork *)network events:(NSMutableArray *)events {
	return [[TFAdmissionEngine alloc] initWithInstallation:@"installation" scheduler:scheduler network:network owns:^BOOL { return YES; } emit:^(NSDictionary *event) { [events addObject:event]; }];
}
- (void)testCatalogExtensionKeepsIdentityAndRequiresOneIndependentVerdict {
	TFCatalogScheduler *scheduler = [TFCatalogScheduler new];
	TFCatalogNetwork *network = [TFCatalogNetwork new];
	NSMutableArray *events = [NSMutableArray array];
	TFAdmissionEngine *engine = [self engineWithScheduler:scheduler network:network events:events];
	NSString *mapId = @"map_0123456789abcdef";
	NSDictionary *resourceTemplate = @{@"url": @"https://tiles.example.test/world/{z}/{x}/{y}.pbf", @"scope": @"tile", @"tilesetId": @"world", @"template": @"tile"};
	NSString *first = [engine registerMap:mapId resources:@[]], *second = [engine registerMap:mapId resources:@[resourceTemplate]];
	XCTAssertEqual([engine extendContext:first resources:@[resourceTemplate]], 1u);
	XCTAssertEqual([engine extendContext:first resources:@[resourceTemplate]], 1u);
	NSMutableDictionary *conflict = [resourceTemplate mutableCopy]; conflict[@"tilesetId"] = @"other";
	XCTAssertThrows([engine extendContext:first resources:@[conflict]]);
	NSString *url = @"https://tiles.example.test/world/2/3/1.pbf";
	__block NSUInteger failed = 0;
	for (NSString *context in @[first, second]) {
		NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[url stringByAppendingFormat:@"?__tf_native_context=%@", context]]];
		[engine request:request response:^(__unused NSHTTPURLResponse *response, __unused NSData *body) {} failure:^{ failed++; } delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) { XCTFail(@"Unexpected delegation"); return [TFCatalogCancel new]; }];
	}
	[scheduler flush];
	XCTAssertEqual(events.count, 2u);
	NSDictionary *batch = events.firstObject, *ticket = [batch[@"tickets"] firstObject];
	XCTAssertEqualObjects(ticket[@"url"], url);
	NSDictionary *authority = @{@"grant": [@"tf_native_v1." stringByAppendingString:@"fixture.signature"], @"mapId": mapId, @"resourceOrigins": @[@"https://tiles.example.test"], @"resourceScopes": @[@"tile"], @"tilesetIds": @[@"world"]};
	NSArray *results = @[@{@"ticket": ticket[@"ticket"], @"kind": @"grant", @"validForMs": @900000, @"authority": authority}];
	NSUInteger accepted = [engine completeContext:first generation:1 batch:batch[@"batch"] results:results];
	XCTAssertEqual(accepted, 1u);
	XCTAssertEqual(network.requests.count, 1u);
	XCTAssertEqualObjects(network.requests.firstObject.URL.absoluteString, url);
	XCTAssertEqual(failed, 0u);
	[engine retire:first];
	XCTAssertThrows([engine extendContext:first resources:@[resourceTemplate]]);
	XCTAssertEqual([engine extendContext:second resources:@[resourceTemplate]], 1u);
}
- (void)testGlyphTemplateExtensionIsAppendOnlyAndFinite {
	TFCatalogScheduler *scheduler = [TFCatalogScheduler new];
	TFCatalogNetwork *network = [TFCatalogNetwork new];
	NSMutableArray *events = [NSMutableArray array];
	TFAdmissionEngine *engine = [self engineWithScheduler:scheduler network:network events:events];
	NSString *url = @"https://tiles.example.test/fonts/{fontstack}/{range}.pbf";
	NSDictionary *first = @{@"url": url, @"scope": @"glyph", @"template": @"glyphs", @"fontStacks": @[@"Brand Regular"]};
	NSString *context = [engine registerMap:@"map_0123456789abcdef" resources:@[first]];
	NSDictionary *extended = @{@"url": url, @"scope": @"glyph", @"template": @"glyphs", @"fontStacks": @[@"Brand Bold", @"Brand Regular"]};
	XCTAssertEqual([engine extendContext:context resources:@[extended]], 1u);
	NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[@"https://tiles.example.test/fonts/Brand%20Bold/0-255.pbf" stringByAppendingFormat:@"?__tf_native_context=%@", context]]];
	__block NSUInteger failures = 0;
	[engine request:request response:^(__unused NSHTTPURLResponse *response, __unused NSData *body) {} failure:^{ failures++; } delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) { XCTFail(@"Unexpected delegation"); return [TFCatalogCancel new]; }];
	[scheduler flush];
	XCTAssertEqual(failures, 0u);
	XCTAssertThrows([engine extendContext:context resources:@[first]]);
	NSDictionary *wrongClass = @{@"url": url, @"scope": @"font", @"template": @"glyphs", @"fontStacks": @[@"Brand Bold", @"Brand Regular"]};
	XCTAssertThrows([engine extendContext:context resources:@[wrongClass]]);
}
@end
