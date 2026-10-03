#import "TFAdmissionBootstrap.h"
#import <atomic>

static void TFBootstrapInvalid(void) {
	[NSException raise:@"TFNativeBootstrapInvalid" format:@"Invalid native bootstrap"];
}
static BOOL TFBootstrapString(id value, NSUInteger limit) { return [value isKindOfClass:NSString.class] && [(NSString *)value length] <= limit; }
static NSTextCheckingResult *TFBootstrapMatch(NSString *value, NSString *pattern) {
	NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
	NSTextCheckingResult *match = [expression firstMatchInString:value options:0 range:NSMakeRange(0, value.length)];
	return match && NSEqualRanges(match.range, NSMakeRange(0, value.length)) ? match : nil;
}

@interface TFBootstrapFlag : NSObject { @public std::atomic_bool value; }
@end
@implementation TFBootstrapFlag
- (instancetype)init { if ((self = [super init])) value.store(true); return self; }
@end

@class TFBootstrapWork;
@interface TFBootstrapContext : NSObject
@property (nonatomic, copy, nullable) NSString *mapId;
@property (nonatomic, copy, nullable) NSString *endpoint;
@property (nonatomic, copy, nullable) NSString *credential;
@property (nonatomic) unsigned long long lastRequest;
@property (nonatomic) TFBootstrapFlag *alive;
@property (nonatomic) NSMutableDictionary<NSString *, TFBootstrapWork *> *pending;
@end
@implementation TFBootstrapContext
- (instancetype)init { if ((self = [super init])) { _alive = [TFBootstrapFlag new]; _pending = [NSMutableDictionary dictionary]; } return self; }
- (NSString *)description { return @"TFBootstrapContext(redacted)"; }
@end

@interface TFBootstrapWork : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic) TFBootstrapContext *context;
@property (nonatomic) TFBootstrapFlag *alive;
@property (nonatomic) NSTimeInterval deadline;
@property (nonatomic, copy, nullable) void (^completion)(NSDictionary *_Nullable);
@property (nonatomic, nullable) id<TFAdmissionCancel> network;
@property (nonatomic, nullable) id<TFAdmissionCancel> timer;
@end
@implementation TFBootstrapWork
- (NSString *)description { return @"TFBootstrapWork(redacted)"; }
@end

@interface TFAdmissionBootstrap () {
	std::atomic_bool _active;
	std::atomic_bool _foreground;
}
@property (nonatomic, copy) NSString *installation;
@property (nonatomic) id<TFAdmissionScheduler> scheduler;
@property (nonatomic) id<TFAdmissionNetwork> network;
@property (nonatomic, copy) TFAdmissionStartGuard owns;
@property (nonatomic) NSMutableDictionary<NSString *, TFBootstrapContext *> *contexts;
@property (nonatomic) NSUInteger pendingCount;
@end

@implementation TFAdmissionBootstrap
- (instancetype)initWithInstallation:(NSString *)installation scheduler:(id<TFAdmissionScheduler>)scheduler network:(id<TFAdmissionNetwork>)network owns:(TFAdmissionStartGuard)owns {
	if ((self = [super init])) {
		_installation = [installation copy]; _scheduler = scheduler; _network = network; _owns = [owns copy];
		_contexts = [NSMutableDictionary dictionary]; _active.store(true); _foreground.store(true);
	}
	return self;
}
- (NSString *)description { return @"TFAdmissionBootstrap(redacted)"; }
- (BOOL)validContext:(NSString *)context { return TFAdmissionValidToken(context) && [context hasPrefix:[self.installation stringByAppendingString:@"."]]; }
- (unsigned long long)sequence:(NSString *)request {
	NSString *prefix = [self.installation stringByAppendingString:@"."];
	if (!TFBootstrapString(request, 96) || ![request hasPrefix:prefix]) TFBootstrapInvalid();
	NSString *suffix = [request substringFromIndex:prefix.length];
	if (!TFBootstrapMatch(suffix, @"[1-9][0-9]{0,15}")) TFBootstrapInvalid();
	unsigned long long value = suffix.longLongValue;
	if (value > 9007199254740991ULL) TFBootstrapInvalid();
	return value;
}
- (BOOL)owned { @try { return self.owns(); } @catch (NSException *exception) { return NO; } }
- (void)registerContext:(NSString *)context mapId:(NSString *)mapId {
	if (!_active.load() || ![self owned] || ![self validContext:context] || self.contexts[context] || self.contexts.count >= 16 ||
		(mapId && (!TFBootstrapString(mapId, 64) || !TFBootstrapMatch(mapId, @"map_[A-Za-z0-9_-]{16}")))) TFBootstrapInvalid();
	TFBootstrapContext *binding = [TFBootstrapContext new]; binding.mapId = mapId;
	self.contexts[context] = binding;
}
- (void)startContext:(NSString *)contextId request:(NSString *)requestId url:(NSString *)url credential:(NSString *)credential body:(NSString *)body completion:(void (^)(NSDictionary *))completion {
	if (![self validContext:contextId]) TFBootstrapInvalid();
	TFBootstrapContext *context = self.contexts[contextId];
	if (!_active.load() || !_foreground.load() || ![self owned] || !context || !context.alive->value.load() || !context.mapId || self.pendingCount >= 32) TFBootstrapInvalid();
	unsigned long long sequence = [self sequence:requestId];
	if (sequence <= context.lastRequest || !TFBootstrapString(credential, 58) || !TFBootstrapMatch(credential, @"tf_public_[0-9a-f]{48}") || !TFBootstrapString(body, 2048)) TFBootstrapInvalid();
	NSTextCheckingResult *match = TFBootstrapMatch(body, @"\\{\"mapId\":\"(map_[A-Za-z0-9_-]{16})\",\"sessionId\":\"([A-Za-z0-9._:-]{1,255})\",\"surfaceId\":\"([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)\"\\}");
	if (!match || ![[body substringWithRange:[match rangeAtIndex:1]] isEqual:context.mapId]) TFBootstrapInvalid();
	for (NSUInteger index = 2; index <= 3; index++) {
		NSString *value = [body substringWithRange:[match rangeAtIndex:index]];
		if ([value hasPrefix:@"tf_native_"] || TFBootstrapMatch(value, @"tf_public_[0-9a-f]{48}")) TFBootstrapInvalid();
	}
	NSString *clean = TFAdmissionCleanURL(url);
	if (![clean isEqual:[TFAdmissionOrigin(clean) stringByAppendingString:@"/v1/sessions/start"]] ||
		(context.endpoint && (![context.endpoint isEqual:clean] || ![context.credential isEqual:credential]))) TFBootstrapInvalid();
	// The controller supplies the initial validated binding; no later request
	// may change its exact endpoint, port, or credential for this Map context.
	context.endpoint = clean; context.credential = credential; context.lastRequest = sequence;
	TFBootstrapWork *work = [TFBootstrapWork new];
	work.identifier = requestId; work.context = context; work.alive = [TFBootstrapFlag new];
	work.deadline = [self.scheduler nowMs] + 30000; work.completion = completion;
	context.pending[requestId] = work; self.pendingCount++;
	work.timer = [self.scheduler after:30000 perform:^{ [self finish:work reply:nil]; }];
	NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:clean]
		cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:30];
	request.HTTPMethod = @"POST"; request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
	request.HTTPShouldHandleCookies = NO;
	[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
	[request setValue:@"no-store" forHTTPHeaderField:@"Cache-Control"];
	[request setValue:credential forHTTPHeaderField:@"X-Tileflow-Mobile-Client"];
	@try {
		work.network = [self.network start:request mayStart:^BOOL { return [self mayStart:work]; } completion:^(NSHTTPURLResponse *response, NSData *bytes) {
			[self.scheduler enqueue:^{
				NSString *cacheControl = @"";
				for (id name in response.allHeaderFields) {
					if ([name isKindOfClass:NSString.class] && [(NSString *)name caseInsensitiveCompare:@"Cache-Control"] == NSOrderedSame) cacheControl = response.allHeaderFields[name];
				}
				BOOL valid = [self mayStart:work] && [response isKindOfClass:NSHTTPURLResponse.class] && response.statusCode >= 100 && response.statusCode <= 599 &&
					TFBootstrapString(cacheControl, 1024) && [bytes isKindOfClass:NSData.class] && bytes.length <= 65536;
				NSDictionary *reply = valid ? @{@"status": @(response.statusCode), @"cacheControl": cacheControl, @"bodyBase64": [bytes base64EncodedStringWithOptions:0]} : nil;
				[self finish:work reply:reply];
			}];
		}];
		if (!work.alive->value.load()) [work.network cancel];
	} @catch (NSException *exception) { [self finish:work reply:nil]; }
}
- (BOOL)mayStart:(TFBootstrapWork *)work {
	return _active.load() && _foreground.load() && work.alive->value.load() && work.context.alive->value.load() && [self.scheduler nowMs] < work.deadline && [self owned];
}
- (void)finish:(TFBootstrapWork *)work reply:(NSDictionary *)reply {
	if (!work.alive->value.exchange(false)) return;
	[work.context.pending removeObjectForKey:work.identifier]; self.pendingCount--;
	[work.timer cancel]; work.timer = nil;
	[work.network cancel]; work.network = nil;
	void (^completion)(NSDictionary *) = work.completion; work.completion = nil;
	@try { if (completion) completion(reply); } @catch (NSException *exception) { /* Consumers cannot reopen cancelled work. */ }
}
- (void)cancelContext:(NSString *)contextId request:(NSString *)requestId {
	if (![self validContext:contextId]) TFBootstrapInvalid();
	unsigned long long sequence = [self sequence:requestId];
	TFBootstrapContext *context = self.contexts[contextId];
	if (!context) return;
	// Cancellation may arrive first. This bounded high-water mark prevents
	// replay without accumulating retired-request tombstones.
	context.lastRequest = MAX(context.lastRequest, sequence);
	TFBootstrapWork *work = context.pending[requestId];
	if (work) [self finish:work reply:nil];
}
- (void)retire:(NSString *)contextId {
	TFBootstrapContext *context = self.contexts[contextId];
	if (!context) return;
	[self.contexts removeObjectForKey:contextId]; context.alive->value.store(false);
	context.credential = nil; context.endpoint = nil;
	for (TFBootstrapWork *work in context.pending.allValues) [self finish:work reply:nil];
}
- (void)lifecycle:(BOOL)foreground {
	_foreground.store(foreground);
	if (!foreground) for (TFBootstrapContext *context in self.contexts.allValues) for (TFBootstrapWork *work in context.pending.allValues) [self finish:work reply:nil];
}
- (void)close {
	_active.store(false);
	for (NSString *context in self.contexts.allKeys) [self retire:context];
}
@end
