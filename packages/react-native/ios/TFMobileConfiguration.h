#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Application data only; not a Map, session or transport identity. */
@interface TFMobileConfiguration : NSObject
@property(nonatomic, copy, readonly) NSString *apiOrigin;
@property(nonatomic, copy, readonly) NSString *credential;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
+ (nullable instancetype)parse:(nullable id)values error:(NSError *_Nullable *_Nullable)error;
+ (nullable instancetype)fromInfo:(nullable NSDictionary *)info
	localized:(nullable NSDictionary *)localized
	error:(NSError *_Nullable *_Nullable)error;
@end

/** A synchronized process snapshot. Source providers and React contexts are never retained. */
@interface TFMobileConfigurationCache : NSObject
- (nullable TFMobileConfiguration *)read:(TFMobileConfiguration *_Nullable (^)(void))source
	error:(NSError *_Nullable *_Nullable)error;
@end

NS_ASSUME_NONNULL_END
