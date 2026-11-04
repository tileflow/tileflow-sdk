#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// MapLibre's Darwin API rejects invalid style expressions with an Objective-C exception.
FOUNDATION_EXPORT BOOL TFStylePerform(void (NS_NOESCAPE ^operation)(void));
FOUNDATION_EXPORT NSExpression *_Nullable TFStyleExpression(id json);
FOUNDATION_EXPORT NSPredicate *_Nullable TFStylePredicate(id json);
FOUNDATION_EXPORT BOOL TFStyleSetProperty(NSObject *layer, NSString *key, id value, BOOL expression);

NS_ASSUME_NONNULL_END
