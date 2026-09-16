#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// UI-queue confined. Native object identity, not a delayed JS callback, binds frame evidence.
@interface TFNativeSurfaceState : NSObject
@property (nonatomic, readonly) BOOL active;
@property (nonatomic, readonly) NSUInteger pendingCount;
@property (nonatomic, readonly, nullable) NSNumber *awaitingSequence;
- (instancetype)initWithSurface:(NSString *)surface emit:(void (^)(NSDictionary *event))emit;
- (void)expect:(NSString *)token;
- (void)layout:(BOOL)visible;
- (void)loaded:(NSString *)token identity:(id)identity;
- (NSUInteger)commit:(NSString *)token;
- (void)frameStart:(nullable id)identity;
- (void)mapRendered:(nullable id)identity fully:(BOOL)fully;
- (void)frameEnd:(nullable id)identity fully:(BOOL)fully;
- (BOOL)beginCommand:(NSUInteger)command;
- (void)cancelCommand:(NSUInteger)command;
- (void)gestureStart:(NSDictionary *)view;
- (void)gestureChange:(NSDictionary *)view;
- (void)gestureEnd:(NSDictionary *)view;
- (void)acknowledge:(NSUInteger)sequence;
- (void)fail;
- (void)close;
@end

NS_ASSUME_NONNULL_END
