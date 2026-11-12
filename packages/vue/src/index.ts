import type {
  LngLatLike,
  Map as MapLibreMap,
  MapOptions as MapLibreMapOptions,
  Marker as MapLibreMarker,
  Popup as MapLibrePopup,
} from 'maplibre-gl';
import {
  computed,
  type CSSProperties,
  defineComponent,
  type DefineComponent,
  getCurrentInstance,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  type PropType,
  ref,
  shallowRef,
  type SlotsType,
  Teleport,
  toRaw,
  type VNode,
  type VNodeChild,
  watch,
  watchEffect,
} from 'vue';
import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core';
import {
  getTileflowSystemColorScheme,
  reportTileflowMapError,
  resolveTileflowCameraFit,
  subscribeTileflowSystemColorScheme,
  type TileflowAppearanceBinding,
  type TileflowBounds,
  type TileflowBrowserThemeBlendSelection,
  type TileflowCameraFit,
  type TileflowColorOverrides,
  type TileflowEmphasis,
  type TileflowFitBoundsOptions,
  type TileflowMap3DAttachment,
  type TileflowMapError,
  type TileflowMapErrorCode,
  type TileflowNavigationControlBinding,
  type TileflowNavigationControlInput,
  type TileflowThemeController,
  type TileflowThemeTransition,
  type TileflowThemeTransitionOptions,
  type TileflowViewMode,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {mountTileflowMap, type TileflowMountedMap} from '@tileflow/core/maplibre';
import {
  defaultTileflowManifestUrl,
  defaultTileflowRuntimeView,
  loadTileflowManifest,
  mergeTileflowAnalytics,
  nearestTileflowBlendTheme,
  normalizeTileflowRuntimeCenter,
  normalizeTileflowStaticImageSize,
  resolveTileflowManifestMap,
  resolveTileflowMapMode,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeTheme,
  resolveTileflowRuntimeThemeBlend,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  type TileflowAnalytics,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeSource,
  type TileflowRuntimeStyle,
  type TileflowTimeOfDay,
} from '@tileflow/core/runtime';
import {
  initialTileflowInteractionState,
  type TileflowAnnotation,
  type TileflowAnnotationViewContext,
  type TileflowInteractionBinding,
  type TileflowInteractionDiagnostic,
  type TileflowInteractionEvent,
  type TileflowInteractionJsonValue,
  type TileflowInteractionState,
  type TileflowInteractionViewContext,
  unusedTileflowRendererDiagnostics,
} from '@tileflow/interactions';
import {
  createTileflowMapLibreDataRuntime,
  createTileflowMapLibreDomRuntime,
  createTileflowMapLibreInteractionCoordinator,
  createTileflowMapLibreSemanticDomRuntime,
  type TileflowAnnotationClusterOptions,
  type TileflowMapLibreDataRuntime,
  type TileflowMapLibreDomRenderTarget,
  type TileflowMapLibreDomRuntime,
  type TileflowMapLibrePoiMap,
  type TileflowMapLibreSemanticDomRenderTarget,
  type TileflowMapLibreSemanticDomRuntime,
} from '@tileflow/interactions/maplibre';
import {
  createTileflowVueInteractionDiagnostic,
  resolveTileflowVueAnnotations,
  resolveTileflowVueInteractionBindings,
  validateTileflowVueInteractionState,
} from './interactions.js';
import {loadTileflowMapLibre} from './maplibre.js';
import {assertTileflowMapStyleInputs, type TileflowMapStyleSourceProps} from './style-source.js';

export {configureTileflowMapLibre} from './maplibre.js';
export type {TileflowMapLibreConfiguration} from './maplibre.js';

export type TileflowMapMode = 'interactive' | 'image';
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;
export type TileflowMapSource = TileflowRuntimeSource;

export type TileflowMapAnnotationSlotContext<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = TileflowAnnotationViewContext<TAnnotation>;

export type TileflowMapInteractionSlotContext<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = TileflowInteractionViewContext<TAnnotation>;

export type TileflowMapSlots<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = {
  marker?: (context: TileflowMapAnnotationSlotContext<TAnnotation>) => VNodeChild;
  popup?: (context: TileflowMapInteractionSlotContext<TAnnotation>) => VNodeChild;
  tooltip?: (context: TileflowMapInteractionSlotContext<TAnnotation>) => VNodeChild;
};

type TileflowMapSharedProps = {
  vegetation?: boolean;
  viewMode?: TileflowViewMode;
  alt?: string;
  analytics?: TileflowAnalytics;
  center?: [number, number];
  captureId?: string;
  className?: string;
  height?: number | string;
  imageLoading?: HTMLImageElement['loading'];
  imageUrl?: string;
  mapOptions?: TileflowMapOptions;
  zoom?: number;
};

type TileflowMapViewProps = {
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
};

type TileflowMapNavigationProps = {
  /**
   * The zoom and compass buttons of an interactive map. A map shows none unless asked: `true` shows
   * them at `top-right`, and an object moves them or limits their buttons.
   */
  navigationControl?: TileflowNavigationControlInput;
};

type TileflowMapStateInput =
  | {defaultInteractionState?: never; interactionState?: TileflowInteractionState}
  | {defaultInteractionState?: TileflowInteractionState; interactionState?: never};

type TileflowMapInteractiveProps<TAnnotation extends TileflowAnnotation> = TileflowMapSharedProps &
  TileflowMapStateInput & {
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
    interactions?: readonly TileflowInteractionBinding[];
    interactive?: boolean;
    mode?: 'interactive';
  } & TileflowMapNavigationProps &
  TileflowMapViewProps;

type TileflowMapImageProps = TileflowMapSharedProps & {
  annotationClusters?: never;
  annotations?: never;
  colors?: never;
  dataOverlays?: never;
  dataSources?: never;
  defaultInteractionState?: never;
  emphasis?: never;
  interactionState?: never;
  interactions?: never;
  interactive?: never;
  mode: 'image';
  navigationControl?: never;
  bounds?: never;
  fitAnnotations?: never;
  fitBoundsOptions?: never;
};

export type TileflowMapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = (
  TileflowMapInteractiveProps<TAnnotation> | TileflowMapImageProps
) &
  TileflowMapStyleSourceProps;

type RuntimeTileflowAnnotation = TileflowAnnotation<TileflowInteractionJsonValue>;
type RuntimeTileflowMapProps = TileflowMapSharedProps &
  TileflowMapStyleSourceProps & {
    annotationClusters?: TileflowAnnotationClusterOptions;
    annotations?: readonly RuntimeTileflowAnnotation[];
    colors?: TileflowColorOverrides;
    dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>>;
    dataSources?: Readonly<Record<string, TileflowGeoJsonSource>>;
    defaultInteractionState?: TileflowInteractionState;
    emphasis?: TileflowEmphasis;
    interactionState?: TileflowInteractionState;
    interactions?: readonly TileflowInteractionBinding[];
    interactive?: boolean;
    mode?: TileflowMapMode;
    navigationControl?: TileflowNavigationControlInput;
    bounds?: TileflowBounds;
    fitAnnotations?: boolean | TileflowFitBoundsOptions;
    fitBoundsOptions?: TileflowFitBoundsOptions;
  };

type PublicTileflowMapStatics = Pick<
  DefineComponent<RuntimeTileflowMapProps>,
  keyof DefineComponent<RuntimeTileflowMapProps>
>;

/**
 * What a template `ref` on `TileflowMap` exposes: the objects behind the map, for the moments when
 * the props are not enough. Both are `null` until the map has loaded, in image mode, and after it
 * is taken down, so call them from event handlers and `onMounted` callbacks that wait for `load`.
 */
export type TileflowMapHandle = {
  /** The MapLibre map, or `null` while there is none. */
  getMap(): MapLibreMap | null;
  /** Changes the map's theme, colours and emphasis; `null` when the map's style has no themes. */
  getThemeController(): TileflowThemeController | null;
};

type PublicTileflowMapComponent = PublicTileflowMapStatics & {
  new <TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
    props: TileflowMapProps<TAnnotation>,
  ): TileflowMapHandle & {
    $emit: {
      (event: 'interactionDiagnostic', diagnostic: TileflowInteractionDiagnostic): void;
      (event: 'interactionEvent', interactionEvent: TileflowInteractionEvent<TAnnotation>): void;
      (event: 'error', error: TileflowMapError): void;
      (event: 'load', map: MapLibreMap): void;
      (event: 'themeChange', transition: TileflowThemeTransition): void;
      (event: 'update:interactionState', state: TileflowInteractionState): void;
    };
    $props: TileflowMapProps<TAnnotation>;
    $slots: TileflowMapSlots<TAnnotation>;
  };
};

/**
 * One marker's view. It reads hover and focus from the marker's element, so only this marker's slot
 * renders again when they change.
 */
const TileflowMarkerPortal = defineComponent({
  name: 'TileflowMarkerPortal',
  props: {
    context: {
      required: true,
      type: Object as PropType<TileflowMapAnnotationSlotContext<RuntimeTileflowAnnotation>>,
    },
    selected: {required: true, type: Boolean},
    slot: {
      required: true,
      type: Function as PropType<
        (context: TileflowMapAnnotationSlotContext<RuntimeTileflowAnnotation>) => VNode[]
      >,
    },
    to: {required: true, type: Object as PropType<HTMLElement>},
  },
  setup(props) {
    const hovered = ref(false);
    const focused = ref(false);
    let element: HTMLElement | null = null;
    const enter = () => (hovered.value = true);
    const leave = () => (hovered.value = false);
    const focus = () => (focused.value = true);
    const blur = () => (focused.value = false);
    onMounted(() => {
      element = props.to.closest<HTMLElement>('[data-tileflow-interaction="marker"]');
      element?.addEventListener('pointerenter', enter);
      element?.addEventListener('pointerleave', leave);
      element?.addEventListener('focusin', focus);
      element?.addEventListener('focusout', blur);
    });
    onBeforeUnmount(() => {
      element?.removeEventListener('pointerenter', enter);
      element?.removeEventListener('pointerleave', leave);
      element?.removeEventListener('focusin', focus);
      element?.removeEventListener('focusout', blur);
    });
    return () =>
      h(
        Teleport,
        {to: props.to},
        props.slot({
          ...props.context,
          state: {focused: focused.value, hovered: hovered.value, selected: props.selected},
        }),
      );
  },
});

export const TileflowMap = defineComponent<RuntimeTileflowMapProps>({
  name: 'TileflowMap',
  inheritAttrs: false,
  slots: Object as SlotsType<TileflowMapSlots<RuntimeTileflowAnnotation>>,
  props: {
    alt: {
      default: '',
      type: String,
    },
    analytics: Object as PropType<TileflowAnalytics>,
    annotationClusters: Object as PropType<TileflowAnnotationClusterOptions>,
    annotations: Array as unknown as PropType<readonly RuntimeTileflowAnnotation[]>,
    center: Array as unknown as PropType<[number, number]>,
    captureId: String,
    className: String,
    colors: Object as PropType<TileflowColorOverrides>,
    dataOverlays: Object as PropType<Readonly<Record<string, TileflowMapLibreOverlay>>>,
    dataSources: Object as PropType<Readonly<Record<string, TileflowGeoJsonSource>>>,
    defaultInteractionState: Object as PropType<TileflowInteractionState>,
    emphasis: Object as PropType<TileflowEmphasis>,
    height: {
      default: 420,
      type: [Number, String] as PropType<number | string>,
    },
    imageLoading: {
      default: 'eager',
      type: String as PropType<HTMLImageElement['loading']>,
    },
    imageUrl: String,
    interactive: {
      default: undefined,
      type: Boolean as PropType<boolean | undefined>,
    },
    interactions: Array as unknown as PropType<readonly TileflowInteractionBinding[]>,
    interactionState: Object as PropType<TileflowInteractionState>,
    mapOptions: Object as PropType<TileflowMapOptions>,
    mode: {
      default: 'interactive',
      type: String as PropType<TileflowMapMode>,
    },
    navigationControl: {
      default: undefined,
      type: [Boolean, Object] as PropType<TileflowNavigationControlInput>,
    },
    bounds: Array as unknown as PropType<TileflowBounds>,
    fitAnnotations: {
      // A Boolean prop that is left out would read as false and look like a choice.
      default: undefined,
      type: [Boolean, Object] as PropType<boolean | TileflowFitBoundsOptions>,
    },
    fitBoundsOptions: Object as PropType<TileflowFitBoundsOptions>,
    source: {
      required: true,
      type: Object as PropType<TileflowRuntimeSource>,
    },
    vegetation: {type: Boolean as PropType<boolean | undefined>, default: undefined},
    viewMode: {type: String as PropType<TileflowViewMode>, default: '3d'},
    theme: String,
    timeOfDay: String as PropType<TileflowTimeOfDay>,
    themeBlend: Object as PropType<TileflowBrowserThemeBlendSelection>,
    themeTransition: Object as PropType<TileflowThemeTransitionOptions>,
    zoom: Number,
  },
  emits: {
    interactionDiagnostic: (_diagnostic: TileflowInteractionDiagnostic) => true,
    error: (_error: TileflowMapError) => true,
    interactionEvent: (_event: TileflowInteractionEvent<RuntimeTileflowAnnotation>) => true,
    load: (_map: MapLibreMap) => true,
    themeChange: (_transition: TileflowThemeTransition) => true,
    'update:interactionState': (_state: TileflowInteractionState) => true,
  },
  setup(props, {attrs, emit, expose, slots}) {
    const instance = getCurrentInstance();
    // With a listener the failure is emitted as `error`; without one it goes to the console.
    const reportError = (code: TileflowMapErrorCode, cause: unknown) =>
      reportTileflowMapError(
        instance?.vnode.props?.onError ? (event) => emit('error', event) : undefined,
        code,
        cause,
      );
    const containerRef = ref<HTMLDivElement | null>(null);
    const loadedManifestMap = shallowRef<TileflowRuntimeManifestMap | null>(null);
    const manifestResolutionKey = ref('');
    const manifestResolutionState = ref<'error' | 'loading' | 'ready'>('loading');
    const imageSize = shallowRef<{height: number; width: number} | null>(null);
    const mapRef = shallowRef<MapLibreMap | null>(null);
    const systemColorScheme = ref<'dark' | 'light'>('light');
    const mapCaptureState = ref<'error' | 'idle' | 'loading'>('loading');
    const themeTransitionState = ref<'error' | 'idle' | 'loading'>('idle');
    const activeRuntimeResource = shallowRef<unknown>(undefined);
    const interactionCaptureState = ref<'error' | 'idle' | 'loading'>('idle');
    const annotationRenderTargets = shallowRef<
      readonly TileflowMapLibreDomRenderTarget<RuntimeTileflowAnnotation>[]
    >([]);
    const semanticRenderTargets = shallowRef<readonly TileflowMapLibreSemanticDomRenderTarget[]>(
      [],
    );
    const controlledInteractionOwnership = props.interactionState !== undefined;
    let annotationRuntime: TileflowMapLibreDomRuntime<RuntimeTileflowAnnotation> | null = null;
    let dataRuntime: TileflowMapLibreDataRuntime<RuntimeTileflowAnnotation> | null = null;
    let semanticRuntime: TileflowMapLibreSemanticDomRuntime | null = null;
    let interactionRuntimesDisposing = false;
    let initializeSemanticRuntime: (() => void) | null = null;
    let annotationRuntimeDiagnosticsUnsubscribe: (() => void) | null = null;
    let annotationRuntimeCoordinatorDetach: (() => void) | null = null;
    let annotationRuntimeEventsUnsubscribe: (() => void) | null = null;
    let annotationRuntimeTargetsUnsubscribe: (() => void) | null = null;
    let semanticRuntimeDiagnosticsUnsubscribe: (() => void) | null = null;
    let semanticRuntimeCoordinatorDetach: (() => void) | null = null;
    let semanticRuntimeEventsUnsubscribe: (() => void) | null = null;
    let semanticRuntimeTargetsUnsubscribe: (() => void) | null = null;
    let activeAnnotationDiagnosticKeys = new Set<string>();
    let activeSemanticDiagnosticKeys = new Set<string>();
    let annotationRuntimeDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
    let semanticRuntimeDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
    let imageResizeObserver: ResizeObserver | null = null;
    let mountedMap: TileflowMountedMap | null = null;
    let navigationBinding: TileflowNavigationControlBinding | null = null;
    let sceneAttachment: TileflowMap3DAttachment | null = null;
    let themeController: TileflowThemeController | null = null;
    let appearanceBinding: TileflowAppearanceBinding | null = null;
    let unsubscribeSystemColorScheme: (() => void) | null = null;
    let mapLoadId = 0;
    let resourceLifetime: AbortController | undefined;
    let manifestLoadId = 0;
    let readinessRunId = 0;
    let interactionReadinessRunId = 0;
    let interactionReadinessFrames: number[] = [];
    let interactionOverlayFailed = false;
    let interactionInputDiagnosticSignature = '';

    const resolvedMode = computed(() => resolveTileflowMapMode({mode: props.mode}));
    const isImageMode = computed(() => resolvedMode.value === 'image');
    const annotationResolution = computed(() =>
      resolveTileflowVueAnnotations({
        annotations: props.annotations,
      }),
    );
    const interactionBindingResolution = computed(() =>
      resolveTileflowVueInteractionBindings(props.interactions),
    );
    const cameraFit = computed(() =>
      resolveTileflowCameraFit({
        annotations: props.annotations ?? [],
        bounds: props.bounds,
        fitAnnotations: props.fitAnnotations,
        fitBoundsOptions: props.fitBoundsOptions,
      }),
    );
    let appliedCameraFitKey: string | undefined;
    const fitCamera = (map: MapLibreMap, fit: TileflowCameraFit, duration?: number) => {
      map.fitBounds(fit.bounds, {
        ...(fit.options.maxZoom === undefined ? {} : {maxZoom: fit.options.maxZoom}),
        ...(fit.options.padding === undefined ? {} : {padding: fit.options.padding}),
        ...(duration !== undefined
          ? {duration}
          : fit.options.duration === undefined
            ? {}
            : {duration: fit.options.duration}),
      });
    };
    const interactionStateDiagnostics = computed<readonly TileflowInteractionDiagnostic[]>(() => {
      const diagnostics = [
        ...validateTileflowVueInteractionState(
          props.interactionState,
          props.defaultInteractionState,
        ),
      ];
      if ((props.interactionState !== undefined) !== controlledInteractionOwnership) {
        diagnostics.push(
          createTileflowVueInteractionDiagnostic(
            'INVALID_DOCUMENT',
            'Tileflow interaction state ownership cannot switch between controlled and uncontrolled.',
          ),
        );
      }
      return diagnostics;
    });
    const hasInteractionConfiguration = computed(
      () =>
        props.annotationClusters !== undefined ||
        props.annotations !== undefined ||
        props.dataOverlays !== undefined ||
        props.dataSources !== undefined ||
        props.interactions !== undefined ||
        props.interactionState !== undefined ||
        props.defaultInteractionState !== undefined ||
        slots.marker !== undefined ||
        slots.popup !== undefined ||
        slots.tooltip !== undefined,
    );
    const interactionInputDiagnostics = computed<readonly TileflowInteractionDiagnostic[]>(() => {
      const diagnostics = [
        ...annotationResolution.value.diagnostics,
        ...interactionBindingResolution.value.diagnostics,
        ...interactionStateDiagnostics.value,
      ];

      if (!isImageMode.value) {
        diagnostics.push(
          ...unusedTileflowRendererDiagnostics({
            annotations: props.annotations ?? [],
            bindings: props.interactions ?? [],
            hasPopupRenderer: slots.popup !== undefined,
            hasTooltipRenderer: slots.tooltip !== undefined,
          }),
        );
      }

      if (isImageMode.value && hasInteractionConfiguration.value) {
        diagnostics.push(
          createTileflowVueInteractionDiagnostic(
            'UNSUPPORTED_MODE',
            'Annotations, semantic interactions, and interaction state are unavailable in image mode.',
          ),
        );
      }

      return diagnostics;
    });
    const initialInteractionState =
      validateTileflowVueInteractionState(props.interactionState, props.defaultInteractionState)
        .length === 0
        ? (props.interactionState ??
          props.defaultInteractionState ??
          initialTileflowInteractionState)
        : initialTileflowInteractionState;
    const interactionCoordinator = createTileflowMapLibreInteractionCoordinator({
      onInteractionStateChange(nextState) {
        if (interactionRuntimesDisposing) return;
        emit('update:interactionState', nextState);
      },
      ...(controlledInteractionOwnership
        ? {interactionState: initialInteractionState}
        : {defaultInteractionState: initialInteractionState}),
    });
    const mapName = computed(() => props.source.map);
    const manifestUrl = computed(() => props.source.manifestUrl ?? defaultTileflowManifestUrl);
    const manifestRequestKey = computed(() => JSON.stringify([manifestUrl.value, mapName.value]));
    const currentManifestResolutionState = computed(() =>
      manifestResolutionKey.value === manifestRequestKey.value
        ? manifestResolutionState.value
        : 'loading',
    );
    const manifestMap = computed(() =>
      manifestResolutionKey.value === manifestRequestKey.value &&
      manifestResolutionState.value === 'ready'
        ? loadedManifestMap.value
        : null,
    );
    // A blend shows its nearest theme until the blend style is ready, and names it while blending.
    const themeBlendKey = computed(() =>
      props.themeBlend ? JSON.stringify(props.themeBlend.themes) : undefined,
    );
    const themeResolution = computed(() => {
      const selection = props.themeBlend
        ? nearestTileflowBlendTheme(props.themeBlend)
        : props.theme;
      if (!manifestMap.value) {
        return {
          error: false,
          name: selection && selection !== 'system' ? selection : undefined,
        } as const;
      }

      try {
        for (const name of props.themeBlend?.themes ?? []) {
          resolveTileflowRuntimeTheme(manifestMap.value, name);
        }
        return {
          error: false,
          name: resolveTileflowRuntimeTheme(
            manifestMap.value,
            selection,
            systemColorScheme.value,
            props.themeBlend ? undefined : props.timeOfDay,
          ).name,
        } as const;
      } catch (cause) {
        return {cause, error: true, name: undefined} as const;
      }
    });
    const resolvedThemeName = computed(() => themeResolution.value.name);
    const manifestView = computed(() =>
      resolveTileflowRuntimeView({manifestMap: manifestMap.value}),
    );
    const manifestCenter = computed<[number, number]>(() =>
      normalizeTileflowRuntimeCenter(manifestView.value.center),
    );
    const imageCenter = computed(() =>
      normalizeTileflowRuntimeCenter(
        props.center ?? props.mapOptions?.center,
        manifestCenter.value,
      ),
    );
    const imageZoom = computed(
      () =>
        props.zoom ??
        props.mapOptions?.zoom ??
        manifestView.value.zoom ??
        defaultTileflowRuntimeView.zoom,
    );
    const resolvedCenter = computed<LngLatLike>(
      () => props.center ?? props.mapOptions?.center ?? manifestCenter.value,
    );
    const resolvedZoom = computed(
      () =>
        props.zoom ??
        props.mapOptions?.zoom ??
        manifestView.value.zoom ??
        defaultTileflowRuntimeView.zoom,
    );
    const resolvedBearing = computed(() => props.mapOptions?.bearing ?? manifestView.value.bearing);
    const resolvedPitch = computed(() => props.mapOptions?.pitch ?? manifestView.value.pitch);
    const resolvedInteractive = computed(
      () => props.interactive ?? props.mapOptions?.interactive ?? true,
    );
    const runtimeStyle = computed(() =>
      isImageMode.value || themeResolution.value.error
        ? null
        : resolveTileflowRuntimeStyle({
            colorScheme: systemColorScheme.value,
            manifestMap: manifestMap.value,
            source: props.source,
            theme: themeResolution.value.name,
          }),
    );
    const blendResolution = computed<{
      cause?: unknown;
      styles: TileflowRuntimeStyle[] | null;
    }>(() => {
      const key = themeBlendKey.value;
      if (isImageMode.value || !manifestMap.value || !key) return {styles: null};
      try {
        return {
          styles: resolveTileflowRuntimeThemeBlend({
            blend: {position: 0, themes: JSON.parse(key) as string[]},
            manifestMap: manifestMap.value,
            source: props.source,
          }),
        };
      } catch (cause) {
        return {cause, styles: null};
      }
    });
    const blendStyles = computed(() => blendResolution.value.styles);
    const resolvedAnalytics = computed(() =>
      mergeTileflowAnalytics(props.analytics, runtimeStyle.value?.analytics),
    );
    const runtimeImageUrl = computed(
      () =>
        props.imageUrl ??
        (isImageMode.value && !themeResolution.value.error
          ? resolveTileflowStaticImageUrl({
              center: imageCenter.value,
              colorScheme: systemColorScheme.value,
              imageSize: imageSize.value,
              manifestMap: manifestMap.value,
              theme: themeResolution.value.name,
              zoom: imageZoom.value,
            })
          : undefined),
    );
    const runtimeResolutionState = computed<'error' | 'idle' | 'loading'>(() => {
      if (currentManifestResolutionState.value !== 'ready') {
        return currentManifestResolutionState.value === 'error' ? 'error' : 'loading';
      }
      if (themeResolution.value.error) return 'error';
      if (isImageMode.value) {
        if (runtimeImageUrl.value) return 'idle';
        return props.imageUrl === undefined && imageSize.value === null ? 'loading' : 'error';
      }
      return runtimeStyle.value ? 'idle' : 'error';
    });
    const currentMapCaptureState = computed<'error' | 'idle' | 'loading'>(() =>
      activeRuntimeResource.value ===
      (isImageMode.value ? runtimeImageUrl.value : runtimeStyle.value)
        ? mapCaptureState.value
        : 'loading',
    );
    const captureState = computed<'error' | 'idle' | 'loading'>(() => {
      if (
        currentMapCaptureState.value === 'error' ||
        interactionCaptureState.value === 'error' ||
        runtimeResolutionState.value === 'error' ||
        themeTransitionState.value === 'error'
      ) {
        return 'error';
      }
      if (
        currentMapCaptureState.value === 'loading' ||
        interactionCaptureState.value === 'loading' ||
        runtimeResolutionState.value === 'loading' ||
        themeTransitionState.value === 'loading'
      ) {
        return 'loading';
      }
      return 'idle';
    });
    const frameStyle = computed<CSSProperties>(() => ({
      height: formatHeight(props.height ?? 420),
      minHeight: '240px',
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    }));
    const resolvedCaptureId = computed(() => normalizeTileflowCaptureId(props.captureId));

    const emitInteractionDiagnostics = (diagnostics: readonly TileflowInteractionDiagnostic[]) => {
      for (const diagnostic of diagnostics) emit('interactionDiagnostic', diagnostic);
    };

    const hasInteractionErrors = () =>
      interactionOverlayFailed ||
      interactionInputDiagnostics.value.some(({level}) => level === 'error') ||
      annotationRuntimeDiagnostics.some(({level}) => level === 'error') ||
      semanticRuntimeDiagnostics.some(({level}) => level === 'error');

    const invalidateInteractionReadiness = () => {
      interactionReadinessRunId += 1;
      if (typeof cancelAnimationFrame === 'function') {
        for (const frame of interactionReadinessFrames) cancelAnimationFrame(frame);
      }
      interactionReadinessFrames = [];
    };

    const settleInteractionReadiness = () => {
      invalidateInteractionReadiness();
      if (hasInteractionErrors()) {
        interactionCaptureState.value = 'error';
        return;
      }

      const runId = interactionReadinessRunId;
      interactionCaptureState.value = 'loading';
      void nextTick().then(() => {
        if (runId !== interactionReadinessRunId || hasInteractionErrors()) return;
        const view = containerRef.value?.ownerDocument.defaultView;
        if (!view) {
          interactionCaptureState.value = 'idle';
          return;
        }

        const firstFrame = view.requestAnimationFrame(() => {
          interactionReadinessFrames = interactionReadinessFrames.filter(
            (frame) => frame !== firstFrame,
          );
          if (runId !== interactionReadinessRunId || hasInteractionErrors()) return;
          const secondFrame = view.requestAnimationFrame(() => {
            interactionReadinessFrames = interactionReadinessFrames.filter(
              (frame) => frame !== secondFrame,
            );
            if (runId !== interactionReadinessRunId || hasInteractionErrors()) return;
            interactionCaptureState.value = 'idle';
          });
          interactionReadinessFrames.push(secondFrame);
        });
        interactionReadinessFrames.push(firstFrame);
      });
    };

    let renderTargetKeySignature = '';
    const syncInteractionRenderTargetReadiness = () => {
      const nextSignature = JSON.stringify([
        ...annotationRenderTargets.value.map(({key}) => `annotation:${key}`),
        ...semanticRenderTargets.value.map(({key}) => `semantic:${key}`),
      ]);
      if (nextSignature === renderTargetKeySignature) return;
      renderTargetKeySignature = nextSignature;
      settleInteractionReadiness();
    };

    const syncRuntimeDiagnostics = (
      source: 'annotation' | 'semantic',
      diagnostics: readonly TileflowInteractionDiagnostic[],
    ) => {
      const previouslyActiveKeys = new Set([
        ...activeAnnotationDiagnosticKeys,
        ...activeSemanticDiagnosticKeys,
      ]);
      const nextKeys = new Set(diagnostics.map(interactionDiagnosticKey));
      if (source === 'annotation') {
        activeAnnotationDiagnosticKeys = nextKeys;
        annotationRuntimeDiagnostics = diagnostics;
      } else {
        activeSemanticDiagnosticKeys = nextKeys;
        semanticRuntimeDiagnostics = diagnostics;
      }
      emitInteractionDiagnostics(
        diagnostics.filter(
          (diagnostic) => !previouslyActiveKeys.has(interactionDiagnosticKey(diagnostic)),
        ),
      );
      settleInteractionReadiness();
    };

    const reportOverlayFailure = (message: string) => {
      interactionOverlayFailed = true;
      interactionCaptureState.value = 'error';
      emitInteractionDiagnostics([
        createTileflowVueInteractionDiagnostic('OVERLAY_FAILURE', message),
      ]);
    };

    watchEffect(() => {
      assertTileflowMapStyleInputs({
        source: props.source,
        theme: props.theme,
        timeOfDay: props.timeOfDay,
        themeBlend: props.themeBlend,
        themeTransition: props.themeTransition,
      });
    });

    watchEffect(() => {
      const diagnostics = interactionInputDiagnostics.value;
      const signature = JSON.stringify(diagnostics);
      if (signature !== interactionInputDiagnosticSignature) {
        interactionInputDiagnosticSignature = signature;
        emitInteractionDiagnostics(diagnostics);
      }
      settleInteractionReadiness();
    });

    const refreshManifest = async () => {
      const requestKey = manifestRequestKey.value;
      const loadId = ++manifestLoadId;
      loadedManifestMap.value = null;
      manifestResolutionKey.value = requestKey;
      manifestResolutionState.value = 'loading';

      try {
        const manifest = await loadTileflowManifest(manifestUrl.value);

        if (loadId === manifestLoadId) {
          const resolvedMap =
            manifest && mapName.value ? resolveTileflowManifestMap(manifest, mapName.value) : null;
          loadedManifestMap.value = resolvedMap;
          manifestResolutionState.value = resolvedMap ? 'ready' : 'error';
          if (!resolvedMap) {
            reportError(
              'manifest',
              new Error(
                manifest
                  ? `The Tileflow manifest at ${manifestUrl.value} has no map named "${mapName.value}".`
                  : `No Tileflow manifest was found at ${manifestUrl.value}.`,
              ),
            );
          }
        }
      } catch (error) {
        if (loadId === manifestLoadId) {
          reportError('manifest', error);
          loadedManifestMap.value = null;
          manifestResolutionState.value = 'error';
        }
      }
    };

    const updateImageResizeObserver = () => {
      imageResizeObserver?.disconnect();
      imageResizeObserver = null;
      imageSize.value = null;

      if (!isImageMode.value || props.imageUrl || !containerRef.value) {
        return;
      }

      const element = containerRef.value;
      const updateImageSize = () => {
        const nextSize = normalizeTileflowStaticImageSize({
          height: element.clientHeight,
          width: element.clientWidth,
        });

        imageSize.value =
          imageSize.value?.height === nextSize.height && imageSize.value.width === nextSize.width
            ? imageSize.value
            : nextSize;
      };

      imageResizeObserver = new ResizeObserver(updateImageSize);
      imageResizeObserver.observe(element);
      updateImageSize();
    };

    watch(
      () => [props.vegetation, props.viewMode] as const,
      ([visible, viewMode]) => {
        sceneAttachment?.setVegetation(visible);
        sceneAttachment?.setViewMode(viewMode ?? '3d');
      },
    );

    const takeAnnotationRuntimeCleanups = () => {
      const dataForMap = dataRuntime;
      const annotationInteractionsForMap = annotationRuntime;
      const teardownSteps = [
        annotationRuntimeTargetsUnsubscribe,
        annotationRuntimeDiagnosticsUnsubscribe,
        annotationRuntimeEventsUnsubscribe,
        annotationRuntimeCoordinatorDetach,
        () => dataForMap?.dispose(),
        () => annotationInteractionsForMap?.dispose(),
      ];
      dataRuntime = null;
      annotationRuntime = null;
      annotationRuntimeCoordinatorDetach = null;
      annotationRuntimeDiagnosticsUnsubscribe = null;
      annotationRuntimeEventsUnsubscribe = null;
      annotationRuntimeTargetsUnsubscribe = null;
      annotationRenderTargets.value = [];
      activeAnnotationDiagnosticKeys = new Set();
      annotationRuntimeDiagnostics = [];
      return teardownSteps;
    };

    const takeSemanticRuntimeCleanups = () => {
      const semanticInteractionsForMap = semanticRuntime;
      const teardownSteps = [
        semanticRuntimeTargetsUnsubscribe,
        semanticRuntimeDiagnosticsUnsubscribe,
        semanticRuntimeEventsUnsubscribe,
        semanticRuntimeCoordinatorDetach,
        () => semanticInteractionsForMap?.dispose(),
      ];
      semanticRuntime = null;
      semanticRuntimeDiagnosticsUnsubscribe = null;
      semanticRuntimeCoordinatorDetach = null;
      semanticRuntimeEventsUnsubscribe = null;
      semanticRuntimeTargetsUnsubscribe = null;
      semanticRenderTargets.value = [];
      activeSemanticDiagnosticKeys = new Set();
      semanticRuntimeDiagnostics = [];
      return teardownSteps;
    };

    const runInteractionCleanups = (teardownSteps: readonly ((() => void) | null)[]) => {
      const wasDisposing = interactionRuntimesDisposing;
      interactionRuntimesDisposing = true;
      let teardownError: unknown;
      for (const teardown of teardownSteps) {
        try {
          teardown?.();
        } catch (error) {
          teardownError ??= error;
        }
      }
      interactionRuntimesDisposing = wasDisposing;
      if (teardownError) {
        reportError('runtime', teardownError);
      }
    };

    const destroyMap = () => {
      mapLoadId += 1;
      const lifetime = resourceLifetime;
      resourceLifetime = undefined;
      readinessRunId += 1;
      invalidateInteractionReadiness();
      const runtime = mountedMap;
      mountedMap = null;
      appearanceBinding = null;
      sceneAttachment = null;
      navigationBinding = null;
      initializeSemanticRuntime = null;
      renderTargetKeySignature = '';
      mapRef.value = null;
      themeController = null;
      runInteractionCleanups([
        ...takeAnnotationRuntimeCleanups(),
        ...takeSemanticRuntimeCleanups(),
        // The base map remains available while application-owned interaction resources detach.
        () => runtime?.dispose(),
        () => lifetime?.abort(),
      ]);
      interactionCaptureState.value = hasInteractionErrors() ? 'error' : 'idle';
    };

    const syncAnnotationRuntime = () => {
      const resolution = annotationResolution.value;

      if (!annotationRuntime) return;

      try {
        annotationRuntime.reconcile(
          resolution.ok && !isImageMode.value ? resolution.annotations : [],
        );
      } catch {
        reportOverlayFailure('Unable to reconcile the Tileflow annotation runtime.');
      }
    };

    /** Workers cannot clone reactive proxies, so raw data crosses that boundary. */
    const syncDataRuntime = () => {
      const resolution = annotationResolution.value;
      if (!dataRuntime) return;
      try {
        dataRuntime.reconcile({
          annotationClusters: props.annotationClusters,
          annotations: resolution.ok && !isImageMode.value ? resolution.annotations : [],
          dataOverlays: props.dataOverlays,
          dataSources:
            props.dataSources &&
            Object.fromEntries(
              Object.entries(toRaw(props.dataSources) as Record<string, TileflowGeoJsonSource>).map(
                ([id, source]) => [id, {...toRaw(source), data: toRaw(source.data)}],
              ),
            ),
        });
      } catch {
        reportOverlayFailure('Unable to reconcile the Tileflow data layers.');
      }
    };

    const syncSemanticRuntime = () => {
      const resolution = interactionBindingResolution.value;
      const bindings = resolution.ok && !isImageMode.value ? resolution.bindings : [];

      if (bindings.length > 0 && !semanticRuntime) initializeSemanticRuntime?.();
      if (!semanticRuntime) return;

      try {
        semanticRuntime.reconcile(bindings);
      } catch {
        reportOverlayFailure('Unable to reconcile the Tileflow semantic interaction runtime.');
      }
    };

    const syncCustomRenderers = () => {
      try {
        annotationRuntime?.setCustomRenderers({
          marker: slots.marker !== undefined,
          popup: slots.popup !== undefined,
          tooltip: slots.tooltip !== undefined,
        });
        semanticRuntime?.setCustomRenderers({
          popup: slots.popup !== undefined,
          tooltip: slots.tooltip !== undefined,
        });
      } catch {
        reportOverlayFailure('Unable to update the Tileflow interaction renderers.');
      }
    };

    const recreateMap = async () => {
      destroyMap();
      interactionOverlayFailed = false;
      settleInteractionReadiness();
      mapCaptureState.value = 'loading';
      themeTransitionState.value = 'idle';

      if (isImageMode.value) {
        await resetImageReadiness();
        return;
      }

      activeRuntimeResource.value = runtimeStyle.value;
      if (!containerRef.value || !runtimeStyle.value) {
        return;
      }

      const loadId = mapLoadId;
      const container = containerRef.value;
      const runtime = runtimeStyle.value;
      const lifetime = new AbortController();
      resourceLifetime = lifetime;
      const isCurrent = () => loadId === mapLoadId && !lifetime.signal.aborted;
      let mounted: TileflowMountedMap;
      try {
        mounted = await mountTileflowMap({
          container,
          runtimeStyle: runtime,
          mapName: mapName.value,
          source: 'vue',
          loadMapLibre: loadTileflowMapLibre,
          loadScene: () => import('@tileflow/core/3d'),
          signal: lifetime.signal,
          getAnalytics: () => resolvedAnalytics.value,
          settings: () => ({
            mapOptions: {
              ...props.mapOptions,
              bearing: resolvedBearing.value,
              center: resolvedCenter.value,
              interactive: resolvedInteractive.value,
              pitch: resolvedPitch.value,
              zoom: resolvedZoom.value,
            },
            appearance: {colors: props.colors, emphasis: props.emphasis},
            vegetation: props.vegetation,
            viewMode: props.viewMode ?? '3d',
            navigationControl: resolvedInteractive.value ? props.navigationControl : false,
          }),
          onError: ({code, error}) => {
            if (isCurrent()) reportError(code, error);
          },
          onLoad: (map) => {
            if (isCurrent()) emit('load', map);
          },
          onState: (state) => {
            if (isCurrent()) mapCaptureState.value = state;
          },
          onThemeChange: (transition) => {
            if (!isCurrent()) return;
            emit('themeChange', transition);
            if (transition.phase === 'preloading' || transition.phase === 'applying') {
              themeTransitionState.value = 'loading';
            } else if (transition.phase === 'error') {
              themeTransitionState.value = 'error';
            } else {
              themeTransitionState.value = 'idle';
            }
          },
        });
      } catch (error) {
        if (isCurrent()) {
          destroyMap();
          reportError('runtime', error);
          mapCaptureState.value = 'error';
        }
        return;
      }

      if (!isCurrent() || containerRef.value !== container || isImageMode.value) {
        try {
          mounted.dispose();
        } catch (error) {
          reportError('runtime', error);
        } finally {
          lifetime.abort();
        }
        return;
      }

      mountedMap = mounted;
      const {map, maplibre: maplibregl} = mounted;
      mapRef.value = map;
      themeController = mounted.themeController ?? null;
      appearanceBinding = mounted.appearance ?? null;
      sceneAttachment = mounted.scene;
      navigationBinding = mounted.navigation;

      try {
        try {
          const mapInteractions = createTileflowMapLibreDomRuntime<
            MapLibreMap,
            MapLibreMarker,
            MapLibrePopup,
            RuntimeTileflowAnnotation
          >({
            createMarker({annotation, element}) {
              element.title = annotation.ariaLabel;
              return new maplibregl.Marker({element});
            },
            customMarker: slots.marker !== undefined,
            customPopup: slots.popup !== undefined,
            customTooltip: slots.tooltip !== undefined,
            createOverlay({container: overlayContainer, kind}) {
              return new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                closeOnMove: false,
                focusAfterOpen: false,
                offset: kind === 'popup' ? 24 : 18,
              }).setDOMContent(overlayContainer);
            },
            document: container.ownerDocument,
            interactionState: interactionCoordinator.getInteractionState(),
            map,
            onInteractionStateChange: interactionCoordinator.requestInteractionState,
            updateMarker(_marker, {annotation, element}) {
              element.title = annotation.ariaLabel;
            },
          });

          annotationRuntime = mapInteractions;
          annotationRuntimeCoordinatorDetach = interactionCoordinator.attach(
            'annotation',
            mapInteractions,
          );
          annotationRuntimeDiagnosticsUnsubscribe = mapInteractions.subscribeDiagnostics(
            (diagnostics) => syncRuntimeDiagnostics('annotation', diagnostics),
          );
          annotationRuntimeEventsUnsubscribe = mapInteractions.subscribeEvents((event) => {
            if (!interactionRuntimesDisposing) emit('interactionEvent', event);
          });
          syncRuntimeDiagnostics('annotation', mapInteractions.getDiagnostics());
          annotationRuntimeTargetsUnsubscribe = mapInteractions.subscribeRenderTargets(
            (targets) => {
              annotationRenderTargets.value = targets;
              syncInteractionRenderTargetReadiness();
            },
          );
          annotationRenderTargets.value = mapInteractions.getRenderTargets();
          syncInteractionRenderTargetReadiness();
          syncAnnotationRuntime();
          // Created ahead of semantic POIs: a click on a cluster belongs to the cluster.
          dataRuntime = createTileflowMapLibreDataRuntime<
            MapLibreMap,
            MapLibreMarker,
            RuntimeTileflowAnnotation
          >({
            createMarker: ({element}) => new maplibregl.Marker({element}),
            document: container.ownerDocument,
            map,
            onDiagnostic: (diagnostic) => emit('interactionDiagnostic', diagnostic),
            onInteractionEvent(event) {
              if (!interactionRuntimesDisposing) emit('interactionEvent', event);
            },
            setHiddenAnnotations: mapInteractions.setHiddenAnnotations,
          });
          syncDataRuntime();
        } catch {
          runInteractionCleanups(takeAnnotationRuntimeCleanups());
          reportOverlayFailure('Unable to initialize the Tileflow annotation runtime.');
        }

        initializeSemanticRuntime = () => {
          if (semanticRuntime || interactionRuntimesDisposing || mapRef.value !== map) return;
          try {
            const semanticInteractions = createTileflowMapLibreSemanticDomRuntime<
              MapLibreMap,
              MapLibrePopup
            >({
              cancelFrame: (frame) => cancelAnimationFrame(frame),
              createOverlay({container: overlayContainer, kind}) {
                return new maplibregl.Popup({
                  closeButton: false,
                  closeOnClick: false,
                  closeOnMove: false,
                  focusAfterOpen: false,
                  offset: kind === 'popup' ? 24 : 18,
                }).setDOMContent(overlayContainer);
              },
              customPopup: slots.popup !== undefined,
              customTooltip: slots.tooltip !== undefined,
              document: container.ownerDocument,
              interactionState: interactionCoordinator.getInteractionState(),
              map,
              onInteractionStateChange: interactionCoordinator.requestInteractionState,
              poiMap: createTileflowVuePoiMap(map),
              requestFrame: (callback) => requestAnimationFrame(callback),
            });

            semanticRuntime = semanticInteractions;
            semanticRuntimeCoordinatorDetach = interactionCoordinator.attach(
              'semantic',
              semanticInteractions,
            );
            semanticRuntimeDiagnosticsUnsubscribe = semanticInteractions.subscribeDiagnostics(
              (diagnostics) => syncRuntimeDiagnostics('semantic', diagnostics),
            );
            semanticRuntimeEventsUnsubscribe = semanticInteractions.subscribeEvents((event) => {
              if (!interactionRuntimesDisposing) emit('interactionEvent', event);
            });
            syncRuntimeDiagnostics('semantic', semanticInteractions.getDiagnostics());
            semanticRuntimeTargetsUnsubscribe = semanticInteractions.subscribeRenderTargets(
              (targets) => {
                semanticRenderTargets.value = targets;
                syncInteractionRenderTargetReadiness();
              },
            );
            semanticRenderTargets.value = semanticInteractions.getRenderTargets();
            syncInteractionRenderTargetReadiness();
          } catch {
            runInteractionCleanups(takeSemanticRuntimeCleanups());
            reportOverlayFailure('Unable to initialize the Tileflow semantic interaction runtime.');
          }
        };
        syncSemanticRuntime();
        if (!isCurrent() || mapRef.value !== map) return;
        // The first view is set without moving; later changes to the request move the camera.
        const initialFit = cameraFit.value;
        appliedCameraFitKey = initialFit.key;
        if (initialFit.error) reportError('camera', new Error(initialFit.error));
        if (initialFit.fit) fitCamera(map, initialFit.fit, 0);

        if (themeController && blendStyles.value && props.themeBlend) {
          switchBlend();
        } else if (themeController && runtimeStyle.value && runtimeStyle.value !== runtime) {
          activeRuntimeResource.value = runtimeStyle.value;
          void themeController.setTheme(runtimeStyle.value, {transition: props.themeTransition});
        }
      } catch (error) {
        if (isCurrent()) {
          destroyMap();
          reportError('runtime', error);
          mapCaptureState.value = 'error';
        }
      }
    };

    const switchBlend = () => {
      const themes = blendStyles.value;
      const position = props.themeBlend?.position;
      const hold = props.themeBlend?.hold === true;
      if (!themeController || !themes || position === undefined) return;
      const controller = themeController;
      if (runtimeStyle.value) activeRuntimeResource.value = runtimeStyle.value;
      void controller
        .setBlend({hold, position, themes}, {transition: props.themeTransition})
        .then((result) => {
          if (themeController === controller && result.status === 'failed') {
            reportError('blend', result.error ?? new Error('The map themes could not be blended.'));
          }
        });
    };

    const switchTheme = () => {
      if (!themeController) return;
      if (props.themeBlend) {
        // The blend names its nearest theme; the blend itself is applied by switchBlend.
        if (runtimeStyle.value) activeRuntimeResource.value = runtimeStyle.value;
        return;
      }
      if (themeResolution.value.error) {
        void themeController.setTheme(themeController.getCurrent());
        return;
      }
      const next = runtimeStyle.value;
      if (!next) return;
      const controller = themeController;
      activeRuntimeResource.value = next;
      void controller.setTheme(next, {transition: props.themeTransition}).then((result) => {
        if (themeController === controller && result.status === 'failed') {
          reportError('theme', result.error ?? new Error('The map theme could not be changed.'));
        }
      });
    };

    const syncSystemColorSchemeSubscription = () => {
      unsubscribeSystemColorScheme?.();
      unsubscribeSystemColorScheme = null;
      if (props.theme !== 'system') return;
      systemColorScheme.value = getTileflowSystemColorScheme();
      unsubscribeSystemColorScheme = subscribeTileflowSystemColorScheme((scheme) => {
        systemColorScheme.value = scheme;
      });
    };

    const syncView = () => {
      mapRef.value?.jumpTo({
        bearing: resolvedBearing.value,
        center: resolvedCenter.value,
        pitch: resolvedPitch.value,
        zoom: resolvedZoom.value,
      });
    };

    const markImageReady = async (image: HTMLImageElement) => {
      const runId = ++readinessRunId;
      try {
        if (typeof image.decode === 'function') await image.decode();
      } catch {
        if (!image.complete || image.naturalWidth === 0) {
          if (runId === readinessRunId) mapCaptureState.value = 'error';
          return;
        }
      }
      if (runId === readinessRunId) {
        mapCaptureState.value = 'idle';
      }
    };

    const resetImageReadiness = async () => {
      if (!isImageMode.value) return;
      const runId = ++readinessRunId;
      activeRuntimeResource.value = runtimeImageUrl.value;
      if (hasInteractionConfiguration.value) {
        mapCaptureState.value = 'idle';
        return;
      }
      mapCaptureState.value = 'loading';
      await nextTick();
      if (runId !== readinessRunId) return;
      const image = containerRef.value?.querySelector('img');
      if (!image?.complete) return;
      if (image.naturalWidth === 0) {
        mapCaptureState.value = 'error';
        return;
      }
      await markImageReady(image);
    };

    onMounted(() => {
      syncSystemColorSchemeSubscription();
      void refreshManifest();
      updateImageResizeObserver();
      void recreateMap();
      void resetImageReadiness();
    });

    onBeforeUnmount(() => {
      unsubscribeSystemColorScheme?.();
      imageResizeObserver?.disconnect();
      destroyMap();
      interactionCoordinator.dispose();
    });

    onUpdated(() => {
      syncCustomRenderers();
    });

    watch(
      () => [props.imageUrl, props.mode, props.source],
      () => {
        void refreshManifest();
      },
    );
    watch(
      () => props.theme,
      () => syncSystemColorSchemeSubscription(),
    );
    watch(
      () => [runtimeStyle.value, themeBlendKey.value],
      () => switchTheme(),
      {flush: 'post'},
    );
    watch(
      () => [props.colors, props.emphasis],
      () =>
        appearanceBinding?.update(
          {colors: props.colors, emphasis: props.emphasis},
          {transition: props.themeTransition},
        ),
      {deep: true, flush: 'post'},
    );
    watch(
      () => {
        const resolution = themeResolution.value;
        return resolution.error ? resolution.cause : undefined;
      },
      (cause) => {
        if (cause !== undefined) reportError('theme', cause);
      },
      {flush: 'post'},
    );
    watch(
      () => blendResolution.value.cause,
      (cause) => {
        if (cause !== undefined) reportError('blend', cause);
      },
      {flush: 'post'},
    );
    watch(
      () => [blendStyles.value, props.themeBlend?.position, props.themeBlend?.hold === true],
      () => switchBlend(),
      {flush: 'post'},
    );
    watch(
      () => [props.navigationControl, resolvedInteractive.value] as const,
      ([navigationControl, interactive]) =>
        navigationBinding?.update(interactive ? navigationControl : false),
      {deep: true, flush: 'post'},
    );
    watch(
      cameraFit,
      (fit) => {
        const map = mapRef.value;
        if (!map || appliedCameraFitKey === fit.key) return;
        appliedCameraFitKey = fit.key;
        if (fit.error) reportError('camera', new Error(fit.error));
        if (fit.fit) fitCamera(map, fit.fit);
      },
      {flush: 'post'},
    );
    watch(
      () => [hasInteractionConfiguration.value, isImageMode.value, runtimeImageUrl.value],
      () => {
        void resetImageReadiness();
      },
      {flush: 'post'},
    );
    watch(
      () => [props.imageUrl, props.mode],
      () => updateImageResizeObserver(),
      {flush: 'post'},
    );
    watch(
      () => [props.interactive, props.mapOptions, props.mode, props.source, manifestMap.value],
      () => void recreateMap(),
      {flush: 'post'},
    );
    watch(
      () => [
        props.center,
        props.zoom,
        props.mapOptions?.bearing,
        props.mapOptions?.center,
        props.mapOptions?.pitch,
        props.mapOptions?.zoom,
        manifestMap.value?.view,
      ],
      () => syncView(),
      {flush: 'post'},
    );
    watch(
      () => props.annotations,
      () => {
        syncAnnotationRuntime();
        syncDataRuntime();
      },
      {deep: true, flush: 'post'},
    );
    watch(
      () => [props.annotationClusters, props.dataOverlays, props.dataSources],
      () => syncDataRuntime(),
      {flush: 'post'},
    );
    watch(
      () => props.interactions,
      () => syncSemanticRuntime(),
      {deep: true, flush: 'post'},
    );
    watch(
      () => props.interactionState,
      (nextState) => {
        if (
          !controlledInteractionOwnership ||
          nextState === undefined ||
          interactionStateDiagnostics.value.length > 0
        ) {
          return;
        }
        try {
          interactionCoordinator.setInteractionState(nextState);
        } catch {
          reportOverlayFailure('Unable to apply Tileflow interaction state.');
        }
      },
      {deep: true, flush: 'post'},
    );

    expose({
      getMap: () => mapRef.value,
      getThemeController: () => themeController,
    } satisfies TileflowMapHandle);

    return () => {
      const rootAttrs = {...attrs};
      const classValue = [attrs.class, props.className];
      const styleValue = [attrs.style, frameStyle.value];
      delete rootAttrs.class;
      delete rootAttrs.style;

      const image =
        isImageMode.value && runtimeImageUrl.value
          ? h('img', {
              alt: props.alt,
              decoding: 'async',
              loading: props.imageLoading,
              onError: () => {
                readinessRunId += 1;
                mapCaptureState.value = 'error';
              },
              onLoad: (event: Event) =>
                void markImageReady(event.currentTarget as HTMLImageElement),
              src: runtimeImageUrl.value,
              style: {
                display: 'block',
                height: '100%',
                objectFit: 'cover',
                width: '100%',
              },
            })
          : undefined;
      // A marker is selected while its popup is open: the popup has a render target of its own.
      const openPopupAnnotationIds = new Set(
        annotationRenderTargets.value
          .filter((target) => target.kind === 'popup')
          .map((target) => target.annotation.id),
      );
      const annotationTeleports = annotationRenderTargets.value.flatMap((target) => {
        const slot =
          target.kind === 'marker'
            ? slots.marker
            : target.kind === 'tooltip'
              ? slots.tooltip
              : slots.popup;
        if (!slot) return [];

        const content = target.annotation[target.kind]?.content;
        const context: TileflowMapAnnotationSlotContext<RuntimeTileflowAnnotation> = {
          annotation: target.annotation,
          close: target.close,
          content,
          target: {
            annotation: target.annotation,
            coordinate: target.annotation.coordinate,
            kind: 'annotation',
          },
          viewName: content?.kind === 'view' ? content.name : undefined,
        };

        if (target.kind === 'marker') {
          return [
            h(TileflowMarkerPortal, {
              context,
              key: `annotation:${target.key}`,
              selected: openPopupAnnotationIds.has(target.annotation.id),
              slot: slot as (
                context: TileflowMapAnnotationSlotContext<RuntimeTileflowAnnotation>,
              ) => VNode[],
              to: target.container,
            }),
          ];
        }

        return [
          h(Teleport, {key: `annotation:${target.key}`, to: target.container}, slot(context)),
        ];
      });
      const semanticTeleports = semanticRenderTargets.value.flatMap((target) => {
        const slot = target.kind === 'tooltip' ? slots.tooltip : slots.popup;
        if (!slot) return [];

        const context: TileflowMapInteractionSlotContext<RuntimeTileflowAnnotation> = {
          close: target.close,
          content: target.content,
          target: target.target,
          viewName: target.viewName,
        };

        return [h(Teleport, {key: `semantic:${target.key}`, to: target.container}, slot(context))];
      });

      return h(
        'div',
        {
          ...rootAttrs,
          class: classValue,
          'data-tileflow-capture-id': resolvedCaptureId.value,
          'data-tileflow-map': mapName.value,
          'data-tileflow-theme': resolvedThemeName.value,
          'data-tileflow-state': captureState.value,
          ref: containerRef,
          style: styleValue,
        },
        [image, ...annotationTeleports, ...semanticTeleports],
      );
    };
  },
}) as unknown as PublicTileflowMapComponent;

export default TileflowMap;

function formatHeight(height: number | string): string {
  return typeof height === 'number' ? `${height}px` : height;
}

function interactionDiagnosticKey(diagnostic: TileflowInteractionDiagnostic): string {
  return JSON.stringify([diagnostic.code, diagnostic.message, diagnostic.path, diagnostic.target]);
}

function createTileflowVuePoiMap(map: MapLibreMap): TileflowMapLibrePoiMap {
  const poiMap = map as unknown as TileflowMapLibrePoiMap;

  return {
    getStyle: () => map.getStyle(),
    on: (event, listener) => poiMap.on(event, listener),
    queryRenderedFeatures(point, options) {
      return map
        .queryRenderedFeatures(point as Parameters<MapLibreMap['queryRenderedFeatures']>[0], {
          layers: [...options.layers],
        })
        .map((feature) => ({
          ...(feature.id === undefined ? {} : {id: feature.id}),
          layer: {id: feature.layer.id},
          ...(feature.properties === null ? {} : {properties: feature.properties}),
          ...(feature.source === undefined ? {} : {source: feature.source}),
          ...(feature.sourceLayer === undefined ? {} : {sourceLayer: feature.sourceLayer}),
        }));
    },
  };
}
