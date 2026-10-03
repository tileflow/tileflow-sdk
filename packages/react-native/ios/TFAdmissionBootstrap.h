#import "TFAdmissionEngine.h"

NS_ASSUME_NONNULL_BEGIN
// All registry mutations use the admission scheduler. Native networking reads
// only immutable request data, continuous deadlines, and atomic liveness.
@interface TFAdmissionBootstrap : NSObject
- (instancetype)initWithInstallation:(NSString *)installation scheduler:(id<TFAdmissionScheduler>)scheduler
	network:(id<TFAdmissionNetwork>)network owns:(TFAdmissionStartGuard)owns;
- (void)registerContext:(NSString *)context mapId:(nullable NSString *)mapId;
- (void)startContext:(NSString *)context request:(NSString *)request url:(NSString *)url
	credential:(NSString *)credential body:(NSString *)body completion:(void (^)(NSDictionary *_Nullable reply))completion;
- (void)cancelContext:(NSString *)context request:(NSString *)request;
- (void)retire:(NSString *)context;
- (void)lifecycle:(BOOL)foreground;
- (void)close;
@end
NS_ASSUME_NONNULL_END
