#import "TFAdmissionNetwork.h"
#import <mach/mach_time.h>
#import <atomic>

@interface TFScheduledAdmission : NSObject <TFAdmissionCancel>
@property (nonatomic, copy) dispatch_block_t block;
@end
@implementation TFScheduledAdmission
- (void)cancel { dispatch_block_cancel(self.block); }
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
	token.block = dispatch_block_create(0, block);
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(milliseconds * NSEC_PER_MSEC)), dispatch_get_main_queue(), token.block);
	return token;
}
@end

@interface TFAdmissionSessionOperation : NSObject <TFAdmissionCancel, NSURLSessionDataDelegate, NSURLSessionTaskDelegate> {
	std::atomic_bool _cancelled;
	std::atomic_bool _finished;
}
@property (nonatomic) NSURLRequest *request;
@property (nonatomic) NSURLSessionConfiguration *configuration;
@property (nonatomic) NSOperationQueue *delegateQueue;
@property (nonatomic) BOOL followsRedirects;
@property (nonatomic) NSUInteger responseByteLimit;
@property (nonatomic, copy) TFAdmissionStartGuard guard;
@property (nonatomic, copy) TFAdmissionNetworkCompletion completion;
@property (atomic, strong, nullable) NSURLSession *session;
@property (atomic, strong, nullable) NSURLSessionDataTask *task;
@property (nonatomic) NSMutableData *body;
@property (nonatomic, nullable) NSHTTPURLResponse *response;
- (BOOL)isCancelled;
- (void)start;
- (void)finish:(nullable NSHTTPURLResponse *)response body:(nullable NSData *)body;
@end

@implementation TFAdmissionSessionOperation
- (instancetype)init {
	if ((self = [super init])) { _cancelled.store(false); _finished.store(false); _body = [NSMutableData data]; }
	return self;
}
- (NSString *)description { return @"TFAdmissionSessionOperation(redacted)"; }
- (BOOL)isCancelled { return _cancelled.load(); }
- (BOOL)mayStart { return !_cancelled.load() && !_finished.load() && self.guard(); }
- (void)start {
	if (![self mayStart]) { [self finish:nil body:nil]; return; }
	NSURLSessionConfiguration *configuration = [self.configuration copy];
	configuration.waitsForConnectivity = NO;
	configuration.discretionary = NO;
	configuration.timeoutIntervalForResource = MIN(30.0, self.request.timeoutInterval);
	configuration.timeoutIntervalForRequest = MIN(30.0, self.request.timeoutInterval);
	self.session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:self.delegateQueue];
	self.task = [self.session dataTaskWithRequest:self.request];
	// Recheck after session/task creation, immediately before native resume.
	if (![self mayStart]) { [self cancel]; return; }
	[self.task resume];
}
- (void)cancel {
	_cancelled.store(true);
	[self.task cancel];
	[self.session invalidateAndCancel];
	[self finish:nil body:nil];
}
- (void)finish:(NSHTTPURLResponse *)response body:(NSData *)body {
	if (_finished.exchange(true)) return;
	[self.session invalidateAndCancel];
	self.task = nil; self.session = nil;
	self.completion(response, body);
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
	// Observe the response ourselves. The engine validates any redirect and
	// creates a new request using the same still-live logical admission.
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
@property (nonatomic) NSURLSessionConfiguration *configuration;
@property (nonatomic) BOOL followsRedirects;
@property (nonatomic) NSUInteger responseByteLimit;
@property (nonatomic) NSUInteger queueDepth;
@property (nonatomic) NSUInteger concurrency;
@property (nonatomic) dispatch_queue_t queue;
@property (nonatomic) NSOperationQueue *delegateQueue;
@property (nonatomic) NSMutableArray<TFAdmissionSessionOperation *> *pending;
@property (nonatomic) NSMutableSet<TFAdmissionSessionOperation *> *active;
@property (nonatomic) BOOL closed;
@end

@implementation TFAdmissionURLSessionNetwork
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects {
	return [self initWithConfiguration:configuration followsRedirects:followsRedirects responseByteLimit:8388608 queueDepth:2048 concurrency:16];
}
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects responseByteLimit:(NSUInteger)responseByteLimit queueDepth:(NSUInteger)queueDepth concurrency:(NSUInteger)concurrency {
	if ((self = [super init])) {
		if (!responseByteLimit || responseByteLimit > 8388608 || !queueDepth || queueDepth > 2048 || !concurrency || concurrency > 16 || concurrency > queueDepth) {
			[NSException raise:@"TFNativeAdmissionBounds" format:@"Invalid native transport bounds"];
		}
		_configuration = [configuration copy]; _followsRedirects = followsRedirects;
		_responseByteLimit = responseByteLimit; _queueDepth = queueDepth; _concurrency = concurrency;
		_queue = dispatch_queue_create("dev.tileflow.native-admission.network", DISPATCH_QUEUE_SERIAL);
		_delegateQueue = [NSOperationQueue new]; _delegateQueue.maxConcurrentOperationCount = 1;
		_pending = [NSMutableArray array]; _active = [NSMutableSet set];
	}
	return self;
}
- (NSString *)description { return @"TFAdmissionURLSessionNetwork(redacted)"; }
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	TFAdmissionSessionOperation *operation = [TFAdmissionSessionOperation new];
	operation.request = [request copy]; operation.guard = guard; operation.configuration = self.configuration;
	operation.delegateQueue = self.delegateQueue; operation.followsRedirects = self.followsRedirects;
	operation.responseByteLimit = self.responseByteLimit;
	__weak TFAdmissionSessionOperation *weakOperation = operation;
	operation.completion = ^(NSHTTPURLResponse *response, NSData *body) {
		completion(response, body);
		dispatch_async(self.queue, ^{
			TFAdmissionSessionOperation *finished = weakOperation;
			if (finished) { [self.active removeObject:finished]; [self.pending removeObject:finished]; }
			[self drain];
		});
	};
	dispatch_async(self.queue, ^{
		if (self.closed || self.pending.count + self.active.count >= self.queueDepth || operation.isCancelled) { [operation cancel]; return; }
		[self.pending addObject:operation];
		[self drain];
	});
	return operation;
}
- (void)drain {
	while (!self.closed && self.active.count < self.concurrency && self.pending.count) {
		TFAdmissionSessionOperation *operation = self.pending.firstObject;
		[self.pending removeObjectAtIndex:0];
		if (operation.isCancelled) { [operation cancel]; continue; }
		[self.active addObject:operation];
		[operation start];
	}
}
- (void)close {
	dispatch_async(self.queue, ^{
		self.closed = YES;
		for (TFAdmissionSessionOperation *operation in [self.pending copy]) [operation cancel];
		for (TFAdmissionSessionOperation *operation in [self.active copy]) [operation cancel];
		[self.pending removeAllObjects]; [self.active removeAllObjects];
	});
}
@end
