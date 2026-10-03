#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol TFAdmissionCancel <NSObject>
- (void)cancel;
@end

@protocol TFAdmissionScheduler <NSObject>
- (NSTimeInterval)nowMs;
- (void)enqueue:(dispatch_block_t)block;
- (id<TFAdmissionCancel>)after:(NSTimeInterval)milliseconds perform:(dispatch_block_t)block;
@end

typedef BOOL (^TFAdmissionStartGuard)(void);
typedef void (^TFAdmissionNetworkCompletion)(NSHTTPURLResponse *_Nullable response, NSData *_Nullable body);
typedef id<TFAdmissionCancel> _Nonnull (^TFAdmissionDelegate)(NSURLRequest *request, TFAdmissionNetworkCompletion completion);

@protocol TFAdmissionNetwork <NSObject>
- (id<TFAdmissionCancel>)start:(NSURLRequest *)request
	mayStart:(TFAdmissionStartGuard)guard
	completion:(TFAdmissionNetworkCompletion)completion;
@end

// Internal per-installation registry. Only the JavaScript controller admits
// commercial requests; native sequence values identify transport messages.
@interface TFAdmissionEngine : NSObject
- (instancetype)initWithInstallation:(NSString *)installation
	scheduler:(id<TFAdmissionScheduler>)scheduler
	network:(id<TFAdmissionNetwork>)network
	owns:(TFAdmissionStartGuard)owns
	emit:(void (^)(NSDictionary *event))emit;
- (NSString *)registerMap:(nullable NSString *)mapId resources:(NSArray<NSDictionary *> *)resources;
- (NSUInteger)extendContext:(NSString *)context resources:(NSArray<NSDictionary *> *)resources;
- (TFAdmissionStartGuard)contextGuard:(NSString *)context;
- (id<TFAdmissionCancel>)request:(NSURLRequest *)request
	response:(void (^)(NSHTTPURLResponse *response, NSData *body))response
	failure:(dispatch_block_t)failure
	delegate:(TFAdmissionDelegate)delegate;
- (NSUInteger)completeContext:(NSString *)context generation:(NSUInteger)generation
	batch:(NSString *)batch results:(NSArray<NSDictionary *> *)results;
- (void)retire:(NSString *)context;
- (void)lifecycle:(BOOL)foreground;
- (void)close;
- (BOOL)isOwner;
@end

FOUNDATION_EXPORT NSString *const TFAdmissionGrantHeader;
FOUNDATION_EXPORT BOOL TFAdmissionHasReservedContext(NSString *url);
FOUNDATION_EXPORT NSDictionary<NSString *, NSString *> *TFAdmissionStripContext(NSString *url);
FOUNDATION_EXPORT NSString *TFAdmissionCleanURL(NSString *url);
FOUNDATION_EXPORT NSString *TFAdmissionOrigin(NSString *url);
FOUNDATION_EXPORT BOOL TFAdmissionStyleMatchesMap(NSString *url, NSString *mapId);
FOUNDATION_EXPORT BOOL TFAdmissionValidToken(id value);
FOUNDATION_EXPORT NSError *TFAdmissionSafeError(void);

NS_ASSUME_NONNULL_END
