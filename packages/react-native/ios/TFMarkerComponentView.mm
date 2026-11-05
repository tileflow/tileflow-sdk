#import "TFMarkerComponentView.h"
#import "TFBridgeSwift.h"
#import <React/RCTConversions.h>
#import <React/RCTUtils.h>
#import <react/renderer/components/TileflowReactNativeSpec/ComponentDescriptors.h>
#import <react/renderer/components/TileflowReactNativeSpec/Props.h>
#import <react/renderer/components/TileflowReactNativeSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface TFMarkerComponentView () <RCTTileflowMarkerViewViewProtocol>
@end

@implementation TFMarkerComponentView {
  TFMarkerBinding *_tileflowMarker;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<TileflowMarkerViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = std::make_shared<const TileflowMarkerViewProps>();
    _tileflowMarker = [[TFMarkerBinding alloc] initWithView:self];
  }
  return self;
}

- (TFMarkerBinding *)tileflowMarker
{
  return _tileflowMarker;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  const auto &value = *std::static_pointer_cast<const TileflowMarkerViewProps>(props);
  [_tileflowMarker updateWithInstanceId:RCTNSStringFromString(value.instanceId)
                          annotationId:RCTNSStringFromString(value.annotationId)
                           optionsJSON:RCTNSStringFromString(value.optionsJson)];
}

- (void)updateLayoutMetrics:(LayoutMetrics const &)layoutMetrics oldLayoutMetrics:(LayoutMetrics const &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [_tileflowMarker layoutChanged];
}

- (void)prepareForRecycle
{
  [_tileflowMarker reset];
  [super prepareForRecycle];
}

- (void)dealloc
{
  [_tileflowMarker reset];
}

@end
