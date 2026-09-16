#import "TFAdmissionEngine.h"

NS_ASSUME_NONNULL_BEGIN
@interface TFAdmissionInstallation : NSObject
@property (nonatomic, readonly) NSString *identifier;
@property (nonatomic, readonly) TFAdmissionEngine *engine;
- (instancetype)initWithEmitter:(void (^)(NSDictionary *event))emit;
// Private deterministic native harness seam; not exposed over React Native.
- (instancetype)initWithScheduler:(id<TFAdmissionScheduler>)scheduler
	network:(nullable id<TFAdmissionNetwork>)network
	emit:(void (^)(NSDictionary *event))emit;
- (BOOL)ownsConfiguration;
- (NSDictionary *)remove;
- (id<TFAdmissionCancel>)delegateRequest:(NSURLRequest *)request
	mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion;
@end

@interface TFNativeAdmissionURLProtocol : NSURLProtocol
+ (nullable TFAdmissionInstallation *)activeInstallation;
+ (void)setActiveInstallation:(nullable TFAdmissionInstallation *)installation;
@end
NS_ASSUME_NONNULL_END
