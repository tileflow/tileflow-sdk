#import "TFAdmissionNetwork.h"
#import <mach/mach_time.h>
#import <atomic>

@interface TFScheduledAdmission : NSObject <TFAdmissionCancel>
@property (nonatomic, copy, nullable) dispatch_block_t action;
@property (nonatomic, strong, nullable) dispatch_source_t timer;
@end
@implementation TFScheduledAdmission
- (void)cancel {
	@synchronized(self) {
		self.action = nil;
		if (self.timer) dispatch_source_cancel(self.timer);
		self.timer = nil;
	}
}
- (void)fire {
	dispatch_block_t action;
	@synchronized(self) { action = self.action; [self cancel]; }
	if (action) action();
}
- (void)dealloc { if (_timer) dispatch_source_cancel(_timer); }
@end

@implementation TFContinuousAdmissionScheduler
- (NSTimeInterval)nowMs {
	static mach_timebase_info_data_t timebase;
	static dispatch_once_t once;
	dispatch_once(&once, ^{ mach_timebase_info(&timebase); });
	return (double)mach_continuous_time() * (double)timebase.numer / (double)timebase.denom / 1000000.0;
}
- (void)enqueue:(dispatch_block_t)block { dispatch_async(dispatch_get_main_queue(), block); }
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block {
	TFScheduledAdmission *token = [TFScheduledAdmission new];
	token.action = block;
	dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
	token.timer = timer;
	__weak TFScheduledAdmission *weakToken = token;
	// Cancellation releases captured work without waiting for the timer date.
	dispatch_source_set_event_handler(timer, ^{ [weakToken fire]; });
	dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(milliseconds * NSEC_PER_MSEC)), DISPATCH_TIME_FOREVER, 0);
	dispatch_resume(timer);
	return token;
}
@end

@interface TFAdmissionSessionOperation : NSObject <TFAdmissionCancel, NSURLSessionDataDelegate, NSURLSessionTaskDelegate> {
	std::atomic_bool _cancelled;
	std::atomic_bool _finished;
	std::atomic_bool _started;
	std::atomic_bool _cleaned;
}
@property (nonatomic, strong, nullable) NSURLRequest *request;
@property (nonatomic, strong, nullable) NSURLSessionConfiguration *configuration;
@property (nonatomic, strong) NSOperationQueue *delegateQueue;
@property (nonatomic) BOOL followsRedirects;
@property (nonatomic) NSUInteger responseByteLimit;
@property (atomic, copy, nullable) TFAdmissionStartGuard guard;
@property (nonatomic, copy, nullable) TFAdmissionNetworkCompletion completion;
@property (nonatomic, copy, nullable) dispatch_block_t cleanup;
@property (atomic, strong, nullable) NSURLSession *session;
@property (atomic, strong, nullable) NSURLSessionDataTask *task;
@property (nonatomic, strong, nullable) NSMutableData *body;
@property (nonatomic, strong, nullable) NSHTTPURLResponse *response;
- (BOOL)isCancelled;
- (void)start;
- (void)finish:(nullable NSHTTPURLResponse *)response body:(nullable NSData *)body;
- (void)releaseNativeResources;
@end

@implementation TFAdmissionSessionOperation
- (instancetype)init {
	if ((self = [super init])) {
		_cancelled.store(false); _finished.store(false); _started.store(false); _cleaned.store(false);
		_body = [NSMutableData data];
	}
	return self;
}
- (NSString *)description { return @"TFAdmissionSessionOperation(redacted)"; }
- (BOOL)isCancelled { return _cancelled.load(); }
- (BOOL)mayStart {
	TFAdmissionStartGuard guard = self.guard;
	return guard && !_cancelled.load() && !_finished.load() && guard();
}
- (void)start {
	if (_started.exchange(true)) return;
	BOOL noSession = NO;
	@try {
		// Protect task construction against native cancellation, not against
		// JavaScript. There is no asynchronous wait or I/O under this lock.
		@synchronized(self) {
			if ([self mayStart]) {
				NSURLSessionConfiguration *configuration = [self.configuration copy];
				configuration.waitsForConnectivity = NO;
				configuration.discretionary = NO;
				configuration.timeoutIntervalForResource = MIN(30.0, self.request.timeoutInterval);
				configuration.timeoutIntervalForRequest = MIN(30.0, self.request.timeoutInterval);
				self.session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:self.delegateQueue];
				self.task = [self.session dataTaskWithRequest:self.request];
				// Recheck after task creation, immediately before native resume.
				if (self.task && [self mayStart]) [self.task resume];
				else [self cancel];
			} else [self finish:nil body:nil];
			noSession = self.session == nil;
		}
	} @catch (NSException *exception) {
		[self cancel];
		@synchronized(self) { noSession = self.session == nil; }
	}
	// A request cancelled before queue drain has no native terminal event.
	// Only processing its queued start may release that reservation.
	if (noSession) [self releaseNativeResources];
}
- (void)cancel {
	_cancelled.store(true);
	[self finish:nil body:nil];
	NSURLSession *session;
	NSURLSessionDataTask *task;
	@synchronized(self) { session = self.session; task = self.task; }
	[task cancel]; [session invalidateAndCancel];
}
- (void)finish:(NSHTTPURLResponse *)response body:(NSData *)body {
	if (_finished.exchange(true)) return;
	NSURLSession *session;
	@synchronized(self) { session = self.session; }
	[session invalidateAndCancel];
	TFAdmissionNetworkCompletion completion = self.completion;
	self.completion = nil;
	if (completion) completion(response, body);
	// Logical completion is not physical cleanup. A cancelled URLSession
	// retains its native capacity slot until didBecomeInvalidWithError.
}
- (void)releaseNativeResources {
	if (_cleaned.exchange(true)) return;
	dispatch_block_t cleanup;
	@synchronized(self) {
		self.task = nil; self.session = nil;
		self.request = nil; self.configuration = nil; self.guard = nil;
		self.body = nil; self.response = nil;
		cleanup = self.cleanup; self.cleanup = nil;
	}
	if (cleanup) cleanup();
}
- (void)URLSession:(NSURLSession *)session didBecomeInvalidWithError:(NSError *)error {
	[self finish:nil body:nil];
	[self releaseNativeResources];
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
	if (![self mayStart] || ![response isKindOfClass:NSHTTPURLResponse.class] || response.expectedContentLength > (int64_t)self.responseByteLimit) {
		completionHandler(NSURLSessionResponseCancel); [self cancel]; return;
	}
	self.response = (NSHTTPURLResponse *)response;
	completionHandler(NSURLSessionResponseAllow);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
	if (![self mayStart] || data.length > self.responseByteLimit - self.body.length) { [self cancel]; return; }
	[self.body appendData:data];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
	if (error || ![self mayStart]) [self finish:nil body:nil];
	else [self finish:self.response body:[self.body copy]];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler {
	if (![self mayStart]) { completionHandler(nil); [self cancel]; return; }
	if (self.followsRedirects) { completionHandler(request); return; }
	// Observe the response here, not through MapLibre delegate forwarding.
	completionHandler(nil);
	[self finish:response body:[NSData data]];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willBeginDelayedRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLSessionDelayedRequestDisposition, NSURLRequest *_Nullable))completionHandler {
	completionHandler([self mayStart] ? NSURLSessionDelayedRequestContinueLoading : NSURLSessionDelayedRequestCancel, nil);
}
- (void)URLSession:(NSURLSession *)session taskIsWaitingForConnectivity:(NSURLSessionTask *)task { [self cancel]; }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *_Nullable))completionHandler {
	completionHandler([self mayStart] ? NSURLSessionAuthChallengePerformDefaultHandling : NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
}
- (void)URLSession:(NSURLSession *)session didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *_Nullable))completionHandler {
	completionHandler([self mayStart] ? NSURLSessionAuthChallengePerformDefaultHandling : NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
}
@end

@interface TFAdmissionURLSessionNetwork ()
@property (nonatomic, strong) NSURLSessionConfiguration *configuration;
@property (nonatomic) BOOL followsRedirects;
@property (nonatomic) NSUInteger responseByteLimit;
@property (nonatomic) NSUInteger queueDepth;
@property (nonatomic) NSUInteger concurrency;
@property (nonatomic) NSUInteger reservations;
@property (nonatomic, strong) dispatch_queue_t queue;
@property (nonatomic, strong) NSOperationQueue *delegateQueue;
@property (nonatomic, strong) NSMutableArray<TFAdmissionSessionOperation *> *pending;
@property (nonatomic, strong) NSMutableSet<TFAdmissionSessionOperation *> *active;
@property (atomic) BOOL closed;
@end

@implementation TFAdmissionURLSessionNetwork
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects {
	return [self initWithConfiguration:configuration followsRedirects:followsRedirects responseByteLimit:8388608 queueDepth:2048 concurrency:16];
}
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects responseByteLimit:(NSUInteger)responseByteLimit queueDepth:(NSUInteger)queueDepth concurrency:(NSUInteger)concurrency {
	return [self initWithConfiguration:configuration followsRedirects:followsRedirects responseByteLimit:responseByteLimit queueDepth:queueDepth concurrency:concurrency
		workQueue:dispatch_queue_create("dev.tileflow.native-admission.network", DISPATCH_QUEUE_SERIAL)];
}
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects responseByteLimit:(NSUInteger)responseByteLimit queueDepth:(NSUInteger)queueDepth concurrency:(NSUInteger)concurrency workQueue:(dispatch_queue_t)workQueue {
	if ((self = [super init])) {
		if (!workQueue || !responseByteLimit || responseByteLimit > 8388608 || !queueDepth || queueDepth > 2048 || !concurrency || concurrency > 16 || concurrency > queueDepth) {
			[NSException raise:@"TFNativeAdmissionBounds" format:@"Invalid native transport bounds"];
		}
		_configuration = [configuration copy]; _followsRedirects = followsRedirects;
		_responseByteLimit = responseByteLimit; _queueDepth = queueDepth; _concurrency = concurrency;
		_queue = workQueue;
		_delegateQueue = [NSOperationQueue new]; _delegateQueue.maxConcurrentOperationCount = 1;
		_pending = [NSMutableArray array]; _active = [NSMutableSet set];
	}
	return self;
}
- (NSString *)description { return @"TFAdmissionURLSessionNetwork(redacted)"; }
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	BOOL reserved;
	@synchronized(self) {
		reserved = !self.closed && self.reservations < self.queueDepth;
		if (reserved) self.reservations++;
	}
	TFAdmissionSessionOperation *operation = [TFAdmissionSessionOperation new];
	operation.request = [request copy]; operation.guard = guard; operation.configuration = self.configuration;
	operation.delegateQueue = self.delegateQueue; operation.followsRedirects = self.followsRedirects;
	operation.responseByteLimit = self.responseByteLimit;
	operation.completion = completion;
	__weak TFAdmissionSessionOperation *weakOperation = operation;
	operation.cleanup = ^{
		if (reserved) dispatch_async(self.queue, ^{
			TFAdmissionSessionOperation *finished = weakOperation;
			if (finished) { [self.active removeObject:finished]; [self.pending removeObject:finished]; }
			@synchronized(self) { self.reservations--; }
			[self drain];
		});
	};
	if (!reserved) { [operation cancel]; [operation start]; return operation; }
	// Capacity is reserved before posting. Native terminal cleanup, not
	// promise rejection, releases it after a URLSession has been created.
	dispatch_async(self.queue, ^{
		if (self.closed || operation.isCancelled) { [operation cancel]; [operation start]; return; }
		[self.pending addObject:operation];
		[self drain];
	});
	return operation;
}
- (void)drain {
	while (!self.closed && self.active.count < self.concurrency && self.pending.count) {
		TFAdmissionSessionOperation *operation = self.pending.firstObject;
		[self.pending removeObjectAtIndex:0];
		if (operation.isCancelled) { [operation start]; continue; }
		[self.active addObject:operation];
		[operation start];
	}
}
- (void)close {
	@synchronized(self) { if (self.closed) return; self.closed = YES; }
	dispatch_async(self.queue, ^{
		for (TFAdmissionSessionOperation *operation in [self.pending copy]) { [operation cancel]; [operation start]; }
		[self.pending removeAllObjects];
		// Keep active sessions and their reservations until invalidation.
		for (TFAdmissionSessionOperation *operation in [self.active copy]) [operation cancel];
	});
}
@end
