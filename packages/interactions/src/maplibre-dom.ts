import type {
  TileflowAnnotation,
  TileflowAnnotationInteractionEvent,
  TileflowInteractionContent,
  TileflowInteractionInputModality,
  TileflowInteractionState,
  TileflowInteractionTargetRef,
} from './contracts';
import {createTileflowAnnotationRegistry, type TileflowAnnotationRegistry} from './maplibre';
import type {TileflowInteractionDiagnostic} from './validation';

/** A minimal structural contract shared by MapLibre Marker and Popup instances. */
export type TileflowMapLibrePositioned<TMap> = {
  addTo: (map: TMap) => unknown;
  remove: () => unknown;
  setLngLat: (coordinate: [longitude: number, latitude: number]) => unknown;
};

export type TileflowMapLibreDomDocument = Pick<Document, 'createElement'>;

export type TileflowMapLibreDomOverlayKind = 'popup' | 'tooltip';

export type TileflowMapLibreDomMarkerFactoryInput<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Readonly<{
  annotation: TAnnotation;
  element: HTMLElement;
}>;

export type TileflowMapLibreDomOverlayFactoryInput<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Readonly<{
  annotation: TAnnotation;
  container: HTMLElement;
  kind: TileflowMapLibreDomOverlayKind;
}>;

export type TileflowMapLibreDomRenderTargetKind = 'marker' | 'popup' | 'tooltip';

/** A live DOM outlet for framework portals, teleports, and snippets. */
export type TileflowMapLibreDomRenderTarget<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Readonly<{
  annotation: TAnnotation;
  close: () => void;
  container: HTMLElement;
  key: string;
  kind: TileflowMapLibreDomRenderTargetKind;
}>;

export type TileflowMapLibreDomRenderTargetListener<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (targets: readonly TileflowMapLibreDomRenderTarget<TAnnotation>[]) => void;

export type TileflowMapLibreDomStateChangeReason = 'popup:close' | 'popup:open' | 'target:remove';

export type TileflowMapLibreDomInteractionStateListener = (
  state: TileflowInteractionState,
  previous: TileflowInteractionState,
  reason: TileflowMapLibreDomStateChangeReason,
) => void;

export type TileflowMapLibreDomDiagnosticListener = (
  diagnostics: readonly TileflowInteractionDiagnostic[],
) => void;

export type TileflowMapLibreDomCustomRenderers = Readonly<{
  marker: boolean;
  popup: boolean;
  tooltip: boolean;
}>;

export type TileflowLegacyMarker = Readonly<{
  color?: string;
  coordinates: readonly [longitude: number, latitude: number];
  id: string;
  label?: string;
}>;

export type TileflowNormalizedLegacyMarkers = Readonly<{
  annotations: readonly TileflowAnnotation[];
  /** Exact legacy element titles, including an explicitly empty label. */
  titles: ReadonlyMap<string, string>;
}>;

/** Normalizes the deprecated plural-coordinate marker shape once for all framework adapters. */
export function normalizeTileflowLegacyMarkers(
  markers: readonly TileflowLegacyMarker[],
): TileflowNormalizedLegacyMarkers {
  const titles = new Map<string, string>();
  const annotations = markers.map((marker): TileflowAnnotation => {
    const title = marker.label ?? marker.id;
    titles.set(marker.id, title);
    return {
      ariaLabel: title.trim().length > 0 ? title : marker.id,
      coordinate: marker.coordinates,
      id: marker.id,
      kind: 'marker',
      ...(marker.color === undefined ? {} : {marker: {color: marker.color}}),
    };
  });

  return Object.freeze({annotations: Object.freeze(annotations), titles});
}

export type TileflowMapLibreDomRuntimeOptions<
  TMap,
  TMarker extends TileflowMapLibrePositioned<TMap>,
  TOverlay extends TileflowMapLibrePositioned<TMap>,
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Readonly<{
  createMarker: (input: TileflowMapLibreDomMarkerFactoryInput<TAnnotation>) => TMarker;
  createOverlay: (input: TileflowMapLibreDomOverlayFactoryInput<TAnnotation>) => TOverlay;
  customMarker?: boolean;
  customPopup?: boolean;
  customTooltip?: boolean;
  defaultInteractionState?: TileflowInteractionState;
  document: TileflowMapLibreDomDocument;
  idPrefix?: string;
  interactionState?: TileflowInteractionState;
  map: TMap;
  onDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
  onInteractionStateChange?: TileflowMapLibreDomInteractionStateListener;
  reorderMarkers?: (
    markers: readonly TMarker[],
    annotations: readonly TAnnotation[],
    previousMarkers: readonly TMarker[],
    previousAnnotations: readonly TAnnotation[],
  ) => void;
  updateMarker?: (
    marker: TMarker,
    input: Readonly<{
      annotation: TAnnotation;
      element: HTMLElement;
      previousAnnotation: TAnnotation;
    }>,
  ) => void;
  updateOverlay?: (
    overlay: TOverlay,
    input: Readonly<{
      annotation: TAnnotation;
      container: HTMLElement;
      kind: TileflowMapLibreDomOverlayKind;
      previousAnnotation: TAnnotation;
    }>,
  ) => void;
}>;

export type TileflowMapLibreDomRuntime<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Readonly<{
  closePopup: () => boolean;
  dispose: () => void;
  getDiagnostics: () => readonly TileflowInteractionDiagnostic[];
  getInteractionState: () => TileflowInteractionState;
  getRenderTargets: () => readonly TileflowMapLibreDomRenderTarget<TAnnotation>[];
  openPopup: (annotationId: string) => boolean;
  reconcile: (annotations: readonly TAnnotation[]) => void;
  setCustomRenderers: (renderers: TileflowMapLibreDomCustomRenderers) => void;
  setInteractionState: (state: TileflowInteractionState) => void;
  subscribeEvents: (
    listener: (event: TileflowAnnotationInteractionEvent<TAnnotation>) => void,
  ) => () => void;
  subscribeDiagnostics: (listener: TileflowMapLibreDomDiagnosticListener) => () => void;
  subscribeRenderTargets: (
    listener: TileflowMapLibreDomRenderTargetListener<TAnnotation>,
  ) => () => void;
}>;

type AnnotationInstance<TMap, TMarker extends TileflowMapLibrePositioned<TMap>, TAnnotation> = {
  annotation: TAnnotation;
  container: HTMLElement;
  element: HTMLElement;
  focused: boolean;
  hovered: boolean;
  marker: TMarker;
  removed: boolean;
  removeListeners: readonly (() => void)[];
};

type ActiveOverlay<TMap, TOverlay extends TileflowMapLibrePositioned<TMap>, TAnnotation> = {
  annotation: TAnnotation;
  closeButton?: HTMLButtonElement;
  container: HTMLElement;
  keydownListener?: (event: KeyboardEvent) => void;
  kind: TileflowMapLibreDomOverlayKind;
  overlay: TOverlay;
  shell: HTMLElement;
};

type PendingStateRequest = Readonly<{
  inputModality: TileflowInteractionInputModality;
  popupId: string | null;
}>;

let runtimeSequence = 0;

/**
 * Creates an annotation runtime without importing MapLibre or reading browser globals.
 *
 * The caller injects a document and factories for MapLibre-compatible positioned instances.
 * Default content is written exclusively through `textContent`; named views are intentionally
 * blank unless the corresponding `custom*` outlet is enabled.
 */
export function createTileflowMapLibreDomRuntime<
  TMap,
  TMarker extends TileflowMapLibrePositioned<TMap>,
  TOverlay extends TileflowMapLibrePositioned<TMap>,
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
>(
  options: TileflowMapLibreDomRuntimeOptions<TMap, TMarker, TOverlay, TAnnotation>,
): TileflowMapLibreDomRuntime<TAnnotation> {
  const document = options.document;
  const idPrefix = options.idPrefix ?? `tileflow-interactions-${++runtimeSequence}`;
  assertIdPrefix(idPrefix);

  const controlled = options.interactionState !== undefined;
  let customRenderers: TileflowMapLibreDomCustomRenderers = Object.freeze({
    marker: options.customMarker ?? false,
    popup: options.customPopup ?? false,
    tooltip: options.customTooltip ?? false,
  });
  let interactionState =
    options.interactionState ?? options.defaultInteractionState ?? createInteractionState(null);
  let pendingStateRequest: PendingStateRequest | null = null;
  let missingControlledPopupNotified: string | null = null;

  const eventListeners = new Set<
    (event: TileflowAnnotationInteractionEvent<TAnnotation>) => void
  >();
  const diagnosticListeners = new Set<TileflowMapLibreDomDiagnosticListener>();
  const renderTargetListeners = new Set<TileflowMapLibreDomRenderTargetListener<TAnnotation>>();
  const activeDiagnostics = new Map<string, TileflowInteractionDiagnostic>();
  let diagnosticSnapshot: readonly TileflowInteractionDiagnostic[] = Object.freeze([]);
  let renderTargets: readonly TileflowMapLibreDomRenderTarget<TAnnotation>[] = Object.freeze([]);

  let activeTooltip: ActiveOverlay<TMap, TOverlay, TAnnotation> | null = null;
  let activePopup: ActiveOverlay<TMap, TOverlay, TAnnotation> | null = null;
  let reconciling = false;
  let disposeStarted = false;
  let disposeComplete = false;
  let overlaySequence = 0;

  const emit = (
    type: TileflowAnnotationInteractionEvent<TAnnotation>['type'],
    annotation: TAnnotation,
    inputModality?: TileflowInteractionInputModality,
  ) => {
    const event: TileflowAnnotationInteractionEvent<TAnnotation> = Object.freeze({
      coordinate: annotation.coordinate,
      ...(inputModality === undefined ? {} : {inputModality}),
      target: Object.freeze({
        annotation,
        coordinate: annotation.coordinate,
        kind: 'annotation' as const,
      }),
      type,
    });
    notifyListeners(eventListeners, event, 'Tileflow interaction event listeners failed.');
  };

  const publishRenderTargets = () => {
    if (reconciling || disposeComplete) return;
    renderTargets = buildRenderTargets();
    notifyListeners(
      renderTargetListeners,
      renderTargets,
      'Tileflow render target listeners failed.',
    );
  };

  const publishDiagnostics = () => {
    if (reconciling || disposeComplete) return;
    diagnosticSnapshot = Object.freeze([...activeDiagnostics.values()]);
    notifyListeners(
      diagnosticListeners,
      diagnosticSnapshot,
      'Tileflow diagnostic listeners failed.',
    );
  };

  const closeTooltipVisual = (annotationId?: string): boolean => {
    const current = activeTooltip;
    if (!current || (annotationId !== undefined && current.annotation.id !== annotationId)) {
      return false;
    }

    activeTooltip = null;
    clearSurfaceDiagnostics(current.annotation.id, 'tooltip');
    const marker = registry.get(current.annotation.id)?.instance;
    marker?.element.removeAttribute('aria-describedby');
    const errors = safelyRunAll([() => current.overlay.remove(), () => current.shell.remove()]);
    publishRenderTargets();
    throwCollectedErrors(errors, 'Unable to close the Tileflow tooltip.');
    return true;
  };

  const closePopupVisual = (
    returnFocus: boolean,
    inputModality: TileflowInteractionInputModality,
    annotationId?: string,
  ): boolean => {
    const current = activePopup;
    if (!current || (annotationId !== undefined && current.annotation.id !== annotationId)) {
      return false;
    }

    activePopup = null;
    clearSurfaceDiagnostics(current.annotation.id, 'popup');
    const marker = registry.get(current.annotation.id)?.instance;
    if (current.keydownListener) {
      current.shell.removeEventListener('keydown', current.keydownListener);
    }
    marker?.element.setAttribute('aria-expanded', 'false');
    marker?.element.removeAttribute('aria-controls');

    const errors = safelyRunAll([() => current.overlay.remove(), () => current.shell.remove()]);
    publishRenderTargets();
    emit('popup:close', current.annotation, inputModality);

    if (returnFocus && marker && !marker.removed) {
      errors.push(...safelyRunAll([() => marker.element.focus({preventScroll: true})]));
    }

    throwCollectedErrors(errors, 'Unable to close the Tileflow popup.');
    return true;
  };

  const updateActiveOverlay = (
    current: ActiveOverlay<TMap, TOverlay, TAnnotation>,
    annotation: TAnnotation,
  ) => {
    const previousAnnotation = current.annotation;
    current.annotation = annotation;
    current.overlay.setLngLat(copyCoordinate(annotation.coordinate));
    options.updateOverlay?.(current.overlay, {
      annotation,
      container: current.shell,
      kind: current.kind,
      previousAnnotation,
    });
    configureOverlayContent(current, annotation);
  };

  const openTooltipVisual = (annotationId: string): boolean => {
    const entry = registry.get(annotationId);
    if (!entry?.definition.tooltip || activePopup?.annotation.id === annotationId) return false;

    if (activeTooltip?.annotation.id === annotationId) {
      if (!Object.is(activeTooltip.annotation, entry.definition)) {
        try {
          updateActiveOverlay(activeTooltip, entry.definition);
          clearOverlayFailure(entry.definition.id, 'tooltip');
        } catch {
          reportOverlayFailure(entry.definition, 'tooltip');
        }
      }
      return false;
    }
    closeTooltipVisual();

    const shell = document.createElement('div');
    const container = document.createElement('div');
    shell.className = 'tileflow-interaction-tooltip';
    container.className = 'tileflow-interaction-tooltip-content';
    shell.id = domId(idPrefix, 'tooltip', ++overlaySequence);
    shell.setAttribute('data-tileflow-interaction', 'tooltip');
    shell.setAttribute('data-tileflow-target-kind', 'annotation');
    shell.setAttribute('role', 'tooltip');
    shell.style.pointerEvents = 'none';
    configureSurfaceStyles(shell);
    shell.append(container);

    let overlay: TOverlay | undefined;
    try {
      overlay = options.createOverlay({
        annotation: entry.definition,
        container: shell,
        kind: 'tooltip',
      });
      overlay.setLngLat(copyCoordinate(entry.definition.coordinate));
      overlay.addTo(options.map);
    } catch {
      safelyRunAll([() => overlay?.remove(), () => shell.remove()]);
      reportOverlayFailure(entry.definition, 'tooltip');
      return false;
    }

    activeTooltip = {
      annotation: entry.definition,
      container,
      kind: 'tooltip',
      overlay,
      shell,
    };
    configureOverlayContent(activeTooltip, entry.definition);
    clearOverlayFailure(entry.definition.id, 'tooltip');
    entry.instance.element.setAttribute('aria-describedby', shell.id);
    publishRenderTargets();
    return true;
  };

  const openPopupVisual = (
    annotationId: string,
    inputModality: TileflowInteractionInputModality,
  ): boolean => {
    const entry = registry.get(annotationId);
    if (!entry?.definition.popup) return false;

    if (activePopup?.annotation.id === annotationId) {
      if (!Object.is(activePopup.annotation, entry.definition)) {
        try {
          updateActiveOverlay(activePopup, entry.definition);
          clearOverlayFailure(entry.definition.id, 'popup');
        } catch {
          reportOverlayFailure(entry.definition, 'popup');
        }
      }
      return false;
    }

    closePopupVisual(false, inputModality);
    closeTooltipVisual(annotationId);

    const shell = document.createElement('div');
    const container = document.createElement('div');
    const closeButton = document.createElement('button');
    shell.className = 'tileflow-interaction-popup';
    container.className = 'tileflow-interaction-popup-content';
    closeButton.className = 'tileflow-interaction-popup-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    shell.id = domId(idPrefix, 'popup', ++overlaySequence);
    shell.setAttribute('data-tileflow-interaction', 'popup');
    shell.setAttribute('data-tileflow-target-kind', 'annotation');
    shell.setAttribute('aria-label', entry.definition.ariaLabel);
    shell.setAttribute('aria-modal', 'false');
    shell.setAttribute('role', 'dialog');
    closeButton.setAttribute('aria-label', `Close ${entry.definition.ariaLabel}`);
    configureSurfaceStyles(shell);
    closeButton.style.background = 'transparent';
    closeButton.style.border = '0';
    closeButton.style.color = 'inherit';
    closeButton.style.cursor = 'pointer';
    shell.append(container, closeButton);

    const closeListener = () => requestPopupState(null, 'pointer');
    const keydownListener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      requestPopupState(null, 'keyboard');
    };
    closeButton.addEventListener('click', closeListener);
    shell.addEventListener('keydown', keydownListener);

    let overlay: TOverlay | undefined;
    try {
      overlay = options.createOverlay({
        annotation: entry.definition,
        container: shell,
        kind: 'popup',
      });
      overlay.setLngLat(copyCoordinate(entry.definition.coordinate));
      overlay.addTo(options.map);
    } catch {
      closeButton.removeEventListener('click', closeListener);
      shell.removeEventListener('keydown', keydownListener);
      safelyRunAll([() => overlay?.remove(), () => shell.remove()]);
      reportOverlayFailure(entry.definition, 'popup');
      return false;
    }

    activePopup = {
      annotation: entry.definition,
      closeButton,
      container,
      keydownListener,
      kind: 'popup',
      overlay,
      shell,
    };
    configureOverlayContent(activePopup, entry.definition);
    clearOverlayFailure(entry.definition.id, 'popup');
    entry.instance.element.setAttribute('aria-controls', shell.id);
    entry.instance.element.setAttribute('aria-expanded', 'true');
    publishRenderTargets();
    emit('popup:open', entry.definition, inputModality);
    closeButton.focus({preventScroll: true});
    return true;
  };

  const syncPopupFromInteractionState = (
    inputModality: TileflowInteractionInputModality,
    returnFocusWhenClosing: boolean,
  ) => {
    const popupId = getAnnotationPopupId(interactionState);
    if (popupId === null) {
      closePopupVisual(returnFocusWhenClosing, inputModality);
      return;
    }

    const entry = registry.get(popupId);
    if (!entry?.definition.popup) {
      closePopupVisual(false, inputModality);
      return;
    }
    openPopupVisual(popupId, inputModality);
  };

  const notifyStateRequest = (
    next: TileflowInteractionState,
    previous: TileflowInteractionState,
    reason: TileflowMapLibreDomStateChangeReason,
  ) => {
    options.onInteractionStateChange?.(next, previous, reason);
  };

  function requestPopupState(
    popupId: string | null,
    inputModality: TileflowInteractionInputModality,
  ): boolean {
    const currentPopupId = getAnnotationPopupId(interactionState);
    if (
      popupId === null
        ? interactionState.popup === null && activePopup === null
        : currentPopupId === popupId && activePopup?.annotation.id === popupId
    ) {
      return false;
    }

    if (popupId !== null && !registry.get(popupId)?.definition.popup) return false;

    const previous = interactionState;
    const next = createInteractionState(
      popupId === null ? null : Object.freeze({id: popupId, kind: 'annotation' as const}),
    );
    missingControlledPopupNotified = null;

    if (controlled) {
      pendingStateRequest = {inputModality, popupId};
      notifyStateRequest(next, previous, popupId === null ? 'popup:close' : 'popup:open');
      return true;
    }

    interactionState = next;
    syncPopupFromInteractionState(inputModality, popupId === null);
    notifyStateRequest(next, previous, popupId === null ? 'popup:close' : 'popup:open');
    return true;
  }

  const reconcileOverlayAvailability = () => {
    if (activeTooltip) {
      const tooltipEntry = registry.get(activeTooltip.annotation.id);
      if (!tooltipEntry?.definition.tooltip) closeTooltipVisual();
      else if (!Object.is(activeTooltip.annotation, tooltipEntry.definition)) {
        updateActiveOverlay(activeTooltip, tooltipEntry.definition);
      }
    }

    const popupId = getAnnotationPopupId(interactionState);
    if (popupId === null) {
      closePopupVisual(false, 'programmatic');
      missingControlledPopupNotified = null;
      return;
    }

    const popupEntry = registry.get(popupId);
    if (popupEntry?.definition.popup) {
      missingControlledPopupNotified = null;
      syncPopupFromInteractionState('programmatic', false);
      return;
    }

    closePopupVisual(false, 'programmatic');
    if (controlled) {
      if (missingControlledPopupNotified === popupId) return;
      missingControlledPopupNotified = popupId;
      notifyStateRequest(createInteractionState(null), interactionState, 'target:remove');
      return;
    }

    const previous = interactionState;
    interactionState = createInteractionState(null);
    notifyStateRequest(interactionState, previous, 'target:remove');
  };

  const closeAnnotationOverlays = (
    annotationId: string,
    inputModality: TileflowInteractionInputModality,
  ) => {
    closeTooltipVisual(annotationId);
    if (getAnnotationPopupId(interactionState) === annotationId) {
      requestPopupState(null, inputModality);
      return;
    }
    closePopupVisual(true, inputModality, annotationId);
  };

  const clearContentDiagnostic = (
    annotationId: string,
    surface: TileflowMapLibreDomRenderTargetKind,
    code: 'INVALID_FIELD' | 'MISSING_VIEW',
  ) => {
    if (!activeDiagnostics.delete(diagnosticKey(annotationId, surface, code))) return;
    publishDiagnostics();
  };

  const reportContentDiagnostic = (
    annotation: TAnnotation,
    surface: TileflowMapLibreDomRenderTargetKind,
    code: 'INVALID_FIELD' | 'MISSING_VIEW',
  ) => {
    const key = diagnosticKey(annotation.id, surface, code);
    if (activeDiagnostics.has(key)) return;
    const diagnostic: TileflowInteractionDiagnostic = Object.freeze({
      code,
      level: 'error' as const,
      message:
        code === 'INVALID_FIELD'
          ? 'Annotation field content did not resolve to a scalar value.'
          : 'Annotation view content has no custom renderer for its active surface.',
      target: Object.freeze({id: annotation.id, kind: 'annotation' as const}),
    });
    activeDiagnostics.set(key, diagnostic);
    options.onDiagnostic?.(diagnostic);
    publishDiagnostics();
  };

  const clearOverlayFailure = (annotationId: string, surface: TileflowMapLibreDomOverlayKind) => {
    if (!activeDiagnostics.delete(overlayDiagnosticKey(annotationId, surface))) return;
    publishDiagnostics();
  };

  const reportOverlayFailure = (
    annotation: TAnnotation,
    surface: TileflowMapLibreDomOverlayKind,
  ) => {
    const key = overlayDiagnosticKey(annotation.id, surface);
    if (activeDiagnostics.has(key)) return;
    const diagnostic: TileflowInteractionDiagnostic = Object.freeze({
      code: 'OVERLAY_FAILURE',
      level: 'error',
      message: `Tileflow could not mount or update the annotation ${surface} overlay.`,
      target: Object.freeze({id: annotation.id, kind: 'annotation' as const}),
    });
    activeDiagnostics.set(key, diagnostic);
    options.onDiagnostic?.(diagnostic);
    publishDiagnostics();
  };

  const resolveAnnotationContent = (
    annotation: TAnnotation,
    content: TileflowInteractionContent,
    surface: TileflowMapLibreDomRenderTargetKind,
  ): string => {
    if (content.kind === 'view') {
      clearContentDiagnostic(annotation.id, surface, 'INVALID_FIELD');
      if (customRenderers[surface]) {
        clearContentDiagnostic(annotation.id, surface, 'MISSING_VIEW');
      } else {
        reportContentDiagnostic(annotation, surface, 'MISSING_VIEW');
      }
      return '';
    }

    clearContentDiagnostic(annotation.id, surface, 'MISSING_VIEW');
    const resolution = resolveContent(content, annotation.data);
    if (resolution.invalidField) {
      reportContentDiagnostic(annotation, surface, 'INVALID_FIELD');
    } else {
      clearContentDiagnostic(annotation.id, surface, 'INVALID_FIELD');
    }
    return resolution.text;
  };

  const clearAnnotationDiagnostics = (annotationId: string) => {
    const prefix = `${annotationId}\u0000`;
    let changed = false;
    for (const key of activeDiagnostics.keys()) {
      if (!key.startsWith(prefix)) continue;
      activeDiagnostics.delete(key);
      changed = true;
    }
    if (changed) publishDiagnostics();
  };

  function clearSurfaceDiagnostics(
    annotationId: string,
    surface: TileflowMapLibreDomRenderTargetKind,
  ) {
    const removedInvalidField = activeDiagnostics.delete(
      diagnosticKey(annotationId, surface, 'INVALID_FIELD'),
    );
    const removedMissingView = activeDiagnostics.delete(
      diagnosticKey(annotationId, surface, 'MISSING_VIEW'),
    );
    if (removedInvalidField || removedMissingView) publishDiagnostics();
  }

  const configureAnnotationElement = (
    instance: Pick<
      AnnotationInstance<TMap, TMarker, TAnnotation>,
      'annotation' | 'container' | 'element'
    >,
    annotation: TAnnotation,
  ) => {
    instance.annotation = annotation;
    instance.element.setAttribute('aria-label', annotation.ariaLabel);
    instance.element.setAttribute('data-tileflow-interaction', 'marker');
    instance.element.setAttribute('data-tileflow-target-kind', 'annotation');
    instance.element.title = annotation.ariaLabel;
    instance.element.style.cursor = annotation.popup ? 'pointer' : 'default';

    if (annotation.popup) {
      instance.element.setAttribute('aria-haspopup', 'dialog');
      instance.element.setAttribute('role', 'button');
      instance.element.tabIndex = 0;
      if (activePopup?.annotation.id !== annotation.id) {
        instance.element.setAttribute('aria-expanded', 'false');
      }
    } else {
      instance.element.removeAttribute('aria-controls');
      instance.element.removeAttribute('aria-expanded');
      instance.element.removeAttribute('aria-haspopup');
      instance.element.setAttribute('role', 'img');
      instance.element.tabIndex = annotation.tooltip ? 0 : -1;
    }

    if (annotation.marker?.color) {
      instance.element.style.setProperty(
        '--tileflow-interaction-marker-color',
        annotation.marker.color,
      );
    } else {
      instance.element.style.removeProperty('--tileflow-interaction-marker-color');
    }

    const markerText = annotation.marker?.content
      ? resolveAnnotationContent(annotation, annotation.marker.content, 'marker')
      : '\u2022';
    if (!annotation.marker?.content) {
      clearContentDiagnostic(annotation.id, 'marker', 'INVALID_FIELD');
      clearContentDiagnostic(annotation.id, 'marker', 'MISSING_VIEW');
    }
    if (!customRenderers.marker) {
      instance.container.textContent = markerText;
      configureDefaultMarkerStyles(instance.container);
    } else {
      clearDefaultMarkerStyles(instance.container);
    }
    configureViewAttribute(instance.container, annotation.marker?.content);
  };

  const applyAnnotation = (
    instance: AnnotationInstance<TMap, TMarker, TAnnotation>,
    annotation: TAnnotation,
    previousAnnotation: TAnnotation,
  ) => {
    configureAnnotationElement(instance, annotation);
    instance.marker.setLngLat(copyCoordinate(annotation.coordinate));
    options.updateMarker?.(instance.marker, {
      annotation,
      element: instance.element,
      previousAnnotation,
    });

    if (activeTooltip?.annotation.id === annotation.id && annotation.tooltip) {
      try {
        updateActiveOverlay(activeTooltip, annotation);
        clearOverlayFailure(annotation.id, 'tooltip');
      } catch (error) {
        reportOverlayFailure(annotation, 'tooltip');
        throw error;
      }
    }
    if (activePopup?.annotation.id === annotation.id && annotation.popup) {
      try {
        updateActiveOverlay(activePopup, annotation);
        clearOverlayFailure(annotation.id, 'popup');
      } catch (error) {
        reportOverlayFailure(annotation, 'popup');
        throw error;
      }
    }
  };

  const createAnnotationInstance = (
    annotation: TAnnotation,
  ): AnnotationInstance<TMap, TMarker, TAnnotation> => {
    const element = document.createElement('div');
    const container = document.createElement('div');
    element.className = 'tileflow-interaction-marker';
    container.className = 'tileflow-interaction-marker-content';
    element.append(container);
    configureAnnotationElement({annotation, container, element}, annotation);

    const marker = options.createMarker({annotation, element});
    const instance: AnnotationInstance<TMap, TMarker, TAnnotation> = {
      annotation,
      container,
      element,
      focused: false,
      hovered: false,
      marker,
      removed: false,
      removeListeners: [],
    };

    const removeListeners: Array<() => void> = [];
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
    ) => {
      element.addEventListener(type, listener);
      removeListeners.push(() => element.removeEventListener(type, listener));
    };

    listen('pointerenter', () => {
      instance.hovered = true;
      emit('target:enter', instance.annotation, 'pointer');
      openTooltipVisual(instance.annotation.id);
    });
    listen('pointerleave', () => {
      instance.hovered = false;
      emit('target:leave', instance.annotation, 'pointer');
      if (!instance.focused) closeTooltipVisual(instance.annotation.id);
    });
    listen('focus', () => {
      instance.focused = true;
      emit('target:focus', instance.annotation, 'keyboard');
      openTooltipVisual(instance.annotation.id);
    });
    listen('blur', () => {
      instance.focused = false;
      emit('target:blur', instance.annotation, 'keyboard');
      if (!instance.hovered) closeTooltipVisual(instance.annotation.id);
    });
    listen('click', () => {
      if (!instance.annotation.popup) return;
      emit('target:activate', instance.annotation, 'pointer');
      requestPopupState(instance.annotation.id, 'pointer');
    });
    listen('keydown', (event) => {
      if (event.key === 'Escape') {
        const didCloseTooltip = closeTooltipVisual(instance.annotation.id);
        const didRequestPopupClose =
          activePopup?.annotation.id === instance.annotation.id
            ? requestPopupState(null, 'keyboard')
            : false;
        if (didCloseTooltip || didRequestPopupClose) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (
        !instance.annotation.popup ||
        (event.key !== 'Enter' && event.key !== ' ' && event.code !== 'Space')
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      emit('target:activate', instance.annotation, 'keyboard');
      requestPopupState(instance.annotation.id, 'keyboard');
    });
    instance.removeListeners = removeListeners;

    try {
      marker.setLngLat(copyCoordinate(annotation.coordinate));
      marker.addTo(options.map);
    } catch (error) {
      for (const removeListener of removeListeners) removeListener();
      safelyRunAll([() => marker.remove(), () => element.remove()]);
      throw error;
    }

    return instance;
  };

  const removeAnnotationInstance = (instance: AnnotationInstance<TMap, TMarker, TAnnotation>) => {
    if (instance.removed) return;
    closeTooltipVisual(instance.annotation.id);
    closePopupVisual(false, 'programmatic', instance.annotation.id);

    const errors = safelyRunAll([
      ...instance.removeListeners,
      () => instance.marker.remove(),
      () => instance.element.remove(),
    ]);
    if (errors.length === 0) instance.removed = true;
    clearAnnotationDiagnostics(instance.annotation.id);
    throwCollectedErrors(
      errors,
      `Unable to remove Tileflow annotation "${instance.annotation.id}".`,
    );
  };

  const registry: TileflowAnnotationRegistry<
    string,
    TAnnotation,
    AnnotationInstance<TMap, TMarker, TAnnotation>
  > = createTileflowAnnotationRegistry({
    context: undefined,
    create: (_context, annotation) => createAnnotationInstance(annotation),
    getKey: (annotation) => annotation.id,
    remove: (instance) => removeAnnotationInstance(instance),
    reorder: options.reorderMarkers
      ? (_context, entries, previousEntries) => {
          options.reorderMarkers?.(
            entries.map((entry) => entry.instance.marker),
            entries.map((entry) => entry.definition),
            previousEntries.map((entry) => entry.instance.marker),
            previousEntries.map((entry) => entry.definition),
          );
        }
      : undefined,
    update: (instance, _context, annotation, previousAnnotation) => {
      applyAnnotation(instance, annotation, previousAnnotation);
      return () => applyAnnotation(instance, previousAnnotation, annotation);
    },
  });

  function configureOverlayContent(
    overlay: ActiveOverlay<TMap, TOverlay, TAnnotation>,
    annotation: TAnnotation,
  ) {
    if (overlay.kind === 'tooltip') {
      configureViewAttribute(overlay.container, annotation.tooltip?.content);
      if (annotation.tooltip) {
        const text = resolveAnnotationContent(annotation, annotation.tooltip.content, 'tooltip');
        if (!customRenderers.tooltip) overlay.container.textContent = text;
      }
      return;
    }

    overlay.shell.setAttribute('aria-label', annotation.ariaLabel);
    overlay.closeButton?.setAttribute('aria-label', `Close ${annotation.ariaLabel}`);
    configureViewAttribute(overlay.container, annotation.popup?.content);
    if (annotation.popup) {
      const text = resolveAnnotationContent(annotation, annotation.popup.content, 'popup');
      if (!customRenderers.popup) overlay.container.textContent = text;
    }
  }

  function buildRenderTargets(): readonly TileflowMapLibreDomRenderTarget<TAnnotation>[] {
    const targets: Array<TileflowMapLibreDomRenderTarget<TAnnotation>> = [];

    if (customRenderers.marker) {
      for (const entry of registry.entries()) {
        const annotationId = entry.definition.id;
        targets.push(
          Object.freeze({
            annotation: entry.definition,
            close: () => closeAnnotationOverlays(annotationId, 'programmatic'),
            container: entry.instance.container,
            key: renderTargetKey('marker', annotationId),
            kind: 'marker' as const,
          }),
        );
      }
    }

    if (customRenderers.tooltip && activeTooltip) {
      const annotationId = activeTooltip.annotation.id;
      targets.push(
        Object.freeze({
          annotation: activeTooltip.annotation,
          close: () => closeTooltipVisual(annotationId),
          container: activeTooltip.container,
          key: renderTargetKey('tooltip', annotationId),
          kind: 'tooltip' as const,
        }),
      );
    }

    if (customRenderers.popup && activePopup) {
      const annotationId = activePopup.annotation.id;
      targets.push(
        Object.freeze({
          annotation: activePopup.annotation,
          close: () => requestPopupState(null, 'programmatic'),
          container: activePopup.container,
          key: renderTargetKey('popup', annotationId),
          kind: 'popup' as const,
        }),
      );
    }

    return Object.freeze(targets);
  }

  return {
    closePopup() {
      assertRuntimeActive(disposeStarted);
      return requestPopupState(null, 'programmatic');
    },
    dispose() {
      if (disposeComplete) return;
      if (!disposeStarted) {
        disposeStarted = true;
        reconciling = true;
        const errors = safelyRunAll([
          () => closeTooltipVisual(),
          () => closePopupVisual(false, 'programmatic'),
        ]);
        reconciling = false;
        renderTargets = Object.freeze([]);
        activeDiagnostics.clear();
        diagnosticSnapshot = Object.freeze([]);
        notifyListeners(
          diagnosticListeners,
          diagnosticSnapshot,
          'Tileflow diagnostic listeners failed.',
          errors,
        );
        notifyListeners(
          renderTargetListeners,
          renderTargets,
          'Tileflow render target listeners failed.',
          errors,
        );
        renderTargetListeners.clear();
        diagnosticListeners.clear();
        eventListeners.clear();
        throwCollectedErrors(errors, 'Unable to begin Tileflow interaction runtime disposal.');
      }

      registry.dispose();
      disposeComplete = true;
    },
    getInteractionState() {
      return interactionState;
    },
    getDiagnostics() {
      return diagnosticSnapshot;
    },
    getRenderTargets() {
      return renderTargets;
    },
    openPopup(annotationId) {
      assertRuntimeActive(disposeStarted);
      return requestPopupState(annotationId, 'programmatic');
    },
    reconcile(annotations) {
      assertRuntimeActive(disposeStarted);
      reconciling = true;
      try {
        registry.reconcile(annotations);
      } finally {
        reconciling = false;
        reconcileOverlayAvailability();
        publishDiagnostics();
        publishRenderTargets();
      }
    },
    setCustomRenderers(renderers) {
      assertRuntimeActive(disposeStarted);
      if (
        renderers.marker === customRenderers.marker &&
        renderers.tooltip === customRenderers.tooltip &&
        renderers.popup === customRenderers.popup
      ) {
        return;
      }

      reconciling = true;
      try {
        const previous = customRenderers;
        customRenderers = Object.freeze({...renderers});
        if (!previous.marker && customRenderers.marker) {
          for (const entry of registry.entries()) entry.instance.container.textContent = '';
        }
        if (!previous.tooltip && customRenderers.tooltip && activeTooltip) {
          activeTooltip.container.textContent = '';
        }
        if (!previous.popup && customRenderers.popup && activePopup) {
          activePopup.container.textContent = '';
        }

        for (const entry of registry.entries()) {
          configureAnnotationElement(entry.instance, entry.definition);
        }
        if (activeTooltip) configureOverlayContent(activeTooltip, activeTooltip.annotation);
        if (activePopup) configureOverlayContent(activePopup, activePopup.annotation);
      } finally {
        reconciling = false;
        publishDiagnostics();
        publishRenderTargets();
      }
    },
    setInteractionState(state) {
      assertRuntimeActive(disposeStarted);
      const popupId = getAnnotationPopupId(state);
      const inputModality =
        pendingStateRequest?.popupId === popupId
          ? pendingStateRequest.inputModality
          : 'programmatic';
      pendingStateRequest = null;
      interactionState = state;
      missingControlledPopupNotified = null;
      syncPopupFromInteractionState(inputModality, popupId === null);
    },
    subscribeEvents(listener) {
      assertRuntimeActive(disposeStarted);
      eventListeners.add(listener);
      return createUnsubscribe(eventListeners, listener);
    },
    subscribeDiagnostics(listener) {
      assertRuntimeActive(disposeStarted);
      diagnosticListeners.add(listener);
      return createUnsubscribe(diagnosticListeners, listener);
    },
    subscribeRenderTargets(listener) {
      assertRuntimeActive(disposeStarted);
      renderTargetListeners.add(listener);
      return createUnsubscribe(renderTargetListeners, listener);
    },
  };
}

function createInteractionState(
  popup: TileflowInteractionTargetRef | null,
): TileflowInteractionState {
  return Object.freeze({popup});
}

function getAnnotationPopupId(state: TileflowInteractionState): string | null {
  return state.popup?.kind === 'annotation' ? state.popup.id : null;
}

function copyCoordinate(
  coordinate: readonly [longitude: number, latitude: number],
): [longitude: number, latitude: number] {
  return [coordinate[0], coordinate[1]];
}

function renderTargetKey(kind: TileflowMapLibreDomRenderTargetKind, annotationId: string): string {
  return `${kind}:${annotationId}`;
}

function domId(prefix: string, kind: TileflowMapLibreDomOverlayKind, sequence: number): string {
  return `${prefix}-${kind}-${sequence}`;
}

function assertIdPrefix(idPrefix: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(idPrefix)) {
    throw new TypeError('Tileflow DOM idPrefix must be a portable identifier.');
  }
}

function assertRuntimeActive(disposed: boolean): void {
  if (disposed) throw new Error('Tileflow MapLibre DOM runtime is disposed.');
}

function configureViewAttribute(
  element: HTMLElement,
  content: TileflowInteractionContent | undefined,
): void {
  if (content?.kind === 'view') {
    element.setAttribute('data-tileflow-view', content.name);
  } else {
    element.removeAttribute('data-tileflow-view');
  }
}

function configureSurfaceStyles(element: HTMLElement): void {
  element.style.background = 'var(--tileflow-interaction-surface, #ffffff)';
  element.style.borderColor = 'var(--tileflow-interaction-border-color, #d1d5db)';
  element.style.borderRadius = 'var(--tileflow-interaction-border-radius, 0.375rem)';
  element.style.borderStyle = 'solid';
  element.style.borderWidth = '1px';
  element.style.boxShadow = 'var(--tileflow-interaction-shadow, 0 2px 8px rgb(0 0 0 / 0.18))';
  element.style.color = 'var(--tileflow-interaction-foreground, #111827)';
  element.style.maxWidth = 'var(--tileflow-interaction-max-width, 20rem)';
  element.style.padding = '0.5rem';
}

function configureDefaultMarkerStyles(element: HTMLElement): void {
  element.style.alignItems = 'center';
  element.style.background = 'var(--tileflow-interaction-marker-color, #2563eb)';
  element.style.borderColor = 'var(--tileflow-interaction-border-color, #ffffff)';
  element.style.borderRadius = 'var(--tileflow-interaction-border-radius, 9999px)';
  element.style.borderStyle = 'solid';
  element.style.borderWidth = '1px';
  element.style.boxShadow = 'var(--tileflow-interaction-shadow, 0 1px 4px rgb(0 0 0 / 0.25))';
  element.style.color = 'var(--tileflow-interaction-foreground, #ffffff)';
  element.style.display = 'inline-flex';
  element.style.justifyContent = 'center';
  element.style.minHeight = '1.5rem';
  element.style.minWidth = '1.5rem';
  element.style.padding = '0.25rem';
}

function clearDefaultMarkerStyles(element: HTMLElement): void {
  element.style.alignItems = '';
  element.style.background = '';
  element.style.borderColor = '';
  element.style.borderRadius = '';
  element.style.borderStyle = '';
  element.style.borderWidth = '';
  element.style.boxShadow = '';
  element.style.color = '';
  element.style.display = '';
  element.style.justifyContent = '';
  element.style.minHeight = '';
  element.style.minWidth = '';
  element.style.padding = '';
}

function resolveContent(
  content: TileflowInteractionContent,
  data: unknown,
): Readonly<{invalidField: boolean; text: string}> {
  if (content.kind === 'text') return {invalidField: false, text: content.text};
  if (content.kind === 'view') return {invalidField: false, text: ''};

  const fallback = content.fallback ?? '';
  const invalid = () => ({invalidField: content.fallback === undefined, text: fallback});
  let current: unknown = data;
  try {
    for (const segment of content.field.split('.')) {
      if (
        current === null ||
        typeof current !== 'object' ||
        isUnsafeFieldSegment(segment) ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return invalid();
      }
      current = (current as Record<string, unknown>)[segment];
    }
  } catch {
    return invalid();
  }

  return current === null ||
    typeof current === 'boolean' ||
    typeof current === 'number' ||
    typeof current === 'string'
    ? {invalidField: false, text: String(current)}
    : invalid();
}

function diagnosticKey(
  annotationId: string,
  surface: TileflowMapLibreDomRenderTargetKind,
  code: 'INVALID_FIELD' | 'MISSING_VIEW',
): string {
  return `${annotationId}\u0000${surface}\u0000${code}`;
}

function overlayDiagnosticKey(
  annotationId: string,
  surface: TileflowMapLibreDomOverlayKind,
): string {
  return `${annotationId}\u0000${surface}\u0000OVERLAY_FAILURE`;
}

function isUnsafeFieldSegment(segment: string): boolean {
  return segment === '__proto__' || segment === 'constructor' || segment === 'prototype';
}

function createUnsubscribe<TValue>(values: Set<TValue>, value: TValue): () => void {
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    values.delete(value);
  };
}

function notifyListeners<TValue>(
  listeners: ReadonlySet<(value: TValue) => void>,
  value: TValue,
  message: string,
  errors: unknown[] = [],
): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollectedErrors(errors, message);
}

function safelyRunAll(operations: readonly (() => unknown)[]): unknown[] {
  const errors: unknown[] = [];
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}
