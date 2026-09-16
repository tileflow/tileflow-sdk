#import "TFAdmissionInstallation.h"
#import <atomic>

static __weak TFAdmissionInstallation *TFActiveInstallation;

@interface TFNativeAdmissionURLProtocol () {
	std::atomic_bool _stopped;
}
@property (atomic, strong, nullable) id<TFAdmissionCancel> cancellation;
@end

@implementation TFNativeAdmissionURLProtocol
+ (TFAdmissionInstallation *)activeInstallation {
	@synchronized(self) { return TFActiveInstallation; }
}
+ (void)setActiveInstallation:(TFAdmissionInstallation *)installation {
	@synchronized(self) { TFActiveInstallation = installation; }
}
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
	// This class is installed only in MapLibre's configuration. Reserved
	// requests remain ours even after retirement or loss of installation.
	return TFAdmissionHasReservedContext(request.URL.absoluteString);
}
+ (BOOL)canInitWithTask:(NSURLSessionTask *)task {
	return [self canInitWithRequest:task.currentRequest ?: task.originalRequest];
}
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
	// Preserve the non-secret discriminator in MapLibre's cache identity.
	return request;
}
- (instancetype)initWithRequest:(NSURLRequest *)request cachedResponse:(NSCachedURLResponse *)cachedResponse client:(id<NSURLProtocolClient>)client {
	if ((self = [super initWithRequest:request cachedResponse:cachedResponse client:client])) _stopped.store(false);
	return self;
}
- (void)startLoading {
	TFAdmissionInstallation *installation = [TFNativeAdmissionURLProtocol activeInstallation];
	if (!installation) {
		if (!_stopped.exchange(true)) [self.client URLProtocol:self didFailWithError:TFAdmissionSafeError()];
		return;
	}
	__weak TFNativeAdmissionURLProtocol *weakSelf = self;
	self.cancellation = [installation.engine request:self.request
		response:^(NSHTTPURLResponse *response, NSData *body) {
			TFNativeAdmissionURLProtocol *strongSelf = weakSelf;
			if (!strongSelf || strongSelf->_stopped.load()) return;
			[strongSelf.client URLProtocol:strongSelf didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
			if (!strongSelf->_stopped.load()) [strongSelf.client URLProtocol:strongSelf didLoadData:body];
			if (!strongSelf->_stopped.load()) [strongSelf.client URLProtocolDidFinishLoading:strongSelf];
			strongSelf->_stopped.store(true); strongSelf.cancellation = nil;
		}
		failure:^{
			TFNativeAdmissionURLProtocol *strongSelf = weakSelf;
			if (strongSelf && !strongSelf->_stopped.exchange(true)) [strongSelf.client URLProtocol:strongSelf didFailWithError:TFAdmissionSafeError()];
			strongSelf.cancellation = nil;
		}
		delegate:^id<TFAdmissionCancel>(NSURLRequest *request, TFAdmissionNetworkCompletion completion) {
			return [installation delegateRequest:request mayStart:^BOOL {
				TFNativeAdmissionURLProtocol *strongSelf = weakSelf;
				return strongSelf && !strongSelf->_stopped.load() && [installation.engine isOwner];
			} completion:completion];
		}];
	if (_stopped.load()) [self.cancellation cancel];
}
- (void)stopLoading {
	_stopped.store(true);
	[self.cancellation cancel];
	self.cancellation = nil;
}
@end
