import {
  Camera as NativeCamera,
  type CameraProps as NativeCameraProps,
  type CameraRef as NativeCameraRef,
  Map as NativeMap,
  type MapProps as NativeMapProps,
  type MapRef as NativeMapRef,
} from '@maplibre/maplibre-react-native';
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {AppState, findNodeHandle, View} from 'react-native';
import type {TileflowAnnotation, TileflowInteractionDiagnostic} from '@tileflow/interactions';
import type {MapBoundaryFeatureState, MapProps} from './contract';
import {createNativeAnnotationClusters} from './native-annotation-clusters';
import type {MapInteractionEvent, MapMarkerRenderer} from './interaction-contract';
import {createMapLifecycle} from './map-lifecycle';
import type {NativeInteractionHost} from './mounted-map-interactions';
import {NativeBoundaryFeatureState} from './native-boundary-feature-state';
import {NativeClusterMarker, NativeDataLayers, type NativeDataTarget} from './native-data-layers';
import {planNativeDataLayers} from './native-data-layers-plan';
import {NativeAnnotationMarker} from './native-marker';
import {createNativeMapOwner, retireNativeMapOwner} from './native-runtime';

type Lifecycle = ReturnType<typeof createMapLifecycle>;
type Snapshot = ReturnType<Lifecycle['getSnapshot']>;
type Scene = NonNullable<Snapshot['renderer']>;
const fill = Object.freeze({flex: 1});

function NativeScene<TAnnotation extends TileflowAnnotation>({
  scene,
  lifecycle,
  mapOptions,
  children,
  interactions,
  interactionEnabled,
  renderMarker,
  boundaryFeatureState,
  data,
}: {
  scene: Scene;
  lifecycle: Lifecycle;
  mapOptions: Snapshot['mapOptions'];
  children?: ReactNode;
  interactions: Snapshot['interactions'];
  interactionEnabled: boolean;
  renderMarker?: MapMarkerRenderer<TAnnotation>;
  boundaryFeatureState?: MapBoundaryFeatureState;
  data: NativeDataInput<TAnnotation>;
}): ReactElement {
  const view = useRef<View | null>(null);
  const camera = useRef<NativeCameraRef | null>(null);
  const nativeMap = useRef<NativeMapRef | null>(null);
  const committedHost = useRef<NativeInteractionHost | undefined>(undefined);
  const tag = useRef<number | null>(null);
  const laidOut = useRef(false);
  const styleLoaded = useRef(false);
  const attachRequested = useRef(false);
  // The style whose load MapLibre last reported; a newly committed style is loading until then.
  const latestStyle = useRef(scene.style);
  latestStyle.current = scene.style;
  const [loadedStyle, setLoadedStyle] = useState<Scene['style'] | undefined>(undefined);
  const host = useMemo<NativeInteractionHost>(() => {
    const value: NativeInteractionHost = Object.freeze({
      key: scene.key,
      style: scene.style,
      current: () => committedHost.current === value && nativeMap.current !== null,
      query(point, options) {
        const map = nativeMap.current;
        if (!map || committedHost.current !== value)
          return Promise.reject(new Error('Native interaction host is unavailable.'));
        return map.queryRenderedFeatures(point, options);
      },
    });
    return value;
  }, [scene.key, scene.style]);
  useLayoutEffect(() => {
    committedHost.current = host;
    lifecycle.bindInteractionHost(host);
    return () => {
      if (committedHost.current === host) committedHost.current = undefined;
      lifecycle.unbindInteractionHost(host);
    };
  }, [host, lifecycle]);
  // Serialized once per style: MapLibre React Native would otherwise serialize an object on every
  // render, and a blend re-renders the Map whenever its position moves.
  const mapStyle = useMemo<NativeMapProps['mapStyle']>(
    () => JSON.stringify(scene.style),
    [scene.style],
  );
  const [initialViewState] = useState<NonNullable<NativeCameraProps['initialViewState']>>(() => {
    const center: [number, number] = [scene.initialView.center[0], scene.initialView.center[1]];
    Object.freeze(center);
    return Object.freeze({
      center,
      zoom: scene.initialView.zoom,
      bearing: scene.initialView.bearing,
      pitch: scene.initialView.pitch,
    });
  });
  const attach = () => {
    if (!tag.current || !laidOut.current || !styleLoaded.current || attachRequested.current) return;
    attachRequested.current = true;
    lifecycle.nativeStyleLoaded(scene.key, tag.current);
  };
  const bind = (node: View | null) => {
    view.current = node;
    if (!node) return;
    const value = findNodeHandle(node);
    if (!Number.isSafeInteger(value) || !value || value < 1) return;
    tag.current = value;
    lifecycle.rootMounted(scene.key, value);
    attach();
  };
  // Stage A owns validation and detached JSON. This restores the consumer's annotation type only.
  const annotations = interactions?.annotations as readonly TAnnotation[] | undefined;
  const byId = new globalThis.Map(annotations?.map((annotation) => [annotation.id, annotation]));
  const [zoomLevel, setZoomLevel] = useState(() => Math.floor(scene.initialView.zoom));
  const followZoom = (event: {nativeEvent: {zoom: number}}) => {
    if (Number.isFinite(event.nativeEvent.zoom)) setZoomLevel(Math.floor(event.nativeEvent.zoom));
  };
  const clusterSettings = data.annotationClusters;
  const clusterKey = JSON.stringify(clusterSettings ?? null);
  const clusterIndex = useMemo(
    () =>
      clusterSettings && annotations
        ? createNativeAnnotationClusters(annotations, clusterSettings)
        : undefined,
    // Options written inline are new objects each render; only a real change rebuilds groups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [annotations, clusterKey],
  );
  const clusterView = clusterIndex?.at(zoomLevel);
  const styleReady = loadedStyle === scene.style;
  const dataPlan = useMemo(
    () =>
      planNativeDataLayers({
        dataOverlays: data.dataOverlays,
        dataSources: data.dataSources,
        style: scene.style as Parameters<typeof planNativeDataLayers>[0]['style'],
      }),
    [data.dataOverlays, data.dataSources, scene.style],
  );
  const reportedPlan = useRef<typeof dataPlan | undefined>(undefined);
  useLayoutEffect(() => {
    if (reportedPlan.current === dataPlan) return;
    reportedPlan.current = dataPlan;
    for (const {message, path} of dataPlan.diagnostics)
      data.onDiagnostic({code: 'INVALID_DATA_LAYER', level: 'error', message, path});
  }, [data, dataPlan]);
  const activate = (target: NativeDataTarget) =>
    data.onActivate({
      coordinate: target.coordinate,
      inputModality: 'touch',
      target,
      type: 'target:activate',
    });
  return (
    <View
      ref={bind}
      collapsable={false}
      style={fill}
      onStartShouldSetResponderCapture={() => {
        lifecycle.beginTouch(scene.key);
        return false;
      }}
      onLayout={(event) => {
        const {width, height} = event.nativeEvent.layout;
        laidOut.current =
          Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
        if (view.current) bind(view.current);
        lifecycle.layoutChanged(scene.key);
        attach();
      }}
    >
      <NativeMap
        {...mapOptions}
        ref={nativeMap}
        style={fill}
        mapStyle={mapStyle}
        onRegionIsChanging={followZoom}
        onRegionDidChange={followZoom}
        onPress={(event) => {
          if (!host.current()) return;
          try {
            lifecycle.mapPress(scene.key, {
              inputModality: 'touch',
              point: event.nativeEvent.point,
              coordinate: event.nativeEvent.lngLat,
            });
          } catch {
            lifecycle.interactionDiagnostic(scene.key, 'INVALID_DOCUMENT');
          }
        }}
        onDidFinishLoadingStyle={() => {
          // This wakes the private adapter only. A JS callback is not readiness evidence.
          styleLoaded.current = true;
          setLoadedStyle(latestStyle.current);
          attach();
        }}
      >
        <NativeCamera
          key="tileflow-camera"
          ref={camera}
          initialViewState={initialViewState}
          minZoom={0}
          maxZoom={24}
        />
        <Fragment key="tileflow-annotations">
          {interactions?.plan.order.map((id) => {
            const annotation = byId.get(id);
            return annotation && !clusterView?.hiddenAnnotationIds.has(id) ? (
              <NativeAnnotationMarker
                key={annotation.id}
                annotation={annotation}
                enabled={interactionEnabled}
                sceneKey={scene.key}
                lifecycle={lifecycle}
                renderMarker={renderMarker}
              />
            ) : null;
          })}
          {clusterView?.clusters.map((cluster) => (
            <NativeClusterMarker
              key={`cluster-${cluster.clusterId}`}
              cluster={cluster}
              label={
                clusterSettings?.formatAriaLabel?.(cluster.pointCount) ??
                `${cluster.pointCount} places`
              }
              onPress={() => {
                activate({
                  annotationIds: cluster.annotationIds,
                  clusterId: cluster.clusterId,
                  coordinate: cluster.coordinate,
                  kind: 'cluster',
                  pointCount: cluster.pointCount,
                  properties: {point_count: cluster.pointCount},
                });
                if (data.expand && clusterSettings?.expandOnClick !== false)
                  camera.current?.easeTo({
                    center: [cluster.coordinate[0], cluster.coordinate[1]],
                    duration: 400,
                    zoom: cluster.expansionZoom,
                  });
              }}
            />
          ))}
        </Fragment>
        {styleReady ? (
          <NativeDataLayers
            key="tileflow-data-layers"
            camera={camera}
            expand={data.expand}
            onActivate={activate}
            plan={dataPlan}
          />
        ) : null}
        {boundaryFeatureState ? (
          <NativeBoundaryFeatureState
            key="tileflow-boundary-feature-state"
            input={boundaryFeatureState}
            style={scene.style}
            loaded={loadedStyle === scene.style}
          />
        ) : null}
        {children}
      </NativeMap>
    </View>
  );
}

type NativeDataInput<TAnnotation extends TileflowAnnotation> = Readonly<
  Pick<MapProps<TAnnotation>, 'annotationClusters' | 'dataOverlays' | 'dataSources'> & {
    /** False when the application owns the camera through `view`. */
    expand: boolean;
    onActivate: (event: MapInteractionEvent<TAnnotation>) => void;
    onDiagnostic: (diagnostic: TileflowInteractionDiagnostic) => void;
  }
>;

/** A Tileflow-only native Map. Its imperative ref exposes safe source state only. */
export function Map<TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
  props: MapProps<TAnnotation>,
): ReactElement {
  const [lifecycle] = useState(() =>
    createMapLifecycle(createNativeMapOwner, retireNativeMapOwner),
  );
  const snapshot = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    lifecycle.getSnapshot,
  );
  const latestProps = useRef(props);
  latestProps.current = props;
  const [callbacks] = useState(() => ({
    onActivate: (event: MapInteractionEvent<TAnnotation>) =>
      latestProps.current.onInteractionEvent?.({...event, type: 'target:activate'}),
    onDiagnostic: (diagnostic: TileflowInteractionDiagnostic) =>
      latestProps.current.onInteractionDiagnostic?.(diagnostic),
  }));
  const data = useMemo<NativeDataInput<TAnnotation>>(
    () => ({
      annotationClusters: props.annotationClusters,
      dataOverlays: props.dataOverlays,
      dataSources: props.dataSources,
      expand: props.view === undefined,
      ...callbacks,
    }),
    [callbacks, props.annotationClusters, props.dataOverlays, props.dataSources, props.view],
  );
  useImperativeHandle(
    props.ref,
    () => Object.freeze({getSourceState: lifecycle.getSourceState, retry: lifecycle.retry}),
    [lifecycle],
  );

  useLayoutEffect(() => {
    const unmount = lifecycle.mount();
    if (AppState.currentState !== 'active') lifecycle.background();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') lifecycle.resume();
      else lifecycle.background();
    });
    return () => {
      subscription.remove();
      unmount();
    };
  }, [lifecycle]);
  useLayoutEffect(() => {
    // This includes the React commit following a gesture callback, even when props are equal.
    lifecycle.update(props);
  });

  return (
    <View style={props.style} testID={props.testID}>
      {snapshot.renderer ? (
        <NativeScene
          key={snapshot.renderer.key}
          scene={snapshot.renderer}
          lifecycle={lifecycle}
          mapOptions={snapshot.mapOptions}
          interactions={snapshot.interactions}
          interactionEnabled={snapshot.interactionEnabled === true}
          renderMarker={props.renderMarker}
          boundaryFeatureState={props.boundaryFeatureState}
          data={data}
        >
          {props.children}
        </NativeScene>
      ) : null}
    </View>
  );
}
