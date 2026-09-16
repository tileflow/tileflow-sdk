#import "TFAdmissionEngine.h"

NS_ASSUME_NONNULL_BEGIN

@interface TFNativeDocumentScope : NSObject
@property (nonatomic, readonly, copy) NSString *context;
@property (nonatomic, readonly, copy) TFAdmissionStartGuard active;
@property (nonatomic, readonly, copy) TFAdmissionDelegate load;
- (instancetype)initWithContext:(NSString *)context active:(TFAdmissionStartGuard)active load:(TFAdmissionDelegate)load;
@end

typedef id<TFAdmissionCancel> _Nonnull (^TFNativeDocumentLoad)(NSURLRequest *request, TFNativeDocumentScope *_Nullable scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion);

// Calls are serialized on the native scheduler; only liveness is read by the network guard.
@interface TFNativeDocumentRegistry : NSObject
- (instancetype)initWithScheduler:(id<TFAdmissionScheduler>)scheduler load:(TFNativeDocumentLoad)load;
- (NSString *)open:(NSURLRequest *)request maximumBytes:(NSUInteger)maximumBytes scope:(nullable TFNativeDocumentScope *)scope;
- (void)response:(NSString *)identifier completion:(void (^)(NSDictionary *_Nullable header))completion;
- (NSDictionary *)chunk:(NSString *)identifier maximumBytes:(NSUInteger)maximumBytes;
- (void)cancel:(NSString *)identifier;
- (void)retireContext:(NSString *)context;
- (void)retireProtected;
- (void)lifecycle:(BOOL)foreground;
- (void)close;
@end

NS_ASSUME_NONNULL_END
