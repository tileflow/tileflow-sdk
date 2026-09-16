#import "TFNativeDocumentRegistry.h"
#import "TFDocumentBounds.h"
#import <atomic>

static void TFDocumentInvalid(void) {
	@throw [NSException exceptionWithName:@"TFNativeDocumentInvalid" reason:@"Native document acquisition failed." userInfo:nil];
}

@implementation TFNativeDocumentScope
- (instancetype)initWithContext:(NSString *)context active:(TFAdmissionStartGuard)active load:(TFAdmissionDelegate)load {
	if ((self = [super init])) {
		if (!TFAdmissionValidToken(context) || !active || !load) TFDocumentInvalid();
		_context = [context copy]; _active = [active copy]; _load = [load copy];
	}
	return self;
}
- (NSString *)description { return @"TFNativeDocumentScope(redacted)"; }
@end

@interface TFNativeDocumentWork : NSObject { @public std::atomic_bool live; }
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) NSString *origin;
@property (nonatomic, copy) NSURLRequest *request;
@property (nonatomic, strong, nullable) TFNativeDocumentScope *scope;
@property (nonatomic) NSUInteger maximumBytes;
@property (nonatomic) NSTimeInterval deadline;
@property (nonatomic) BOOL nativeFinished;
@property (nonatomic) BOOL requested;
@property (nonatomic) NSUInteger offset;
@property (nonatomic) NSUInteger revision;
@property (nonatomic) NSUInteger redirects;
@property (nonatomic, strong, nullable) id<TFAdmissionCancel> cancellation;
@property (nonatomic, strong, nullable) id<TFAdmissionCancel> timer;
@property (nonatomic, strong, nullable) NSMutableData *body;
@property (nonatomic, copy, nullable) NSDictionary *header;
@property (nonatomic, copy, nullable) void (^waiter)(NSDictionary *_Nullable);
@end
@implementation TFNativeDocumentWork
- (instancetype)init { if ((self = [super init])) live.store(true); return self; }
- (NSString *)description { return @"TFNativeDocumentWork(redacted)"; }
@end

@interface TFNativeDocumentRegistry () {
	std::atomic_bool _foreground;
	std::atomic_bool _closed;
}
@property (nonatomic, strong) id<TFAdmissionScheduler> scheduler;
@property (nonatomic, copy) TFNativeDocumentLoad load;
@property (nonatomic, strong) NSMutableDictionary<NSString *, TFNativeDocumentWork *> *work;
@end
@implementation TFNativeDocumentRegistry
- (instancetype)initWithScheduler:(id<TFAdmissionScheduler>)scheduler load:(TFNativeDocumentLoad)load {
	if ((self = [super init])) {
		if (!scheduler || !load) TFDocumentInvalid();
		_scheduler = scheduler; _load = [load copy]; _work = [NSMutableDictionary dictionary];
		_foreground.store(true); _closed.store(false);
	}
	return self;
}
- (BOOL)active:(TFNativeDocumentWork *)work {
	@try {
		return work->live.load() && !self->_closed.load() && self->_foreground.load() &&
			[self.scheduler nowMs] < work.deadline && (!work.scope || work.scope.active());
	} @catch (NSException *exception) { return NO; }
}
- (NSString *)open:(NSURLRequest *)request maximumBytes:(NSUInteger)maximumBytes scope:(TFNativeDocumentScope *)scope {
	TFAdmissionCleanURL(request.URL.absoluteString);
	if (self->_closed.load() || !self->_foreground.load() || self.work.count >= 16 || maximumBytes < 1 || maximumBytes > 8388608 ||
		![request.HTTPMethod isEqual:@"GET"] || request.HTTPBody || request.HTTPBodyStream || request.allHTTPHeaderFields.count ||
		(scope && !scope.active())) TFDocumentInvalid();
	TFNativeDocumentWork *work = [TFNativeDocumentWork new];
	work.identifier = NSUUID.UUID.UUIDString;
	work.origin = TFAdmissionOrigin(request.URL.absoluteString);
	work.maximumBytes = maximumBytes; work.scope = scope; work.deadline = [self.scheduler nowMs] + 30000;
	NSMutableURLRequest *copy = [request mutableCopy];
	copy.timeoutInterval = 30; copy.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
	copy.HTTPShouldHandleCookies = NO;
	TFDocumentSetByteLimit(copy, maximumBytes);
	work.request = copy;
	self.work[work.identifier] = work;
	work.timer = [self.scheduler after:30000 perform:^{ [self retireQuietly:work.identifier]; }];
	[self issue:work];
	return work.identifier;
}
- (void)issue:(TFNativeDocumentWork *)work {
	if (![self active:work]) { [self retireQuietly:work.identifier]; return; }
	NSUInteger revision = ++work.revision;
	work.nativeFinished = NO;
	@try {
		id<TFAdmissionCancel> cancellation = self.load(work.request, work.scope, ^BOOL { return [self active:work]; }, ^(NSHTTPURLResponse *response, NSData *body) {
			[self.scheduler enqueue:^{
				if (revision != work.revision || work.nativeFinished) return;
				work.nativeFinished = YES;
				[self received:work response:response body:body];
			}];
		});
		if (!cancellation) TFDocumentInvalid();
		work.cancellation = cancellation;
		if (!work->live.load()) [self retireQuietly:work.identifier];
	} @catch (NSException *exception) {
		// A throwing adapter might already have queued work. Retain the bounded
		// reservation until its completion rather than manufacturing capacity.
		[self retireQuietly:work.identifier];
	}
}
- (void)received:(TFNativeDocumentWork *)work response:(NSHTTPURLResponse *)response body:(NSData *)body {
	if (![self active:work] || !response || !body || response.statusCode < 100 || response.statusCode > 599 || body.length > work.maximumBytes) {
		[self retireQuietly:work.identifier]; return;
	}
	NSString *url = response.URL.absoluteString;
	@try {
		TFAdmissionCleanURL(url);
		if (![TFAdmissionOrigin(url) isEqual:work.origin]) TFDocumentInvalid();
		if (!work.scope && [@[@301, @302, @303, @307, @308] containsObject:@(response.statusCode)]) {
			NSString *location = [response valueForHTTPHeaderField:@"Location"];
			if (++work.redirects > 3 || ![location isKindOfClass:NSString.class] || !location.length || location.length > 2048 || [location containsString:@"\\"]) TFDocumentInvalid();
			NSURL *target = [NSURL URLWithString:location relativeToURL:response.URL].absoluteURL;
			TFAdmissionCleanURL(target.absoluteString);
			if (![TFAdmissionOrigin(target.absoluteString) isEqual:work.origin]) TFDocumentInvalid();
			NSMutableURLRequest *next = [work.request mutableCopy]; next.URL = target;
			next.timeoutInterval = MAX(0.001, (work.deadline - [self.scheduler nowMs]) / 1000);
			work.request = next; work.cancellation = nil;
			[self issue:work]; return;
		}
	} @catch (NSException *exception) { [self retireQuietly:work.identifier]; return; }
	work.body = [body mutableCopy];
	work.header = @{@"url": [url copy], @"status": @(response.statusCode)};
	void (^waiter)(NSDictionary *) = work.waiter; work.waiter = nil;
	if (waiter) waiter(work.header);
}
- (void)response:(NSString *)identifier completion:(void (^)(NSDictionary *_Nullable))completion {
	TFNativeDocumentWork *work = self.work[identifier];
	if (!work || ![self active:work] || work.requested) { completion(nil); return; }
	work.requested = YES;
	if (work.header) completion(work.header);
	else work.waiter = completion;
}
- (NSDictionary *)chunk:(NSString *)identifier maximumBytes:(NSUInteger)maximumBytes {
	TFNativeDocumentWork *work = self.work[identifier];
	if (!work || ![self active:work] || !work.requested || !work.body || maximumBytes < 1 || maximumBytes > 65536) {
		[self retireQuietly:identifier]; TFDocumentInvalid();
	}
	NSUInteger length = MIN(maximumBytes, work.body.length - work.offset);
	NSData *bytes = [work.body subdataWithRange:NSMakeRange(work.offset, length)];
	NSString *encoded = [bytes base64EncodedStringWithOptions:0];
	work.offset += length;
	BOOL last = work.offset == work.body.length;
	if (last) [self cancel:identifier];
	return @{@"bodyBase64": encoded, @"last": @(last)};
}
- (void)cancel:(NSString *)identifier {
	if (!TFAdmissionValidToken(identifier)) TFDocumentInvalid();
	TFNativeDocumentWork *work = self.work[identifier];
	if (!work) return;
	work->live.store(false);
	[work.timer cancel]; work.timer = nil;
	void (^waiter)(NSDictionary *) = work.waiter; work.waiter = nil;
	[work.body resetBytesInRange:NSMakeRange(0, work.body.length)]; work.body = nil; work.header = nil;
	@try {
		if (!work.nativeFinished) [work.cancellation cancel];
		work.cancellation = nil;
	} @finally {
		if (work.nativeFinished) [self.work removeObjectForKey:identifier];
		if (waiter) waiter(nil);
	}
}
- (void)retireQuietly:(NSString *)identifier {
	@try { [self cancel:identifier]; }
	@catch (NSException *exception) { /* Retain failed physical cleanup; continue logical retirement. */ }
}
- (void)retireContext:(NSString *)context {
	for (TFNativeDocumentWork *work in self.work.allValues) if ([work.scope.context isEqual:context]) [self retireQuietly:work.identifier];
}
- (void)lifecycle:(BOOL)foreground {
	self->_foreground.store(foreground);
	if (!foreground) for (NSString *identifier in self.work.allKeys) [self retireQuietly:identifier];
}
- (void)close {
	self->_closed.store(true);
	for (NSString *identifier in self.work.allKeys) [self retireQuietly:identifier];
}
- (NSString *)description { return @"TFNativeDocumentRegistry(redacted)"; }
@end
