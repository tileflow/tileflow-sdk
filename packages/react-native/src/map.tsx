import {forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {ElementRef} from 'react';
import {findNodeHandle, Linking} from 'react-native';
import type {NativeSyntheticEvent} from 'react-native';
import NativeMap from './specs/TileflowMapViewNativeComponent';
import type {MapEvent} from './specs/TileflowMapViewNativeComponent';
import {MapController} from './map-controller';
import {MapCollection, MapContext, useCommittedValue, useMapCommand} from './map-context';
import type {MapContextValue} from './map-context';
import {StyleRegistry} from './style-registry';
import {createMapRef} from './map-ref';
import {mapModule} from './sdk-modules';
import {mapError} from './map-error';
import {padding, sourceJson} from './map-input';
import type {CameraProps, CameraState, MapPressEvent, MapViewProps, MapViewRef, MapWarningEvent, PoiEvent} from './contract';
import type {JsonObject, NativeImage, NativeMapOptions, NativePointAnnotation, NativeUserLocation} from './native-map-contract';

let nextInstance = 0;
const defaultLocation: NativeUserLocation = {visible: false};

function Appearance({props}: {props: MapViewProps}) {
  useMapCommand('setBoundaryValues', {values: props.boundaryValues as JsonObject ?? null});
  useMapCommand('setStyleState', {state: props.styleState ?? {}});
  useMapCommand('setSun', {sun: props.sun as JsonObject ?? null});
  useMapCommand('setEmphasis', {emphasis: props.emphasis as JsonObject ?? null});
  return null;
}

export const MapView = forwardRef<MapViewRef, MapViewProps>(function MapView(props, ref) {
  mapModule();
  const callbacks = useCommittedValue(props);
  const source = sourceJson(props.source);
  const identity = source + '\n' + (props.surfaceId ?? '');
  const current = useRef<MapController | null>(null);
  const controller = useMemo(() => {
    const instanceId = 'tileflow-map-' + (++nextInstance);
    return new MapController(instanceId, mapModule, (error) => {
      if (current.current?.instanceId === instanceId) callbacks.current.onMapLoadingError?.(error);
    });
  }, [identity, callbacks]);
  const [mountedFor, setMountedFor] = useState<string>();
  const [camera, setCamera] = useState<{instance: string; owner: symbol; props: CameraProps}>();
  const [location, setLocation] = useState<{instance: string; owner: symbol; props: NativeUserLocation}>();
  useLayoutEffect(() => { current.current = controller; setMountedFor(controller.instanceId); }, [controller]);
  const runtime = useMemo<MapContextValue>(() => ({
    controller,
    style: new StyleRegistry(controller),
    points: new MapCollection<NativePointAnnotation>(controller, (annotations) => controller.call('setPointAnnotations', {annotations})),
    images: new MapCollection<NativeImage>(controller, (images) => controller.call('setImages', {images})),
    setCamera: (owner, value) => {
      setCamera((previous) => value ? {instance: controller.instanceId, owner, props: value}
        : previous?.owner === owner ? undefined : previous);
    },
    setLocation: (owner, value) => {
      setLocation((previous) => value ? {instance: controller.instanceId, owner, props: value}
        : previous?.owner === owner ? undefined : previous);
    },
  }), [controller]);
  const cameraProps = camera?.instance === controller.instanceId ? camera.props : undefined;
  const locationProps = location?.instance === controller.instanceId ? location.props : defaultLocation;
  const options: NativeMapOptions = {
    ...(props.surfaceId ? {surfaceId: props.surfaceId} : {}),
    ...(props.quality ? {quality: props.quality} : {}),
    ...(props.scrollEnabled === undefined ? {} : {scrollEnabled: props.scrollEnabled}),
    ...(props.zoomEnabled === undefined ? {} : {zoomEnabled: props.zoomEnabled}),
    ...(props.rotateEnabled === undefined ? {} : {rotateEnabled: props.rotateEnabled}),
    ...(props.pitchEnabled === undefined ? {} : {pitchEnabled: props.pitchEnabled}),
    ...(props.compassEnabled === undefined ? {} : {compassEnabled: props.compassEnabled}),
    ...(props.scaleBarEnabled === undefined ? {} : {scaleBarEnabled: props.scaleBarEnabled}),
    ...(props.attributionPosition ? {attributionPosition: props.attributionPosition} : {}),
    contentInset: cameraProps?.padding ?? padding(props.contentInset) ?? {},
    cameraLimits: {
      ...(cameraProps?.minZoomLevel === undefined ? {} : {minZoomLevel: cameraProps.minZoomLevel}),
      ...(cameraProps?.maxZoomLevel === undefined ? {} : {maxZoomLevel: cameraProps.maxZoomLevel}),
      ...(cameraProps?.maxBounds ? {maxBounds: cameraProps.maxBounds} : {}),
    },
    ...(cameraProps ? {initialCamera: {...cameraProps.defaultSettings,
      ...(cameraProps.centerCoordinate ? {centerCoordinate: cameraProps.centerCoordinate} : {}),
      ...(cameraProps.zoomLevel === undefined ? {} : {zoomLevel: cameraProps.zoomLevel}),
      ...(cameraProps.heading === undefined ? {} : {heading: cameraProps.heading}),
      ...(cameraProps.pitch === undefined ? {} : {pitch: cameraProps.pitch}),
      ...(cameraProps.bounds ? {bounds: cameraProps.bounds} : {}),
      ...(cameraProps.padding ? {padding: cameraProps.padding} : {}),
    }} : {}),
    eventLevel: props.onCameraChanged ? 'continuous' : 'camera',
  };
  const appearance = {theme: props.theme, timeOfDay: props.timeOfDay, themeBlend: props.themeBlend, viewMode: props.viewMode};
  const userLocation: NativeUserLocation = {
    ...locationProps,
    ...(cameraProps?.followUserLocation === undefined ? {} : {followUserLocation: cameraProps.followUserLocation}),
    ...(cameraProps?.followUserMode ? {followUserMode: cameraProps.followUserMode} : {}),
    ...(cameraProps?.followZoomLevel === undefined ? {} : {followZoomLevel: cameraProps.followZoomLevel}),
    ...(cameraProps?.followPitch === undefined ? {} : {followPitch: cameraProps.followPitch}),
    ...(cameraProps?.followPadding ? {followPadding: cameraProps.followPadding} : {}),
  };
  const nativeRef = useCallback((view: ElementRef<typeof NativeMap> | null) => {
    controller.attach(view ? findNodeHandle(view) : null);
  }, [controller]);
  useImperativeHandle(ref, () => createMapRef(controller, runtime.style), [controller, runtime]);
  const onMapEvent = useCallback((event: NativeSyntheticEvent<MapEvent>) => {
    if (current.current !== controller) return;
    const wire = event.nativeEvent;
    let payload: unknown;
    try { payload = JSON.parse(wire.payload); }
    catch { controller.report(mapError({code: 'rendererFailed', message: 'The native map returned an invalid event.'})); return; }
    if (!controller.receive(wire.instanceId, wire.type, payload)) return;
    const handlers = callbacks.current;
    switch (wire.type) {
      case 'loading': handlers.onWillStartLoadingMap?.(); break;
      case 'contentReady': handlers.onDidFinishLoadingMap?.(); break;
      case 'failed': handlers.onMapLoadingError?.(mapError(payload)); break;
      case 'tap': case 'longPress': {
        const touch = payload as {coordinate: readonly [number, number]; point: readonly [number, number]};
        const press: MapPressEvent = {type: 'Feature', geometry: {type: 'Point', coordinates: touch.coordinate},
          properties: {screenPointX: touch.point[0], screenPointY: touch.point[1]}};
        if (wire.type === 'tap') handlers.onPress?.(press); else handlers.onLongPress?.(press);
        break;
      }
      case 'cameraChanged': {
        const state = payload as CameraState & {phase: string};
        handlers.onCameraChanged?.(state);
        if (state.phase === 'ended') handlers.onMapIdle?.(state);
        break;
      }
      case 'poiActivated': handlers.onPoiPress?.(payload as PoiEvent); break;
      case 'themeChanged': handlers.onThemeChange?.((payload as {theme: string}).theme); break;
      case 'themeTransition': handlers.onThemeTransition?.(payload as JsonObject); break;
      case 'followModeChanged': handlers.onUserTrackingModeChange?.(payload as JsonObject); break;
      case 'warning': {
        const warning = payload as MapWarningEvent;
        console.warn('Tileflow map warning', warning.code, warning.context?.feature ?? '');
        handlers.onWarning?.(warning);
        break;
      }
      case 'externalLinkRequested': {
        const url = (payload as {url: string}).url;
        if (handlers.onOpenURL) handlers.onOpenURL(url);
        else void Linking.openURL(url).catch((error: unknown) => controller.report(mapError(error)));
        break;
      }
    }
  }, [callbacks, controller]);
  return <MapContext.Provider value={runtime}>
    <NativeMap key={controller.instanceId} ref={nativeRef} collapsable={false}
      style={[{flex: 1}, props.style]} testID={props.testID} accessibilityLabel={props.accessibilityLabel}
      instanceId={controller.instanceId} sourceJson={mountedFor === controller.instanceId ? source : ''}
      appearanceJson={JSON.stringify(appearance)} optionsJson={JSON.stringify(options)} onMapEvent={onMapEvent}>
      <Appearance props={props} />
      <LocationOptions value={userLocation} />
      {props.children}
    </NativeMap>
  </MapContext.Provider>;
});

function LocationOptions({value}: {value: NativeUserLocation}) {
  useMapCommand('setUserLocation', value);
  return null;
}
