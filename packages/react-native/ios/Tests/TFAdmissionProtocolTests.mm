#import <XCTest/XCTest.h>
#import <MapLibre/MLNNetworkConfiguration.h>
#import "TFAdmissionInstallation.h"

@interface TFProtocolTestCancel : NSObject <TFAdmissionCancel>
@end
@implementation TFProtocolTestCancel
- (void)cancel {}
@end
@interface TFProtocolTestScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic) NSMutableArray *blocks;
- (void)flush;
@end
@implementation TFProtocolTestScheduler
- (instancetype)init { if ((self = [super init])) _blocks = [NSMutableArray array]; return self; }
- (NSTimeInterval)nowMs { return 0; }
- (void)enqueue:(dispatch_block_t)block { [self.blocks addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block { return [TFProtocolTestCancel new]; }
- (void)flush {
	while (self.blocks.count) { dispatch_block_t block = self.blocks.firstObject; [self.blocks removeObjectAtIndex:0]; block(); }
}
@end
@interface TFProtocolTestNetwork : NSObject <TFAdmissionNetwork>
@property (nonatomic) NSURLRequest *request;
@property (nonatomic, copy) TFAdmissionNetworkCompletion completion;
@end
@implementation TFProtocolTestNetwork
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	self.request = request; self.completion = completion; return [TFProtocolTestCancel new];
}
@end
@interface TFPriorURLProtocol : NSURLProtocol
@end
@implementation TFPriorURLProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request { return YES; }
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)startLoading {}
- (void)stopLoading {}
@end
@interface TFResponseDelegate : NSObject <MLNNetworkConfigurationDelegate>
@property (nonatomic) NSUInteger calls;
@end
@implementation TFResponseDelegate
- (MLNNetworkResponse *)didReceiveResponse:(MLNNetworkResponse *)response { self.calls++; return response; }
@end
@interface TFSessionFactoryDelegate : NSObject <MLNNetworkConfigurationDelegate>
@end
@implementation TFSessionFactoryDelegate
- (NSURLSession *)sessionForNetworkConfiguration:(MLNNetworkConfiguration *)configuration { return NSURLSession.sharedSession; }
@end

@interface TFProtocolTestClient : NSObject <NSURLProtocolClient>
@property (nonatomic) NSUInteger responses;
@property (nonatomic) NSUInteger failures;
@property (nonatomic) NSUInteger finishes;
@property (nonatomic, nullable) NSError *error;
@end
@implementation TFProtocolTestClient
- (void)URLProtocol:(NSURLProtocol *)protocol didFailWithError:(NSError *)error { self.failures++; self.error = error; }
- (void)URLProtocol:(NSURLProtocol *)protocol didReceiveResponse:(NSURLResponse *)response cacheStoragePolicy:(NSURLCacheStoragePolicy)policy { self.responses++; }
- (void)URLProtocol:(NSURLProtocol *)protocol didLoadData:(NSData *)data {}
- (void)URLProtocolDidFinishLoading:(NSURLProtocol *)protocol { self.finishes++; }
- (void)URLProtocol:(NSURLProtocol *)protocol wasRedirectedToRequest:(NSURLRequest *)request redirectResponse:(NSURLResponse *)response {}
- (void)URLProtocol:(NSURLProtocol *)protocol cachedResponseIsValid:(NSCachedURLResponse *)cachedResponse {}
- (void)URLProtocol:(NSURLProtocol *)protocol didReceiveAuthenticationChallenge:(NSURLAuthenticationChallenge *)challenge {}
- (void)URLProtocol:(NSURLProtocol *)protocol didCancelAuthenticationChallenge:(NSURLAuthenticationChallenge *)challenge {}
@end

@interface TFAdmissionProtocolTests : XCTestCase
@property (nonatomic) MLNNetworkConfiguration *manager;
@property (nonatomic) NSURLSessionConfiguration *saved;
@property (nonatomic) id<MLNNetworkConfigurationDelegate> savedDelegate;
@property (nonatomic) TFAdmissionInstallation *installation;
@property (nonatomic) TFProtocolTestScheduler *scheduler;
@property (nonatomic) TFProtocolTestNetwork *network;
@property (nonatomic) NSMutableArray<NSDictionary *> *events;
@end
@implementation TFAdmissionProtocolTests
- (void)setUp {
	[super setUp];
	self.manager = MLNNetworkConfiguration.sharedManager; self.saved = self.manager.sessionConfiguration; self.savedDelegate = self.manager.delegate;
	self.manager.delegate = nil;
	NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	configuration.protocolClasses = @[TFPriorURLProtocol.class]; self.manager.sessionConfiguration = configuration;
	self.scheduler = [TFProtocolTestScheduler new]; self.network = [TFProtocolTestNetwork new]; self.events = [NSMutableArray array];
}
- (void)install {
	self.installation = [[TFAdmissionInstallation alloc] initWithScheduler:self.scheduler network:self.network emit:^(NSDictionary *event) { [self.events addObject:event]; }];
}
- (void)tearDown {
	[self.installation remove]; self.installation = nil;
	self.manager.sessionConfiguration = self.saved; self.manager.delegate = self.savedDelegate;
	[super tearDown];
}
- (void)testProtocolIsScopedToMapLibreAndUnownedRequestsRemainInThePriorChain {
	NSArray *appProtocols = NSURLSessionConfiguration.defaultSessionConfiguration.protocolClasses;
	NSURLSessionConfiguration *prior = self.manager.sessionConfiguration;
	[self install];
	XCTAssertEqualObjects(self.manager.sessionConfiguration.protocolClasses, (@[TFNativeAdmissionURLProtocol.class, TFPriorURLProtocol.class]));
	XCTAssertEqualObjects(NSURLSessionConfiguration.defaultSessionConfiguration.protocolClasses, appProtocols);
	XCTAssertFalse([TFNativeAdmissionURLProtocol canInitWithRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://outside.test/image.png"]]]);
	XCTAssertTrue([self.installation ownsConfiguration]);
	NSDictionary *ack = [self.installation remove];
	XCTAssertEqualObjects(ack, (@{@"removed": @YES, @"ownershipLost": @NO}));
	XCTAssertEqual(self.manager.sessionConfiguration, prior);
	XCTAssertEqualObjects([self.installation remove], ack);
}
- (void)testAProtocolConfigurationCopyOrDelegateMutationLosesOwnershipWithoutOverwritingTheReplacement {
	[self install];
	NSURLSessionConfiguration *replacement = [self.manager.sessionConfiguration copy];
	self.manager.sessionConfiguration = replacement;
	XCTAssertFalse([self.installation ownsConfiguration]);
	XCTAssertEqualObjects([self.installation remove], (@{@"removed": @NO, @"ownershipLost": @YES}));
	XCTAssertEqual(self.manager.sessionConfiguration, replacement);
}
- (void)testCustomSessionFactoriesCannotBypassTheScopedProtocolSilently {
	TFSessionFactoryDelegate *delegate = [TFSessionFactoryDelegate new]; self.manager.delegate = delegate;
	XCTAssertThrows([self install]);
	XCTAssertNil([TFNativeAdmissionURLProtocol activeInstallation]);
}
- (void)testUnknownOrRetiredReservedRequestsFailClosedEvenThroughAnOldConfiguration {
	[self install]; [self.installation remove];
	NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://tiles.tileflow.test/world/0/0/0.pbf?__tf_native_context=retired.1"]];
	XCTAssertTrue([TFNativeAdmissionURLProtocol canInitWithRequest:request]);
	TFProtocolTestClient *client = [TFProtocolTestClient new];
	TFNativeAdmissionURLProtocol *protocol = [[TFNativeAdmissionURLProtocol alloc] initWithRequest:request cachedResponse:nil client:client];
	[protocol startLoading]; [self.scheduler flush];
	XCTAssertEqual(client.failures, 1u); XCTAssertNil(self.network.request);
	XCTAssertFalse([client.error.description containsString:@"tf_native_v1"]);
}
- (void)testTheAdapterObservesItsOwnResponseWithoutMapLibreDelegateForwarding {
	TFResponseDelegate *delegate = [TFResponseDelegate new]; self.manager.delegate = delegate;
	[self install];
	NSString *url = @"https://tiles.tileflow.test/world/0/0/0.pbf";
	NSString *context = [self.installation.engine registerMap:@"map_0123456789abcdef" resources:@[@{@"url": url, @"scope": @"tile", @"tilesetId": @"world"}]];
	NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[url stringByAppendingFormat:@"?__tf_native_context=%@", context]]];
	TFProtocolTestClient *client = [TFProtocolTestClient new];
	TFNativeAdmissionURLProtocol *protocol = [[TFNativeAdmissionURLProtocol alloc] initWithRequest:request cachedResponse:nil client:client];
	[protocol startLoading]; [self.scheduler flush];
	NSDictionary *batch = self.events.lastObject;
	NSString *ticket = batch[@"tickets"][0][@"ticket"];
	[self.installation.engine completeContext:context generation:1 batch:batch[@"batch"] results:@[@{@"ticket": ticket, @"kind": @"grant", @"validForMs": @900000,
		@"authority": @{@"grant": @"tf_native_v1.fixture.signature", @"mapId": @"map_0123456789abcdef", @"resourceOrigins": @[@"https://tiles.tileflow.test"], @"resourceScopes": @[@"tile"], @"tilesetIds": @[@"world"]}}]];
	[self.scheduler flush];
	XCTAssertEqualObjects(self.network.request.URL.absoluteString, url);
	self.network.completion([[NSHTTPURLResponse alloc] initWithURL:[NSURL URLWithString:url] statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{}], [NSData data]);
	[self.scheduler flush];
	XCTAssertEqual(client.finishes, 1u); XCTAssertEqual(delegate.calls, 0u);
	XCTAssertTrue([[self.events valueForKey:@"kind"] containsObject:@"response"]);
}
@end
