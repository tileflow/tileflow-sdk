#import "TFAdmissionEngine.h"

NS_ASSUME_NONNULL_BEGIN
@interface TFContinuousAdmissionScheduler : NSObject <TFAdmissionScheduler>
@end

@interface TFAdmissionURLSessionNetwork : NSObject <TFAdmissionNetwork>
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects;
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects
	responseByteLimit:(NSUInteger)responseByteLimit queueDepth:(NSUInteger)queueDepth concurrency:(NSUInteger)concurrency;
// Internal deterministic harness seam; callers must provide a serial queue.
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects
	responseByteLimit:(NSUInteger)responseByteLimit queueDepth:(NSUInteger)queueDepth concurrency:(NSUInteger)concurrency workQueue:(dispatch_queue_t)workQueue;
- (void)close;
@end
NS_ASSUME_NONNULL_END
