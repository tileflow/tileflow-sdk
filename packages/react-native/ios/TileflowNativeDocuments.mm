#import "TileflowNativeDocuments.h"
#import "TileflowNativeAdmission.h"
#import "TFNativeDocumentRegistry.h"
#import "TFAdmissionNetwork.h"
#import <React/RCTBridge.h>
#import <UIKit/UIKit.h>
#import <atomic>
#import <cmath>

@interface TileflowNativeDocuments () {
	std::atomic_bool _invalidated;
}
@property (nonatomic, strong, nullable) TFNativeDocumentRegistry *registry;
@property (nonatomic, strong, nullable) TFAdmissionURLSessionNetwork *network;
@end

@implementation TileflowNativeDocuments
RCT_EXPORT_MODULE(TileflowNativeDocuments)
@synthesize bridge = _bridge;
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init {
	if ((self = [super init])) {
		_invalidated.store(false);
		NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
		[center addObserver:self selector:@selector(background:) name:UIApplicationWillResignActiveNotification object:nil];
		[center addObserver:self selector:@selector(foreground:) name:UIApplicationDidBecomeActiveNotification object:nil];
	}
	return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (TFNativeDocumentRegistry *)ensureRegistry {
	if (_invalidated.load()) [self invalid];
	if (!self.registry) {
		NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
		configuration.protocolClasses = @[];
		configuration.URLCache = nil;
		configuration.HTTPCookieStorage = nil;
		configuration.URLCredentialStorage = nil;
		configuration.HTTPShouldSetCookies = NO;
		configuration.HTTPAdditionalHeaders = nil;
		configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
		TFAdmissionURLSessionNetwork *network = [[TFAdmissionURLSessionNetwork alloc] initWithConfiguration:configuration followsRedirects:NO responseByteLimit:8388608 queueDepth:16 concurrency:4];
		self.network = network;
		self.registry = [[TFNativeDocumentRegistry alloc] initWithScheduler:[TFContinuousAdmissionScheduler new] load:^id<TFAdmissionCancel>(NSURLRequest *request, TFNativeDocumentScope *scope, TFAdmissionStartGuard guard, TFAdmissionNetworkCompletion completion) {
			if (scope) return scope.load(request, completion);
			return [network start:request mayStart:guard completion:completion];
		}];
		[self.registry lifecycle:UIApplication.sharedApplication.applicationState == UIApplicationStateActive];
	}
	return self.registry;
}
RCT_REMAP_METHOD(openDocument, openDocumentURL:(NSString *)url maximumBytes:(double)maximumBytes installation:(NSString *)installation context:(NSString *)context resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (_invalidated.load() || !std::isfinite(maximumBytes) || std::floor(maximumBytes) != maximumBytes || maximumBytes < 1 || maximumBytes > 8388608 ||
			(installation == nil) != (context == nil)) [self invalid];
		TFAdmissionCleanURL(url);
		TFNativeDocumentScope *scope = nil;
		if (installation) {
			if (!TFAdmissionValidToken(installation) || !TFAdmissionValidToken(context)) [self invalid];
			TileflowNativeAdmission *admission = [self.bridge moduleForClass:TileflowNativeAdmission.class];
			if (!admission) [self invalid];
			scope = [admission documentScopeForInstallation:installation context:context documents:self];
			if (!scope) [self invalid];
		}
		NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:url]];
		NSString *identifier = [[self ensureRegistry] open:request maximumBytes:(NSUInteger)maximumBytes scope:scope];
		resolve(@{@"document": identifier});
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(documentResponse, responseDocument:(NSString *)document resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (_invalidated.load() || !TFAdmissionValidToken(document) || !self.registry) [self invalid];
		[self.registry response:document completion:^(NSDictionary *header) {
			if (!header || self->_invalidated.load()) [self reject:reject];
			else resolve(header);
		}];
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(documentChunk, chunkDocument:(NSString *)document maximumBytes:(double)maximumBytes resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (_invalidated.load() || !TFAdmissionValidToken(document) || !self.registry || !std::isfinite(maximumBytes) ||
			std::floor(maximumBytes) != maximumBytes || maximumBytes < 1 || maximumBytes > 65536) [self invalid];
		resolve([self.registry chunk:document maximumBytes:(NSUInteger)maximumBytes]);
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(cancelDocument, cancelDocumentID:(NSString *)document resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (!TFAdmissionValidToken(document)) [self invalid];
		[self.registry cancel:document];
		resolve(@{@"cancelled": @YES});
	} @catch (NSException *exception) { [self reject:reject]; }
}
- (void)retireNativeContext:(NSString *)context { [self.registry retireContext:context]; }
- (void)retireProtectedDocuments { [self.registry retireProtected]; }
- (void)background:(NSNotification *)notification { [self.registry lifecycle:NO]; }
- (void)foreground:(NSNotification *)notification { if (!_invalidated.load()) [self.registry lifecycle:YES]; }
- (void)invalidate {
	_invalidated.store(true);
	[NSNotificationCenter.defaultCenter removeObserver:self];
	dispatch_async(dispatch_get_main_queue(), ^{ [self.registry close]; [self.network close]; });
}
- (void)reject:(RCTPromiseRejectBlock)reject { reject(@"NATIVE_DOCUMENT_UNAVAILABLE", @"Native document acquisition failed.", nil); }
- (void)invalid { @throw [NSException exceptionWithName:@"TFNativeDocumentInvalid" reason:@"Native document acquisition failed." userInfo:nil]; }
- (NSString *)description { return @"TileflowNativeDocuments(redacted)"; }
@end
