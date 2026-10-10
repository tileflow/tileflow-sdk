#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTInvalidating.h>
#import <MapLibre/MapLibre.h>
#import <MapLibreReactNative/MLRNMapView.h>
#import <MapLibreReactNative/MLRNCamera.h>
#import <QuartzCore/QuartzCore.h>
#import <algorithm>
#import "TFAdmissionEngine.h"
#import "TFNativeSurfaceState.h"
#import "TFNativeTheme.h"
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
static MLRNCamera *TFSurfaceCamera(UIView *root, MLRNMapView *map) {
	NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:root];
	MLRNCamera *found = nil; NSUInteger visited = 0;
	while (queue.count) {
		if (++visited > 1024) TFSurfaceInvalid();
		UIView *view = queue.firstObject; [queue removeObjectAtIndex:0];
		if ([view isKindOfClass:MLRNCamera.class]) {
			if (found) TFSurfaceInvalid(); found = (MLRNCamera *)view;
		}
		if (queue.count + view.subviews.count > 1024) TFSurfaceInvalid();
		[queue addObjectsFromArray:view.subviews];
	}
	id registered = map.reactCamera;
	if (!found || ![registered isKindOfClass:MLRNCamera.class] || registered != found || ((MLRNCamera *)registered).map != map) TFSurfaceInvalid();
	return found;
}

// The view MapLibre draws into: the subview backed by a Metal (or OpenGL) layer.
static UIView *TFSurfaceRenderView(MLNMapView *map) {
	for (UIView *view in map.subviews) {
		NSString *name = NSStringFromClass(view.layer.class);
		if ([name containsString:@"Metal"] || [name containsString:@"EAGL"]) return view;
	}
	return nil;
}
// A snapshot of one frame over the rendering view. It keeps four ground points of that frame and
// follows them with the ground plane's projective transform while the camera moves.
@interface TFSurfaceCover : NSObject
@property (nonatomic, strong) UIView *view;
@property (nonatomic, copy) NSArray<NSValue *> *corners;
@property (nonatomic, copy) NSArray<NSValue *> *anchors;
@property (nonatomic) BOOL fading;
@end
@implementation TFSurfaceCover
@end
@interface TFSurfaceReveal : NSObject
@property (nonatomic) double duration;
@property (nonatomic, strong) NSMutableArray<TFSurfaceCover *> *covers;
@property (nonatomic, copy) RCTPromiseResolveBlock resolve;
@end
@implementation TFSurfaceReveal
@end

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
@property (nonatomic) BOOL observing;
@property (nonatomic, strong) NSMutableArray<TFSurfaceCover *> *covers;
@property (nonatomic, strong) NSMutableArray<TFSurfaceReveal *> *reveals;
@property (nonatomic, strong) NSMutableArray<TFSurfaceReveal *> *settling;
@property (nonatomic, copy, nullable) dispatch_block_t revealDeadline;
@property (nonatomic, copy, nullable) NSString *themedToken;
@property (nonatomic, strong) NSMutableDictionary<NSString *, MLNStyleLayer *> *themedLayers;
@property (nonatomic, strong) NSMutableDictionary<NSString *, UIImage *> *themedImages;
- (void)attach;
- (NSUInteger)applyThemeValues:(NSDictionary *)values;
- (void)retire;
- (BOOL)cover;
- (void)reveal:(double)duration resolve:(RCTPromiseResolveBlock)resolve;
- (void)discardCovers;
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
	self.covers = [NSMutableArray array]; self.reveals = [NSMutableArray array]; self.settling = [NSMutableArray array];
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
- (BOOL)cover {
	if (UIAccessibilityIsReduceMotionEnabled() || !self.foreground || !self.root.window || !self.style) return NO;
	for (TFSurfaceCover *existing in self.covers) if (!existing.fading) return YES;
	UIView *render = TFSurfaceRenderView(self.map);
	CGRect frame = render.frame;
	if (!render || frame.size.width < 1 || frame.size.height < 1 || self.covers.count >= 4) return NO;
	UIView *snapshot = [render snapshotViewAfterScreenUpdates:NO];
	if (!snapshot) return NO;
	snapshot.userInteractionEnabled = NO; snapshot.accessibilityElementsHidden = YES;
	snapshot.layer.anchorPoint = CGPointZero; snapshot.frame = frame;
	// Ground points below the horizon at any supported pitch, in map view coordinates.
	CGFloat width = frame.size.width, height = frame.size.height;
	NSMutableArray<NSValue *> *corners = [NSMutableArray array], *anchors = [NSMutableArray array];
	for (NSValue *value in @[[NSValue valueWithCGPoint:CGPointMake(width * 0.1, height * 0.45)], [NSValue valueWithCGPoint:CGPointMake(width * 0.9, height * 0.45)],
		[NSValue valueWithCGPoint:CGPointMake(width * 0.9, height * 0.9)], [NSValue valueWithCGPoint:CGPointMake(width * 0.1, height * 0.9)]]) {
		CGPoint point = value.CGPointValue;
		CLLocationCoordinate2D coordinate = [self.map convertPoint:CGPointMake(point.x + frame.origin.x, point.y + frame.origin.y) toCoordinateFromView:self.map];
		if (!std::isfinite(coordinate.latitude) || !std::isfinite(coordinate.longitude) || std::fabs(coordinate.latitude) > 90) return NO;
		[corners addObject:value];
		[anchors addObject:[NSValue valueWithBytes:&coordinate objCType:@encode(CLLocationCoordinate2D)]];
	}
	TFSurfaceCover *cover = [TFSurfaceCover new];
	cover.view = snapshot; cover.corners = corners; cover.anchors = anchors;
	// Newer covers go below older ones, which keep fading on top.
	[self.map insertSubview:snapshot aboveSubview:render];
	[self.covers addObject:cover];
	return YES;
}
- (void)followCovers {
	if (!self.covers.count) return;
	UIView *render = TFSurfaceRenderView(self.map);
	if (!render) return;
	CGPoint origin = render.frame.origin;
	for (TFSurfaceCover *cover in self.covers) {
		CGPoint from[4], to[4];
		for (int index = 0; index < 4; index++) {
			from[index] = cover.corners[index].CGPointValue;
			CLLocationCoordinate2D coordinate;
			[cover.anchors[index] getValue:&coordinate size:sizeof(coordinate)];
			CGPoint point = [self.map convertCoordinate:coordinate toPointToView:self.map];
			if (!std::isfinite(point.x) || !std::isfinite(point.y)) return;
			to[index] = CGPointMake(point.x - origin.x, point.y - origin.y);
		}
		double h[9];
		if (!TFThemeHomography(from, to, h)) continue;
		[CATransaction begin]; [CATransaction setDisableActions:YES];
		cover.view.layer.position = origin; cover.view.layer.transform = TFThemeTransform(h);
		[CATransaction commit];
	}
}
- (void)reveal:(double)duration resolve:(RCTPromiseResolveBlock)resolve {
	TFSurfaceReveal *reveal = [TFSurfaceReveal new];
	reveal.duration = duration; reveal.resolve = resolve; reveal.covers = [self.covers mutableCopy];
	if (!reveal.covers.count) { resolve(@{@"revealed": @YES}); return; }
	[self.reveals addObject:reveal];
	// Fades start on the next complete frame, or after ten seconds at most.
	if (!self.revealDeadline) {
		__weak TFSurfaceAttachment *weakSelf = self;
		dispatch_block_t deadline = dispatch_block_create((dispatch_block_flags_t)0, ^{ weakSelf.revealDeadline = nil; [weakSelf startReveals]; });
		self.revealDeadline = deadline;
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), deadline);
	}
	[self.map triggerRepaint];
}
- (void)startReveals {
	if (self.revealDeadline) { dispatch_block_cancel(self.revealDeadline); self.revealDeadline = nil; }
	NSArray<TFSurfaceReveal *> *reveals = [self.reveals copy];
	[self.reveals removeAllObjects];
	for (TFSurfaceReveal *reveal in reveals) {
		for (TFSurfaceCover *cover in reveal.covers) {
			if (cover.fading) continue;
			cover.fading = YES;
			__weak TFSurfaceAttachment *weakSelf = self;
			[UIView animateWithDuration:reveal.duration / 1000.0 delay:0 options:UIViewAnimationOptionCurveEaseInOut | UIViewAnimationOptionAllowUserInteraction
				animations:^{ cover.view.alpha = 0; } completion:^(__unused BOOL finished) { [weakSelf removeCover:cover]; }];
		}
		[self settle:reveal];
	}
}
- (void)removeCover:(TFSurfaceCover *)cover {
	[cover.view.layer removeAllAnimations]; [cover.view removeFromSuperview];
	[self.covers removeObject:cover];
	for (TFSurfaceReveal *reveal in [self.settling copy]) [self settle:reveal];
}
// A reveal resolves once every cover that existed when it was requested is gone.
- (void)settle:(TFSurfaceReveal *)reveal {
	for (TFSurfaceCover *cover in reveal.covers) if ([self.covers containsObject:cover]) {
		if (![self.settling containsObject:reveal]) [self.settling addObject:reveal];
		return;
	}
	[self.settling removeObject:reveal];
	if (reveal.resolve) { RCTPromiseResolveBlock resolve = reveal.resolve; reveal.resolve = nil; resolve(@{@"revealed": @YES}); }
}
- (void)discardCovers {
	if (self.revealDeadline) { dispatch_block_cancel(self.revealDeadline); self.revealDeadline = nil; }
	for (TFSurfaceCover *cover in [self.covers copy]) { [cover.view.layer removeAllAnimations]; [cover.view removeFromSuperview]; }
	[self.covers removeAllObjects];
	NSArray *reveals = [self.reveals arrayByAddingObjectsFromArray:self.settling];
	[self.reveals removeAllObjects]; [self.settling removeAllObjects];
	for (TFSurfaceReveal *reveal in reveals) if (reveal.resolve) { RCTPromiseResolveBlock resolve = reveal.resolve; reveal.resolve = nil; resolve(@{@"revealed": @YES}); }
}
- (NSUInteger)applyThemeValues:(NSDictionary *)values {
	MLNStyle *style = self.style;
	if (!style) TFSurfaceInvalid();
	if (![self.themedToken isEqual:self.token]) {
		// Layers and original artwork belong to one style.
		self.themedToken = self.token; self.themedLayers = [NSMutableDictionary dictionary]; self.themedImages = [NSMutableDictionary dictionary];
	}
	NSUInteger applied = 0;
	for (NSString *group in @[@"paint", @"layout"]) {
		id entries = values[group];
		if (!entries) continue;
		if (![entries isKindOfClass:NSArray.class] || [entries count] > 8192) TFSurfaceInvalid();
		for (id entry in entries) {
			if (![entry isKindOfClass:NSArray.class] || [entry count] != 3 || ![entry[0] isKindOfClass:NSString.class] || ![entry[1] isKindOfClass:NSString.class]) TFSurfaceInvalid();
			NSString *identifier = entry[0];
			MLNStyleLayer *layer = self.themedLayers[identifier];
			if (!layer) {
				layer = [style layerWithIdentifier:identifier];
				if (!layer) continue;
				self.themedLayers[identifier] = layer;
			}
			if ([entry[1] isEqual:@"visibility"]) {
				// Per-theme copies of a layer switch by visibility, a plain flag.
				layer.visible = ![entry[2] isEqual:@"none"];
				applied++;
				continue;
			}
			NSString *key = TFThemeStyleKey(entry[1]);
			if (![layer respondsToSelector:NSSelectorFromString(key)] || !TFThemeCameraValue(entry[2], 0)) continue;
			// A value MapLibre rejects keeps its previous value; the rest of the batch still applies.
			BOOL supported;
			NSExpression *expression = TFThemeExpression(entry[2], key, &supported);
			if (!supported) continue;
			@try { [layer setValue:expression forKey:key]; applied++; }
			@catch (__unused NSException *exception) {}
		}
	}
	id images = values[@"images"];
	if (images) {
		if (![images isKindOfClass:NSArray.class] || [images count] > 64) TFSurfaceInvalid();
		// Originals are read before any artwork is replaced, so tuples can share names.
		for (NSArray *entry in images) {
			if (![entry isKindOfClass:NSArray.class] || entry.count != 4) TFSurfaceInvalid();
			for (NSUInteger index = 0; index < 3; index++) {
				if (![entry[index] isKindOfClass:NSString.class]) TFSurfaceInvalid();
				if (!self.themedImages[entry[index]]) { UIImage *image = [style imageForName:entry[index]]; if (image) self.themedImages[entry[index]] = image; }
			}
		}
		for (NSArray *entry in images) {
			UIImage *from = self.themedImages[entry[1]], *to = self.themedImages[entry[2]];
			double t = TFSurfaceNumber(entry[3], 0, 1);
			if (!from || !to) continue;
			[style setImage:TFThemeMixImage(from, to, t) forName:entry[0]];
			applied++;
		}
	}
	id light = values[@"light"];
	if (light) {
		if (![light isKindOfClass:NSDictionary.class]) TFSurfaceInvalid();
		MLNLight *next = style.light ?: [MLNLight new];
		id colour = light[@"color"], intensity = light[@"intensity"], position = light[@"position"];
		if ([colour isKindOfClass:NSString.class]) { UIColor *parsed = TFThemeColor(colour); if (parsed) next.color = [NSExpression expressionForConstantValue:parsed]; }
		if ([intensity isKindOfClass:NSNumber.class]) next.intensity = [NSExpression expressionForConstantValue:intensity];
		if ([position isKindOfClass:NSArray.class] && [position count] == 3 && TFThemeNumbers(position)) {
			MLNSphericalPosition spherical = MLNSphericalPositionMake([position[0] doubleValue], [position[1] doubleValue], [position[2] doubleValue]);
			next.position = [NSExpression expressionForConstantValue:[NSValue valueWithMLNSphericalPosition:spherical]];
		}
		style.light = next;
		applied++;
	}
	return applied;
}
- (void)retire {
	if (self.retiring) return;
	[self discardCovers];
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
	if ([self owns]) { [self sampleLayout]; [self.state frameStart:self.style]; [self followCovers]; }
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewWillStartRenderingFrame:mapView];
}
- (void)mapViewDidFinishRenderingMap:(MLNMapView *)mapView fullyRendered:(BOOL)fully {
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingMap:mapView fullyRendered:fully];
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fully {
	if ([self owns]) { [self.state frameEnd:self.style fully:fully]; if (fully && self.reveals.count) [self startReveals]; }
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully];
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fully frameEncodingTime:(double)encoding frameRenderingTime:(double)rendering {
	if ([self owns]) { [self.state frameEnd:self.style fully:fully]; if (fully && self.reveals.count) [self startReveals]; }
	if ([self.previous respondsToSelector:_cmd]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully frameEncodingTime:encoding frameRenderingTime:rendering];
	else if ([self.previous respondsToSelector:@selector(mapViewDidFinishRenderingFrame:fullyRendered:)]) [self.previous mapViewDidFinishRenderingFrame:mapView fullyRendered:fully];
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fully renderingStats:(MLNRenderingStats *)stats {
	if ([self owns]) { [self.state frameEnd:self.style fully:fully]; if (fully && self.reveals.count) [self startReveals]; }
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
	if ([self owns]) { [self.state gestureChange:self.view]; [self followCovers]; }
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
		if (!surface.style) TFSurfaceInvalid();
		[surface.state request:token];
		[surface.map triggerRepaint];
		resolve(@{@"requested": @YES});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(applyCamera, applyCameraForSurface:(NSString *)identifier sequence:(NSNumber *)sequence view:(NSDictionary *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:NO];
		NSDictionary *target = TFSurfaceView(input); NSUInteger command = TFSurfaceInteger(sequence);
		NSUInteger invalidation = [surface.state beginCommand:command];
		if (!invalidation) TFSurfaceInvalid();
		MLRNCamera *camera = TFSurfaceCamera(surface.root, surface.map);
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
		resolve(@{@"command": @(command), @"invalidation": @(invalidation), @"view": target});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(cancelCamera, cancelCameraForSurface:(NSString *)identifier sequence:(NSNumber *)sequence resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try { if (!TFAdmissionValidToken(identifier)) TFSurfaceInvalid(); [self.surfaces[identifier].state cancelCommand:TFSurfaceInteger(sequence)]; resolve(@{@"cancelled": @YES}); }
	@catch (NSException *exception) { TFSurfaceReject(reject); }
}
static double TFSurfaceDuration(id value) {
	if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) TFSurfaceInvalid();
	double number = [value doubleValue];
	if (!std::isfinite(number) || number < 0 || number > 5000 || std::floor(number) != number) TFSurfaceInvalid();
	return number;
}
RCT_REMAP_METHOD(coverSurface, coverSurface:(NSString *)identifier duration:(NSNumber *)duration resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:NO];
		double milliseconds = TFSurfaceDuration(duration);
		resolve(@{@"covered": @(milliseconds > 0 && [surface cover])});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(revealSurface, revealSurface:(NSString *)identifier duration:(NSNumber *)duration resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:YES];
		[surface reveal:TFSurfaceDuration(duration) resolve:resolve];
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(applyThemeValues, applyThemeValuesForSurface:(NSString *)identifier style:(NSString *)token values:(NSDictionary *)values resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		TFSurfaceAttachment *surface = [self current:identifier allowFailed:NO];
		if (![values isKindOfClass:NSDictionary.class] || ![surface.token isEqual:token]) TFSurfaceInvalid();
		NSUInteger applied = [surface applyThemeValues:values];
		resolve(@{@"applied": @(applied)});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
}
RCT_REMAP_METHOD(discardSurfaceCover, discardSurfaceCover:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
	@try {
		if (!TFAdmissionValidToken(identifier)) TFSurfaceInvalid();
		[self.surfaces[identifier] discardCovers];
		resolve(@{@"discarded": @YES});
	} @catch (NSException *exception) { TFSurfaceReject(reject); }
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
