#import <XCTest/XCTest.h>
#import "TFAdmissionEngine.h"

@interface TFTestCancellation : NSObject <TFAdmissionCancel>
@property (atomic) BOOL cancelled;
@end
@implementation TFTestCancellation
- (void)cancel { self.cancelled = YES; }
@end

@interface TFManualAdmissionScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic) NSTimeInterval time;
@property (nonatomic) NSMutableArray<dispatch_block_t> *queue;
@property (nonatomic) NSMutableArray<NSDictionary *> *timers;
- (void)flush;
- (void)advance:(NSTimeInterval)milliseconds;
@end
@implementation TFManualAdmissionScheduler
- (instancetype)init {
	if ((self = [super init])) { _queue = [NSMutableArray array]; _timers = [NSMutableArray array]; }
	return self;
}
- (NSTimeInterval)nowMs { return self.time; }
- (void)enqueue:(dispatch_block_t)block { [self.queue addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block {
	TFTestCancellation *token = [TFTestCancellation new];
	[self.timers addObject:@{@"due": @(self.time + milliseconds), @"block": [block copy], @"token": token}];
	return token;
}
- (void)flush {
	while (self.queue.count) {
		dispatch_block_t block = self.queue.firstObject;
		[self.queue removeObjectAtIndex:0];
		block();
	}
}
- (void)advance:(NSTimeInterval)milliseconds {
	self.time += milliseconds;
	for (NSDictionary *timer in [self.timers copy]) {
		TFTestCancellation *token = timer[@"token"];
		if (!token.cancelled && [timer[@"due"] doubleValue] <= self.time) {
			token.cancelled = YES;
			[self enqueue:timer[@"block"]];
		}
	}
	[self flush];
}
@end

@interface TFAdmissionNetworkDouble : NSObject <TFAdmissionNetwork>
@property (nonatomic) NSMutableArray<NSDictionary *> *requests;
- (void)deliver:(NSUInteger)index status:(NSInteger)status location:(nullable NSString *)location;
@end
@implementation TFAdmissionNetworkDouble
- (instancetype)init { if ((self = [super init])) _requests = [NSMutableArray array]; return self; }
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	TFTestCancellation *token = [TFTestCancellation new];
	[self.requests addObject:@{@"request": request, @"guard": [guard copy], @"completion": [completion copy], @"token": token}];
	return token;
}
- (void)deliver:(NSUInteger)index status:(NSInteger)status location:(NSString *)location {
	NSDictionary *item = self.requests[index];
	NSURLRequest *request = item[@"request"];
	NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:request.URL statusCode:status HTTPVersion:@"HTTP/1.1" headerFields:location ? @{@"Location": location} : @{}];
	TFAdmissionNetworkCompletion completion = item[@"completion"];
	completion(response, [NSData data]);
}
@end

@interface TFAdmissionEngineTests : XCTestCase
@property (nonatomic) TFManualAdmissionScheduler *scheduler;
@property (nonatomic) TFAdmissionNetworkDouble *network;
@property (nonatomic) TFAdmissionEngine *engine;
@property (nonatomic) NSMutableArray<NSDictionary *> *events;
@property (nonatomic) NSMutableArray<NSString *> *delegated;
@property (nonatomic) NSUInteger failures;
@property (nonatomic) NSUInteger responses;
@property (nonatomic) BOOL owns;
@end

@implementation TFAdmissionEngineTests
- (NSString *)original { return @"https://tiles.tileflow.test/world/0/0/0.pbf?variant=a%2Fb&x=1"; }
- (NSString *)redirected { return @"https://tiles.tileflow.test/world/0/0/1.pbf?x=1"; }
- (NSString *)grant { return @"tf_native_v1.fixture.signature"; }
- (void)setUp {
	[super setUp];
	self.scheduler = [TFManualAdmissionScheduler new];
	self.network = [TFAdmissionNetworkDouble new];
	self.events = [NSMutableArray array];
	self.delegated = [NSMutableArray array];
	self.failures = 0; self.responses = 0; self.owns = YES;
	__weak TFAdmissionEngineTests *weakSelf = self;
	self.engine = [[TFAdmissionEngine alloc] initWithInstallation:@"installation_1" scheduler:self.scheduler network:self.network
		owns:^BOOL { return weakSelf.owns; }
		emit:^(NSDictionary *event) { [weakSelf.events addObject:event]; }];
}
- (void)tearDown { [self.engine close]; [super tearDown]; }
- (NSString *)registerDirect:(BOOL)direct {
	return [self.engine registerMap:direct ? nil : @"map_0123456789abcdef" resources:@[
		@{@"url": self.original, @"scope": @"tile", @"tilesetId": @"world"},
		@{@"url": self.redirected, @"scope": @"tile", @"tilesetId": @"world"}]];
}
- (NSURLRequest *)tagged:(NSString *)url context:(NSString *)context {
	NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:[url stringByAppendingFormat:@"&__tf_native_context=%@", context]]];
	[request setValue:@"bytes=1-8" forHTTPHeaderField:@"Range"];
	[request setValue:@"version-1" forHTTPHeaderField:@"If-None-Match"];
	return request;
}
- (id<TFAdmissionCancel>)request:(NSString *)context {
	return [self.engine request:[self tagged:self.original context:context]
		response:^(NSHTTPURLResponse *response, NSData *body) { self.responses++; }
		failure:^{ self.failures++; }
		delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) {
			[self.delegated addObject:request.URL.absoluteString];
			completion([[NSHTTPURLResponse alloc] initWithURL:request.URL statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{}], [NSData data]);
			return [TFTestCancellation new];
		}];
}
- (NSDictionary *)batch:(NSString *)context {
	for (NSDictionary *event in self.events.reverseObjectEnumerator) {
		if ([event[@"kind"] isEqual:@"batch"] && [event[@"context"] isEqual:context]) return event;
	}
	XCTFail(@"Expected a native batch");
	return @{};
}
- (void)admit:(NSString *)context budget:(NSUInteger)budget tileset:(NSString *)tileset {
	NSDictionary *batch = [self batch:context];
	NSMutableArray *results = [NSMutableArray array];
	for (NSDictionary *ticket in batch[@"tickets"]) {
		[results addObject:@{@"ticket": ticket[@"ticket"], @"kind": @"grant", @"validForMs": @(budget),
			@"authority": @{@"grant": self.grant, @"mapId": @"map_0123456789abcdef",
				@"resourceOrigins": @[@"https://tiles.tileflow.test"], @"resourceScopes": @[@"tile"], @"tilesetIds": @[tileset]}}];
	}
	[self.engine completeContext:context generation:1 batch:batch[@"batch"] results:results];
	[self.scheduler flush];
}

- (void)testTwoContextsShareOriginalURLsButNotTicketsOrAuthority {
	NSString *first = [self registerDirect:NO], *second = [self registerDirect:NO];
	[self request:first]; [self request:second]; [self.scheduler flush];
	XCTAssertNotEqualObjects(first, second);
	[self admit:first budget:900000 tileset:@"world"];
	XCTAssertEqual(self.network.requests.count, 1u);
	[self admit:second budget:900000 tileset:@"world"];
	XCTAssertEqual(self.network.requests.count, 2u);
	for (NSDictionary *item in self.network.requests) {
		NSURLRequest *request = item[@"request"];
		XCTAssertEqualObjects(request.URL.absoluteString, self.original);
		XCTAssertEqualObjects([request valueForHTTPHeaderField:TFAdmissionGrantHeader], self.grant);
		XCTAssertEqualObjects([request valueForHTTPHeaderField:@"Range"], @"bytes=1-8");
		XCTAssertEqualObjects([request valueForHTTPHeaderField:@"If-None-Match"], @"version-1");
	}
	XCTAssertFalse([self.events.description containsString:self.grant]);
}
- (void)testBoundedQueueAndBatchRetireWhenJavaScriptNeverResponds {
	NSString *context = [self registerDirect:NO];
	for (NSUInteger index = 0; index < 129; index++) [self request:context];
	[self.scheduler flush];
	XCTAssertEqual(self.failures, 1u);
	XCTAssertEqual([(NSArray *)[self batch:context][@"tickets"] count], 8u);
	XCTAssertEqual(self.network.requests.count, 0u);
	[self.scheduler advance:30000];
	XCTAssertTrue([[self.events valueForKey:@"kind"] containsObject:@"retired"]);
	[self admit:context budget:900000 tileset:@"world"];
	XCTAssertEqual(self.network.requests.count, 0u);
}
- (void)testCancellationDuringQueueJavaScriptAndNetworkDropsLateCompletion {
	for (NSUInteger phase = 0; phase < 3; phase++) {
		NSString *context = [self registerDirect:NO];
		id<TFAdmissionCancel> token = [self request:context];
		if (phase == 0) [token cancel];
		[self.scheduler flush];
		if (phase == 1) [token cancel];
		[self.scheduler flush];
		if (phase != 0) [self admit:context budget:900000 tileset:@"world"];
		if (phase == 2) [token cancel];
		[self.scheduler flush];
		for (NSUInteger index = 0; index < self.network.requests.count; index++) [self.network deliver:index status:200 location:nil];
		[self.scheduler flush];
		XCTAssertEqual(self.responses, 0u);
		[self.engine retire:context];
	}
}
- (void)testDirectAdmissionPreservesThePreviousProtocolPathWithoutGrant {
	NSString *context = [self registerDirect:YES];
	[self request:context]; [self.scheduler flush];
	NSDictionary *batch = [self batch:context];
	NSString *ticket = batch[@"tickets"][0][@"ticket"];
	[self.engine completeContext:context generation:1 batch:batch[@"batch"] results:@[@{@"ticket": ticket, @"kind": @"delegate"}]];
	[self.scheduler flush];
	XCTAssertEqualObjects(self.delegated, (@[self.original]));
	XCTAssertEqual(self.network.requests.count, 0u);
}
- (void)testExpiryUsesEnqueueAnchorRatherThanBridgeReceipt {
	NSString *context = [self registerDirect:NO];
	[self request:context]; [self.scheduler flush];
	self.scheduler.time = 5000;
	[self admit:context budget:7000 tileset:@"world"];
	TFAdmissionStartGuard guard = self.network.requests.firstObject[@"guard"];
	XCTAssertTrue(guard());
	self.scheduler.time = 6000;
	XCTAssertFalse(guard());
}
- (void)testOwnershipReplacementInvalidatesNetworkAndKeepsDiagnosticsSecretFree {
	NSString *context = [self registerDirect:NO];
	[self request:context]; [self.scheduler flush]; [self admit:context budget:900000 tileset:@"world"];
	self.owns = NO;
	TFAdmissionStartGuard guard = self.network.requests.firstObject[@"guard"];
	XCTAssertFalse(guard());
	[self.network deliver:0 status:200 location:nil]; [self.scheduler flush];
	XCTAssertEqual(self.responses, 0u);
	XCTAssertTrue([[self.events valueForKey:@"kind"] containsObject:@"ownershipLost"]);
	XCTAssertFalse([TFAdmissionSafeError().description containsString:self.grant]);
}
- (void)testRedirectsRevalidateOriginExactPathContextAndExistingTicket {
	for (NSString *target in @[self.redirected, @"https://outside.test/world/0/0/1.pbf", @"https://tiles.tileflow.test/unapproved", [self.redirected stringByAppendingString:@"&__tf_native_context=retired.9"]]) {
		NSString *context = [self registerDirect:NO];
		NSUInteger before = self.network.requests.count;
		[self request:context]; [self.scheduler flush]; [self admit:context budget:900000 tileset:@"world"];
		[self.network deliver:before status:302 location:target]; [self.scheduler flush];
		XCTAssertEqual(self.network.requests.count, before + ([target isEqual:self.redirected] ? 2u : 1u));
		XCTAssertTrue([[self.events valueForKey:@"status"] containsObject:@302]);
		[self.engine retire:context];
	}
}
- (void)testMalformedReservedContextNeverDelegates {
	NSString *context = [self registerDirect:NO];
	for (NSString *suffix in @[@"__tf_native_context=", @"__tf_native_context=unknown.1", [NSString stringWithFormat:@"__tf_native_context=%@&__tf_native_context=%@", context, context], [@"%5f%5ftf_native_context=" stringByAppendingString:context]]) {
		NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[self.original stringByAppendingFormat:@"&%@", suffix]]];
		[self.engine request:request response:^(NSHTTPURLResponse *response, NSData *body) { XCTFail(@"Unexpected response"); }
			failure:^{ self.failures++; } delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) {
				XCTFail(@"Reserved traffic must not delegate"); return [TFTestCancellation new];
			}];
	}
	[self.scheduler flush];
	XCTAssertEqual(self.failures, 4u);
	XCTAssertEqual(self.events.count, 0u);
}
- (void)testRetirementAndWrongTilesetCannotSendOrReviveAuthority {
	NSString *context = [self registerDirect:NO];
	[self request:context]; [self.scheduler flush]; [self admit:context budget:900000 tileset:@"other"];
	XCTAssertEqual(self.network.requests.count, 0u);
	[self.engine retire:context]; [self.engine retire:context];
	[self admit:context budget:900000 tileset:@"world"];
	XCTAssertEqual(self.network.requests.count, 0u);
}
- (void)testSuspensionCancelsAllWorkAndResumeStartsWithFreshAdmission {
	NSString *context = [self registerDirect:NO];
	[self request:context]; [self.scheduler flush]; [self admit:context budget:900000 tileset:@"world"];
	[self.engine lifecycle:NO]; [self.scheduler flush];
	TFAdmissionStartGuard guard = self.network.requests.firstObject[@"guard"];
	XCTAssertFalse(guard());
	XCTAssertTrue(((TFTestCancellation *)self.network.requests.firstObject[@"token"]).cancelled);
	self.scheduler.time += 900000;
	[self.engine lifecycle:YES];
	[self request:context]; [self.scheduler flush]; [self admit:context budget:900000 tileset:@"world"];
	XCTAssertEqual(self.network.requests.count, 2u);
}
@end
