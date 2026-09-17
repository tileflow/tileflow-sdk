import {Marker as NativeMarker} from '@maplibre/maplibre-react-native';
import {type ReactElement, useLayoutEffect, useMemo} from 'react';
import {Pressable, processColor, View} from 'react-native';
import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';
import type {MapMarkerRenderer} from './interaction-contract';
import type {createMapLifecycle} from './map-lifecycle';
import {nativeMarkerModel, resolveNativeMarkerContent} from './native-marker-model';

type Lifecycle = ReturnType<typeof createMapLifecycle>;
const button = Object.freeze({
  minWidth: 44,
  minHeight: 44,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});
const dot = Object.freeze({
  width: 18,
  height: 18,
  borderRadius: 9,
  borderWidth: 2,
  borderColor: '#ffffff',
});
const defaultColor = '#2563eb';

/** One React/native host per portable annotation ID; no selected-content view exists here. */
export function NativeAnnotationMarker<TAnnotation extends TileflowAnnotation>({
  annotation,
  state,
  enabled,
  sceneKey,
  lifecycle,
  renderMarker,
}: {
  annotation: TAnnotation;
  state: TileflowInteractionState;
  enabled: boolean;
  sceneKey: string;
  lifecycle: Lifecycle;
  renderMarker?: MapMarkerRenderer<TAnnotation>;
}): ReactElement {
  const model = useMemo(
    () => nativeMarkerModel(annotation, state, enabled),
    [annotation, state, enabled],
  );
  const rendered = resolveNativeMarkerContent(model.context, renderMarker);
  let color = defaultColor;
  let invalidColor = false;
  if (annotation.marker?.color) {
    try {
      if (typeof processColor(annotation.marker.color) === 'number')
        color = annotation.marker.color;
      else invalidColor = true;
    } catch {
      invalidColor = true;
    }
  }
  const diagnostic =
    rendered.diagnostic ?? (!rendered.content && invalidColor ? 'INVALID_FIELD' : undefined);
  useLayoutEffect(() => {
    if (diagnostic) lifecycle.interactionDiagnostic(sceneKey, diagnostic);
  }, [annotation, diagnostic, lifecycle, sceneKey]);
  const press = (event?: {stopPropagation(): void}) => {
    event?.stopPropagation();
    lifecycle.markerPress(sceneKey, annotation);
  };
  return (
    <NativeMarker
      id={`tileflow-annotation-${model.key}`}
      lngLat={model.lngLat}
      accessible={false}
      onPress={press}
    >
      <Pressable
        {...model.accessibility}
        disabled={!enabled}
        style={button}
        onTouchStart={(event) => {
          lifecycle.claimMarker(sceneKey, annotation);
          event.stopPropagation();
        }}
        onPress={press}
        onAccessibilityTap={() => {
          lifecycle.beginTouch(sceneKey);
          press();
        }}
      >
        <View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {rendered.content ?? <View style={[dot, {backgroundColor: color}]} />}
        </View>
      </Pressable>
    </NativeMarker>
  );
}
