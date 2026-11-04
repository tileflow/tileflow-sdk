#import "TileflowStyleBridge.h"
#import <MapLibre/MapLibre.h>

BOOL TFStylePerform(void (^operation)(void)) {
    @try {
        operation();
        return YES;
    } @catch (NSException *exception) {
        return NO;
    }
}

NSExpression *TFStyleExpression(id json) {
    @try {
        return [NSExpression expressionWithMLNJSONObject:json];
    } @catch (NSException *exception) {
        return nil;
    }
}

NSPredicate *TFStylePredicate(id json) {
    @try {
        return [NSPredicate predicateWithMLNJSONObject:json];
    } @catch (NSException *exception) {
        return nil;
    }
}

BOOL TFStyleSetProperty(NSObject *layer, NSString *key, id value, BOOL expression) {
    return TFStylePerform(^{
        NSExpression *property = expression ? [NSExpression expressionWithMLNJSONObject:value]
                                            : [NSExpression expressionForConstantValue:value];
        [layer setValue:property forKey:key];
    });
}
