#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>

NS_ASSUME_NONNULL_BEGIN

// Private preparation channel. Methods are serialized with admission on the main queue.
@interface TileflowNativeDocuments : NSObject <RCTBridgeModule, RCTInvalidating>
- (void)retireNativeContext:(NSString *)context;
- (void)retireProtectedDocuments;
@end

NS_ASSUME_NONNULL_END
