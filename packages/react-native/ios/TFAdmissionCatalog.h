#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Resource identity only; the session controller remains the admission authority.
@interface TFAdmissionCatalog : NSObject
@property (nonatomic, readonly, copy) NSDictionary<NSString *, NSDictionary *> *resources;
- (instancetype)initWithResources:(NSArray<NSDictionary *> *)resources;
- (TFAdmissionCatalog *)extending:(NSArray<NSDictionary *> *)resources;
- (nullable NSDictionary *)find:(NSString *)url;
@end

NS_ASSUME_NONNULL_END
