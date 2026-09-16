#import <XCTest/XCTest.h>
#import "TFNativeSurfaceState.h"

@interface TFNativeSurfaceStateTests : XCTestCase
@end
@implementation TFNativeSurfaceStateTests
- (void)drain:(TFNativeSurfaceState *)state {
	while (state.awaitingSequence) [state acknowledge:state.awaitingSequence.unsignedLongLongValue];
}
- (void)testStyleAndLayoutCommitMustPrecedeTheMatchingFullyRenderedFrame {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSObject *style = [NSObject new];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:style];
	[state frameStart:style]; [state mapRendered:style fully:YES]; [state frameEnd:style fully:YES];
	[self drain:state];
	XCTAssertFalse([[events valueForKey:@"kind"] containsObject:@"render"]);
	NSUInteger layout = [state commit:@"one"];
	[state frameStart:style]; [state frameEnd:style fully:YES]; [self drain:state];
	XCTAssertEqualObjects(events.lastObject[@"kind"], @"render");
	XCTAssertEqualObjects(events.lastObject[@"layout"], @(layout));
	[state close];
}
- (void)testStaleNativeStyleObjectsAndBackgroundInvalidateFrames {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSObject *old = [NSObject new]; NSObject *current = [NSObject new];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:old]; [state commit:@"one"];
	[state frameStart:old]; [state expect:@"two"]; [state loaded:@"two" identity:current]; [state commit:@"two"];
	[state mapRendered:old fully:YES]; [state frameEnd:old fully:YES];
	[state frameStart:current]; [state mapRendered:current fully:YES]; [state layout:NO]; [state frameEnd:current fully:YES];
	[self drain:state];
	XCTAssertFalse([[events valueForKey:@"kind"] containsObject:@"render"]);
	XCTAssertThrows([state commit:@"two"]);
	[state close]; XCTAssertFalse(state.active);
}
- (void)testNativeGestureEpochsExcludeProgrammaticCommandsAndQueueCapacityIsBounded {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:[NSObject new]];
	XCTAssertTrue([state beginCommand:1]); [state cancelCommand:2]; XCTAssertFalse([state beginCommand:2]);
	NSDictionary *view = @{@"center": @[@1, @2], @"zoom": @3, @"bearing": @4, @"pitch": @5};
	[state gestureStart:view]; XCTAssertFalse([state beginCommand:3]); [state gestureEnd:view];
	XCTAssertTrue([state beginCommand:4]);
	for (NSUInteger index = 0; index < 1000; index++) { [state gestureStart:view]; [state gestureChange:view]; [state gestureEnd:view]; }
	XCTAssertLessThanOrEqual(state.pendingCount, 32u); XCTAssertEqual(events.count, 1u);
	XCTAssertEqualObjects(state.description, @"TFNativeSurfaceState");
	[state close];
}
@end
