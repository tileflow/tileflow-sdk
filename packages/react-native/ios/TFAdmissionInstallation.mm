#import "TFAdmissionInstallation.h"
#import "TFAdmissionNetwork.h"
#import <MapLibre/MLNNetworkConfiguration.h>

@interface TFAdmissionInstallation ()
@property (nonatomic, readwrite) NSString *identifier;
@property (nonatomic, readwrite) TFAdmissionEngine *engine;
@property (nonatomic) MLNNetworkConfiguration *manager;
@property (nonatomic) NSURLSessionConfiguration *previous;
@property (nonatomic) NSURLSessionConfiguration *installed;
@property (nonatomic) NSArray<Class> *protocols;
@property (nonatomic) NSDictionary *additionalHeaders;
@property (nonatomic, nullable) id<MLNNetworkConfigurationDelegate> previousDelegate;
@property (nonatomic, nullable) TFAdmissionURLSessionNetwork *protectedNetwork;
@property (nonatomic) TFAdmissionURLSessionNetwork *previousNetwork;
@property (atomic) BOOL active;
@property (nonatomic, nullable) NSDictionary *removal;
@end

@implementation TFAdmissionInstallation
- (instancetype)initWithEmitter:(void (^)(NSDictionary *))emit {
	return [self initWithScheduler:[TFContinuousAdmissionScheduler new] network:nil emit:emit];
}
- (instancetype)initWithScheduler:(id<TFAdmissionScheduler>)scheduler network:(id<TFAdmissionNetwork>)network emit:(void (^)(NSDictionary *))emit {
	return [self initWithConfiguration:MLNNetworkConfiguration.sharedManager scheduler:scheduler network:network emit:emit];
}
- (instancetype)initWithConfiguration:(MLNNetworkConfiguration *)configuration scheduler:(id<TFAdmissionScheduler>)scheduler network:(id<TFAdmissionNetwork>)network emit:(void (^)(NSDictionary *))emit {
	if ((self = [super init])) {
		if ([TFNativeAdmissionURLProtocol activeInstallation]) [self invalid];
		_manager = configuration;
		_previous = _manager.sessionConfiguration;
		_previousDelegate = _manager.delegate;
		// A custom session factory bypasses sessionConfiguration.
		if (!_manager || !_previous || _previous.identifier || [_previousDelegate respondsToSelector:@selector(sessionForNetworkConfiguration:)] ||
			[_previous.protocolClasses containsObject:TFNativeAdmissionURLProtocol.class]) [self invalid];
		for (NSString *name in _previous.HTTPAdditionalHeaders) {
			if ([name caseInsensitiveCompare:TFAdmissionGrantHeader] == NSOrderedSame) [self invalid];
		}
		@try {
			_identifier = NSUUID.UUID.UUIDString;
			_installed = [_previous copy];
			_protocols = [@[TFNativeAdmissionURLProtocol.class] arrayByAddingObjectsFromArray:_previous.protocolClasses ?: @[]];
			_installed.protocolClasses = _protocols;
			_additionalHeaders = [_installed.HTTPAdditionalHeaders copy] ?: @{};
			_previousNetwork = [[TFAdmissionURLSessionNetwork alloc] initWithConfiguration:_previous followsRedirects:YES];
			if (!network) {
				NSURLSessionConfiguration *privateConfiguration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
				privateConfiguration.protocolClasses = @[];
				privateConfiguration.URLCache = nil;
				privateConfiguration.HTTPCookieStorage = nil;
				privateConfiguration.URLCredentialStorage = nil;
				privateConfiguration.HTTPShouldSetCookies = NO;
				privateConfiguration.HTTPAdditionalHeaders = nil;
				privateConfiguration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
				privateConfiguration.HTTPMaximumConnectionsPerHost = 1;
				_protectedNetwork = [[TFAdmissionURLSessionNetwork alloc] initWithConfiguration:privateConfiguration followsRedirects:NO];
				network = _protectedNetwork;
			}
			if (!network || !_previousNetwork) [self invalid];
			_active = YES;
			__weak TFAdmissionInstallation *weakSelf = self;
			_engine = [[TFAdmissionEngine alloc] initWithInstallation:_identifier scheduler:scheduler network:network
				owns:^BOOL { return [weakSelf ownsConfiguration]; } emit:emit];
			[TFNativeAdmissionURLProtocol setActiveInstallation:self];
			_manager.sessionConfiguration = _installed;
			if (![self ownsConfiguration]) [self invalid];
		} @catch (NSException *exception) {
			// A setter can mutate before throwing. Restore by identity, not
			// by whether its call returned, and never overwrite a later owner.
			@try { [self remove]; } @catch (NSException *cleanupError) {
				[self.engine close]; [self.protectedNetwork close]; [self.previousNetwork close];
			}
			self.active = NO;
			if ([TFNativeAdmissionURLProtocol activeInstallation] == self) [TFNativeAdmissionURLProtocol setActiveInstallation:nil];
			[self invalid];
		}
	}
	return self;
}
- (NSString *)description { return @"TFAdmissionInstallation(redacted)"; }
- (BOOL)matchesConfiguration {
	NSURLSessionConfiguration *current = self.manager.sessionConfiguration;
	return self.installed && current == self.installed && self.manager.delegate == self.previousDelegate &&
		[current.protocolClasses isEqual:self.protocols] && [(current.HTTPAdditionalHeaders ?: @{}) isEqual:self.additionalHeaders] &&
		[TFNativeAdmissionURLProtocol activeInstallation] == self;
}
- (BOOL)ownsConfiguration {
	@try { return self.active && [self matchesConfiguration]; }
	@catch (NSException *exception) { return NO; }
}
- (NSDictionary *)remove {
	if (self.removal) return self.removal;
	BOOL owned = [self matchesConfiguration];
	self.active = NO;
	[self.engine close];
	[self.protectedNetwork close]; [self.previousNetwork close];
	BOOL restored = NO;
	if (owned) {
		@try { self.manager.sessionConfiguration = self.previous; }
		@catch (NSException *exception) {
			if (self.manager.sessionConfiguration == self.installed) [self invalid];
		}
		NSURLSessionConfiguration *after = self.manager.sessionConfiguration;
		if (after == self.installed) [self invalid];
		restored = after == self.previous;
	}
	if ([TFNativeAdmissionURLProtocol activeInstallation] == self) [TFNativeAdmissionURLProtocol setActiveInstallation:nil];
	self.removal = @{@"removed": @(restored), @"ownershipLost": @(!restored)};
	return self.removal;
}
- (id<TFAdmissionCancel>)delegateRequest:(NSURLRequest *)request mayStart:(TFAdmissionStartGuard)guard completion:(TFAdmissionNetworkCompletion)completion {
	return [self.previousNetwork start:request mayStart:guard completion:completion];
}
- (void)invalid {
	@throw [NSException exceptionWithName:@"TFNativeAdmissionOwnership" reason:@"Native network ownership is unavailable" userInfo:nil];
}
@end
