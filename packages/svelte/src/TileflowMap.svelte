<script lang="ts">
  import type {Map as MapLibreMap} from 'maplibre-gl';
  import {createEventDispatcher, onMount, tick} from 'svelte';
  import type {TileflowThemeController} from '@tileflow/core/browser';
  import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
  import {resolveTileflowMapMode} from '@tileflow/core/runtime';
  import {
    createTileflowAdapterReference,
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
    TileflowInteractionContent,
    TileflowInteractionDiagnostic,
    TileflowInteractionViewContext,
  } from '@tileflow/interactions';
  import type {
    TileflowMapLibreDomRenderTarget,
    TileflowMapLibreSemanticDomRenderTarget,
  } from '@tileflow/interactions/maplibre';
  import type {TileflowMapProps} from './index.js';
  import {assertTileflowMapStyleInputs} from './style-source.js';

  export let alt: NonNullable<TileflowMapProps['alt']> = '';
  export let analytics: TileflowMapProps['analytics'] = undefined;
  export let annotationClusters: TileflowMapProps['annotationClusters'] = undefined;
  export let annotations: TileflowMapProps['annotations'] = undefined;
  export let colors: TileflowMapProps['colors'] = undefined;
  export let dataOverlays: TileflowMapProps['dataOverlays'] = undefined;
  export let dataSources: TileflowMapProps['dataSources'] = undefined;

  export let center: TileflowMapProps['center'] = undefined;
  export let captureId: TileflowMapProps['captureId'] = undefined;
  export let className: NonNullable<TileflowMapProps['className']> = '';
  export let defaultInteractionState: TileflowMapProps['defaultInteractionState'] = undefined;
  export let emphasis: TileflowMapProps['emphasis'] = undefined;
  export let height: NonNullable<TileflowMapProps['height']> = 420;
  export let imageLoading: NonNullable<TileflowMapProps['imageLoading']> = 'eager';
  export let imageUrl: TileflowMapProps['imageUrl'] = undefined;
  export let interactive: TileflowMapProps['interactive'] = undefined;
  export let interactions: TileflowMapProps['interactions'] = undefined;
  export let interactionState: TileflowMapProps['interactionState'] = undefined;
  export let mapOptions: TileflowMapProps['mapOptions'] = undefined;
  export let marker: TileflowMapProps['marker'] = undefined;
  export let mode: NonNullable<TileflowMapProps['mode']> = 'interactive';
  export let navigationControl: TileflowMapProps['navigationControl'] = undefined;
  export let bounds: TileflowMapProps['bounds'] = undefined;
  export let fitAnnotations: TileflowMapProps['fitAnnotations'] = undefined;
  export let fitBoundsOptions: TileflowMapProps['fitBoundsOptions'] = undefined;
  export let onInteractionDiagnostic: TileflowMapProps['onInteractionDiagnostic'] = undefined;
  export let onInteractionEvent: TileflowMapProps['onInteractionEvent'] = undefined;
  export let onInteractionStateChange: TileflowMapProps['onInteractionStateChange'] = undefined;
  export let onError: TileflowMapProps['onError'] = undefined;
  export let onThemeChange: TileflowMapProps['onThemeChange'] = undefined;
  export let popup: TileflowMapProps['popup'] = undefined;
  export let source: TileflowMapProps['source'];
  export let theme: TileflowMapProps['theme'] = undefined;
  export let timeOfDay: TileflowMapProps['timeOfDay'] = undefined;
  export let themeBlend: TileflowMapProps['themeBlend'] = undefined;
  export let vegetation: TileflowMapProps['vegetation'] = undefined;
  export let viewMode: NonNullable<TileflowMapProps['viewMode']> = '3d';
  export let themeTransition: TileflowMapProps['themeTransition'] = undefined;
  export let tooltip: TileflowMapProps['tooltip'] = undefined;
  export let zoom: TileflowMapProps['zoom'] = undefined;

  const runtimeReference = createTileflowAdapterReference(mode === 'image');
  $: runtimeReference.setImageMode(mode === 'image');
  let container: HTMLDivElement;
  let imageElement: HTMLImageElement | null = null;
  let controller: TileflowMapController<TileflowAnnotation> | null = null;
  let mapStatus: TileflowMapStatus | null = null;
  let renderTargets: TileflowMapRenderTargetList<TileflowAnnotation> = {
    annotations: [],
    semantic: [],
  };
  let viewsSettled = true;
  let portalDiagnostic: TileflowInteractionDiagnostic | null = null;

  const dispatch = createEventDispatcher<{load: MapLibreMap}>();
  const controlledInteractionOwnership = interactionState !== undefined;

  /** The MapLibre map, or `null` until the map has loaded, in image mode and after it is taken down. */
  export const addSource = runtimeReference.reference.addSource;
  export const removeSource = runtimeReference.reference.removeSource;
  export const addLayer = runtimeReference.reference.addLayer;
  export const moveLayer = runtimeReference.reference.moveLayer;
  export const removeLayer = runtimeReference.reference.removeLayer;

  export function getMap(): MapLibreMap | null {
    return controller?.getMap() ?? null;
  }

  /** Changes the map's theme, colours and emphasis; `null` when the map's style has no themes. */
  export function getThemeController(): TileflowThemeController | null {
    return controller?.getThemeController() ?? null;
  }

  $: assertTileflowMapStyleInputs({source, theme, timeOfDay, themeBlend, themeTransition});
  $: resolvedMode = resolveTileflowMapMode({mode});
  $: isImageMode = resolvedMode === 'image';
  $: resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  $: frameStyle = `height: ${formatHeight(height)}; min-height: 240px; overflow: hidden; position: relative; width: 100%;`;

  // An option changed in place reaches the map as a new value, as each assignment did before.
  $: annotationsValue = shallowCopy(annotations);
  $: annotationClustersValue = shallowCopy(annotationClusters);
  $: colorsValue = shallowCopy(colors);
  $: dataOverlaysValue = shallowCopy(dataOverlays);
  $: dataSourcesValue = shallowCopy(dataSources);
  $: emphasisValue = shallowCopy(emphasis);
  $: interactionsValue = shallowCopy(interactions);
  $: interactionStateValue = shallowCopy(interactionState);
  $: navigationControlValue = shallowCopy(navigationControl);

  $: controllerOptions = {
    alt,
    analytics,
    annotationClusters: annotationClustersValue,
    annotations: annotationsValue,
    bounds,
    center,
    colors: colorsValue,
    dataOverlays: dataOverlaysValue,
    dataSources: dataSourcesValue,
    emphasis: emphasisValue,
    fitAnnotations,
    fitBoundsOptions,
    // The image this component renders, so it is there on the server too.
    image: isImageMode ? imageElement : undefined,
    imageLoading,
    imageUrl,
    interactions: interactionsValue,
    interactive,
    mapOptions,
    mode: resolvedMode,
    navigationControl: navigationControlValue,
    onError,
    onInteractionDiagnostic,
    onInteractionEvent,
    onInteractionStateChange,
    onLoad: (map: MapLibreMap) => dispatch('load', map),
    onStatusChange: (nextStatus: TileflowMapStatus) => {
      mapStatus = nextStatus;
    },
    onThemeChange,
    renderTargets: {
      marker: marker !== undefined,
      onChange: (targets: TileflowMapRenderTargetList<TileflowAnnotation>) => {
        renderTargets = targets;
      },
      popup: popup !== undefined,
      tooltip: tooltip !== undefined,
    },
    source,
    theme: theme as TileflowMapControllerOptions['theme'],
    themeBlend,
    themeTransition,
    timeOfDay,
    vegetation,
    viewMode,
    zoom,
    ...({defaultInteractionState, interactionState: interactionStateValue} as Pick<
      TileflowMapControllerOptions,
      'interactionState'
    >),
  } satisfies TileflowMapControllerOptions<TileflowAnnotation>;

  // Each change hands the options over; the map does only the work a change asks for.
  $: controller?.update(controllerOptions);

  // Before the map mounts, and on the server, the frame shows what the options already say.
  $: status =
    mapStatus ?? getTileflowMapInitialStatus(controllerOptions, controlledInteractionOwnership);
  $: captureState =
    portalDiagnostic !== null
      ? 'error'
      : status.readiness === 'idle' && !viewsSettled
        ? 'loading'
        : status.readiness;

  // Snippet views settle once Svelte has committed them and two frames have drawn them.
  let viewSignature = '[]';
  let viewRun = 0;
  $: settleViews(renderTargets);

  function settleViews(targets: TileflowMapRenderTargetList<TileflowAnnotation>) {
    const signature = JSON.stringify([
      ...targets.annotations.map(({key}) => `annotation:${key}`),
      ...targets.semantic.map(({key}) => `semantic:${key}`),
    ]);
    if (signature === viewSignature) return;
    viewSignature = signature;
    const run = ++viewRun;
    viewsSettled = false;
    void (async () => {
      await tick();
      if (run !== viewRun) return;
      await nextAnimationFrame();
      if (run !== viewRun) return;
      await nextAnimationFrame();
      if (run === viewRun) viewsSettled = true;
    })();
  }

  onMount(() => {
    controller = createTileflowMap(container, controllerOptions, {
      sessionSource: 'svelte',
      // The frame this component renders carries the capture attributes.
      statusElement: null,
    });
    runtimeReference.attach(controller);
    mapStatus = controller.getStatus();

    return () => {
      viewRun += 1;
      if (controller) runtimeReference.detach(controller);
      controller?.destroy();
      controller = null;
    };
  });

  function nextAnimationFrame(): Promise<void> {
    const view = container?.ownerDocument.defaultView;
    if (!view) return Promise.resolve();
    return new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
  }

  function reportPortalFailure(error: unknown) {
    console.error('Failed to mount a Tileflow interaction snippet', error);
    if (portalDiagnostic) return;
    portalDiagnostic = {
      code: 'OVERLAY_FAILURE',
      level: 'error',
      message: 'Unable to mount a Tileflow interaction snippet.',
    };
    onInteractionDiagnostic?.(portalDiagnostic);
  }

  type MarkerPointerState = {focused: boolean; hovered: boolean};
  let markerPointer: Record<string, MarkerPointerState> = {};
  // A marker is selected while its popup is open: the popup has a render target of its own.
  $: openPopupAnnotationIds = new Set(
    renderTargets.annotations
      .filter((renderTarget) => renderTarget.kind === 'popup')
      .map((renderTarget) => renderTarget.annotation.id),
  );

  /** Reads a marker's hover and focus from its element, for the `state` of its snippet. */
  function trackMarker(
    _node: HTMLElement,
    renderTarget: TileflowMapLibreDomRenderTarget<TileflowAnnotation>,
  ) {
    const element = renderTarget.container.closest<HTMLElement>(
      '[data-tileflow-interaction="marker"]',
    );
    const set = (patch: Partial<MarkerPointerState>) => {
      markerPointer = {
        ...markerPointer,
        [renderTarget.key]: {
          ...(markerPointer[renderTarget.key] ?? {focused: false, hovered: false}),
          ...patch,
        },
      };
    };
    const enter = () => set({hovered: true});
    const leave = () => set({hovered: false});
    const focus = () => set({focused: true});
    const blur = () => set({focused: false});
    element?.addEventListener('pointerenter', enter);
    element?.addEventListener('pointerleave', leave);
    element?.addEventListener('focusin', focus);
    element?.addEventListener('focusout', blur);
    return {
      destroy() {
        element?.removeEventListener('pointerenter', enter);
        element?.removeEventListener('pointerleave', leave);
        element?.removeEventListener('focusin', focus);
        element?.removeEventListener('focusout', blur);
        const rest = {...markerPointer};
        delete rest[renderTarget.key];
        markerPointer = rest;
      },
    };
  }

  function portal(node: HTMLElement, target: HTMLElement) {
    let currentTarget = target;
    const move = (nextTarget: HTMLElement) => {
      try {
        nextTarget.append(node);
        currentTarget = nextTarget;
      } catch (error) {
        reportPortalFailure(error);
      }
    };
    move(target);

    return {
      destroy() {
        node.remove();
      },
      update(nextTarget: HTMLElement) {
        if (nextTarget !== currentTarget) move(nextTarget);
      },
    };
  }

  function createAnnotationViewContext(
    renderTarget: TileflowMapLibreDomRenderTarget<TileflowAnnotation>,
    pointer?: MarkerPointerState,
    openPopups?: ReadonlySet<string>,
  ): TileflowAnnotationViewContext {
    const content = getRenderTargetContent(renderTarget);
    return {
      ...(renderTarget.kind === 'marker'
        ? {
            state: {
              focused: pointer?.focused ?? false,
              hovered: pointer?.hovered ?? false,
              selected: openPopups?.has(renderTarget.annotation.id) ?? false,
            },
          }
        : {}),
      annotation: renderTarget.annotation,
      close: renderTarget.close,
      content,
      target: {
        annotation: renderTarget.annotation,
        coordinate: renderTarget.annotation.coordinate,
        kind: 'annotation',
      },
      viewName: content?.kind === 'view' ? content.name : undefined,
    };
  }

  function getRenderTargetContent(
    renderTarget: TileflowMapLibreDomRenderTarget<TileflowAnnotation>,
  ): TileflowInteractionContent | undefined {
    switch (renderTarget.kind) {
      case 'marker':
        return renderTarget.annotation.marker?.content;
      case 'popup':
        return renderTarget.annotation.popup?.content;
      case 'tooltip':
        return renderTarget.annotation.tooltip?.content;
    }
  }

  function createSemanticViewContext(
    renderTarget: TileflowMapLibreSemanticDomRenderTarget,
  ): TileflowInteractionViewContext {
    return {
      close: renderTarget.close,
      content: renderTarget.content,
      target: renderTarget.target,
      viewName: renderTarget.viewName,
    };
  }

  function shallowCopy<T>(value: T): T {
    if (Array.isArray(value)) return [...value] as T;
    if (value !== null && typeof value === 'object') return {...value};
    return value;
  }

  function formatHeight(value: number | string): string {
    return typeof value === 'number' ? `${value}px` : value;
  }
</script>

<div
  bind:this={container}
  class={className}
  data-tileflow-capture-id={resolvedCaptureId}
  data-tileflow-map={source.map}
  data-tileflow-theme={status.theme}
  data-tileflow-state={captureState}
  style={frameStyle}
>
  {#if isImageMode && status.imageUrl}
    <!-- The map tracks the image's load and decode for capture readiness. -->
    <img
      bind:this={imageElement}
      {alt}
      decoding="async"
      loading={imageLoading}
      src={status.imageUrl}
      style="display: block; height: 100%; object-fit: cover; width: 100%;"
    />
  {/if}
  {#each renderTargets.annotations as renderTarget (renderTarget.key)}
    {#if renderTarget.kind === 'marker' && marker}
      <div
        style="display: contents;"
        use:portal={renderTarget.container}
        use:trackMarker={renderTarget}
      >
        {@render marker(
          createAnnotationViewContext(
            renderTarget,
            markerPointer[renderTarget.key],
            openPopupAnnotationIds,
          ),
        )}
      </div>
    {:else if renderTarget.kind === 'tooltip' && tooltip}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render tooltip(createAnnotationViewContext(renderTarget))}
      </div>
    {:else if renderTarget.kind === 'popup' && popup}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render popup(createAnnotationViewContext(renderTarget))}
      </div>
    {/if}
  {/each}
  {#each renderTargets.semantic as renderTarget (renderTarget.key)}
    {#if renderTarget.kind === 'tooltip' && tooltip}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render tooltip(createSemanticViewContext(renderTarget))}
      </div>
    {:else if renderTarget.kind === 'popup' && popup}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render popup(createSemanticViewContext(renderTarget))}
      </div>
    {/if}
  {/each}
</div>
