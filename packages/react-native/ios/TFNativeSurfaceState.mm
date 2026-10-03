#import "TFNativeSurfaceState.h"
#import "TFAdmissionEngine.h"

@interface TFNativeSurfaceState ()
@property (nonatomic, copy) NSString *surface;
@property (nonatomic, copy) NSString *token;
@property (nonatomic, copy) void (^emit)(NSDictionary *);
@property (nonatomic, strong, nullable) id style;
@property (nonatomic, strong, nullable) id frame;
@property (nonatomic) NSUInteger frameLayout;
@property (nonatomic) NSUInteger layoutEpoch;
@property (nonatomic) NSUInteger committed;
@property (nonatomic) NSUInteger requested;
@property (nonatomic) NSUInteger sequence;
@property (nonatomic) NSUInteger command;
@property (nonatomic) NSUInteger gestureSequence;
@property (nonatomic) NSUInteger gesture;
@property (nonatomic) BOOL visible;
@property (nonatomic) BOOL closed;
@property (nonatomic) BOOL failed;
@property (nonatomic) BOOL reported;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *pending;
@property (nonatomic, readwrite, nullable) NSNumber *awaitingSequence;
- (NSUInteger)enqueue:(NSString *)kind fields:(NSDictionary *)fields;
@end

@implementation TFNativeSurfaceState
- (instancetype)initWithSurface:(NSString *)surface emit:(void (^)(NSDictionary *))emit {
	if ((self = [super init])) {
		_surface = [surface copy]; _emit = [emit copy]; _token = @"";
		_layoutEpoch = 1; _pending = [NSMutableArray array];
	}
	return self;
}
- (BOOL)active { return !self.closed && !self.failed; }
- (NSUInteger)pendingCount { return self.pending.count; }
- (void)expect:(NSString *)token {
	if (self.closed || !TFAdmissionValidToken(token)) [self invalid];
	self.token = token; self.style = nil; self.frame = nil; self.committed = 0;
	self.requested = 0; self.reported = NO; self.failed = NO; self.gesture = 0;
}
- (void)layout:(BOOL)visible {
	if (self.closed) return;
	self.visible = visible;
	if (self.layoutEpoch >= 9007199254740991ULL) { [self fail]; return; }
	self.layoutEpoch++; self.committed = 0; self.requested = 0; self.frame = nil;
	self.reported = NO; self.gesture = 0;
	[self enqueue:@"invalidate" fields:@{}];
}
- (void)loaded:(NSString *)token identity:(id)identity {
	if (!self.active || ![token isEqual:self.token] || self.style == identity) return;
	self.style = identity; self.requested = 0; self.frame = nil; self.reported = NO;
	[self enqueue:@"style" fields:@{}];
}
- (NSUInteger)commit:(NSString *)token {
	if (!self.active || !self.visible || ![token isEqual:self.token] || !self.style) [self invalid];
	self.committed = self.layoutEpoch; self.requested = 0; self.frame = nil; self.reported = NO;
	return self.committed;
}
- (void)request:(NSString *)token {
	if (!self.active || !self.visible || ![token isEqual:self.token] || !self.style ||
		self.committed != self.layoutEpoch || self.reported) [self invalid];
	self.requested = self.layoutEpoch; self.frame = nil;
}
- (void)frameStart:(id)identity {
	self.frame = self.active && self.visible && identity == self.style && self.committed == self.layoutEpoch && self.requested == self.layoutEpoch ? identity : nil;
	self.frameLayout = self.layoutEpoch;
}
- (void)frameEnd:(id)identity fully:(BOOL)fully {
	id captured = self.frame; self.frame = nil;
	if (!self.active || self.reported || !self.visible || !fully || !captured ||
		captured != identity || captured != self.style || self.frameLayout != self.layoutEpoch || self.committed != self.layoutEpoch || self.requested != self.layoutEpoch) return;
	self.reported = YES; self.requested = 0; [self enqueue:@"render" fields:@{}];
}
- (NSUInteger)beginCommand:(NSUInteger)command {
	if (!self.active || !self.visible || !self.style || self.gesture || command <= self.command || command > 9007199254740991ULL) return 0;
	self.command = command; self.committed = 0; self.requested = 0; self.frame = nil; self.reported = NO;
	return [self enqueue:@"invalidate" fields:@{}];
}
- (void)cancelCommand:(NSUInteger)command { if (command > self.command && command <= 9007199254740991ULL) self.command = command; }
- (void)gestureStart:(NSDictionary *)view {
	if (!self.active || !self.visible || !self.style || self.gesture) return;
	if (self.gestureSequence >= 9007199254740991ULL) { [self fail]; return; }
	self.requested = 0; self.frame = nil; self.gesture = ++self.gestureSequence;
	[self enqueue:@"gesture-start" fields:@{@"gesture": @(self.gesture), @"view": view}];
}
- (void)gestureChange:(NSDictionary *)view {
	if (self.active && self.gesture) [self enqueue:@"gesture-change" fields:@{@"gesture": @(self.gesture), @"view": view}];
}
- (void)gestureEnd:(NSDictionary *)view {
	if (!self.active || !self.gesture) return;
	NSUInteger completed = self.gesture; self.gesture = 0;
	[self enqueue:@"gesture-end" fields:@{@"gesture": @(completed), @"view": view}];
}
- (void)fail {
	if (self.closed || self.failed) return;
	self.failed = YES; self.committed = 0; self.requested = 0; self.frame = nil; self.gesture = 0;
	[self enqueue:@"error" fields:@{}];
}
- (NSUInteger)enqueue:(NSString *)kind fields:(NSDictionary *)fields {
	if (self.closed || !self.token.length || self.sequence >= 9007199254740991ULL) return 0;
	NSDictionary *last = self.pending.lastObject;
	if (([kind isEqual:@"gesture-change"] || [kind isEqual:@"invalidate"]) && [last[@"kind"] isEqual:kind] &&
		[last[@"style"] isEqual:self.token] && (last[@"gesture"] == fields[@"gesture"] || [last[@"gesture"] isEqual:fields[@"gesture"]])) [self.pending removeLastObject];
	BOOL overflow = self.pending.count >= 32;
	if (overflow) {
		[self.pending removeAllObjects]; self.failed = YES; self.frame = nil; self.committed = 0;
		self.requested = 0; self.gesture = 0; kind = @"error"; fields = @{};
	}
	NSUInteger emitted = ++self.sequence;
	NSMutableDictionary *event = [@{@"surface": self.surface, @"style": self.token, @"layout": @(self.layoutEpoch), @"sequence": @(emitted), @"kind": kind} mutableCopy];
	[event addEntriesFromDictionary:fields]; [self.pending addObject:[event copy]]; [self drain];
	return overflow ? 0 : emitted;
}
- (void)drain {
	if (self.closed || self.awaitingSequence || !self.pending.count) return;
	NSDictionary *event = self.pending.firstObject; [self.pending removeObjectAtIndex:0];
	self.awaitingSequence = event[@"sequence"];
	@try { self.emit(event); } @catch (NSException *exception) { [self close]; }
}
- (void)acknowledge:(NSUInteger)sequence {
	if (!self.awaitingSequence || self.awaitingSequence.unsignedLongLongValue != sequence) return;
	self.awaitingSequence = nil; [self drain];
}
- (void)close { self.closed = YES; self.style = nil; self.frame = nil; self.committed = 0; self.requested = 0; self.gesture = 0; [self.pending removeAllObjects]; self.awaitingSequence = nil; }
- (NSString *)description { return @"TFNativeSurfaceState"; }
- (void)invalid { @throw [NSException exceptionWithName:@"TFNativeSurfaceInvalid" reason:@"Native surface operation failed." userInfo:nil]; }
@end
