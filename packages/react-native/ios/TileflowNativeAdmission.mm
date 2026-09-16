#import "TileflowNativeAdmission.h"
#import "TFAdmissionInstallation.h"
#import "TFAdmissionBootstrap.h"
#import "TFAdmissionNetwork.h"
#import <UIKit/UIKit.h>
#import <cmath>

@interface TileflowNativeAdmission ()
@property (nonatomic, nullable) TFAdmissionInstallation *installation;
@property (nonatomic, nullable) TFAdmissionBootstrap *bootstrapRequests;
@property (nonatomic, nullable) TFAdmissionURLSessionNetwork *bootstrapNetwork;
@property (nonatomic, nullable) NSString *lastRemoved;
@property (nonatomic, nullable) NSDictionary *lastRemoval;
@property (nonatomic) BOOL observing;
@property (nonatomic) BOOL invalidated;
@end

@implementation TileflowNativeAdmission
RCT_EXPORT_MODULE(TileflowNativeAdmission)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"TileflowNativeAdmissionEvent"]; }
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }
- (instancetype)init {
	if ((self = [super init])) {
		NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
		[center addObserver:self selector:@selector(background:) name:UIApplicationWillResignActiveNotification object:nil];
		[center addObserver:self selector:@selector(foreground:) name:UIApplicationDidBecomeActiveNotification object:nil];
	}
	return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }

RCT_REMAP_METHOD(install, installWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	BOOL started = NO;
	@try {
		if (self.invalidated || self.installation || !self.observing) [self invalid];
		started = YES;
		__weak TileflowNativeAdmission *weakSelf = self;
		self.installation = [[TFAdmissionInstallation alloc] initWithEmitter:^(NSDictionary *event) {
			TileflowNativeAdmission *strongSelf = weakSelf;
			if ([event[@"kind"] isEqual:@"retired"]) [strongSelf.bootstrapRequests retire:event[@"context"]];
			else if ([event[@"kind"] isEqual:@"ownershipLost"]) [strongSelf.bootstrapRequests close];
			else if ([event[@"kind"] isEqual:@"lifecycle"]) [strongSelf.bootstrapRequests lifecycle:[event[@"foreground"] boolValue]];
			if (!strongSelf || strongSelf.invalidated || !strongSelf.observing) [NSException raise:@"TFNativeAdmissionListener" format:@"Native admission listener is unavailable"];
			[strongSelf sendEventWithName:@"TileflowNativeAdmissionEvent" body:event];
		}];
		self.bootstrapNetwork = [self createBootstrapNetwork];
		if (!self.installation || !self.bootstrapNetwork) [self invalid];
		self.bootstrapRequests = [[TFAdmissionBootstrap alloc] initWithInstallation:self.installation.identifier scheduler:[TFContinuousAdmissionScheduler new]
			network:self.bootstrapNetwork owns:^BOOL { return [weakSelf.installation.engine isOwner]; }];
		if (!self.bootstrapRequests) [self invalid];
		[self.installation.engine lifecycle:UIApplication.sharedApplication.applicationState == UIApplicationStateActive];
		if (![self.installation.engine isOwner]) [self invalid];
		resolve(@{@"installation": self.installation.identifier});
	} @catch (NSException *exception) {
		// Do not roll back an existing installation rejected by the guard.
		if (started) {
			@try { [self shutdown]; } @catch (NSException *cleanupError) { /* No successful acknowledgement. */ }
		}
		[self reject:reject];
	}
}
- (TFAdmissionURLSessionNetwork *)createBootstrapNetwork {
	NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
	configuration.protocolClasses = @[];
	configuration.URLCache = nil; configuration.HTTPCookieStorage = nil; configuration.URLCredentialStorage = nil;
	configuration.HTTPShouldSetCookies = NO; configuration.HTTPAdditionalHeaders = nil;
	configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
	configuration.HTTPMaximumConnectionsPerHost = 4;
	return [[TFAdmissionURLSessionNetwork alloc] initWithConfiguration:configuration followsRedirects:NO responseByteLimit:65536 queueDepth:32 concurrency:4];
}
RCT_REMAP_METHOD(registerContext, registerInstallation:(NSString *)identifier registration:(NSDictionary *)registration resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFAdmissionInstallation *installation = [self current:identifier];
		if (![registration isKindOfClass:NSDictionary.class] || registration.count > 2) [self invalid];
		NSString *mapId = registration[@"mapId"] == NSNull.null ? nil : registration[@"mapId"];
		NSArray *resources = registration[@"resources"];
		if (![resources isKindOfClass:NSArray.class] || resources.count > 128) [self invalid];
		NSString *context = [installation.engine registerMap:mapId resources:resources];
		@try {
			if (!self.bootstrapRequests) [self invalid];
			[self.bootstrapRequests registerContext:context mapId:mapId];
		} @catch (NSException *exception) { [installation.engine retire:context]; @throw; }
		resolve(@{@"context": context, @"generation": @1});
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(retireContext, retireInstallation:(NSString *)identifier context:(NSString *)context resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (!TFAdmissionValidToken(context)) [self invalid];
		if ([self.installation.identifier isEqual:identifier]) {
			[self.bootstrapRequests retire:context]; [self.installation.engine retire:context];
		} else if (![self.lastRemoved isEqual:identifier]) [self invalid];
		resolve(@{@"retired": @YES});
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(bootstrap, bootstrapInstallation:(NSString *)identifier context:(NSString *)context request:(NSString *)request url:(NSString *)url credential:(NSString *)credential body:(NSString *)body resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		[self current:identifier];
		if (!self.bootstrapRequests) [self invalid];
		[self.bootstrapRequests startContext:context request:request url:url credential:credential body:body completion:^(NSDictionary *reply) {
			if (reply) resolve(reply);
			else reject(@"NATIVE_ADMISSION_UNAVAILABLE", @"Native resource admission failed", nil);
		}];
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(cancelBootstrap, cancelBootstrapInstallation:(NSString *)identifier context:(NSString *)context request:(NSString *)request resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (!TFAdmissionValidToken(context) || !TFAdmissionValidToken(request)) [self invalid];
		if ([self.installation.identifier isEqual:identifier]) [self.bootstrapRequests cancelContext:context request:request];
		else if (![self.lastRemoved isEqual:identifier]) [self invalid];
		resolve(@{@"cancelled": @YES});
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(completeBatch, completeInstallation:(NSString *)identifier context:(NSString *)context generation:(double)generation batch:(NSString *)batch results:(NSArray<NSDictionary *> *)results resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFAdmissionInstallation *installation = [self current:identifier];
		if (!TFAdmissionValidToken(context) || !TFAdmissionValidToken(batch) || generation != 1.0 || ![results isKindOfClass:NSArray.class] || results.count > 8) [self invalid];
		// Bound the envelope before the engine holds any authority. This data
		// is ephemeral bridge input, never a log, event, error or snapshot.
		if (![NSJSONSerialization isValidJSONObject:results]) [self invalid];
		NSData *wire = [NSJSONSerialization dataWithJSONObject:results options:0 error:nil];
		if (!wire || wire.length > 524288) [self invalid];
		NSUInteger accepted = [self.installation.engine completeContext:context generation:1 batch:batch results:results];
		resolve(@{@"accepted": @(accepted)});
	} @catch (NSException *exception) { [self reject:reject]; }
}
RCT_REMAP_METHOD(remove, removeInstallation:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (!self.installation && [self.lastRemoved isEqual:identifier]) { resolve(self.lastRemoval); return; }
		if (![self.installation.identifier isEqual:identifier]) [self invalid];
		resolve([self shutdown]);
	} @catch (NSException *exception) { [self reject:reject]; }
}
- (NSDictionary *)shutdown {
	if (!self.installation) return self.lastRemoval ?: @{@"removed": @NO, @"ownershipLost": @NO};
	[self.bootstrapRequests close]; [self.bootstrapNetwork close];
	NSDictionary *ack = [self.installation remove];
	self.lastRemoved = self.installation.identifier; self.lastRemoval = ack;
	self.installation = nil; self.bootstrapRequests = nil; self.bootstrapNetwork = nil;
	return ack;
}
- (TFAdmissionInstallation *)current:(NSString *)identifier {
	if (self.invalidated || ![self.installation.identifier isEqual:identifier] || ![self.installation.engine isOwner]) [self invalid];
	return self.installation;
}
- (void)background:(NSNotification *)notification { [self.installation.engine lifecycle:NO]; }
- (void)foreground:(NSNotification *)notification { [self.installation.engine lifecycle:YES]; }
- (void)invalidate {
	[NSNotificationCenter.defaultCenter removeObserver:self];
	dispatch_async(dispatch_get_main_queue(), ^{
		self.invalidated = YES;
		@try { [self shutdown]; } @catch (NSException *exception) { /* Retain failed cleanup for retry. */ }
	});
	[super invalidate];
}
- (void)reject:(RCTPromiseRejectBlock)reject { reject(@"NATIVE_ADMISSION_UNAVAILABLE", @"Native resource admission failed", nil); }
- (void)invalid { [NSException raise:@"TFNativeAdmissionInvalid" format:@"Invalid native admission"]; }
@end
