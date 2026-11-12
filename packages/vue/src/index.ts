import type {Map as MapLibreMap, MapOptions as MapLibreMapOptions} from 'maplibre-gl';
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
import type {
  TileflowBounds,
  TileflowBrowserThemeBlendSelection,
  TileflowColorOverrides,
  TileflowEmphasis,
  TileflowFitBoundsOptions,
  TileflowMapError,
  TileflowNavigationControlInput,
  TileflowThemeController,
  TileflowThemeTransition,
  TileflowThemeTransitionOptions,
  TileflowViewMode,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  resolveTileflowMapMode,
  type TileflowAnalytics,
  type TileflowRuntimeSource,
  type TileflowTimeOfDay,
} from '@tileflow/core/runtime';
import {
  createTileflowAdapterReference,
  createTileflowMap,
  getTileflowMapInitialStatus,
  type TileflowMapRef as RuntimeStyleRef,
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
  TileflowInteractionJsonValue,
  TileflowInteractionState,
  TileflowInteractionViewContext,
} from '@tileflow/interactions';
import type {TileflowAnnotationClusterOptions} from '@tileflow/interactions/maplibre';
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
export type TileflowMapRef = TileflowMapHandle;

export type TileflowMapHandle = RuntimeStyleRef & {
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
    const runtimeReference = createTileflowAdapterReference(props.mode === 'image');
    const instance = getCurrentInstance();
    // A Vue event without a listener stays unset, so failures go to the console and image mode
    // reports only what the application asked of it.
    const listens = (name: string) => instance?.vnode.props?.[name] !== undefined;
    const containerRef = ref<HTMLDivElement | null>(null);
    const imageRef = ref<HTMLImageElement | null>(null);
    const controlledInteractionOwnership = props.interactionState !== undefined;
    const mapStatus = shallowRef<TileflowMapStatus | null>(null);
    const renderTargets = shallowRef<TileflowMapRenderTargetList<RuntimeTileflowAnnotation>>({
      annotations: [],
      semantic: [],
    });
    const viewsSettled = ref(true);
    let controller: TileflowMapController<RuntimeTileflowAnnotation> | null = null;

    // Deep changes to reactive options reach the map as new values.
    const annotations = deepSnapshot(
      () => props.annotations,
      (value) => [...value],
    );
    const interactions = deepSnapshot(
      () => props.interactions,
      (value) => [...value],
    );
    const interactionState = deepSnapshot(
      () => props.interactionState,
      (value) => ({...value}),
    );
    const colors = deepSnapshot(
      () => props.colors,
      (value) => ({...value}),
    );
    const emphasis = deepSnapshot(
      () => props.emphasis,
      (value) => ({...value}) as TileflowEmphasis,
    );
    const navigationControl = deepSnapshot(
      () => props.navigationControl,
      (value) => (typeof value === 'object' ? {...value} : value),
    );

    const resolvedMode = computed(() => resolveTileflowMapMode({mode: props.mode}));
    const isImageMode = computed(() => resolvedMode.value === 'image');
    watchEffect(() => runtimeReference.setImageMode(isImageMode.value));

    const controllerOptions = computed<TileflowMapControllerOptions<RuntimeTileflowAnnotation>>(
      () => ({
        alt: props.alt,
        analytics: props.analytics,
        annotationClusters: props.annotationClusters,
        annotations: annotations.value,
        bounds: props.bounds,
        center: props.center,
        colors: colors.value,
        dataOverlays: props.dataOverlays,
        // Workers cannot clone reactive proxies, so raw data crosses that boundary.
        dataSources:
          props.dataSources &&
          Object.fromEntries(
            Object.entries(toRaw(props.dataSources) as Record<string, TileflowGeoJsonSource>).map(
              ([id, source]) => [id, {...toRaw(source), data: toRaw(source.data)}],
            ),
          ),
        emphasis: emphasis.value,
        fitAnnotations: props.fitAnnotations,
        fitBoundsOptions: props.fitBoundsOptions,
        // The image this component renders, so it is there on the server too.
        image: isImageMode.value ? imageRef.value : undefined,
        imageLoading: props.imageLoading as 'eager' | 'lazy' | undefined,
        imageUrl: props.imageUrl,
        interactions: interactions.value,
        interactive: props.interactive,
        mapOptions: props.mapOptions,
        mode: resolvedMode.value,
        navigationControl: navigationControl.value,
        onError: listens('onError') ? (event) => emit('error', event) : undefined,
        onInteractionDiagnostic: listens('onInteractionDiagnostic')
          ? (diagnostic) => emit('interactionDiagnostic', diagnostic)
          : undefined,
        onInteractionEvent: listens('onInteractionEvent')
          ? (event) => emit('interactionEvent', event)
          : undefined,
        onInteractionStateChange: listens('onUpdate:interactionState')
          ? (state) => emit('update:interactionState', state)
          : undefined,
        onLoad: (map) => emit('load', map),
        onStatusChange: (status) => {
          mapStatus.value = status;
        },
        onThemeChange: (transition) => emit('themeChange', transition),
        renderTargets: {
          marker: slots.marker !== undefined,
          onChange: (targets) => {
            renderTargets.value = targets;
          },
          popup: slots.popup !== undefined,
          tooltip: slots.tooltip !== undefined,
        },
        source: props.source,
        theme: props.theme as TileflowMapControllerOptions['theme'],
        themeBlend: props.themeBlend,
        themeTransition: props.themeTransition,
        timeOfDay: props.timeOfDay,
        vegetation: props.vegetation,
        viewMode: props.viewMode,
        zoom: props.zoom,
        ...({
          defaultInteractionState: props.defaultInteractionState,
          interactionState: interactionState.value,
        } as Pick<TileflowMapControllerOptions, 'interactionState'>),
      }),
    );
    // Before the map mounts, and on the server, the frame shows what the options already say.
    const status = computed(
      () =>
        mapStatus.value ??
        getTileflowMapInitialStatus(controllerOptions.value, controlledInteractionOwnership),
    );
    if (typeof window === 'undefined') {
      // On the server nothing mounts, so the diagnostics the options already show are emitted here.
      for (const diagnostic of status.value.diagnostics) emit('interactionDiagnostic', diagnostic);
    }

    // Slot views settle once Vue has committed them and two frames have drawn them.
    let viewSignature = '[]';
    let viewRun = 0;
    let viewFrames: number[] = [];
    const cancelViewFrames = () => {
      for (const frame of viewFrames) cancelAnimationFrame(frame);
      viewFrames = [];
    };
    watch(
      renderTargets,
      (targets) => {
        const signature = JSON.stringify([
          ...targets.annotations.map(({key}) => `annotation:${key}`),
          ...targets.semantic.map(({key}) => `semantic:${key}`),
        ]);
        if (signature === viewSignature) return;
        viewSignature = signature;
        const run = ++viewRun;
        cancelViewFrames();
        viewsSettled.value = false;
        void nextTick().then(() => {
          if (run !== viewRun) return;
          const first = requestAnimationFrame(() => {
            const second = requestAnimationFrame(() => {
              if (run === viewRun) viewsSettled.value = true;
            });
            viewFrames = [second];
          });
          viewFrames = [first];
        });
      },
      {flush: 'post'},
    );

    watchEffect(() => {
      assertTileflowMapStyleInputs({
        source: props.source,
        theme: props.theme,
        timeOfDay: props.timeOfDay,
        themeBlend: props.themeBlend,
        themeTransition: props.themeTransition,
      });
    });

    onMounted(() => {
      const container = containerRef.value;
      if (!container) return;
      controller = createTileflowMap(container, controllerOptions.value, {
        sessionSource: 'vue',
        // The frame this component renders carries the capture attributes.
        statusElement: null,
      });
      runtimeReference.attach(controller);
      mapStatus.value = controller.getStatus();
    });
    // Each change hands the options over; the map does only the work a change asks for.
    watch(controllerOptions, (options) => controller?.update(options), {flush: 'post'});
    onUpdated(() => {
      // Slots that appear or leave change which views the map leaves to Vue.
      controller?.update(controllerOptions.value);
    });
    onBeforeUnmount(() => {
      viewRun += 1;
      cancelViewFrames();
      if (controller) runtimeReference.detach(controller);
      controller?.destroy();
      controller = null;
    });

    expose({
      ...runtimeReference.reference,
      getMap: () => controller?.getMap() ?? null,
      getThemeController: () => controller?.getThemeController() ?? null,
    } satisfies TileflowMapHandle);

    const frameStyle = computed<CSSProperties>(() => ({
      height: formatHeight(props.height ?? 420),
      minHeight: '240px',
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    }));
    const resolvedCaptureId = computed(() => normalizeTileflowCaptureId(props.captureId));
    const captureState = computed(() => {
      const readiness = status.value.readiness;
      return readiness === 'idle' && !viewsSettled.value ? 'loading' : readiness;
    });

    return () => {
      const rootAttrs = {...attrs};
      const classValue = [attrs.class, props.className];
      const styleValue = [attrs.style, frameStyle.value];
      delete rootAttrs.class;
      delete rootAttrs.style;

      const imageUrl = status.value.imageUrl;
      // The map tracks the image's load and decode for capture readiness.
      const image =
        isImageMode.value && imageUrl
          ? h('img', {
              alt: props.alt,
              decoding: 'async',
              loading: props.imageLoading,
              ref: imageRef,
              src: imageUrl,
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
        renderTargets.value.annotations
          .filter((target) => target.kind === 'popup')
          .map((target) => target.annotation.id),
      );
      const annotationTeleports = renderTargets.value.annotations.flatMap((target) => {
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
      const semanticTeleports = renderTargets.value.semantic.flatMap((target) => {
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
          'data-tileflow-map': props.source.map,
          'data-tileflow-theme': status.value.theme,
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

/** A reactive option as a value that changes identity whenever its contents change. */
function deepSnapshot<T>(getter: () => T | undefined, copy: (value: T) => T) {
  const snapshot = shallowRef<T | undefined>(getter());
  watch(
    getter,
    (value) => {
      snapshot.value = value === undefined ? undefined : copy(value);
    },
    {deep: true},
  );
  return snapshot;
}
