#import <XCTest/XCTest.h>
#import "TFAdmissionEngine.h"

@interface TFIngressCancel : NSObject <TFAdmissionCancel>
@end
@implementation TFIngressCancel
- (void)cancel {}
@end
@interface TFIngressScheduler : NSObject <TFAdmissionScheduler>
@property (nonatomic, strong) NSMutableArray *blocks;
- (void)flush;
@end
@implementation TFIngressScheduler
- (instancetype)init { if ((self = [super init])) _blocks = [NSMutableArray array]; return self; }
- (NSTimeInterval)nowMs { return 0; }
- (void)enqueue:(dispatch_block_t)block { [self.blocks addObject:[block copy]]; }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block { return [TFIngressCancel new]; }
- (void)flush {
	while (self.blocks.count) { dispatch_block_t block = self.blocks.firstObject; [self.blocks removeObjectAtIndex:0]; block(); }
}
@end
@interface TFIngressNetwork : NSObject <TFAdmissionNetwork>
@end
@implementation TFIngressNetwork
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	@throw [NSException exceptionWithName:@"UnexpectedNetwork" reason:@"No network should start in the ingress fixture" userInfo:nil];
}
@end

@interface TFAdmissionIngressTests : XCTestCase
@end
@implementation TFAdmissionIngressTests
- (void)testIngressIsBoundedBeforeMainQueueDrainAndRepeatedCancellationCannotBypassIt {
	TFIngressScheduler *scheduler = [TFIngressScheduler new];
	NSMutableArray *events = [NSMutableArray array];
	TFAdmissionEngine *engine = [[TFAdmissionEngine alloc] initWithInstallation:@"installation_1" scheduler:scheduler network:[TFIngressNetwork new]
		owns:^BOOL { return YES; } emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSString *url = @"https://tiles.tileflow.test/world/0/0/0.pbf";
	NSString *context = [engine registerMap:@"map_0123456789abcdef" resources:@[@{@"url": url, @"scope": @"tile", @"tilesetId": @"world"}]];
	NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[url stringByAppendingFormat:@"?__tf_native_context=%@", context]]];
	__block NSUInteger failures = 0;
	id<TFAdmissionCancel> (^enqueue)(void) = ^id<TFAdmissionCancel> {
		return [engine request:request response:^(NSHTTPURLResponse *response, NSData *body) { XCTFail(@"Unexpected response"); }
			failure:^{ failures++; } delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) { return [TFIngressCancel new]; }];
	};
	for (NSUInteger index = 0; index < 2048; index++) { id<TFAdmissionCancel> token = enqueue(); [token cancel]; [token cancel]; }
	enqueue();
	XCTAssertEqual(failures, 1u); XCTAssertEqual(events.count, 0u);
	[scheduler flush]; XCTAssertEqual(failures, 1u);
	enqueue(); [scheduler flush];
	XCTAssertEqualObjects(events.lastObject[@"kind"], @"batch");
	[engine retire:context]; [scheduler flush];
}
@end
