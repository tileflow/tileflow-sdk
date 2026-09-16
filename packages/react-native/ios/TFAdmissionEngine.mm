#import "TFAdmissionEngine.h"
#import <atomic>
#import <cmath>

static void TFInvalidAdmission(void) {
	@throw [NSException exceptionWithName:@"TFNativeAdmissionInvalid" reason:@"Invalid native admission" userInfo:nil];
}
static BOOL TFString(id value, NSUInteger limit) { return [value isKindOfClass:NSString.class] && [(NSString *)value length] <= limit; }
static BOOL TFExactNumber(id value, double minimum, double maximum) {
	return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() &&
		std::isfinite([value doubleValue]) && std::floor([value doubleValue]) == [value doubleValue] && [value doubleValue] >= minimum && [value doubleValue] <= maximum;
}
static BOOL TFGrantShape(NSString *value) {
	if (!TFString(value, 24576)) return NO;
	NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:@"^tf_native_v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$" options:0 error:nil];
	return [expression numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)] == 1;
}

@interface TFAdmissionFlag : NSObject { @public std::atomic_bool value; }
@end
@implementation TFAdmissionFlag
- (instancetype)init { if ((self = [super init])) value.store(true); return self; }
@end

@interface TFAdmissionCancellation : NSObject <TFAdmissionCancel> {
	std::atomic_bool _cancelled;
}
@property (nonatomic, copy) dispatch_block_t action;
- (instancetype)initWithAction:(dispatch_block_t)action;
@end
@implementation TFAdmissionCancellation
- (instancetype)initWithAction:(dispatch_block_t)action { if ((self = [super init])) { _cancelled.store(false); _action = [action copy]; } return self; }
- (void)cancel { if (!_cancelled.exchange(true)) self.action(); }
- (NSString *)description { return @"TFAdmissionCancellation(redacted)"; }
@end

@class TFAdmissionWork;
@interface TFAdmissionContext : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy, nullable) NSString *mapId;
@property (nonatomic) NSDictionary<NSString *, NSDictionary *> *resources;
@property (nonatomic) NSMutableDictionary<NSString *, TFAdmissionWork *> *work;
@property (nonatomic) NSMutableArray<NSString *> *order;
@property (nonatomic) TFAdmissionFlag *alive;
@property (nonatomic, copy, nullable) NSString *batch;
@property (nonatomic, nullable) NSArray<NSString *> *batchTickets;
@property (nonatomic, nullable) id<TFAdmissionCancel> batchTimer;
@property (nonatomic) NSUInteger sequence;
@end
@implementation TFAdmissionContext
- (instancetype)init {
	if ((self = [super init])) { _work = [NSMutableDictionary dictionary]; _order = [NSMutableArray array]; _alive = [TFAdmissionFlag new]; }
	return self;
}
- (NSString *)description { return @"TFAdmissionContext(redacted)"; }
@end

@interface TFAdmissionWork : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic) TFAdmissionContext *context;
@property (nonatomic) NSURLRequest *request;
@property (nonatomic) TFAdmissionFlag *alive;
@property (nonatomic) NSTimeInterval entered;
@property (atomic) NSTimeInterval deadline;
@property (nonatomic, copy) NSString *phase;
@property (nonatomic, copy) void (^response)(NSHTTPURLResponse *, NSData *);
@property (nonatomic, copy) dispatch_block_t failure;
@property (nonatomic, copy) TFAdmissionDelegate delegate;
@property (nonatomic, nullable) id<TFAdmissionCancel> cancellation;
@property (nonatomic, nullable) id<TFAdmissionCancel> timer;
@property (nonatomic, nullable) NSDictionary *authority;
@property (nonatomic) NSUInteger redirects;
@end
@implementation TFAdmissionWork
- (NSString *)description { return @"TFAdmissionWork(redacted)"; }
@end

@interface TFAdmissionEngine () {
	std::atomic_bool _active;
	std::atomic_bool _foreground;
	std::atomic_bool _lossQueued;
}
@property (nonatomic, copy) NSString *installation;
@property (nonatomic) id<TFAdmissionScheduler> scheduler;
@property (nonatomic) id<TFAdmissionNetwork> network;
@property (nonatomic, copy) TFAdmissionStartGuard owns;
@property (nonatomic, copy) void (^emit)(NSDictionary *);
@property (nonatomic) NSMutableDictionary<NSString *, TFAdmissionContext *> *contexts;
@property (nonatomic) NSUInteger contextSequence;
@property (nonatomic) NSUInteger ticketSequence;
@end

@implementation TFAdmissionEngine
- (instancetype)initWithInstallation:(NSString *)installation scheduler:(id<TFAdmissionScheduler>)scheduler network:(id<TFAdmissionNetwork>)network owns:(TFAdmissionStartGuard)owns emit:(void (^)(NSDictionary *))emit {
	if ((self = [super init])) {
		_installation = [installation copy]; _scheduler = scheduler; _network = network; _owns = [owns copy]; _emit = [emit copy];
		_contexts = [NSMutableDictionary dictionary]; _active.store(true); _foreground.store(true); _lossQueued.store(false);
	}
	return self;
}
- (NSString *)description { return @"TFAdmissionEngine(redacted)"; }
- (NSString *)registerMap:(NSString *)mapId resources:(NSArray<NSDictionary *> *)resources {
	if (![self isOwner] || self.contexts.count >= 16 || ![resources isKindOfClass:NSArray.class] || resources.count > 128 || self.contextSequence >= 9007199254740991ULL) TFInvalidAdmission();
	if (mapId) {
		NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^map_[A-Za-z0-9_-]{16}$" options:0 error:nil];
		if (!TFString(mapId, 64) || [pattern numberOfMatchesInString:mapId options:0 range:NSMakeRange(0, mapId.length)] != 1) TFInvalidAdmission();
	}
	NSMutableDictionary *catalog = [NSMutableDictionary dictionary];
	NSArray *scopes = @[@"style", @"tilejson", @"tile", @"sprite", @"glyph", @"font"];
	for (NSDictionary *resource in resources) {
		if (![resource isKindOfClass:NSDictionary.class] || !TFString(resource[@"url"], 1920) || ![scopes containsObject:resource[@"scope"]]) TFInvalidAdmission();
		NSString *url = TFAdmissionCleanURL(resource[@"url"]);
		if (catalog[url]) TFInvalidAdmission();
		NSString *tileset = resource[@"tilesetId"];
		if (([resource[@"scope"] isEqual:@"tile"] || [resource[@"scope"] isEqual:@"tilejson"]) && !tileset) TFInvalidAdmission();
		if (tileset) {
			NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9._:-]{1,255}$" options:0 error:nil];
			if (!TFString(tileset, 255) || [pattern numberOfMatchesInString:tileset options:0 range:NSMakeRange(0, tileset.length)] != 1 ||
				[tileset.lowercaseString containsString:@"tf_native_"] || [tileset.lowercaseString containsString:@"tf_public_"]) TFInvalidAdmission();
		}
		NSMutableDictionary *copy = [@{@"url": url, @"scope": resource[@"scope"]} mutableCopy];
		if (tileset) copy[@"tilesetId"] = tileset;
		catalog[url] = [copy copy];
	}
	TFAdmissionContext *context = [TFAdmissionContext new];
	context.identifier = [NSString stringWithFormat:@"%@.%lu", self.installation, (unsigned long)++self.contextSequence];
	context.mapId = mapId; context.resources = [catalog copy];
	self.contexts[context.identifier] = context;
	return context.identifier;
}

- (id<TFAdmissionCancel>)request:(NSURLRequest *)request response:(void (^)(NSHTTPURLResponse *, NSData *))response failure:(dispatch_block_t)failure delegate:(TFAdmissionDelegate)delegate {
	TFAdmissionFlag *alive = [TFAdmissionFlag new];
	__block TFAdmissionWork *work = nil;
	[self.scheduler enqueue:^{
		if (!alive->value.load()) return;
		NSDictionary *tagged;
		@try { tagged = TFAdmissionStripContext(request.URL.absoluteString); }
		@catch (NSException *exception) { alive->value.store(false); failure(); return; }
		TFAdmissionContext *context = self.contexts[tagged[@"context"]];
		if (!self->_foreground.load() || ![self isOwner] || !context || !context.alive->value.load() || !context.resources[tagged[@"url"]] || context.work.count >= 128 ||
			![request.HTTPMethod isEqual:@"GET"] || request.HTTPBody || request.HTTPBodyStream ||
			[request valueForHTTPHeaderField:TFAdmissionGrantHeader] != nil || self.ticketSequence >= 9007199254740991ULL) {
			alive->value.store(false); failure(); return;
		}
		NSMutableURLRequest *clean = [request mutableCopy];
		clean.URL = [NSURL URLWithString:tagged[@"url"]];
		work = [TFAdmissionWork new];
		work.identifier = [NSString stringWithFormat:@"%lu", (unsigned long)++self.ticketSequence];
		work.context = context; work.request = clean; work.alive = alive; work.entered = [self.scheduler nowMs]; work.phase = @"queue";
		work.response = response; work.failure = failure; work.delegate = delegate;
		context.work[work.identifier] = work; [context.order addObject:work.identifier];
		work.timer = [self.scheduler after:30000 perform:^{
			if ([context.batchTickets containsObject:work.identifier]) [self retire:context.identifier];
			else [self fail:work];
		}];
		[self.scheduler enqueue:^{ [self drain:context]; }];
	}];
	return [[TFAdmissionCancellation alloc] initWithAction:^{
		alive->value.store(false);
		[self.scheduler enqueue:^{
			if (!work) return;
			if ([work.context.batchTickets containsObject:work.identifier]) [self event:work.context kind:@"cancel" fields:@{@"tickets": @[work.identifier]}];
			[self finish:work];
		}];
	}];
}

- (void)drain:(TFAdmissionContext *)context {
	if (!context.alive->value.load() || !self->_foreground.load() || ![self isOwner] || context.batch) return;
	NSMutableArray<TFAdmissionWork *> *selected = [NSMutableArray array];
	for (NSString *identifier in context.order) {
		TFAdmissionWork *work = context.work[identifier];
		if (work.alive->value.load() && [work.phase isEqual:@"queue"]) [selected addObject:work];
		if (selected.count == 8) break;
	}
	if (!selected.count) return;
	if (context.sequence >= 9007199254740991ULL) { [self retire:context.identifier]; return; }
	NSString *batch = [NSString stringWithFormat:@"%lu", (unsigned long)++context.sequence];
	context.batch = batch;
	NSMutableArray *tickets = [NSMutableArray array], *identifiers = [NSMutableArray array];
	for (TFAdmissionWork *work in selected) {
		work.phase = @"javascript";
		[tickets addObject:@{@"ticket": work.identifier, @"url": work.request.URL.absoluteString}];
		[identifiers addObject:work.identifier];
	}
	context.batchTickets = [identifiers copy];
	context.batchTimer = [self.scheduler after:30000 perform:^{ if ([context.batch isEqual:batch]) [self retire:context.identifier]; }];
	[self event:context kind:@"batch" fields:@{@"batch": batch, @"tickets": tickets}];
}

- (BOOL)authority:(NSDictionary *)authority allows:(NSDictionary *)resource context:(TFAdmissionContext *)context {
	return [authority[@"mapId"] isEqual:context.mapId] && [authority[@"resourceOrigins"] containsObject:TFAdmissionOrigin(resource[@"url"])] &&
		[authority[@"resourceScopes"] containsObject:resource[@"scope"]] && (!resource[@"tilesetId"] || [authority[@"tilesetIds"] containsObject:resource[@"tilesetId"]]);
}
- (BOOL)validAuthority:(NSDictionary *)authority {
	if (![authority isKindOfClass:NSDictionary.class] || !TFGrantShape(authority[@"grant"]) || !TFString(authority[@"mapId"], 64)) return NO;
	for (NSString *key in @[@"resourceOrigins", @"resourceScopes", @"tilesetIds"]) {
		NSArray *array = authority[key];
		NSUInteger maximum = [key isEqual:@"resourceOrigins"] ? 2 : [key isEqual:@"resourceScopes"] ? 6 : 18;
		if (![array isKindOfClass:NSArray.class] || array.count > maximum) return NO;
		for (id value in array) if (!TFString(value, 2048)) return NO;
	}
	return YES;
}

- (NSUInteger)completeContext:(NSString *)identifier generation:(NSUInteger)generation batch:(NSString *)batch results:(NSArray<NSDictionary *> *)results {
	TFAdmissionContext *context = self.contexts[identifier];
	if (!context || !context.alive->value.load() || !context.batch || generation != 1 || ![context.batch isEqual:batch] || ![self isOwner]) return 0;
	if (![results isKindOfClass:NSArray.class] || results.count > 8 || results.count != context.batchTickets.count) { [self retire:identifier]; return 0; }
	for (NSUInteger index = 0; index < results.count; index++) {
		if (![results[index] isKindOfClass:NSDictionary.class] || ![results[index][@"ticket"] isEqual:context.batchTickets[index]]) { [self retire:identifier]; return 0; }
	}
	[context.batchTimer cancel]; context.batchTimer = nil; context.batch = nil; context.batchTickets = nil;
	NSUInteger accepted = 0;
	for (NSDictionary *result in results) {
		TFAdmissionWork *work = context.work[result[@"ticket"]];
		if (!work) continue;
		if (!work.alive->value.load()) { [self finish:work]; continue; }
		if (!self->_foreground.load() || [self.scheduler nowMs] - work.entered >= 30000) { [self fail:work]; continue; }
		if ([result[@"kind"] isEqual:@"delegate"] && !context.mapId) {
			work.phase = @"network"; work.deadline = work.entered + 30000;
			if (![self canStart:work]) { [self fail:work]; continue; }
			@try {
				work.cancellation = work.delegate(work.request, ^(NSHTTPURLResponse *response, NSData *body) {
					[self.scheduler enqueue:^{ [self received:work url:work.request.URL response:response body:body]; }];
				});
				if (!work.alive->value.load()) [work.cancellation cancel];
				accepted++;
			} @catch (NSException *exception) { [self fail:work]; }
			continue;
		}
		NSDictionary *authority = result[@"authority"];
		NSDictionary *resource = context.resources[work.request.URL.absoluteString];
		if (![result[@"kind"] isEqual:@"grant"] || !context.mapId || !TFExactNumber(result[@"validForMs"], 1, 900000) ||
			![self validAuthority:authority] || ![self authority:authority allows:resource context:context]) { [self fail:work]; continue; }
		work.authority = [authority copy];
		// The budget is already based on the controller's original local
		// deadline. Anchor it earlier, at enqueue, not at bridge receipt.
		work.deadline = MIN(work.entered + 30000, work.entered + [result[@"validForMs"] doubleValue] - 1000);
		if ([self start:work url:work.request.URL]) accepted++;
	}
	[self.scheduler enqueue:^{ [self drain:context]; }];
	return accepted;
}

- (BOOL)canStart:(TFAdmissionWork *)work {
	if (!work.alive->value.load() || !work.context.alive->value.load() || !self->_active.load() || !self->_foreground.load() || [self.scheduler nowMs] >= work.deadline) return NO;
	if (!self.owns()) { [self loseOwnership]; return NO; }
	return YES;
}
- (BOOL)start:(TFAdmissionWork *)work url:(NSURL *)url {
	NSDictionary *resource = work.context.resources[url.absoluteString];
	if (!resource || !work.authority || ![self authority:work.authority allows:resource context:work.context] || ![self canStart:work]) { [self fail:work]; return NO; }
	NSMutableURLRequest *request = [work.request mutableCopy];
	request.URL = url;
	request.timeoutInterval = MAX(0.001, (work.deadline - [self.scheduler nowMs]) / 1000.0);
	[request setValue:work.authority[@"grant"] forHTTPHeaderField:TFAdmissionGrantHeader];
	work.phase = @"network";
	@try {
		work.cancellation = [self.network start:request mayStart:^BOOL { return [self canStart:work]; }
			completion:^(NSHTTPURLResponse *response, NSData *body) {
				[self.scheduler enqueue:^{ [self received:work url:url response:response body:body]; }];
			}];
		if (!work.alive->value.load()) [work.cancellation cancel];
		return YES;
	} @catch (NSException *exception) { [self fail:work]; return NO; }
}

- (void)received:(TFAdmissionWork *)work url:(NSURL *)url response:(NSHTTPURLResponse *)response body:(NSData *)body {
	if (!work.alive->value.load() || !work.context.alive->value.load()) return;
	if (![self isOwner]) return;
	if (!response || !body || body.length > 8388608 || !self->_foreground.load() || [self.scheduler nowMs] >= work.deadline) { [self fail:work]; return; }
	[self event:work.context kind:@"response" fields:@{@"status": @(response.statusCode)}];
	if (work.authority && [@[@301, @302, @303, @307, @308] containsObject:@(response.statusCode)]) {
		if (++work.redirects > 3) { [self fail:work]; return; }
		NSString *location = [response valueForHTTPHeaderField:@"Location"];
		@try {
			if (!TFString(location, 2048) || !location.length || [location containsString:@"\\"]) TFInvalidAdmission();
			NSString *target = [NSURL URLWithString:location relativeToURL:url].absoluteURL.absoluteString;
			if (TFAdmissionHasReservedContext(target)) {
				NSDictionary *tagged = TFAdmissionStripContext(target);
				if (![tagged[@"context"] isEqual:work.context.identifier]) TFInvalidAdmission();
				target = tagged[@"url"];
			} else TFAdmissionCleanURL(target);
			if (![TFAdmissionOrigin(target) isEqual:TFAdmissionOrigin(work.request.URL.absoluteString)]) TFInvalidAdmission();
			[self start:work url:[NSURL URLWithString:target]];
		} @catch (NSException *exception) { [self fail:work]; }
		return;
	}
	if (!work.alive->value.exchange(false)) return;
	[self finish:work];
	work.response(response, body);
}
- (void)finish:(TFAdmissionWork *)work {
	work.alive->value.store(false);
	[work.cancellation cancel]; work.cancellation = nil;
	[work.timer cancel]; work.timer = nil; work.authority = nil;
	[work.context.work removeObjectForKey:work.identifier]; [work.context.order removeObject:work.identifier];
	[self.scheduler enqueue:^{ [self drain:work.context]; }];
}
- (void)fail:(TFAdmissionWork *)work {
	BOOL notify = work.alive->value.exchange(false);
	[self finish:work];
	if (notify) work.failure();
}
- (void)retire:(NSString *)identifier {
	TFAdmissionContext *context = self.contexts[identifier];
	if (!context) return;
	[self.contexts removeObjectForKey:identifier]; context.alive->value.store(false);
	[context.batchTimer cancel]; context.batchTimer = nil; context.batch = nil; context.batchTickets = nil;
	for (TFAdmissionWork *work in context.work.allValues) [self fail:work];
	[self event:context kind:@"retired" fields:@{@"code": @"NATIVE_ADMISSION_CANCELLED"}];
}
- (void)lifecycle:(BOOL)foreground {
	self->_foreground.store(foreground);
	if (!foreground) for (TFAdmissionContext *context in self.contexts.allValues) {
		if (context.batchTickets.count) [self event:context kind:@"cancel" fields:@{@"tickets": context.batchTickets}];
		for (TFAdmissionWork *work in context.work.allValues) [self fail:work];
	}
	[self safeEmit:@{@"kind": @"lifecycle", @"installation": self.installation, @"foreground": @(foreground)}];
	if (foreground) for (TFAdmissionContext *context in self.contexts.allValues) [self.scheduler enqueue:^{ [self drain:context]; }];
}
- (void)close {
	self->_active.store(false);
	for (NSString *identifier in self.contexts.allKeys) [self retire:identifier];
}
- (BOOL)isOwner {
	if (!self->_active.load()) return NO;
	if (!self.owns()) { [self loseOwnership]; return NO; }
	return YES;
}
- (void)loseOwnership {
	self->_active.store(false);
	if (self->_lossQueued.exchange(true)) return;
	[self.scheduler enqueue:^{
		[self close];
		[self safeEmit:@{@"kind": @"ownershipLost", @"installation": self.installation}];
	}];
}
- (void)event:(TFAdmissionContext *)context kind:(NSString *)kind fields:(NSDictionary *)fields {
	NSMutableDictionary *event = [@{@"kind": kind, @"installation": self.installation, @"context": context.identifier, @"generation": @1} mutableCopy];
	[event addEntriesFromDictionary:fields];
	[self safeEmit:event];
}
- (void)safeEmit:(NSDictionary *)event {
	@try { self.emit(event); }
	@catch (NSException *exception) { [self close]; }
}
@end
