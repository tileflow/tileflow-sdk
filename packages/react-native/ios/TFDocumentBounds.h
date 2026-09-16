#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Private request metadata, never an HTTP header or URL parameter.
FOUNDATION_EXPORT void TFDocumentSetByteLimit(NSMutableURLRequest *request, NSUInteger maximumBytes);
FOUNDATION_EXPORT NSUInteger TFDocumentResponseByteLimit(NSURLRequest *request, NSUInteger transportMaximum);

NS_ASSUME_NONNULL_END
