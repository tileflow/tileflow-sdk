#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTInvalidating.h>
#import <MapLibre/MapLibre.h>
#import <MapLibreReactNative/MLRNMapView.h>
#import <MapLibreReactNative/MLRNCamera.h>
#import <QuartzCore/QuartzCore.h>
#import "TFAdmissionEngine.h"
#import "TFNativeSurfaceState.h"
#import <cmath>

static void TFSurfaceInvalid(void) {
	@throw [NSException exceptionWithName:@"TFNativeSurfaceInvalid" reason:@"Native surface operation failed." userInfo:nil];
}
static void TFSurfaceReject(RCTPromiseRejectBlock reject) { reject(@"NATIVE_SURFACE_UNAVAILABLE", @"Native surface operation failed.", nil); }
static NSUInteger TFSurfaceInteger(id value) {
	if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) TFSurfaceInvalid();
	double number = [value doubleValue];
	if (!std::isfinite(number) || number < 1 || number > 9007199254740991.0 || std::floor(number) != number) TFSurfaceInvalid();
	return (NSUInteger)number;
}
static double TFSurfaceNumber(id value, double minimum, double maximum) {
	if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) TFSurfaceInvalid();
	double number = [value doubleValue];
	if (!std::isfinite(number) || number < minimum || number > maximum) TFSurfaceInvalid();
	return number;
}
static NSDictionary *TFSurfaceView(id value) {
	if (![value isKindOfClass:NSDictionary.class] || [value count] != 4) TFSurfaceInvalid();
	for (id key in value) if (![@[@"center", @"zoom", @"bearing", @"pitch"] containsObject:key]) TFSurfaceInvalid();
	id center = value[@"center"];
	if (![center isKindOfClass:NSArray.class] || [center count] != 2) TFSurfaceInvalid();
	return @{@"center": @[@(TFSurfaceNumber(center[0], -180, 180)), @(TFSurfaceNumber(center[1], -90, 90))],
		@"zoom": @(TFSurfaceNumber(value[@"zoom"], 0, 24)), @"bearing": @(TFSurfaceNumber(value[@"bearing"], -180, 180)),
		@"pitch": @(TFSurfaceNumber(value[@"pitch"], 0, 85))};
}
static MLRNMapView *TFSurfaceMap(UIView *root) {
	NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:root];
	MLRNMapView *found = nil; NSUInteger visited = 0;
	while (queue.count) {
		if (++visited > 1024) TFSurfaceInvalid();
		UIView *view = queue.firstObject; [queue removeObjectAtIndex:0];
		if ([view isKindOfClass:MLRNMapView.class]) {
			if (found) TFSurfaceInvalid(); found = (MLRNMapView *)view;
		} else {
			if (queue.count + view.subviews.count > 1024) TFSurfaceInvalid();
			[queue addObjectsFromArray:view.subviews];
		}
	}
	if (!found) TFSurfaceInvalid();
	return found;
}

@interface TFSurfaceLayoutProbe : UIView
@property (nonatomic, copy) dispatch_block_t changed;
@end
@implementation TFSurfaceLayoutProbe
- (void)layoutSubviews { [super layoutSubviews]; if (self.changed) self.changed(); }
- (void)didMoveToWindow { [super didMoveToWindow]; if (self.changed) self.changed(); }
@end

@interface TFSurfaceAttachment : NSObject <MLNMapViewDelegate>
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, strong) UIView *root;
@property (nonatomic, strong) MLRNMapView *map;
@property (nonatomic, weak) id<MLNMapViewDelegate> previous;
@property (nonatomic, strong) TFSurfaceLayoutProbe *probe;
@property (nonatomic, strong) TFNativeSurfaceState *state;
@property (nonatomic, copy) NSString *token;
@property (nonatomic, strong, nullable) NSArray *layoutSnapshot;
@property (nonatomic, strong) NSMutableArray<dispatch_block_t> *detached;
@property (nonatomic, copy, nullable) dispatch_block_t deadline;
@property (nonatomic, copy, nullable) dispatch_block_t layoutCancel;
@property (nonatomic) BOOL retiring;
@property (nonatomic) BOOL foreground;
@property (nonatomic) BOOL repaint;
@property (nonatomic) BOOL observing;
- (void)attach;
- (void)retire;
- (BOOL)owns;
- (MLNStyle *)style;
- (NSDictionary *)view;
- (void)sampleLayout;
@end

@implementation TFSurfaceAttachment
- (BOOL)owns {
	if (self.retiring || self.map.delegate != self) return NO;
	@try { return TFSurfaceMap(self.root) == self.map; }
	@catch (__unused NSException *exception) { return NO; }
}
- (NSString *)marker { return [@"__tileflow_native_style_" stringByAppendingString:self.token ?: @""]; }
- (MLNStyle *)style { MLNStyle *style = self.map.style; return [style layerWithIdentifier:self.marker] ? style : nil; }
- (NSDictionary *)view {
	CLLocationCoordinate2D center = self.map.centerCoordinate;
	double longitude = std::fmod(center.longitude + 540, 360) - 180;
	double bearing = std::fmod(self.map.direction + 540, 360) - 180;
	return @{@"center": @[@(longitude), @(center.latitude)], @"zoom": @(self.map.zoomLevel), @"bearing": @(bearing), @"pitch": @(self.map.camera.pitch)};
}
- (void)attach {
	self.token = @""; self.detached = [NSMutableArray array]; self.previous = self.map.delegate;
	if ([self.previous isKindOfClass:TFSurfaceAttachment.class]) TFSurfaceInvalid();
	self.map.delegate = self;
	[self.map addObserver:self forKeyPath:@"delegate" options:0 context:(__bridge void *)self]; self.observing = YES;
	TFSurfaceLayoutProbe *probe = [[TFSurfaceLayoutProbe alloc] initWithFrame:self.root.bounds];
	probe.userInteractionEnabled = NO; probe.accessibilityElementsHidden = YES; probe.alpha = 0;
	probe.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
	__weak TFSurfaceAttachment *weakSelf = self;
	probe.changed = ^{
		TFSurfaceAttachment *owner = weakSelf;
		if (!owner) return;
		if (owner.retiring && !owner.root.window) {
			NSArray *callbacks = [owner.detached copy]; [owner.detached removeAllObjects];
			owner.probe.changed = nil; [owner.probe removeFromSuperview];
			for (dispatch_block_t callback in callbacks) callback();
		} else [owner sampleLayout];
	};
	self.probe = probe; [self.root addSubview:probe]; [self sampleLayout];
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
	if (context == (__bridge void *)self && object == self.map) {
		if (!self.retiring && self.map.delegate != self) [self.state fail];
		return;
	}
	[super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}
- (void)sampleLayout {
	if (self.retiring) return;
	NSArray *snapshot = @[@(self.root.bounds.size.width), @(self.root.bounds.size.height), @(self.map.bounds.size.width), @(self.map.bounds.size.height),
		@(self.root.frame.origin.x), @(self.root.frame.origin.y), @(self.root.window && self.map.window && self.foreground)];
	if ([snapshot isEqual:self.layoutSnapshot]) return;
	self.layoutSnapshot = snapshot;
	BOOL visible = [snapshot.lastObject boolValue];
	for (NSUInteger index = 0; index < 4; index++) visible = visible && [snapshot[index] doubleValue] > 0;
	[self.state layout:visible];
}
- (void)retire {
	if (self.retiring) return;
	self.retiring = YES; [self.state close];
	if (self.deadline) dispatch_block_cancel(self.deadline); self.deadline = nil;
	if (self.layoutCancel) self.layoutCancel(); self.layoutCancel = nil;
	if (self.observing) { [self.map removeObserver:self forKeyPath:@"delegate" context:(__bridge void *)self]; self.observing = NO; }
	if (self.map.delegate == self) self.map.delegate = self.previous;
	if (!self.root.window && self.probe.changed) self.probe.changed();
}
- (BOOL)respondsToSelector:(SEL)selector { return [super respondsToSelector:selector] || [self.previous respondsToSelector:selector]; }
- (id)forwardingTargetForSelector:(SEL)selector { return [self.previous respondsToSelector:selector] ? self.previous : [super forwardingTargetForSelector:selector]; }
- (void)mapView:(MLNMapView *)mapView didFinishLoadingStyle:(MLNStyle *)style {
	if ([self owns] && style == self.style) [self.state loaded:self.token identity:style];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapView:mapView didFinishLoadingStyle:style];
}
- (void)mapViewWillStartRenderingFrame:(MLNMapView *)mapView {
	if ([self owns]) { [self sampleLayout]; [self.state frameStart:self.style]; }
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewWillStartRenderingFrame:mapView];
}
- (void)mapViewDidFinishRenderingMap:(MLNMapView *)mapView fullyRendered:(BOOL)fully {
	if ([self owns]) [self.state mapRendered:self.style fully:fully];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingMap:mapView fullyRendered:fully];
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fully {
	if ([self owns]) [self.state frameEnd:self.style fully:fully];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully];
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fully frameEncodingTime:(double)encoding frameRenderingTime:(double)rendering {
	if ([self owns]) [self.state frameEnd:self.style fully:fully];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully frameEncodingTime:encoding frameRenderingTime:rendering];
	else if ([self.previous respondsToSelector:@selector(mapViewDidFinishRenderingFrame:fullyRendered:)]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully];
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fully renderingStats:(MLNRenderingStats *)stats {
	if ([self owns]) [self.state frameEnd:self.style fully:fully];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully renderingStats:stats];
	else if ([self.previous respondsToSelector:@selector(mapViewDidFinishRenderingFrame:fullyRendered:)]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully];
}
- (void)mapView:(MLNMapView *)mapView regionWillChangeWithReason:(MLNCameraChangeReason)reason animated:(BOOL)animated {
	MLNCameraChangeReason gestures = MLNCameraChangeReasonResetNorth | MLNCameraChangeReasonGesturePan | MLNCameraChangeReasonGesturePinch |
		MLNCameraChangeReasonGestureRotate | MLNCameraChangeReasonGestureZoomIn | MLNCameraChangeReasonGestureZoomOut |
		MLNCameraChangeReasonGestureOneFingerZoom | MLNCameraChangeReasonGestureTilt;
	if ([self owns]) { if (reason & gestures) [self.state gestureStart:self.view]; else [self.state gestureEnd:self.view]; }
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapView:mapView regionWillChangeWithReason:reason animated:animated];
	else if ([self.previous respondsToSelector:@selector(mapView:regionWillChangeAnimated:)]) [self.previous mapView:mapView regionWillChangeAnimated:animated];
}
- (void)mapView:(MLNMapView *)mapView regionIsChangingWithReason:(MLNCameraChangeReason)reason {
	if ([self owns]) [self.state gestureChange:self.view];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapView:mapView regionIsChangingWithReason:reason];
	else if ([self.previous respondsToSelector:@selector(mapViewRegionIsChanging:)]) [self.previous mapViewRegionIsChanging:mapView];
}
- (void)mapView:(MLNMapView *)mapView regionDidChangeWithReason:(MLNCameraChangeReason)reason animated:(BOOL)animated {
	if ([self owns]) [self.state gestureEnd:self.view];
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapView:mapView regionDidChangeWithReason:reason animated:animated];
	else if ([self.previous respondsToSelector:@selector(mapView:regionDidChangeAnimated:)]) [self.previous mapView:mapView regionDidChangeAnimated:animated];
}
- (NSString *)description { return @"TFSurfaceAttachment"; }
@end

@interface TileflowNativeSurface : RCTEventEmitter <RCTBridgeModule, RCTInvalidating>
@property (nonatomic, strong) NSMutableDictionary<NSString *, TFSurfaceAttachment *> *surfaces;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, TFSurfaceLayoutProbe *> *rootRetirements;
@property (nonatomic) BOOL invalidated;
@property (nonatomic) BOOL observing;
@end
@implementation TileflowNativeSurface
RCT_EXPORT_MODULE(TileflowNativeSurface)
@synthesize viewRegistry_DEPRECATED = _viewRegistry_DEPRECATED;
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"TileflowNativeSurfaceEvent"]; }
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }
- (instancetype)init {
	if ((self = [super init])) {
		_surfaces = [NSMutableDictionary dictionary]; _rootRetirements = [NSMutableDictionary dictionary];
		[NSNotificationCenter.defaultCenter addObserver:self selector:@selector(background:) name:UIApplicationWillResignActiveNotification object:nil];
		[NSNotificationCenter.defaultCenter addObserver:self selector:@selector(foreground:) name:UIApplicationDidBecomeActiveNotification object:nil];
	}
	return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (TFSurfaceAttachment *)current:(NSString *)identifier allowFailed:(BOOL)allowFailed {
	TFSurfaceAttachment *surface = self.surfaces[identifier];
	if (self.invalidated || !surface || ![surface owns] || (!allowFailed && !surface.state.active)) TFSurfaceInvalid();
	return surface;
}
RCT_REMAP_METHOD(attachSurface, attachSurfaceWithTag:(NSNumber *)tag resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceInteger(tag);
		if (self.invalidated || !self.observing || !self.viewRegistry_DEPRECATED) TFSurfaceInvalid();
		[self.viewRegistry_DEPRECATED addUIBlock:^(RCTViewRegistry *registry) {
			@try {
				if (self.invalidated || self.surfaces.count >= 16) TFSurfaceInvalid();
				UIView *root = [registry viewForReactTag:tag];
				if (!root || !root.window) TFSurfaceInvalid();
				MLRNMapView *map = TFSurfaceMap(root);
				for (TFSurfaceAttachment *existing in self.surfaces.allValues) if (existing.map == map) TFSurfaceInvalid();
				TFSurfaceAttachment *surface = [TFSurfaceAttachment new];
				surface.identifier = NSUUID.UUID.UUIDString; surface.root = root; surface.map = map;
				surface.foreground = UIApplication.sharedApplication.applicationState == UIApplicationStateActive;
				__weak TileflowNativeSurface *weakSelf = self;
				__weak TFSurfaceAttachment *weakSurface = surface;
				surface.state = [[TFNativeSurfaceState alloc] initWithSurface:surface.identifier emit:^(NSDictionary *event) {
					TileflowNativeSurface *owner = weakSelf; TFSurfaceAttachment *attachment = weakSurface;
					if (!attachment) return;
					if ([event[@"kind"] isEqual:@"render"] && attachment.deadline) { dispatch_block_cancel(attachment.deadline); attachment.deadline = nil; }
					if (!owner || owner.invalidated || !owner.observing) { [attachment.state close]; return; }
					[owner sendEventWithName:@"TileflowNativeSurfaceEvent" body:event];
				}];
				self.surfaces[surface.identifier] = surface;
				@try { [surface attach]; } @catch (NSException *exception) { [surface retire]; @throw; }
				resolve(@{@"surface": surface.identifier});
			} @catch (NSException *exception) { TFSurfaceReject(reject); }
		}];
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(expectStyle, expectSurface:(NSString *)identifier style:(NSString *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:YES];
		[surface.state expect:token]; surface.token = token;
		if (surface.deadline) dispatch_block_cancel(surface.deadline);
		__weak TFSurfaceAttachment *weakSurface = surface;
		dispatch_block_t deadline = dispatch_block_create((dispatch_block_flags_t)0, ^{
			TFSurfaceAttachment *current = weakSurface;
			if (current && !current.retiring && [current.token isEqual:token]) [current.state fail];
		});
		surface.deadline = deadline;
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), deadline);
		resolve(@{@"accepted": @YES});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(acknowledgeSurface, acknowledgeSurface:(NSString *)identifier sequence:(NSNumber *)sequence resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try { if (!TFAdmissionValidToken(identifier)) TFSurfaceInvalid(); [self.surfaces[identifier].state acknowledge:TFSurfaceInteger(sequence)]; resolve(@{@"acknowledged": @YES}); }
	@catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(commitLayout, commitSurface:(NSString *)identifier style:(NSString *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:NO];
		if (surface.layoutCancel) TFSurfaceInvalid();
		__block BOOL finished = NO;
		void (^complete)(BOOL) = ^(BOOL success) {
			if (finished) return; finished = YES; surface.layoutCancel = nil;
			@try {
				if (!success || [self current:identifier allowFailed:NO] != surface || ![surface.token isEqual:token]) TFSurfaceInvalid();
				[surface sampleLayout]; resolve(@{@"layout": @([surface.state commit:token])});
			} @catch (NSException *exception) { TFSurfaceReject(reject); }
		};
		surface.layoutCancel = ^{ complete(NO); };
		[CATransaction begin];
		[CATransaction setCompletionBlock:^{ complete(YES); }];
		[surface.root setNeedsLayout]; [surface.root layoutIfNeeded];
		[CATransaction commit];
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(requestFrame, requestFrameForSurface:(NSString *)identifier style:(NSString *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:NO];
		if (![surface.token isEqual:token]) TFSurfaceInvalid();
		MLNStyleLayer *layer = [surface.style layerWithIdentifier:surface.marker];
		if (![layer isKindOfClass:MLNBackgroundStyleLayer.class]) TFSurfaceInvalid();
		surface.repaint = !surface.repaint;
		((MLNBackgroundStyleLayer *)layer).backgroundOpacity = [NSExpression expressionForConstantValue:surface.repaint ? @0 : @0.0001];
		resolve(@{@"requested": @YES});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(applyCamera, applyCameraForSurface:(NSString *)identifier sequence:(NSNumber *)sequence view:(NSDictionary *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:NO];
		NSDictionary *target = TFSurfaceView(input); NSUInteger command = TFSurfaceInteger(sequence);
		if (![surface.state beginCommand:command]) TFSurfaceInvalid();
		id camera = surface.map.reactCamera;
		if (![camera isKindOfClass:MLRNCamera.class] || ((MLRNCamera *)camera).map != surface.map) TFSurfaceInvalid();
		NSUInteger cameras = 0;
		for (UIView *child in surface.map.reactSubviews) if ([child isKindOfClass:MLRNCamera.class]) cameras++;
		if (cameras != 1) TFSurfaceInvalid();
		// The pinned iOS CameraUpdateItem computes altitude before applying a changed pitch.
		// Apply center/bearing/pitch first, then compute the exact zoom at that pitch.
		NSMutableDictionary *pitchStop = [target mutableCopy];
		[pitchStop removeObjectForKey:@"zoom"]; pitchStop[@"duration"] = @0;
		[camera handleImperativeStop:pitchStop];
		NSMutableDictionary *stop = [target mutableCopy]; stop[@"duration"] = @0;
		[camera handleImperativeStop:stop];
		NSDictionary *actual = surface.view;
		for (NSString *key in @[@"zoom", @"pitch"]) if (std::abs([actual[key] doubleValue] - [target[key] doubleValue]) > 0.000001) TFSurfaceInvalid();
		for (NSString *key in @[@"bearing"]) if (std::abs(std::fmod([actual[key] doubleValue] - [target[key] doubleValue] + 540, 360) - 180) > 0.000001) TFSurfaceInvalid();
		if (std::abs(std::fmod([actual[@"center"][0] doubleValue] - [target[@"center"][0] doubleValue] + 540, 360) - 180) > 0.000001 ||
			std::abs([actual[@"center"][1] doubleValue] - [target[@"center"][1] doubleValue]) > 0.000001 || [self current:identifier allowFailed:NO] != surface) TFSurfaceInvalid();
		resolve(@{@"command": @(command), @"view": target});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(cancelCamera, cancelCameraForSurface:(NSString *)identifier sequence:(NSNumber *)sequence resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try { if (!TFAdmissionValidToken(identifier)) TFSurfaceInvalid(); [self.surfaces[identifier].state cancelCommand:TFSurfaceInteger(sequence)]; resolve(@{@"cancelled": @YES}); }
	@catch (NSException *exception) { TFSurfaceReject(reject); }
}
- (void)retire:(TFSurfaceAttachment *)surface resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {
	[surface retire];
	if (!surface.root.window) { [self.surfaces removeObjectForKey:surface.identifier]; resolve(@{@"detached": @YES}); return; }
	if (surface.detached.count >= 16) TFSurfaceInvalid();
	__block BOOL completed = NO;
	NSString *identifier = [surface.identifier copy];
	__weak TileflowNativeSurface *weakSelf = self;
	__weak TFSurfaceAttachment *weakSurface = surface;
	[surface.detached addObject:^{
		TileflowNativeSurface *owner = weakSelf;
		TFSurfaceAttachment *attachment = weakSurface;
		if (!owner || !attachment) return;
		TFSurfaceAttachment *registered = owner.surfaces[identifier];
		if (registered && registered != attachment) return;
		if (registered == attachment) [owner.surfaces removeObjectForKey:identifier];
		if (!completed) { completed = YES; resolve(@{@"detached": @YES}); }
	}];
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
		if (!completed) { completed = YES; TFSurfaceReject(reject); }
	});
}
RCT_REMAP_METHOD(retireSurface, retireSurfaceWithIdentifier:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (!TFAdmissionValidToken(identifier)) TFSurfaceInvalid();
		TFSurfaceAttachment *surface = self.surfaces[identifier];
		if (!surface) { resolve(@{@"detached": @YES}); return; }
		[self retire:surface resolver:resolve rejecter:reject];
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(retireRoot, retireRootWithTag:(NSNumber *)tag resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceInteger(tag);
		if (!self.viewRegistry_DEPRECATED) TFSurfaceInvalid();
		[self.viewRegistry_DEPRECATED addUIBlock:^(RCTViewRegistry *registry) {
			@try {
				UIView *root = [registry viewForReactTag:tag];
				if (!root || !root.window) { resolve(@{@"detached": @YES}); return; }
				for (TFSurfaceAttachment *surface in self.surfaces.allValues) if (surface.root == root) { [self retire:surface resolver:resolve rejecter:reject]; return; }
				if (self.rootRetirements.count >= 16 || self.rootRetirements[tag]) TFSurfaceInvalid();
				TFSurfaceLayoutProbe *probe = [[TFSurfaceLayoutProbe alloc] initWithFrame:CGRectZero];
				probe.userInteractionEnabled = NO; probe.alpha = 0;
				__block BOOL completed = NO;
				__weak TileflowNativeSurface *weakSelf = self;
				__weak TFSurfaceLayoutProbe *weakProbe = probe;
				probe.changed = ^{
					if (root.window) return;
					[weakSelf.rootRetirements removeObjectForKey:tag]; weakProbe.changed = nil; [weakProbe removeFromSuperview];
					if (!completed) { completed = YES; resolve(@{@"detached": @YES}); }
				};
				self.rootRetirements[tag] = probe; [root addSubview:probe];
				dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ if (!completed) { completed = YES; TFSurfaceReject(reject); } });
			} @catch (NSException *exception) { TFSurfaceReject(reject); }
		}];
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
- (void)background:(NSNotification *)notification { for (TFSurfaceAttachment *surface in self.surfaces.allValues) { surface.foreground = NO; [surface sampleLayout]; } }
- (void)foreground:(NSNotification *)notification { for (TFSurfaceAttachment *surface in self.surfaces.allValues) { surface.foreground = YES; [surface sampleLayout]; } }
- (void)invalidate {
	[NSNotificationCenter.defaultCenter removeObserver:self];
	dispatch_async(dispatch_get_main_queue(), ^{ self.invalidated = YES; for (TFSurfaceAttachment *surface in self.surfaces.allValues) [surface retire]; });
	[super invalidate];
}
@end
