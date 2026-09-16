#import "TFDocumentBounds.h"
#import <cmath>

static NSString *const TFDocumentLimitKey = @"dev.tileflow.native.document-byte-limit";
static void TFInvalidDocumentLimit(void) {
	@throw [NSException exceptionWithName:@"TFNativeDocumentInvalid" reason:@"Native document acquisition failed." userInfo:nil];
}
void TFDocumentSetByteLimit(NSMutableURLRequest *request, NSUInteger maximumBytes) {
	if (!request || !maximumBytes || maximumBytes > 8388608) TFInvalidDocumentLimit();
	[NSURLProtocol setProperty:@(maximumBytes) forKey:TFDocumentLimitKey inRequest:request];
}
NSUInteger TFDocumentResponseByteLimit(NSURLRequest *request, NSUInteger transportMaximum) {
	id value = [NSURLProtocol propertyForKey:TFDocumentLimitKey inRequest:request];
	if (!value) return transportMaximum;
	if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() ||
		!std::isfinite([value doubleValue]) || std::floor([value doubleValue]) != [value doubleValue] ||
		[value doubleValue] < 1 || [value doubleValue] > 8388608) TFInvalidDocumentLimit();
	return MIN(transportMaximum, [value unsignedIntegerValue]);
}
