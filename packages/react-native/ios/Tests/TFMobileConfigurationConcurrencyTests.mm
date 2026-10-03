#import <XCTest/XCTest.h>
#import "../TFMobileConfiguration.h"

@interface TFMobileConfigurationConcurrencyTests : XCTestCase
@end

@implementation TFMobileConfigurationConcurrencyTests
- (void)testConcurrentReadersReceiveOneImmutableApplicationSnapshot {
	TFMobileConfigurationCache *cache = [TFMobileConfigurationCache new];
	dispatch_group_t completed = dispatch_group_create();
	dispatch_semaphore_t entered = dispatch_semaphore_create(0);
	dispatch_semaphore_t release = dispatch_semaphore_create(0);
	dispatch_queue_t queue = dispatch_queue_create("dev.tileflow.configuration.test", DISPATCH_QUEUE_CONCURRENT);
	NSObject *counterLock = [NSObject new];
	__block NSUInteger reads = 0;
	__block TFMobileConfiguration *first = nil;
	__block TFMobileConfiguration *second = nil;
	__block BOOL timedOut = NO;
	TFMobileConfiguration *(^read)(void) = ^{
		@synchronized (counterLock) { reads++; }
		NSString *credential = [@"tf_public_" stringByAppendingString:
			[@"" stringByPaddingToLength:48 withString:@"b" startingAtIndex:0]];
		return [TFMobileConfiguration parse:@[
			@"apiOrigin=https://api.example.test",
			[@"credential=" stringByAppendingString:credential]
		] error:nil];
	};
	dispatch_group_async(completed, queue, ^{
		first = [cache read:^{
			dispatch_semaphore_signal(entered);
			if (dispatch_semaphore_wait(release, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) {
				timedOut = YES;
				return (TFMobileConfiguration *)nil;
			}
			return read();
		} error:nil];
	});
	long started = dispatch_semaphore_wait(entered, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
	dispatch_group_async(completed, queue, ^{ second = [cache read:read error:nil]; });
	dispatch_semaphore_signal(release);
	long finished = dispatch_group_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
	XCTAssertEqual(started, 0L);
	XCTAssertEqual(finished, 0L);
	if (finished != 0) return;
	XCTAssertFalse(timedOut);
	XCTAssertNotNil(first);
	XCTAssertEqual(first, second);
	XCTAssertEqual(reads, 1u);
	XCTAssertEqualObjects(first.description, @"TFMobileConfiguration");
}
@end
