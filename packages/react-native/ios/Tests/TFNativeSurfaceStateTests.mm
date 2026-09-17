#import <XCTest/XCTest.h>
#import "TFNativeSurfaceState.h"

@interface TFNativeSurfaceStateTests : XCTestCase
@end
@implementation TFNativeSurfaceStateTests
- (void)drain:(TFNativeSurfaceState *)state {
	while (state.awaitingSequence) [state acknowledge:state.awaitingSequence.unsignedLongLongValue];
}
- (void)testStyleLayoutCommitAndRequestedFrameMustPrecedeMatchingFullyRenderedEvidence {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSObject *style = [NSObject new];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:style];
	[state frameStart:style]; [state frameEnd:style fully:YES];
	XCTAssertFalse([[events valueForKey:@"kind"] containsObject:@"render"]); [self drain:state];
	NSUInteger layout = [state commit:@"one"];
	[state frameStart:style]; [state frameEnd:style fully:YES];
	XCTAssertFalse([[events valueForKey:@"kind"] containsObject:@"render"]);
	[state request:@"one"]; [state frameStart:style]; [state frameEnd:style fully:YES]; [self drain:state];
	XCTAssertEqualObjects(events.lastObject[@"kind"], @"render");
	XCTAssertEqualObjects(events.lastObject[@"layout"], @(layout));
	[state close];
}
- (void)testStaleNativeStyleObjectsAndBackgroundInvalidateFrames {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSObject *old = [NSObject new]; NSObject *current = [NSObject new];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:old]; [self drain:state];
	[state commit:@"one"]; [state request:@"one"]; [state frameStart:old];
	[state expect:@"two"]; [state loaded:@"two" identity:current]; [self drain:state];
	[state commit:@"two"]; [state request:@"two"];
	[state frameEnd:old fully:YES]; [state frameStart:current]; [state layout:NO]; [state frameEnd:current fully:YES];
	[self drain:state];
	XCTAssertFalse([[events valueForKey:@"kind"] containsObject:@"render"]);
	XCTAssertThrows([state commit:@"two"]);
	[state close]; XCTAssertFalse(state.active);
}
- (void)testLayoutChangeRequiresFreshRequestedFullFrameAndClosesGesture {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSObject *style = [NSObject new];
	NSDictionary *view = @{@"center": @[@1, @2], @"zoom": @3, @"bearing": @4, @"pitch": @5};
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:style]; [self drain:state];
	[state commit:@"one"]; [state gestureStart:view]; [self drain:state];
	[state layout:YES]; [self drain:state];
	NSUInteger invalidation = [state beginCommand:1];
	XCTAssertGreaterThan(invalidation, 0u); [self drain:state];
	XCTAssertEqualObjects(events.lastObject[@"kind"], @"invalidate");
	XCTAssertEqualObjects(events.lastObject[@"sequence"], @(invalidation));
	[state commit:@"one"]; [state frameStart:style]; [state frameEnd:style fully:YES];
	XCTAssertFalse([[events valueForKey:@"kind"] containsObject:@"render"]);
	[state request:@"one"]; [state frameStart:style]; [state frameEnd:style fully:YES]; [self drain:state];
	XCTAssertTrue([[events valueForKey:@"kind"] containsObject:@"render"]);
	[state close];
}
- (void)testSuccessiveStyleTokensAcceptOnlyTheirOwnPostRequestFullFrame {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	NSObject *first = [NSObject new]; NSObject *second = [NSObject new];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:first]; [self drain:state];
	NSUInteger firstInvalidation = [state beginCommand:1];
	XCTAssertGreaterThan(firstInvalidation, 0u); [self drain:state];
	[state commit:@"one"]; [state request:@"one"]; [state frameStart:first]; [state frameEnd:first fully:YES]; [self drain:state];
	NSPredicate *render = [NSPredicate predicateWithFormat:@"kind == 'render'"];
	XCTAssertEqual([[events filteredArrayUsingPredicate:render] count], 1u);
	XCTAssertEqualObjects([[events filteredArrayUsingPredicate:render] lastObject][@"style"], @"one");

	[state expect:@"two"]; [state loaded:@"two" identity:second]; [self drain:state];
	NSUInteger secondInvalidation = [state beginCommand:2];
	XCTAssertGreaterThan(secondInvalidation, firstInvalidation); [self drain:state];
	[state commit:@"two"]; [state frameStart:second]; [state frameEnd:second fully:YES];
	XCTAssertEqual([[events filteredArrayUsingPredicate:render] count], 1u);
	[state request:@"two"];
	[state frameStart:first]; [state frameEnd:first fully:YES];
	[state frameStart:second]; [state frameEnd:second fully:NO];
	XCTAssertEqual([[events filteredArrayUsingPredicate:render] count], 1u);
	[state frameStart:second]; [state frameEnd:second fully:YES]; [self drain:state];
	XCTAssertEqual([[events filteredArrayUsingPredicate:render] count], 2u);
	XCTAssertEqualObjects([[events filteredArrayUsingPredicate:render] lastObject][@"style"], @"two");
	[state close];
}
- (void)testFailedStyleCanBeRearmedForRollback {
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(__unused NSDictionary *event) {}];
	[state expect:@"one"]; [state fail]; XCTAssertFalse(state.active);
	[state expect:@"rollback"]; XCTAssertTrue(state.active);
	[state close];
}
- (void)testCommandInvalidationReceiptIsOwnedByItsSurface {
	NSMutableArray<NSDictionary *> *firstEvents = [NSMutableArray array];
	NSMutableArray<NSDictionary *> *secondEvents = [NSMutableArray array];
	TFNativeSurfaceState *first = [[TFNativeSurfaceState alloc] initWithSurface:@"first" emit:^(NSDictionary *event) { [firstEvents addObject:event]; }];
	TFNativeSurfaceState *second = [[TFNativeSurfaceState alloc] initWithSurface:@"second" emit:^(NSDictionary *event) { [secondEvents addObject:event]; }];
	NSObject *firstStyle = [NSObject new]; NSObject *secondStyle = [NSObject new];
	[first expect:@"one"]; [first layout:YES]; [first loaded:@"one" identity:firstStyle]; [self drain:first];
	[second expect:@"two"]; [second layout:YES]; [second loaded:@"two" identity:secondStyle]; [self drain:second];
	NSUInteger firstInvalidation = [first beginCommand:1];
	NSUInteger secondInvalidation = [second beginCommand:1];
	XCTAssertGreaterThan(firstInvalidation, 0u); XCTAssertGreaterThan(secondInvalidation, 0u);
	[self drain:first]; [self drain:second];
	XCTAssertEqualObjects(firstEvents.lastObject[@"surface"], @"first");
	XCTAssertEqualObjects(firstEvents.lastObject[@"sequence"], @(firstInvalidation));
	XCTAssertEqualObjects(secondEvents.lastObject[@"surface"], @"second");
	XCTAssertEqualObjects(secondEvents.lastObject[@"sequence"], @(secondInvalidation));
	[first close]; [second close];
}
- (void)testNativeGestureEpochsExcludeProgrammaticCommandsAndQueueCapacityIsBounded {
	NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
	TFNativeSurfaceState *state = [[TFNativeSurfaceState alloc] initWithSurface:@"surface" emit:^(NSDictionary *event) { [events addObject:event]; }];
	[state expect:@"one"]; [state layout:YES]; [state loaded:@"one" identity:[NSObject new]];
	XCTAssertGreaterThan([state beginCommand:1], 0u); [state cancelCommand:2]; XCTAssertEqual([state beginCommand:2], 0u);
	NSDictionary *view = @{@"center": @[@1, @2], @"zoom": @3, @"bearing": @4, @"pitch": @5};
	[state gestureStart:view]; XCTAssertEqual([state beginCommand:3], 0u); [state gestureEnd:view];
	XCTAssertGreaterThan([state beginCommand:4], 0u);
	for (NSUInteger index = 0; index < 1000; index++) { [state gestureStart:view]; [state gestureChange:view]; [state gestureEnd:view]; }
	XCTAssertLessThanOrEqual(state.pendingCount, 32u); XCTAssertEqual(events.count, 1u);
	XCTAssertEqualObjects(state.description, @"TFNativeSurfaceState");
	[state close];
}
@end
