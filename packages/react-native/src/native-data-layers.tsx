import {
  type CameraRef,
  GeoJSONSource,
  type GeoJSONSourceRef,
  Layer,
  type LayerProps,
  Marker,
} from '@maplibre/maplibre-react-native';
import {type ReactElement, type RefObject, useRef} from 'react';
import {Pressable, Text} from 'react-native';
import type {
  TileflowAnnotationCluster,
  TileflowInteractionCoordinate,
  TileflowInteractionJsonValue,
  TileflowResolvedClusterTarget,
  TileflowResolvedStyleFeatureTarget,
} from '@tileflow/interactions';
import type {NativeDataLayersPlan, NativeDataSourcePlan} from './native-data-layers-plan';

export type NativeDataTarget = TileflowResolvedClusterTarget | TileflowResolvedStyleFeatureTarget;

type Feature = Readonly<{
  geometry?: Readonly<{coordinates?: unknown; type?: string}> | null;
  id?: number | string;
  properties?: Readonly<Record<string, unknown>> | null;
}>;

const bubble = Object.freeze({
  alignItems: 'center' as const,
  backgroundColor: '#2563eb',
  borderColor: '#ffffff',
  borderRadius: 22,
  borderWidth: 2,
  justifyContent: 'center' as const,
  minHeight: 44,
  minWidth: 44,
  paddingHorizontal: 6,
});
const count = Object.freeze({color: '#ffffff', fontSize: 14, fontWeight: '600' as const});

/** Runtime GeoJSON and overlays as MapLibre React Native children; theme loads re-adopt them. */
export function NativeDataLayers({
  camera,
  expand,
  onActivate,
  plan,
}: {
  camera: RefObject<CameraRef | null>;
  expand: boolean;
  onActivate: (target: NativeDataTarget) => void;
  plan: NativeDataLayersPlan;
}): ReactElement {
  return (
    <>
      {plan.sources.map((source) => (
        <NativeDataSource
          key={source.id}
          camera={camera}
          expand={expand}
          onActivate={onActivate}
          source={source}
        />
      ))}
      {plan.layers.map((layer) => (
        <Layer key={layer.id} {...(layer as unknown as LayerProps)} />
      ))}
    </>
  );
}

function NativeDataSource({
  camera,
  expand,
  onActivate,
  source,
}: {
  camera: RefObject<CameraRef | null>;
  expand: boolean;
  onActivate: (target: NativeDataTarget) => void;
  source: NativeDataSourcePlan;
}): ReactElement {
  const ref = useRef<GeoJSONSourceRef | null>(null);
  const pressable = source.clusterLayers.length > 0 || source.pointLayers.length > 0;
  return (
    <GeoJSONSource
      {...(source.definition as object)}
      id={source.id}
      ref={ref}
      data={source.data as never}
      onPress={
        pressable
          ? (event) => {
              const feature = event.nativeEvent.features[0] as Feature | undefined;
              const coordinate = pointCoordinate(feature);
              if (!feature || !coordinate) return;
              const properties = jsonProperties(feature.properties);
              const clusterId = properties.cluster_id;
              if (typeof clusterId !== 'number') {
                const layerId = source.pointLayers[0];
                if (!layerId) return;
                onActivate({
                  coordinate,
                  feature: {...(feature.id === undefined ? {} : {id: feature.id}), properties},
                  kind: 'style-feature',
                  layerId,
                });
                return;
              }
              onActivate({
                clusterId,
                coordinate,
                kind: 'cluster',
                pointCount: typeof properties.point_count === 'number' ? properties.point_count : 0,
                properties,
                source: source.id,
              });
              if (!expand || !source.expandOnClick) return;
              ref.current?.getClusterExpansionZoom(clusterId).then(
                (zoom) =>
                  camera.current?.easeTo({
                    center: [coordinate[0], coordinate[1]],
                    duration: 400,
                    zoom,
                  }),
                () => undefined,
              );
            }
          : undefined
      }
    >
      {source.layers.map((layer) => (
        <Layer key={layer.id} {...(layer as unknown as LayerProps)} />
      ))}
    </GeoJSONSource>
  );
}

/** One accessible native button for a group of annotations. */
export function NativeClusterMarker({
  cluster,
  label,
  onPress,
}: {
  cluster: TileflowAnnotationCluster;
  label: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Marker
      id={`tileflow-cluster-${cluster.clusterId}`}
      lngLat={[cluster.coordinate[0], cluster.coordinate[1]]}
      onPress={onPress}
    >
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessible
        onPress={onPress}
        style={bubble}
      >
        <Text style={count}>{cluster.label}</Text>
      </Pressable>
    </Marker>
  );
}

function pointCoordinate(feature: Feature | undefined): TileflowInteractionCoordinate | undefined {
  const coordinates = feature?.geometry?.coordinates;
  return feature?.geometry?.type === 'Point' &&
    Array.isArray(coordinates) &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number'
    ? [coordinates[0], coordinates[1]]
    : undefined;
}

function jsonProperties(
  properties: Feature['properties'],
): Readonly<Record<string, TileflowInteractionJsonValue>> {
  return Object.fromEntries(
    Object.entries(properties ?? {}).filter(([, value]) => value !== undefined),
  ) as Record<string, TileflowInteractionJsonValue>;
}
