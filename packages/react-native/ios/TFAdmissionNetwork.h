#import "TFAdmissionEngine.h"

NS_ASSUME_NONNULL_BEGIN
@interface TFContinuousAdmissionScheduler : NSObject <TFAdmissionScheduler>
@end

@interface TFAdmissionURLSessionNetwork : NSObject <TFAdmissionNetwork>
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects;
- (instancetype)initWithConfiguration:(NSURLSessionConfiguration *)configuration followsRedirects:(BOOL)followsRedirects
	responseByteLimit:(NSUInteger)responseByteLimit queueDepth:(NSUInteger)queueDepth concurrency:(NSUInteger)concurrency;
- (void)close;
@end
NS_ASSUME_NONNULL_END
