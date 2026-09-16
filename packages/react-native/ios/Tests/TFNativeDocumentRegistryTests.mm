#import <XCTest/XCTest.h>
#import "TFNativeDocumentRegistry.h"

@interface TFDocumentTestCancel : NSObject <TFAdmissionCancel>
@property (nonatomic, copy) dispatch_block_t action;
@end
@implementation TFDocumentTestCancel
- (void)cancel { if (self.action) self.action(); }
@end
@interface TFDocumentTestScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic) NSTimeInterval time;
@property (nonatomic) NSMutableArray<dispatch_block_t> *queue;
@property (nonatomic) NSMutableArray<NSDictionary *> *timers;
- (void)flush;
- (void)advance;
@end
@implementation TFDocumentTestScheduler
- (instancetype)init { if ((self = [super init])) { _queue = [NSMutableArray array]; _timers = [NSMutableArray array]; } return self; }
- (NSTimeInterval)nowMs { return self.time; }
- (void)enqueue:(dispatch_block_t)block { [self.queue addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)delay perform:(dispatch_block_t)block {
	NSMutableDictionary *entry = [@{@"at": @(self.time + delay), @"block": [block copy]} mutableCopy];
	[self.timers addObject:entry];
	TFDocumentTestCancel *cancel = [TFDocumentTestCancel new]; cancel.action = ^{ [entry removeObjectForKey:@"block"]; }; return cancel;
}
- (void)flush { while (self.queue.count) { dispatch_block_t block = self.queue.firstObject; [self.queue removeObjectAtIndex:0]; block(); } }
- (void)advance {
	self.time += 30000;
	for (NSMutableDictionary *timer in [self.timers copy]) {
		dispatch_block_t block = timer[@"block"];
		if (block && [timer[@"at"] doubleValue] <= self.time) { [timer removeObjectForKey:@"block"]; block(); }
	}
	[self flush];
}
@end

@interface TFNativeDocumentRegistryTests : XCTestCase
@end
@implementation TFNativeDocumentRegistryTests
- (NSURLRequest *)request { return [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://maps.example.test/manifest.json"]]; }
- (NSHTTPURLResponse *)response { return [[NSHTTPURLResponse alloc] initWithURL:self.request.URL statusCode:200 HTTPVersion:nil headerFields:@{}]; }
- (void)testHeadersChunksAndCancellationRemainBoundedAndIndependent {
	TFDocumentTestScheduler *scheduler = [TFDocumentTestScheduler new];
	NSMutableArray<TFAdmissionNetworkCompletion> *callbacks = [NSMutableArray array];
	TFNativeDocumentRegistry *registry = [[TFNativeDocumentRegistry alloc] initWithScheduler:scheduler load:^id<TFAdmissionCancel>(NSURLRequest *request, TFNativeDocumentScope *scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion) {
		[callbacks addObject:[completion copy]]; return [TFDocumentTestCancel new];
	}];
	NSString *first = [registry open:self.request maximumBytes:1024 scope:nil];
	NSString *second = [registry open:self.request maximumBytes:1024 scope:nil];
	XCTAssertNotEqualObjects(first, second);
	__block NSDictionary *header = nil;
	[registry response:first completion:^(NSDictionary *value) { header = value; }];
	XCTAssertNil(header);
	callbacks[0](self.response, [@"{}" dataUsingEncoding:NSUTF8StringEncoding]);
	[scheduler flush];
	XCTAssertEqualObjects(header, (@{@"url": self.request.URL.absoluteString, @"status": @200}));
	XCTAssertEqualObjects([registry chunk:first maximumBytes:1], (@{@"bodyBase64": @"ew==", @"last": @NO}));
	XCTAssertEqualObjects([registry chunk:first maximumBytes:1], (@{@"bodyBase64": @"fQ==", @"last": @YES}));
	[registry cancel:first]; [registry cancel:first];
	__block BOOL rejected = NO;
	[registry response:second completion:^(NSDictionary *value) { rejected = value == nil; }];
	[registry cancel:second];
	XCTAssertTrue(rejected);
	callbacks[1](self.response, [@"{}" dataUsingEncoding:NSUTF8StringEncoding]);
	[scheduler flush];
	XCTAssertThrows([registry chunk:second maximumBytes:2]);
}
- (void)testPendingTransportAndUnreadBodiesKeepTheirCapacity {
	TFDocumentTestScheduler *scheduler = [TFDocumentTestScheduler new];
	NSMutableArray *callbacks = [NSMutableArray array];
	TFNativeDocumentRegistry *registry = [[TFNativeDocumentRegistry alloc] initWithScheduler:scheduler load:^id<TFAdmissionCancel>(NSURLRequest *request, TFNativeDocumentScope *scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion) {
		[callbacks addObject:[completion copy]]; return [TFDocumentTestCancel new];
	}];
	NSMutableArray *identifiers = [NSMutableArray array];
	for (NSUInteger index = 0; index < 16; index++) [identifiers addObject:[registry open:self.request maximumBytes:1024 scope:nil]];
	for (NSString *identifier in identifiers) [registry cancel:identifier];
	XCTAssertThrows([registry open:self.request maximumBytes:1024 scope:nil]);
	((TFAdmissionNetworkCompletion)callbacks.firstObject)(nil, nil); [scheduler flush];
	XCTAssertNotNil([registry open:self.request maximumBytes:1024 scope:nil]);
	[registry close];
}
- (void)testContextRetirementAndDeadlineInvalidateDeliveredBodiesWithoutJavaScript {
	TFDocumentTestScheduler *scheduler = [TFDocumentTestScheduler new];
	TFNativeDocumentRegistry *registry = [[TFNativeDocumentRegistry alloc] initWithScheduler:scheduler load:^id<TFAdmissionCancel>(NSURLRequest *request, TFNativeDocumentScope *scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion) {
		completion(self.response, [@"{}" dataUsingEncoding:NSUTF8StringEncoding]); return [TFDocumentTestCancel new];
	}];
	TFNativeDocumentScope *scope = [[TFNativeDocumentScope alloc] initWithContext:@"one" active:^BOOL { return YES; } load:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) { return [TFDocumentTestCancel new]; }];
	NSString *first = [registry open:self.request maximumBytes:1024 scope:scope];
	NSString *second = [registry open:self.request maximumBytes:1024 scope:nil];
	[scheduler flush];
	[registry response:first completion:^(NSDictionary *value) { XCTAssertNotNil(value); }];
	[registry response:second completion:^(NSDictionary *value) { XCTAssertNotNil(value); }];
	[registry retireContext:@"one"];
	XCTAssertThrows([registry chunk:first maximumBytes:2]);
	XCTAssertEqualObjects([registry chunk:second maximumBytes:2][@"last"], @YES);
	NSString *third = [registry open:self.request maximumBytes:1024 scope:nil]; [scheduler flush];
	[scheduler advance];
	XCTAssertThrows([registry chunk:third maximumBytes:2]);
}
- (void)testInvalidBodiesAndPartialMetadataNeverBecomeReadable {
	for (NSNumber *variant in @[@0, @1, @2]) {
		TFDocumentTestScheduler *scheduler = [TFDocumentTestScheduler new];
		TFNativeDocumentRegistry *registry = [[TFNativeDocumentRegistry alloc] initWithScheduler:scheduler load:^id<TFAdmissionCancel>(NSURLRequest *request, TFNativeDocumentScope *scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion) {
			NSHTTPURLResponse *response = variant.integerValue == 1 ? [[NSHTTPURLResponse alloc] initWithURL:[NSURL URLWithString:@"https://other.example.test/manifest.json"] statusCode:200 HTTPVersion:nil headerFields:nil] : self.response;
			completion(response, [NSMutableData dataWithLength:variant.integerValue == 0 ? 3 : 2]);
			return [TFDocumentTestCancel new];
		}];
		NSString *identifier = [registry open:self.request maximumBytes:2 scope:nil];
		if (variant.integerValue == 2) [registry lifecycle:NO];
		[scheduler flush];
		[registry response:identifier completion:^(NSDictionary *value) { XCTAssertNil(value); }];
		XCTAssertThrows([registry chunk:identifier maximumBytes:2]);
		XCTAssertEqualObjects(registry.description, @"TFNativeDocumentRegistry(redacted)");
	}
}
@end
