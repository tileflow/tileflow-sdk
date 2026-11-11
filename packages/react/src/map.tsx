'use client';

import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ImgHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import type {Map as MapLibreMap, MapOptions as MapLibreMapOptions} from 'maplibre-gl';
import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core';
import type {
  TileflowBounds,
  TileflowColorOverrides,
  TileflowEmphasis,
  TileflowFitBoundsOptions,
  TileflowMapError,
  TileflowNavigationControlInput,
  TileflowThemeController,
  TileflowThemeTransition,
  TileflowViewMode,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  resolveTileflowMapMode,
  type TileflowAnalytics,
  type TileflowRuntimeSource,
} from '@tileflow/core/runtime';
import {
  createTileflowMap,
  getTileflowMapInitialStatus,
  type TileflowMapController,
  type TileflowMapControllerOptions,
  type TileflowMapRenderTargetList,
  type TileflowMapStatus,
} from '@tileflow/dom';
import type {
  TileflowAnnotation,
  TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowInteractionState,
  TileflowInteractionViewContext,
} from '@tileflow/interactions';
import type {
  TileflowAnnotationClusterOptions,
  TileflowMapLibreDomRenderTarget,
  TileflowMapLibreSemanticDomRenderTarget,
} from '@tileflow/interactions/maplibre';
import {assertTileflowMapStyleInputs, type TileflowMapStyleSourceProps} from './map-style-inputs';

export type TileflowMapSource = TileflowRuntimeSource;
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

export type TileflowAnnotationRenderer<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (context: TileflowAnnotationViewContext<TAnnotation>) => ReactNode;

export type TileflowInteractionRenderer<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (context: TileflowInteractionViewContext<TAnnotation>) => ReactNode;

type MapSharedProps = {
  vegetation?: boolean;
  viewMode?: TileflowViewMode;
  captureId?: string;
  imageUrl?: string;
  alt?: string;
  center?: [number, number];
  zoom?: number;
  className?: string;
  height?: CSSProperties['height'];
  imageLoading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  interactive?: boolean;
  mapOptions?: TileflowMapOptions;
  analytics?: TileflowAnalytics;
  /**
   * Called with `{code, error}` when the map cannot load its manifest, apply a theme, blend,
   * `colors` or `emphasis`, start its runtime or load its 3D scene. Without it, those failures go to
   * `console.error`.
   */
  onError?: (event: TileflowMapError) => void;
  onLoad?: (map: MapLibreMap) => void;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
};

type TileflowInteractionStateInputProps =
  | Readonly<{
      defaultInteractionState?: never;
      interactionState?: TileflowInteractionState;
    }>
  | Readonly<{
      defaultInteractionState?: TileflowInteractionState;
      interactionState?: never;
    }>;

type TileflowInteractionRendererProps<TAnnotation extends TileflowAnnotation> =
  | Readonly<{
      interactions?: never;
      renderPopup?: TileflowAnnotationRenderer<TAnnotation>;
      renderTooltip?: TileflowAnnotationRenderer<TAnnotation>;
    }>
  | Readonly<{
      interactions: readonly TileflowInteractionBinding[];
      renderPopup?: TileflowInteractionRenderer<TAnnotation>;
      renderTooltip?: TileflowInteractionRenderer<TAnnotation>;
    }>;

type MapInteractiveProps<TAnnotation extends TileflowAnnotation> = MapSharedProps &
  TileflowInteractionStateInputProps &
  TileflowInteractionRendererProps<TAnnotation> & {
    /** Group `annotations` into accessible cluster buttons. Up to 1,000 annotations. */
    annotationClusters?: TileflowAnnotationClusterOptions;
    annotations?: readonly TAnnotation[];
    /**
     * Colour token overrides for the map, for example `{'surface.land': '#f4f1ea'}`, or colour knobs
     * the map declares, for example `{water: '#2563eb'}`. The overrides ease in over
     * `themeTransition`, stay through theme changes, and an empty object restores the map's own
     * colours. A value may use CSS variables, such as `var(--primary)` or
     * `color-mix(in oklab, var(--primary) 40%, white)`, read where the map sits and read again when
     * the page's theme changes. The map must be configurable at run time; an unknown token, an
     * invalid value or a variable with no value and no fallback is reported as an error and leaves
     * the colours unchanged.
     */
    colors?: TileflowColorOverrides;
    /** Overlays drawn over `dataSources` or compiled sources, keyed as in `defineMap`. */
    dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>>;
    /** Application GeoJSON, keyed as in `defineMap`. A compiled source of the same key is filled. */
    dataSources?: Readonly<Record<string, TileflowGeoJsonSource>>;
    /**
     * Makes chosen modules of the map recede and its labels fade, so your own content reads first.
     * It eases in over `themeTransition` and stays through theme changes; leave it out for the map
     * as designed.
     */
    emphasis?: TileflowEmphasis;
    mode?: 'interactive';
    onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
    onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
    onInteractionStateChange?: (state: TileflowInteractionState) => void;
    renderMarker?: TileflowAnnotationRenderer<TAnnotation>;
  } & MapViewProps;

type MapViewProps = {
  /**
   * Shows these bounds, `[west, south, east, north]` or `[[west, south], [east, north]]`. The map
   * starts there, and moves to new bounds when this prop changes. `center` and `zoom` set the
   * view only until bounds are given.
   */
  bounds?: TileflowBounds;
  /**
   * Fits the map to all `annotations`, with 48 pixels of padding and at most zoom 15 unless
   * options say otherwise, and again whenever their positions change. `bounds` takes precedence.
   */
  fitAnnotations?: boolean | TileflowFitBoundsOptions;
  /** How `bounds` is fitted: `padding`, `maxZoom` and `duration`. */
  fitBoundsOptions?: TileflowFitBoundsOptions;
  /**
   * The zoom and compass buttons of an interactive map. A map shows none unless asked: `true` shows
   * them at `top-right`, and an object moves them or limits their buttons.
   */
  navigationControl?: TileflowNavigationControlInput;
};

type MapImageProps = MapSharedProps & {
  annotationClusters?: never;
  annotations?: never;
  colors?: never;
  dataOverlays?: never;
  dataSources?: never;
  defaultInteractionState?: never;
  emphasis?: never;
  interactionState?: never;
  interactions?: never;
  mode: 'image';
  onInteractionDiagnostic?: never;
  onInteractionEvent?: never;
  onInteractionStateChange?: never;
  renderMarker?: never;
  renderPopup?: never;
  renderTooltip?: never;
  bounds?: never;
  fitAnnotations?: never;
  fitBoundsOptions?: never;
  navigationControl?: never;
};

export type MapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = (
  MapInteractiveProps<TAnnotation> | MapImageProps
) &
  TileflowMapStyleSourceProps;

/**
 * Props without `interactions`, where a popup or tooltip view receives the annotation it belongs
 * to. A view written inline gets its parameter types from this overload.
 */
export type MapAnnotationProps<TAnnotation extends TileflowAnnotation> = (
  Extract<MapInteractiveProps<TAnnotation>, {interactions?: never}> | MapImageProps
) &
  TileflowMapStyleSourceProps;

/** Props with `interactions`, where a view may belong to an annotation or to a map feature. */
export type MapInteractionProps<TAnnotation extends TileflowAnnotation> = Exclude<
  MapInteractiveProps<TAnnotation>,
  {interactions?: never}
> &
  TileflowMapStyleSourceProps;

/**
 * What a `ref` on `Map` gives an application: the objects behind the map, for the moments when the
 * props are not enough. Both are `null` until the map has loaded, in image mode, and after it is
 * taken down, so call them from event handlers and effects, not while rendering.
 */
export type TileflowMapHandle = Readonly<{
  /** The MapLibre map, or `null` while there is none. */
  getMap(): MapLibreMap | null;
  /** Changes the map's theme, colours and emphasis; `null` when the map's style has no themes. */
  getThemeController(): TileflowThemeController | null;
}>;

type MapComponent = {
  <TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
    props: MapAnnotationProps<TAnnotation> & RefAttributes<TileflowMapHandle>,
  ): ReactElement;
  <TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
    props: MapInteractionProps<TAnnotation> & RefAttributes<TileflowMapHandle>,
  ): ReactElement;
  displayName?: string;
};

const noRenderTargets: TileflowMapRenderTargetList<never> = {annotations: [], semantic: []};

// `forwardRef` serves React 18 and 19; React 19 would also accept `ref` as a plain prop.
export const Map = forwardRef(function Map<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
>(props: MapProps<TAnnotation>, ref: ForwardedRef<TileflowMapHandle>): ReactElement {
  assertTileflowMapStyleInputs(props);

  const {
    annotationClusters,
    annotations,
    colors,
    dataOverlays,
    dataSources,
    captureId,
    defaultInteractionState,
    emphasis,
    mode = 'interactive',
    source,
    imageUrl,
    alt = '',
    center,
    zoom,
    className,
    height = 420,
    imageLoading = 'eager',
    interactive,
    mapOptions,
    analytics,
    theme,
    timeOfDay,
    themeBlend,
    themeTransition,
    vegetation,
    viewMode = '3d',
    interactionState,
    interactions,
    onInteractionDiagnostic,
    onInteractionEvent,
    onInteractionStateChange,
    onError,
    onLoad,
    renderMarker,
    renderPopup,
    renderTooltip,
  } = props;
  const {bounds, fitAnnotations, fitBoundsOptions, navigationControl} = props;
  const generalRenderPopup = renderPopup as TileflowInteractionRenderer<TAnnotation> | undefined;
  const generalRenderTooltip = renderTooltip as
    TileflowInteractionRenderer<TAnnotation> | undefined;
  const sourceMap = source.map;
  const sourceManifestUrl = source.manifestUrl;
  const runtimeSource = useMemo<TileflowRuntimeSource>(
    () => ({manifestUrl: sourceManifestUrl, map: sourceMap}),
    [sourceManifestUrl, sourceMap],
  );
  const resolvedMode = resolveTileflowMapMode({mode});
  const isImageMode = resolvedMode === 'image';
  const controlledInteractionOwnershipRef = useRef(interactionState !== undefined);
  // The frame holds an image-mode map; an interactive map has its own element inside the frame.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // The map lives in the framework-free controller; this component draws its views.
  const controllerRef = useRef<TileflowMapController<TAnnotation> | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      getMap: () => controllerRef.current?.getMap() ?? null,
      getThemeController: () => controllerRef.current?.getThemeController() ?? null,
    }),
    [],
  );
  const [mapStatus, setMapStatus] = useState<TileflowMapStatus | null>(null);
  const [renderTargets, setRenderTargets] =
    useState<TileflowMapRenderTargetList<TAnnotation>>(noRenderTargets);
  const resolvedCaptureId = normalizeTileflowCaptureId(captureId);

  const controllerOptions: TileflowMapControllerOptions<TAnnotation> = {
    alt,
    analytics,
    annotationClusters,
    annotations,
    bounds,
    center,
    colors,
    dataOverlays,
    dataSources,
    emphasis,
    fitAnnotations,
    fitBoundsOptions,
    // The image this component renders, so it is there on the server too.
    image: isImageMode ? imageRef.current : undefined,
    imageLoading,
    imageUrl,
    interactions,
    interactive,
    mapOptions,
    mode: resolvedMode,
    navigationControl,
    onError,
    onInteractionDiagnostic,
    onInteractionEvent,
    onInteractionStateChange,
    onLoad,
    onStatusChange: setMapStatus,
    onThemeChange: props.onThemeChange,
    renderTargets: {
      marker: renderMarker !== undefined,
      onChange: setRenderTargets,
      popup: renderPopup !== undefined,
      tooltip: renderTooltip !== undefined,
    },
    source: runtimeSource,
    theme,
    themeBlend,
    themeTransition,
    timeOfDay,
    vegetation,
    viewMode,
    zoom,
    // Both are passed on, so a map given both reports it as it would with one.
    ...({defaultInteractionState, interactionState} as Pick<
      TileflowMapControllerOptions<TAnnotation>,
      'interactionState'
    >),
  };
  const controllerOptionsRef = useRef(controllerOptions);
  controllerOptionsRef.current = controllerOptions;
  // Before the map mounts, and on the server, the frame shows what the options already say.
  const status =
    mapStatus ??
    getTileflowMapInitialStatus(controllerOptions, controlledInteractionOwnershipRef.current);
  const interactionDiagnostic =
    status.diagnostics.find((diagnostic) => diagnostic.level === 'error') ?? status.diagnostics[0];
  const annotationRenderTargets = renderTargets.annotations;
  const semanticRenderTargets = renderTargets.semantic;
  // A marker is selected while its popup is open: the popup has a render target of its own.
  const openPopupAnnotationIds = useMemo(
    () =>
      new Set(
        annotationRenderTargets
          .filter((target) => target.kind === 'popup')
          .map((target) => target.annotation.id),
      ),
    [annotationRenderTargets],
  );
  const portalKeys = useMemo(
    () => [
      ...annotationRenderTargets.map((target) => `annotation:${target.key}`),
      ...semanticRenderTargets.map((target) => `semantic:${target.key}`),
    ],
    [annotationRenderTargets, semanticRenderTargets],
  );
  const portalReadiness = useTileflowPortalReadiness(portalKeys);
  const effectiveCaptureState =
    status.readiness === 'idle' && !portalReadiness.idle ? 'loading' : status.readiness;

  useLayoutEffect(() => {
    const container = isImageMode ? frameRef.current : containerRef.current;
    if (!container) return;
    const controller = createTileflowMap(container, controllerOptionsRef.current, {
      sessionSource: 'react',
      // The frame this component draws carries the capture attributes.
      statusElement: null,
    });
    controllerRef.current = controller;
    setMapStatus(controller.getStatus());
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.destroy();
      setMapStatus(null);
      setRenderTargets(noRenderTargets);
    };
  }, [isImageMode]);

  // Every render hands its props over; the map does only the work a change asks for.
  useLayoutEffect(() => {
    controllerRef.current?.update(controllerOptions);
  });

  const frameStyle: CSSProperties = {
    height,
    minHeight: 240,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  };
  const diagnosticView = interactionDiagnostic ? (
    <div
      data-tileflow-interaction-diagnostic={interactionDiagnostic.code}
      role="alert"
      style={interactionDiagnosticStyle}
    >
      {interactionDiagnostic.message}
    </div>
  ) : null;

  if (isImageMode) {
    return (
      <div
        className={className}
        data-tileflow-capture-id={resolvedCaptureId}
        data-tileflow-map={sourceMap}
        data-tileflow-theme={status.theme}
        data-tileflow-state={effectiveCaptureState}
        ref={frameRef}
        style={frameStyle}
      >
        {status.imageUrl ? (
          // The map tracks the image's load and decode for capture readiness.
          <img
            alt={alt}
            decoding="async"
            loading={imageLoading}
            ref={imageRef}
            src={status.imageUrl}
            style={{
              display: 'block',
              height: '100%',
              objectFit: 'cover',
              width: '100%',
            }}
          />
        ) : null}
        {diagnosticView}
      </div>
    );
  }

  return (
    <>
      <div
        className={className}
        data-tileflow-capture-id={resolvedCaptureId}
        data-tileflow-map={sourceMap}
        data-tileflow-theme={status.theme}
        data-tileflow-state={effectiveCaptureState}
        style={frameStyle}
      >
        <div ref={containerRef} style={mapContainerStyle} />
        {diagnosticView}
      </div>
      {annotationRenderTargets.map((target) => {
        const portalKey = `annotation:${target.key}`;
        return createPortal(
          <TileflowAnnotationPortal
            onCommit={portalReadiness.markCommitted}
            portalKey={portalKey}
            readinessToken={portalReadiness.token}
            renderMarker={renderMarker}
            renderPopup={generalRenderPopup}
            renderTarget={target}
            renderTooltip={generalRenderTooltip}
            selected={openPopupAnnotationIds.has(target.annotation.id)}
          />,
          target.container,
          portalKey,
        );
      })}
      {semanticRenderTargets.map((target) => {
        const portalKey = `semantic:${target.key}`;
        return createPortal(
          <TileflowSemanticPortal<TAnnotation>
            onCommit={portalReadiness.markCommitted}
            portalKey={portalKey}
            readinessToken={portalReadiness.token}
            renderPopup={generalRenderPopup}
            renderTarget={target}
            renderTooltip={generalRenderTooltip}
          />,
          target.container,
          portalKey,
        );
      })}
    </>
  );
}) as unknown as MapComponent;

const mapContainerStyle: CSSProperties = {
  inset: 0,
  position: 'absolute',
};

const interactionDiagnosticStyle: CSSProperties = {
  background: '#7f1d1d',
  border: '1px solid #fecaca',
  borderRadius: 4,
  color: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  left: 12,
  maxWidth: 'calc(100% - 24px)',
  padding: '8px 10px',
  position: 'absolute',
  top: 12,
  zIndex: 10,
};

type TileflowAnnotationPortalProps<TAnnotation extends TileflowAnnotation> = Readonly<{
  onCommit: TileflowPortalCommitListener;
  portalKey: string;
  readinessToken: string;
  renderMarker?: TileflowAnnotationRenderer<TAnnotation>;
  renderPopup?: TileflowInteractionRenderer<TAnnotation>;
  renderTarget: TileflowMapLibreDomRenderTarget<TAnnotation>;
  renderTooltip?: TileflowInteractionRenderer<TAnnotation>;
  selected: boolean;
}>;

/** Hover and focus of a marker, read from its element so only this marker's view renders again. */
function useMarkerPointerState(container: HTMLElement, enabled: boolean) {
  const [state, setState] = useState({focused: false, hovered: false});
  useEffect(() => {
    if (!enabled) return;
    const element = container.closest<HTMLElement>('[data-tileflow-interaction="marker"]');
    if (!element) return;
    const set = (patch: Partial<typeof state>) => setState((previous) => ({...previous, ...patch}));
    const enter = () => set({hovered: true});
    const leave = () => set({hovered: false});
    const focus = () => set({focused: true});
    const blur = () => set({focused: false});
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', blur);
    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', blur);
    };
  }, [container, enabled]);
  return state;
}

function TileflowAnnotationPortal<TAnnotation extends TileflowAnnotation>({
  onCommit,
  portalKey,
  readinessToken,
  renderMarker,
  renderPopup,
  renderTarget,
  renderTooltip,
  selected,
}: TileflowAnnotationPortalProps<TAnnotation>) {
  useLayoutEffect(() => {
    onCommit(readinessToken, portalKey);
  }, [onCommit, portalKey, readinessToken]);
  const pointer = useMarkerPointerState(renderTarget.container, renderTarget.kind === 'marker');

  const {annotation} = renderTarget;
  const content =
    renderTarget.kind === 'marker'
      ? annotation.marker?.content
      : renderTarget.kind === 'tooltip'
        ? annotation.tooltip?.content
        : annotation.popup?.content;
  const context: TileflowAnnotationViewContext<TAnnotation> = {
    annotation,
    close: renderTarget.close,
    ...(content ? {content} : {}),
    target: {
      annotation,
      coordinate: annotation.coordinate,
      kind: 'annotation',
    },
    ...(content?.kind === 'view' ? {viewName: content.name} : {}),
    ...(renderTarget.kind === 'marker' ? {state: {...pointer, selected}} : {}),
  };
  if (renderTarget.kind === 'marker') return renderMarker?.(context) ?? null;
  const renderer = renderTarget.kind === 'tooltip' ? renderTooltip : renderPopup;
  return renderer?.(context) ?? null;
}

type TileflowSemanticPortalProps<TAnnotation extends TileflowAnnotation> = Readonly<{
  onCommit: TileflowPortalCommitListener;
  portalKey: string;
  readinessToken: string;
  renderPopup?: TileflowInteractionRenderer<TAnnotation>;
  renderTarget: TileflowMapLibreSemanticDomRenderTarget;
  renderTooltip?: TileflowInteractionRenderer<TAnnotation>;
}>;

function TileflowSemanticPortal<TAnnotation extends TileflowAnnotation>({
  onCommit,
  portalKey,
  readinessToken,
  renderPopup,
  renderTarget,
  renderTooltip,
}: TileflowSemanticPortalProps<TAnnotation>) {
  useLayoutEffect(() => {
    onCommit(readinessToken, portalKey);
  }, [onCommit, portalKey, readinessToken]);

  const context: TileflowInteractionViewContext<TAnnotation> = {
    close: renderTarget.close,
    content: renderTarget.content,
    target: renderTarget.target,
    ...(renderTarget.viewName ? {viewName: renderTarget.viewName} : {}),
  };
  const renderer = renderTarget.kind === 'tooltip' ? renderTooltip : renderPopup;
  return renderer?.(context) ?? null;
}

type TileflowPortalCommitListener = (readinessToken: string, portalKey: string) => void;

type TileflowPortalCommitSnapshot = Readonly<{
  keys: ReadonlySet<string>;
  token: string;
}>;

function useTileflowPortalReadiness(portalKeys: readonly string[]) {
  const signature = JSON.stringify([...portalKeys].sort());
  const versionRef = useRef({signature, version: 0});
  if (versionRef.current.signature !== signature) {
    versionRef.current = {signature, version: versionRef.current.version + 1};
  }
  const token = `${versionRef.current.version}:${signature}`;
  const expectedKeysRef = useRef({keys: [...portalKeys].sort(), token});
  if (expectedKeysRef.current.token !== token) {
    expectedKeysRef.current = {keys: [...portalKeys].sort(), token};
  }
  const expectedKeys = expectedKeysRef.current.keys;
  const [committed, setCommitted] = useState<TileflowPortalCommitSnapshot>(() => ({
    keys: new Set(),
    token,
  }));
  const [readyToken, setReadyToken] = useState(token);
  const readinessRunRef = useRef(0);
  const markCommitted = useCallback<TileflowPortalCommitListener>((committedToken, portalKey) => {
    setCommitted((current) => {
      if (current.token !== committedToken) {
        return {keys: new Set([portalKey]), token: committedToken};
      }
      if (current.keys.has(portalKey)) return current;
      return {keys: new Set([...current.keys, portalKey]), token: committedToken};
    });
  }, []);

  useLayoutEffect(() => {
    setCommitted((current) => (current.token === token ? current : {keys: new Set(), token}));
  }, [token]);

  useLayoutEffect(() => {
    if (
      readyToken === token ||
      committed.token !== token ||
      !expectedKeys.every((key) => committed.keys.has(key))
    ) {
      return;
    }

    const browserWindow = globalThis.window;
    const run = ++readinessRunRef.current;
    let secondFrame: number | undefined;
    const firstFrame = browserWindow.requestAnimationFrame(() => {
      secondFrame = browserWindow.requestAnimationFrame(() => {
        if (readinessRunRef.current === run) setReadyToken(token);
      });
    });

    return () => {
      readinessRunRef.current += 1;
      browserWindow.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) browserWindow.cancelAnimationFrame(secondFrame);
    };
  }, [committed, expectedKeys, readyToken, token]);

  return {idle: readyToken === token, markCommitted, token};
}
