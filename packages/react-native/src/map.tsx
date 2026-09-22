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
import type {TileflowAnnotation} from '@tileflow/interactions';
import type {MapProps} from './contract';
import type {MapMarkerRenderer} from './interaction-contract';
import {createMapLifecycle} from './map-lifecycle';
import type {NativeInteractionHost} from './mounted-map-interactions';
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
}: {
  scene: Scene;
  lifecycle: Lifecycle;
  mapOptions: Snapshot['mapOptions'];
  children?: ReactNode;
  interactions: Snapshot['interactions'];
  interactionEnabled: boolean;
  renderMarker?: MapMarkerRenderer<TAnnotation>;
}): ReactElement {
  const view = useRef<View | null>(null);
  const camera = useRef<NativeCameraRef | null>(null);
  const nativeMap = useRef<NativeMapRef | null>(null);
  const committedHost = useRef<NativeInteractionHost | undefined>(undefined);
  const tag = useRef<number | null>(null);
  const laidOut = useRef(false);
  const styleLoaded = useRef(false);
  const attachRequested = useRef(false);
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
        mapStyle={scene.style as NativeMapProps['mapStyle']}
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
            return annotation ? (
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
        </Fragment>
        {children}
      </NativeMap>
    </View>
  );
}

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
  useImperativeHandle(props.ref, () => Object.freeze({getSourceState: lifecycle.getSourceState}), [
    lifecycle,
  ]);

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
        >
          {props.children}
        </NativeScene>
      ) : null}
    </View>
  );
}
