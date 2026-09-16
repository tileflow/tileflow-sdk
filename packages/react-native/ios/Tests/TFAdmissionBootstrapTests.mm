#import <XCTest/XCTest.h>
#import "TFAdmissionBootstrap.h"

@interface TFBootstrapTestCancel : NSObject <TFAdmissionCancel>
@property (nonatomic) BOOL cancelled;
@end
@implementation TFBootstrapTestCancel
- (void)cancel { self.cancelled = YES; }
@end

@interface TFBootstrapTestScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic) NSTimeInterval time;
@property (nonatomic) NSMutableArray<dispatch_block_t> *work;
@property (nonatomic) NSMutableArray<NSDictionary *> *timers;
- (void)flush;
- (void)advance:(NSTimeInterval)time;
@end
@implementation TFBootstrapTestScheduler
- (instancetype)init { if ((self = [super init])) { _work = [NSMutableArray array]; _timers = [NSMutableArray array]; } return self; }
- (NSTimeInterval)nowMs { return self.time; }
- (void)enqueue:(dispatch_block_t)block { [self.work addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block {
	TFBootstrapTestCancel *token = [TFBootstrapTestCancel new];
	[self.timers addObject:@{@"at": @(self.time + milliseconds), @"block": [block copy], @"token": token}];
	return token;
}
- (void)flush { while (self.work.count) { dispatch_block_t block = self.work.firstObject; [self.work removeObjectAtIndex:0]; block(); } }
- (void)advance:(NSTimeInterval)time {
	self.time += time;
	for (NSDictionary *timer in [self.timers copy]) {
		TFBootstrapTestCancel *token = timer[@"token"];
		if ([timer[@"at"] doubleValue] <= self.time && !token.cancelled) { token.cancelled = YES; [self enqueue:timer[@"block"]]; }
	}
	[self flush];
}
@end

@interface TFBootstrapTestNetwork : NSObject <TFAdmissionNetwork>
@property (nonatomic) NSMutableArray<NSDictionary *> *pending;
@end
@implementation TFBootstrapTestNetwork
- (instancetype)init { if ((self = [super init])) _pending = [NSMutableArray array]; return self; }
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	TFBootstrapTestCancel *token = [TFBootstrapTestCancel new];
	[self.pending addObject:@{@"request": request, @"guard": [guard copy], @"completion": [completion copy], @"token": token}];
	return token;
}
@end

@interface TFAdmissionBootstrapTests : XCTestCase
@property (nonatomic) TFBootstrapTestScheduler *scheduler;
@property (nonatomic) TFBootstrapTestNetwork *network;
@property (nonatomic) TFAdmissionBootstrap *bootstrap;
@property (nonatomic) NSMutableArray *replies;
@property (nonatomic) BOOL owns;
@end
@implementation TFAdmissionBootstrapTests
- (NSString *)credential { return [@"tf_public_" stringByAppendingString:[@"" stringByPaddingToLength:48 withString:@"a" startingAtIndex:0]]; }
- (NSString *)endpoint { return @"https://api.tileflow.test/v1/sessions/start"; }
- (NSString *)payload { return @"{\"mapId\":\"map_0123456789abcdef\",\"sessionId\":\"ses_fixture_1\",\"surfaceId\":\"default\"}"; }
- (void)setUp {
	self.scheduler = [TFBootstrapTestScheduler new]; self.network = [TFBootstrapTestNetwork new]; self.replies = [NSMutableArray array]; self.owns = YES;
	__weak TFAdmissionBootstrapTests *weakSelf = self;
	self.bootstrap = [[TFAdmissionBootstrap alloc] initWithInstallation:@"installation_1" scheduler:self.scheduler network:self.network owns:^BOOL { return weakSelf.owns; }];
	[self.bootstrap registerContext:@"installation_1.1" mapId:@"map_0123456789abcdef"];
	[self.bootstrap registerContext:@"installation_1.2" mapId:@"map_0123456789abcdef"];
}
- (void)tearDown { [self.bootstrap close]; }
- (void)start:(NSUInteger)sequence context:(NSString *)context {
	[self.bootstrap startContext:context request:[NSString stringWithFormat:@"installation_1.%lu", (unsigned long)sequence]
		url:self.endpoint credential:self.credential body:self.payload completion:^(NSDictionary *reply) { [self.replies addObject:reply ?: NSNull.null]; }];
}
- (void)complete:(NSUInteger)index body:(NSData *)body headers:(NSDictionary *)headers {
	TFAdmissionNetworkCompletion complete = self.network.pending[index][@"completion"];
	NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:[NSURL URLWithString:self.endpoint] statusCode:201 HTTPVersion:@"HTTP/1.1" headerFields:headers];
	complete(response, body); [self.scheduler flush];
}
- (BOOL)mayStart:(NSUInteger)index { TFAdmissionStartGuard guard = self.network.pending[index][@"guard"]; return guard(); }
- (void)testRetiringOneContextCancelsItsBootstrapAndNeverDeliversLateBytesToAnother {
	[self start:1 context:@"installation_1.1"]; [self start:2 context:@"installation_1.2"];
	NSURLRequest *request = self.network.pending[0][@"request"];
	XCTAssertEqualObjects(request.HTTPMethod, @"POST");
	XCTAssertEqualObjects([request valueForHTTPHeaderField:@"X-Tileflow-Mobile-Client"], self.credential);
	XCTAssertNil([request valueForHTTPHeaderField:TFAdmissionGrantHeader]);
	XCTAssertFalse(request.HTTPShouldHandleCookies);
	[self.bootstrap retire:@"installation_1.1"];
	XCTAssertFalse([self mayStart:0]); XCTAssertTrue([self mayStart:1]);
	[self complete:0 body:[@"{}" dataUsingEncoding:NSUTF8StringEncoding] headers:@{@"Cache-Control": @"no-store"}];
	[self complete:1 body:[@"{}" dataUsingEncoding:NSUTF8StringEncoding] headers:@{@"Cache-Control": @"no-store"}];
	XCTAssertEqual(self.replies.count, 2U); XCTAssertEqualObjects(self.replies[0], NSNull.null);
	XCTAssertEqualObjects(self.replies[1][@"bodyBase64"], @"e30=");
	XCTAssertFalse([self.bootstrap.description containsString:self.credential]);
}
- (void)testCancellationIsIdempotentAndPreventsReplayBeforeAndAfterStart {
	[self.bootstrap cancelContext:@"installation_1.1" request:@"installation_1.1"];
	XCTAssertThrows([self start:1 context:@"installation_1.1"]);
	[self start:2 context:@"installation_1.1"];
	[self.bootstrap cancelContext:@"installation_1.1" request:@"installation_1.2"];
	[self.bootstrap cancelContext:@"installation_1.1" request:@"installation_1.2"];
	[self complete:0 body:[@"{}" dataUsingEncoding:NSUTF8StringEncoding] headers:@{}];
	XCTAssertEqual(self.replies.count, 1U); XCTAssertEqualObjects(self.replies[0], NSNull.null);
	XCTAssertThrows([self start:2 context:@"installation_1.1"]);
	XCTAssertThrows([self start:3 context:@"unknown.1"]);
}
- (void)testPinnedOriginPortCredentialAndExactBodyAreNotMutable {
	[self start:1 context:@"installation_1.1"];
	for (NSString *url in @[@"http://api.tileflow.test/v1/sessions/start", @"https://other.test/v1/sessions/start", @"https://api.tileflow.test:444/v1/sessions/start", @"https://api.tileflow.test/v1/sessions/start?x=1"]) {
		XCTAssertThrows([self.bootstrap startContext:@"installation_1.1" request:@"installation_1.2" url:url credential:self.credential body:self.payload completion:^(NSDictionary *reply) {}]);
	}
	NSString *otherBody = [self.payload stringByReplacingOccurrencesOfString:@"map_0123456789abcdef" withString:@"map_fedcba9876543210"];
	XCTAssertThrows([self.bootstrap startContext:@"installation_1.1" request:@"installation_1.2" url:self.endpoint credential:self.credential body:otherBody completion:^(NSDictionary *reply) {}]);
	NSString *otherCredential = [self.credential stringByReplacingOccurrencesOfString:@"a" withString:@"b"];
	XCTAssertThrows([self.bootstrap startContext:@"installation_1.1" request:@"installation_1.2" url:self.endpoint credential:otherCredential body:self.payload completion:^(NSDictionary *reply) {}]);
	XCTAssertEqual(self.network.pending.count, 1U);
}
- (void)testQueueAndResponseBytesAreBounded {
	for (NSUInteger i = 1; i <= 32; i++) [self start:i context:@"installation_1.1"];
	XCTAssertThrows([self start:33 context:@"installation_1.1"]);
	[self.bootstrap cancelContext:@"installation_1.1" request:@"installation_1.1"];
	[self start:34 context:@"installation_1.1"];
	[self complete:32 body:[NSMutableData dataWithLength:65537] headers:@{@"Cache-Control": @"no-store"}];
	XCTAssertEqualObjects(self.replies.lastObject, NSNull.null);
	[self.bootstrap close]; [self.bootstrap close];
	XCTAssertEqual(self.replies.count, 33U);
	for (NSUInteger i = 0; i < self.network.pending.count; i++) XCTAssertFalse([self mayStart:i]);
}
- (void)testExpiryDoesNotDependOnTimerExecutionAndResumeDoesNotReviveWork {
	[self start:1 context:@"installation_1.1"];
	self.scheduler.time = 30000;
	XCTAssertFalse([self mayStart:0]);
	[self complete:0 body:[@"{}" dataUsingEncoding:NSUTF8StringEncoding] headers:@{}];
	XCTAssertEqualObjects(self.replies.lastObject, NSNull.null);
	[self start:2 context:@"installation_1.1"];
	[self.bootstrap lifecycle:NO]; [self.bootstrap lifecycle:YES];
	XCTAssertFalse([self mayStart:1]);
	[self start:3 context:@"installation_1.1"];
	XCTAssertTrue([self mayStart:2]);
	self.owns = NO;
	XCTAssertFalse([self mayStart:2]);
	[self complete:2 body:[@"{}" dataUsingEncoding:NSUTF8StringEncoding] headers:@{}];
	XCTAssertEqualObjects(self.replies.lastObject, NSNull.null);
}
@end
