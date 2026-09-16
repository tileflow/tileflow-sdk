#import "TFAdmissionDocumentScope.h"
#import <atomic>

@interface TFAdmissionDocumentOperation : NSObject <TFAdmissionCancel> {
	std::atomic_bool _finished;
}
@property (nonatomic, strong, nullable) id<TFAdmissionCancel> request;
@property (nonatomic, copy, nullable) TFAdmissionNetworkCompletion completion;
- (void)finish:(nullable NSHTTPURLResponse *)response body:(nullable NSData *)body;
@end
@implementation TFAdmissionDocumentOperation
- (instancetype)init { if ((self = [super init])) _finished.store(false); return self; }
- (void)finish:(NSHTTPURLResponse *)response body:(NSData *)body {
	if (_finished.exchange(true)) return;
	TFAdmissionNetworkCompletion completion = self.completion; self.completion = nil;
	if (completion) completion(response, body);
}
- (void)cancel {
	@try { [self.request cancel]; }
	@finally {
		// The admission network owns physical cleanup; this is the document's logical result.
		[self finish:nil body:nil];
	}
}
- (NSString *)description { return @"TFAdmissionDocumentOperation(redacted)"; }
@end

TFNativeDocumentScope *TFCreateAdmissionDocumentScope(TFAdmissionEngine *engine, NSString *context) {
	TFAdmissionStartGuard active = [engine contextGuard:context];
	return [[TFNativeDocumentScope alloc] initWithContext:context active:active load:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) {
		NSString *url = TFAdmissionCleanURL(request.URL.absoluteString);
		NSMutableURLRequest *tagged = [request mutableCopy];
		tagged.URL = [NSURL URLWithString:[url stringByAppendingFormat:@"%@__tf_native_context=%@", [url containsString:@"?"] ? @"&" : @"?", context]];
		TFAdmissionDocumentOperation *operation = [TFAdmissionDocumentOperation new];
		operation.completion = completion;
		operation.request = [engine request:tagged response:^(NSHTTPURLResponse *response, NSData *body) {
			[operation finish:response body:body];
		} failure:^{ [operation finish:nil body:nil]; } delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) {
			// Unprotected preparation uses the independent credential-free document channel.
			completion(nil, nil);
			return [TFAdmissionDocumentOperation new];
		}];
		return operation;
	}];
}
