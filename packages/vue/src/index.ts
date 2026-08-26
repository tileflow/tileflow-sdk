import type {
  LngLatLike,
  Map as MapLibreMap,
  MapOptions as MapLibreMapOptions,
  Marker as MapLibreMarker,
  Popup as MapLibrePopup,
  RequestParameters,
  RequestTransformFunction,
  StyleSpecification,
} from 'maplibre-gl';
import {
  computed,
  type CSSProperties,
  defineComponent,
  type DefineComponent,
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
  type VNodeChild,
  watch,
  watchEffect,
} from 'vue';
import {
  attachTileflowFairUseNotice,
  attachTileflowMapLifecycle,
  createTileflowSessionStarter,
  createTileflowTransformRequest,
  loadTileflowStyleFonts,
  registerTileflowWorldRequestBridge,
  type TileflowFairUseNoticeController,
  type TileflowMapLifecycleAttachment,
  type TileflowWorldRequestBridge,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  createTileflowSessionController,
  defaultTileflowManifestUrl,
  defaultTileflowRuntimeView,
  loadTileflowManifest,
  mergeTileflowAnalytics,
  normalizeTileflowRuntimeCenter,
  normalizeTileflowStaticImageSize,
  resolveTileflowManifestMap,
  resolveTileflowMapMode,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  shouldLoadTileflowManifest,
  type TileflowAnalytics,
  type TileflowMapMarker,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeSource,
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
} from '@tileflow/interactions';
import {
  createTileflowMapLibreDomRuntime,
  createTileflowMapLibreInteractionCoordinator,
  createTileflowMapLibreSemanticDomRuntime,
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

type TileflowMapAnnotationInput<TAnnotation extends TileflowAnnotation> =
  | {annotations?: readonly TAnnotation[]; markers?: never}
  | {annotations?: never; markers?: readonly TileflowMapMarker[]};

type TileflowMapStateInput =
  | {defaultInteractionState?: never; interactionState?: TileflowInteractionState}
  | {defaultInteractionState?: TileflowInteractionState; interactionState?: never};

type TileflowMapInteractiveProps<TAnnotation extends TileflowAnnotation> = TileflowMapSharedProps &
  TileflowMapAnnotationInput<TAnnotation> &
  TileflowMapStateInput & {
    interactions?: readonly TileflowInteractionBinding[];
    interactive?: boolean;
    mode?: 'interactive';
  };

type TileflowMapImageProps = TileflowMapSharedProps & {
  annotations?: never;
  defaultInteractionState?: never;
  interactionState?: never;
  interactions?: never;
  interactive?: never;
  markers?: never;
  mode: 'image';
};

export type TileflowMapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = (
  | TileflowMapInteractiveProps<TAnnotation>
  | TileflowMapImageProps
) &
  TileflowMapStyleSourceProps;

type RuntimeTileflowAnnotation = TileflowAnnotation<TileflowInteractionJsonValue>;
type RuntimeTileflowMapProps = TileflowMapSharedProps &
  TileflowMapStyleSourceProps & {
    annotations?: readonly RuntimeTileflowAnnotation[];
    defaultInteractionState?: TileflowInteractionState;
    interactionState?: TileflowInteractionState;
    interactions?: readonly TileflowInteractionBinding[];
    interactive?: boolean;
    markers?: readonly TileflowMapMarker[];
    mode?: TileflowMapMode;
  };

type PublicTileflowMapStatics = Pick<
  DefineComponent<RuntimeTileflowMapProps>,
  keyof DefineComponent<RuntimeTileflowMapProps>
>;

type PublicTileflowMapComponent = PublicTileflowMapStatics & {
  new <TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
    props: TileflowMapProps<TAnnotation>,
  ): {
    $emit: {
      (event: 'interactionDiagnostic', diagnostic: TileflowInteractionDiagnostic): void;
      (event: 'interactionEvent', interactionEvent: TileflowInteractionEvent<TAnnotation>): void;
      (event: 'load', map: MapLibreMap): void;
      (event: 'update:interactionState', state: TileflowInteractionState): void;
    };
    $props: TileflowMapProps<TAnnotation>;
    $slots: TileflowMapSlots<TAnnotation>;
  };
};

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
    annotations: Array as unknown as PropType<readonly RuntimeTileflowAnnotation[]>,
    center: Array as unknown as PropType<[number, number]>,
    captureId: String,
    className: String,
    defaultInteractionState: Object as PropType<TileflowInteractionState>,
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
    markers: Array as unknown as PropType<readonly TileflowMapMarker[]>,
    mode: {
      default: 'interactive',
      type: String as PropType<TileflowMapMode>,
    },
    source: {
      required: true,
      type: Object as PropType<TileflowRuntimeSource>,
    },
    zoom: Number,
  },
  emits: {
    interactionDiagnostic: (_diagnostic: TileflowInteractionDiagnostic) => true,
    interactionEvent: (_event: TileflowInteractionEvent<RuntimeTileflowAnnotation>) => true,
    load: (_map: MapLibreMap) => true,
    'update:interactionState': (_state: TileflowInteractionState) => true,
  },
  setup(props, {attrs, emit, slots}) {
    const containerRef = ref<HTMLDivElement | null>(null);
    const loadedManifestMap = shallowRef<TileflowRuntimeManifestMap | null>(null);
    const manifestResolutionKey = ref('');
    const manifestResolutionState = ref<'error' | 'loading' | 'not-needed' | 'ready'>('loading');
    const imageSize = shallowRef<{height: number; width: number} | null>(null);
    const mapRef = shallowRef<MapLibreMap | null>(null);
    const mapCaptureState = ref<'error' | 'idle' | 'loading'>('loading');
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
    let legacyTitles = new Map<string, string>();
    let imageResizeObserver: ResizeObserver | null = null;
    let mapFairUseNotice: TileflowFairUseNoticeController | null = null;
    let mapLifecycle: TileflowMapLifecycleAttachment | null = null;
    let mapResizeObserver: ResizeObserver | null = null;
    let mapWorldRequestBridge: TileflowWorldRequestBridge | null = null;
    let mapLoadId = 0;
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
        markers: props.markers,
      }),
    );
    const interactionBindingResolution = computed(() =>
      resolveTileflowVueInteractionBindings(props.interactions),
    );
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
        props.annotations !== undefined ||
        props.markers !== undefined ||
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
    const mapName = computed(() =>
      props.source.kind === 'tileflow' ? props.source.map : undefined,
    );
    const manifestUrl = computed(() =>
      props.source.kind === 'tileflow'
        ? (props.source.manifestUrl ?? defaultTileflowManifestUrl)
        : defaultTileflowManifestUrl,
    );
    const shouldLoadManifest = computed(() =>
      shouldLoadTileflowManifest({
        imageMode: isImageMode.value,
        imageUrl: props.imageUrl,
        source: props.source,
      }),
    );
    const manifestRequestKey = computed(() =>
      shouldLoadManifest.value ? JSON.stringify([manifestUrl.value, mapName.value]) : 'not-needed',
    );
    const currentManifestResolutionState = computed(() =>
      manifestResolutionKey.value === manifestRequestKey.value
        ? manifestResolutionState.value
        : shouldLoadManifest.value
          ? 'loading'
          : 'not-needed',
    );
    const manifestMap = computed(() =>
      manifestResolutionKey.value === manifestRequestKey.value &&
      manifestResolutionState.value === 'ready'
        ? loadedManifestMap.value
        : null,
    );
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
      isImageMode.value
        ? null
        : resolveTileflowRuntimeStyle({
            manifestMap: manifestMap.value,
            source: props.source,
          }),
    );
    const resolvedAnalytics = computed(() =>
      mergeTileflowAnalytics(props.analytics, runtimeStyle.value?.analytics),
    );
    const runtimeImageUrl = computed(
      () =>
        props.imageUrl ??
        (isImageMode.value
          ? resolveTileflowStaticImageUrl({
              center: imageCenter.value,
              imageSize: imageSize.value,
              manifestMap: manifestMap.value,
              zoom: imageZoom.value,
            })
          : undefined),
    );
    const runtimeResolutionState = computed<'error' | 'idle' | 'loading'>(() => {
      if (shouldLoadManifest.value && currentManifestResolutionState.value !== 'ready') {
        return currentManifestResolutionState.value === 'error' ? 'error' : 'loading';
      }
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
        runtimeResolutionState.value === 'error'
      ) {
        return 'error';
      }
      if (
        currentMapCaptureState.value === 'loading' ||
        interactionCaptureState.value === 'loading' ||
        runtimeResolutionState.value === 'loading'
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
      assertTileflowMapStyleInputs({source: props.source});
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
      const shouldLoad = shouldLoadManifest.value;
      const requestKey = manifestRequestKey.value;

      if (!shouldLoad) {
        manifestLoadId += 1;
        loadedManifestMap.value = null;
        manifestResolutionKey.value = requestKey;
        manifestResolutionState.value = 'not-needed';
        return;
      }

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
        }
      } catch (error) {
        if (loadId === manifestLoadId) {
          console.error('Failed to load Tileflow manifest', error);
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

    const destroyMap = () => {
      mapLoadId += 1;
      readinessRunId += 1;
      invalidateInteractionReadiness();
      const lifecycle = mapLifecycle;
      const fairUseNotice = mapFairUseNotice;
      const resizeObserver = mapResizeObserver;
      const map = mapRef.value;
      const annotationInteractionsForMap = annotationRuntime;
      const semanticInteractionsForMap = semanticRuntime;
      const worldRequestBridge = mapWorldRequestBridge;
      const teardownSteps = [
        annotationRuntimeCoordinatorDetach,
        semanticRuntimeCoordinatorDetach,
        annotationRuntimeTargetsUnsubscribe,
        annotationRuntimeDiagnosticsUnsubscribe,
        annotationRuntimeEventsUnsubscribe,
        semanticRuntimeTargetsUnsubscribe,
        semanticRuntimeDiagnosticsUnsubscribe,
        semanticRuntimeEventsUnsubscribe,
        () => annotationInteractionsForMap?.dispose(),
        () => semanticInteractionsForMap?.dispose(),
        () => worldRequestBridge?.dispose(),
        () => fairUseNotice?.dispose(),
        () => lifecycle?.dispose(),
        () => resizeObserver?.disconnect(),
        () => map?.remove(),
      ];
      annotationRuntime = null;
      semanticRuntime = null;
      initializeSemanticRuntime = null;
      annotationRuntimeCoordinatorDetach = null;
      annotationRuntimeDiagnosticsUnsubscribe = null;
      annotationRuntimeEventsUnsubscribe = null;
      annotationRuntimeTargetsUnsubscribe = null;
      semanticRuntimeDiagnosticsUnsubscribe = null;
      semanticRuntimeCoordinatorDetach = null;
      semanticRuntimeEventsUnsubscribe = null;
      semanticRuntimeTargetsUnsubscribe = null;
      annotationRenderTargets.value = [];
      semanticRenderTargets.value = [];
      activeAnnotationDiagnosticKeys = new Set();
      activeSemanticDiagnosticKeys = new Set();
      annotationRuntimeDiagnostics = [];
      semanticRuntimeDiagnostics = [];
      renderTargetKeySignature = '';
      mapFairUseNotice = null;
      mapLifecycle = null;
      mapResizeObserver = null;
      mapRef.value = null;
      mapWorldRequestBridge = null;

      interactionRuntimesDisposing = true;
      let teardownError: unknown;
      for (const teardown of teardownSteps) {
        try {
          teardown?.();
        } catch (error) {
          teardownError ??= error;
        }
      }
      interactionRuntimesDisposing = false;
      interactionCaptureState.value = hasInteractionErrors() ? 'error' : 'idle';
      if (teardownError) {
        console.error('Failed to fully dispose the Tileflow map runtime', teardownError);
      }
    };

    const syncAnnotationRuntime = () => {
      const resolution = annotationResolution.value;
      legacyTitles = new Map(resolution.legacyTitles);

      if (!annotationRuntime) return;

      try {
        annotationRuntime.reconcile(
          resolution.ok && !isImageMode.value ? resolution.annotations : [],
        );
      } catch {
        reportOverlayFailure('Unable to reconcile the Tileflow annotation runtime.');
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

      if (isImageMode.value) {
        return;
      }

      activeRuntimeResource.value = runtimeStyle.value;
      if (!containerRef.value || !runtimeStyle.value) {
        return;
      }

      const loadId = mapLoadId;
      const container = containerRef.value;
      const runtime = runtimeStyle.value;
      const analyticsForMap = resolvedAnalytics.value;
      let maplibregl: Awaited<ReturnType<typeof loadTileflowMapLibre>>;

      try {
        [maplibregl] = await Promise.all([
          loadTileflowMapLibre(),
          loadTileflowStyleFonts(runtime.style, {
            fontFaces: runtime.fontFaces,
          }),
        ]);
      } catch (error) {
        if (loadId === mapLoadId) {
          console.error('Failed to load the Tileflow map runtime', error);
          mapCaptureState.value = 'error';
        }
        return;
      }

      if (
        loadId !== mapLoadId ||
        containerRef.value !== container ||
        runtimeStyle.value !== runtime ||
        isImageMode.value
      ) {
        return;
      }

      const session = createTileflowSessionController({source: 'vue'});
      const sessionStarter = createTileflowSessionStarter({
        getSessionId: () => session.sessionId,
        sessionId: session.sessionId,
        source: 'vue',
      });
      mapFairUseNotice = attachTileflowFairUseNotice(container);
      mapWorldRequestBridge = registerTileflowWorldRequestBridge({
        addProtocol: maplibregl.addProtocol,
        onNotice: mapFairUseNotice.update,
      });
      const map = new maplibregl.Map({
        ...props.mapOptions,
        attributionControl: props.mapOptions?.attributionControl ?? {
          compact: true,
        },
        bearing: resolvedBearing.value,
        center: resolvedCenter.value,
        container,
        interactive: resolvedInteractive.value,
        pitch: resolvedPitch.value,
        style: runtime.style as StyleSpecification | string,
        transformRequest: createTileflowTransformRequest<
          RequestParameters,
          Parameters<RequestTransformFunction>[1]
        >({
          getAnalytics: () => analyticsForMap,
          sessionController: session,
          sessionId: session.sessionId,
          transformRequest: props.mapOptions?.transformRequest ?? undefined,
          worldRequestBridge: mapWorldRequestBridge,
        }),
        zoom: resolvedZoom.value,
      });

      mapRef.value = map;

      try {
        const mapInteractions = createTileflowMapLibreDomRuntime<
          MapLibreMap,
          MapLibreMarker,
          MapLibrePopup,
          RuntimeTileflowAnnotation
        >({
          createMarker({annotation, element}) {
            element.title = legacyTitles.get(annotation.id) ?? annotation.ariaLabel;
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
            element.title = legacyTitles.get(annotation.id) ?? annotation.ariaLabel;
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
        annotationRuntimeTargetsUnsubscribe = mapInteractions.subscribeRenderTargets((targets) => {
          annotationRenderTargets.value = targets;
          syncInteractionRenderTargetReadiness();
        });
        annotationRenderTargets.value = mapInteractions.getRenderTargets();
        syncInteractionRenderTargetReadiness();
        syncAnnotationRuntime();
      } catch {
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
          reportOverlayFailure('Unable to initialize the Tileflow semantic interaction runtime.');
        }
      };
      syncSemanticRuntime();

      if (resolvedInteractive.value) {
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
      }

      mapResizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      mapResizeObserver.observe(container);

      mapLifecycle = attachTileflowMapLifecycle({
        getSession: () => {
          const analyticsForLoad = resolvedAnalytics.value;

          return {
            analytics: analyticsForLoad,
            styleId:
              analyticsForLoad?.styleId ??
              (typeof runtime.style === 'string' ? runtime.style : mapName.value),
          };
        },
        map,
        onLoad: (loadedMap) => emit('load', loadedMap),
        scheduler: {
          cancelFrame: (frame: number) => cancelAnimationFrame(frame),
          requestFrame: (callback) => requestAnimationFrame(callback),
        },
        sessionStarter,
        setState: (state) => {
          mapCaptureState.value = state;
        },
        subscribe: (subscribedMap, event, listener) => {
          const subscription = subscribedMap.on(event, listener);

          return () => subscription.unsubscribe();
        },
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
      void refreshManifest();
      updateImageResizeObserver();
      void recreateMap();
      void resetImageReadiness();
    });

    onBeforeUnmount(() => {
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
      () => [
        props.analytics,
        props.interactive,
        props.mapOptions,
        props.mode,
        props.source,
        manifestMap.value,
      ],
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
      () => [props.annotations, props.markers],
      () => syncAnnotationRuntime(),
      {deep: true, flush: 'post'},
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
  return {
    getStyle: () => map.getStyle(),
    on: (event, listener) => map.on(event, listener),
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
