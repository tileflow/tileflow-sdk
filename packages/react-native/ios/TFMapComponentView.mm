#import "TFMapComponentView.h"
#import "TFMarkerComponentView.h"
#import "TFBridgeSwift.h"
#import <React/RCTConversions.h>
#import <React/RCTUtils.h>
#import <react/renderer/components/TileflowReactNativeSpec/ComponentDescriptors.h>
#import <react/renderer/components/TileflowReactNativeSpec/EventEmitters.h>
#import <react/renderer/components/TileflowReactNativeSpec/Props.h>
#import <react/renderer/components/TileflowReactNativeSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface TFMapComponentView () <RCTTileflowMapViewViewProtocol>
@end

@implementation TFMapComponentView {
  TFMapHostView *_host;
  NSMutableArray<UIView<RCTComponentViewProtocol> *> *_children;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<TileflowMapViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = std::make_shared<const TileflowMapViewProps>();
    _host = [[TFMapHostView alloc] initWithFrame:self.bounds];
    _children = [NSMutableArray new];
    self.contentView = _host;
    [self connectEvents];
  }
  return self;
}

- (void)connectEvents
{
  __weak TFMapComponentView *weakSelf = self;
  _host.eventHandler = ^(NSString *instanceId, NSString *type, NSString *payload) {
    TFMapComponentView *view = weakSelf;
    if (!view || !view->_eventEmitter) {
      return;
    }
    auto emitter = std::static_pointer_cast<const TileflowMapViewEventEmitter>(view->_eventEmitter);
    emitter->onMapEvent({std::string(instanceId.UTF8String), std::string(type.UTF8String), std::string(payload.UTF8String)});
  };
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  const auto &value = *std::static_pointer_cast<const TileflowMapViewProps>(props);
  [self connectEvents];
  [_host updateWithReactTag:self.tag
                instanceId:RCTNSStringFromString(value.instanceId)
                sourceJSON:RCTNSStringFromString(value.sourceJson)
            appearanceJSON:RCTNSStringFromString(value.appearanceJson)
               optionsJSON:RCTNSStringFromString(value.optionsJson)];
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_children insertObject:childComponentView atIndex:index];
  if ([childComponentView isKindOfClass:TFMarkerComponentView.class]) {
    [_host addMarker:((TFMarkerComponentView *)childComponentView).tileflowMarker];
    return;
  }
  NSInteger contentIndex = 0;
  for (NSInteger i = 0; i < index; i++) {
    if (![_children[i] isKindOfClass:TFMarkerComponentView.class]) {
      contentIndex++;
    }
  }
  [_host mountContent:childComponentView index:contentIndex];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_children removeObjectIdenticalTo:childComponentView];
  if ([childComponentView isKindOfClass:TFMarkerComponentView.class]) {
    [_host removeMarker:((TFMarkerComponentView *)childComponentView).tileflowMarker];
    return;
  }
  [childComponentView removeFromSuperview];
}

- (void)prepareForRecycle
{
  for (UIView *child in _children) {
    [child removeFromSuperview];
  }
  [_children removeAllObjects];
  [_host dispose];
  [super prepareForRecycle];
}

- (void)dealloc
{
  [_host dispose];
}

@end
