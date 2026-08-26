import type {
  TileflowInteractionBinding,
  TileflowInteractionContent,
  TileflowInteractionEvent,
  TileflowInteractionInputModality,
  TileflowInteractionState,
  TileflowResolvedSemanticFeatureTarget,
} from './contracts';
import type {
  TileflowMapLibreDomCustomRenderers,
  TileflowMapLibreDomDocument,
  TileflowMapLibreDomOverlayKind,
  TileflowMapLibreDomStateChangeReason,
  TileflowMapLibrePositioned,
} from './maplibre-dom';
import {
  createTileflowMapLibrePoiController,
  type TileflowMapLibrePoiController,
  type TileflowMapLibrePoiMap,
  type TileflowMapLibrePoiMatch,
} from './maplibre-poi';
import {tileflowInteractionTargetRefsEqual} from './reducer';
import type {TileflowInteractionDiagnostic} from './validation';

export type TileflowMapLibreSemanticDomOverlayFactoryInput = Readonly<{
  binding: TileflowInteractionBinding;
  container: HTMLElement;
  kind: TileflowMapLibreDomOverlayKind;
  target: TileflowResolvedSemanticFeatureTarget;
}>;

export type TileflowMapLibreSemanticDomRenderTarget = Readonly<{
  binding: TileflowInteractionBinding;
  close: () => void;
  container: HTMLElement;
  content: TileflowInteractionContent;
  key: string;
  kind: TileflowMapLibreDomOverlayKind;
  target: TileflowResolvedSemanticFeatureTarget;
  viewName?: string;
}>;

export type TileflowMapLibreSemanticDomRuntimeOptions<
  TMap,
  TOverlay extends TileflowMapLibrePositioned<TMap>,
> = Readonly<{
  cancelFrame: (frame: number) => void;
  createOverlay: (input: TileflowMapLibreSemanticDomOverlayFactoryInput) => TOverlay;
  customPopup?: boolean;
  customTooltip?: boolean;
  defaultInteractionState?: TileflowInteractionState;
  document: TileflowMapLibreDomDocument;
  idPrefix?: string;
  interactionState?: TileflowInteractionState;
  map: TMap;
  onDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
  onInteractionStateChange?: (
    state: TileflowInteractionState,
    previous: TileflowInteractionState,
    reason: TileflowMapLibreDomStateChangeReason,
  ) => void;
  poiMap: TileflowMapLibrePoiMap;
  requestFrame: (callback: () => void) => number;
}>;

export type TileflowMapLibreSemanticDomRuntime = Readonly<{
  closePopup: () => boolean;
  dispose: () => void;
  getDiagnostics: () => readonly TileflowInteractionDiagnostic[];
  getInteractionState: () => TileflowInteractionState;
  getRenderTargets: () => readonly TileflowMapLibreSemanticDomRenderTarget[];
  reconcile: (bindings: readonly TileflowInteractionBinding[]) => void;
  setCustomRenderers: (
    renderers: Pick<TileflowMapLibreDomCustomRenderers, 'popup' | 'tooltip'>,
  ) => void;
  setInteractionState: (state: TileflowInteractionState) => void;
  subscribeDiagnostics: (
    listener: (diagnostics: readonly TileflowInteractionDiagnostic[]) => void,
  ) => () => void;
  subscribeEvents: (listener: (event: TileflowInteractionEvent) => void) => () => void;
  subscribeRenderTargets: (
    listener: (targets: readonly TileflowMapLibreSemanticDomRenderTarget[]) => void,
  ) => () => void;
}>;

type ActiveOverlay<TMap, TOverlay extends TileflowMapLibrePositioned<TMap>> = {
  closeListener?: () => void;
  closeButton?: HTMLButtonElement;
  container: HTMLElement;
  keydownListener?: (event: KeyboardEvent) => void;
  kind: TileflowMapLibreDomOverlayKind;
  match: TileflowMapLibrePoiMatch;
  overlay: TOverlay;
  shell: HTMLElement;
};

type PendingStateRequest = Readonly<{
  inputModality: TileflowInteractionInputModality;
  match: TileflowMapLibrePoiMatch | null;
}>;

type PendingCleanupTask = {
  operations: Array<{complete: boolean; run: () => unknown}>;
};

let semanticRuntimeSequence = 0;

/**
 * Mounts semantic POI tooltip and popup shells around the manifest-scoped POI hit tester.
 * MapLibre, the document, and the scheduler are injected so importing this module remains SSR-safe.
 */
export function createTileflowMapLibreSemanticDomRuntime<
  TMap,
  TOverlay extends TileflowMapLibrePositioned<TMap>,
>(
  options: TileflowMapLibreSemanticDomRuntimeOptions<TMap, TOverlay>,
): TileflowMapLibreSemanticDomRuntime {
  const controlled = options.interactionState !== undefined;
  const idPrefix = options.idPrefix ?? `tileflow-semantic-${++semanticRuntimeSequence}`;
  assertIdPrefix(idPrefix);

  let bindings: readonly TileflowInteractionBinding[] = Object.freeze([]);
  let interactionState =
    options.interactionState ?? options.defaultInteractionState ?? Object.freeze({popup: null});
  let customRenderers = Object.freeze({
    popup: options.customPopup ?? false,
    tooltip: options.customTooltip ?? false,
  });
  let pendingStateRequest: PendingStateRequest | null = null;
  let hoveredMatch: TileflowMapLibrePoiMatch | null = null;
  let activeTooltip: ActiveOverlay<TMap, TOverlay> | null = null;
  let activePopup: ActiveOverlay<TMap, TOverlay> | null = null;
  let renderTargets: readonly TileflowMapLibreSemanticDomRenderTarget[] = Object.freeze([]);
  let disposed = false;
  let disposeComplete = false;
  let overlaySequence = 0;

  const pendingCleanupTasks = new Set<PendingCleanupTask>();
  const eventListeners = new Set<(event: TileflowInteractionEvent) => void>();
  const renderTargetListeners = new Set<
    (targets: readonly TileflowMapLibreSemanticDomRenderTarget[]) => void
  >();
  const diagnosticListeners = new Set<
    (diagnostics: readonly TileflowInteractionDiagnostic[]) => void
  >();
  const diagnosticsByKey = new Map<string, TileflowInteractionDiagnostic>();
  let diagnostics: readonly TileflowInteractionDiagnostic[] = Object.freeze([]);

  const publishRenderTargets = () => {
    if (disposed) return;
    renderTargets = buildRenderTargets();
    notify(renderTargetListeners, renderTargets);
  };

  const publishDiagnostics = () => {
    if (disposed) return;
    diagnostics = Object.freeze([...diagnosticsByKey.values()]);
    notify(diagnosticListeners, diagnostics);
  };

  const reportDiagnostic = (key: string, diagnostic: TileflowInteractionDiagnostic) => {
    if (diagnosticsByKey.has(key)) return;
    const frozen = Object.freeze(diagnostic);
    diagnosticsByKey.set(key, frozen);
    publishDiagnostics();
    options.onDiagnostic?.(frozen);
  };

  const clearDiagnostic = (key: string) => {
    if (!diagnosticsByKey.delete(key)) return;
    publishDiagnostics();
  };

  const retireResources = (operations: readonly (() => unknown)[]): unknown[] => {
    const task: PendingCleanupTask = {
      operations: operations.map((run) => ({complete: false, run})),
    };
    pendingCleanupTasks.add(task);
    const errors = runCleanupTask(task);
    if (cleanupTaskComplete(task)) pendingCleanupTasks.delete(task);
    return errors;
  };

  const flushPendingCleanupTasks = (): unknown[] => {
    const errors: unknown[] = [];
    for (const task of pendingCleanupTasks) {
      errors.push(...runCleanupTask(task));
      if (cleanupTaskComplete(task)) pendingCleanupTasks.delete(task);
    }
    return errors;
  };

  const emit = (event: TileflowInteractionEvent) => notify(eventListeners, event);

  const emitPopupEvent = (
    type: 'popup:close' | 'popup:open',
    match: TileflowMapLibrePoiMatch,
    inputModality: TileflowInteractionInputModality,
  ) => {
    emit(
      Object.freeze({
        bindingId: match.binding.id,
        coordinate: match.target.coordinate,
        inputModality,
        target: match.target,
        type,
      }),
    );
  };

  const closeTooltipVisual = (): boolean => {
    const current = activeTooltip;
    if (!current) return false;
    activeTooltip = null;
    const errors = retireResources([() => current.overlay.remove(), () => current.shell.remove()]);
    errors.push(
      ...safelyRunAll([
        () => clearSurfaceDiagnostics(current.match, 'tooltip'),
        () => publishRenderTargets(),
      ]),
    );
    throwCollectedErrors(errors, 'Unable to close the Tileflow semantic tooltip.');
    return true;
  };

  const closePopupVisual = (inputModality: TileflowInteractionInputModality): boolean => {
    const current = activePopup;
    if (!current) return false;
    activePopup = null;
    const errors = retireResources([
      ...(current.closeButton && current.closeListener
        ? [() => current.closeButton?.removeEventListener('click', current.closeListener!)]
        : []),
      ...(current.keydownListener
        ? [() => current.shell.removeEventListener('keydown', current.keydownListener!)]
        : []),
      () => current.overlay.remove(),
      () => current.shell.remove(),
    ]);
    errors.push(
      ...safelyRunAll([
        () => clearSurfaceDiagnostics(current.match, 'popup'),
        () => publishRenderTargets(),
        () => emitPopupEvent('popup:close', current.match, inputModality),
      ]),
    );
    throwCollectedErrors(errors, 'Unable to close the Tileflow semantic popup.');
    return true;
  };

  const configureOverlayContent = (current: ActiveOverlay<TMap, TOverlay>) => {
    const surface = current.match.binding[current.kind];
    if (!surface) return;
    configureViewAttribute(current.container, surface.content);
    const text = resolveSemanticContent(current.match, current.kind, surface.content);
    if (!customRenderers[current.kind]) current.container.textContent = text;
  };

  const resolveSemanticContent = (
    match: TileflowMapLibrePoiMatch,
    kind: TileflowMapLibreDomOverlayKind,
    content: TileflowInteractionContent,
  ): string => {
    const missingViewKey = surfaceDiagnosticKey(match, kind, 'MISSING_VIEW');
    const invalidFieldKey = surfaceDiagnosticKey(match, kind, 'INVALID_FIELD');
    if (content.kind === 'view') {
      clearDiagnostic(invalidFieldKey);
      if (customRenderers[kind]) clearDiagnostic(missingViewKey);
      else {
        const target = semanticTargetReference(match.target);
        reportDiagnostic(missingViewKey, {
          code: 'MISSING_VIEW',
          level: 'error',
          message: 'Semantic view content has no custom renderer for its active surface.',
          ...(target ? {target} : {}),
        });
      }
      return '';
    }

    clearDiagnostic(missingViewKey);
    const resolution = resolveContent(content, match.target.feature.properties);
    if (resolution.invalidField) {
      const target = semanticTargetReference(match.target);
      reportDiagnostic(invalidFieldKey, {
        code: 'INVALID_FIELD',
        level: 'error',
        message: 'Semantic feature field content did not resolve to a scalar value.',
        ...(target ? {target} : {}),
      });
    } else clearDiagnostic(invalidFieldKey);
    return resolution.text;
  };

  function clearSurfaceDiagnostics(
    match: TileflowMapLibrePoiMatch,
    kind: TileflowMapLibreDomOverlayKind,
  ) {
    clearDiagnostic(surfaceDiagnosticKey(match, kind, 'MISSING_VIEW'));
    clearDiagnostic(surfaceDiagnosticKey(match, kind, 'INVALID_FIELD'));
  }

  const openTooltipVisual = (match: TileflowMapLibrePoiMatch): boolean => {
    if (!match.binding.tooltip || sameMatch(activePopup?.match, match)) {
      return false;
    }
    if (activeTooltip && sameMatch(activeTooltip.match, match)) {
      try {
        updateOverlayVisual(activeTooltip, match);
        clearDiagnostic(overlayDiagnosticKey('tooltip'));
      } catch {
        reportOverlayFailure('tooltip', match.target);
      }
      return false;
    }
    closeTooltipVisual();

    const shell = options.document.createElement('div');
    const container = options.document.createElement('div');
    shell.className = 'tileflow-interaction-tooltip';
    container.className = 'tileflow-interaction-tooltip-content';
    shell.id = `${idPrefix}-tooltip-${++overlaySequence}`;
    shell.setAttribute('data-tileflow-interaction', 'tooltip');
    shell.setAttribute('data-tileflow-target-kind', 'semantic-feature');
    shell.setAttribute('role', 'tooltip');
    shell.style.pointerEvents = 'none';
    configureSurfaceStyles(shell);
    shell.append(container);

    let overlay: TOverlay | undefined;
    try {
      overlay = options.createOverlay({
        binding: match.binding,
        container: shell,
        kind: 'tooltip',
        target: match.target,
      });
      overlay.setLngLat(copyCoordinate(match.target.coordinate));
      overlay.addTo(options.map);
    } catch {
      retireResources([() => overlay?.remove(), () => shell.remove()]);
      reportOverlayFailure('tooltip', match.target);
      return false;
    }
    activeTooltip = {container, kind: 'tooltip', match, overlay, shell};
    configureOverlayContent(activeTooltip);
    clearDiagnostic(overlayDiagnosticKey('tooltip'));
    publishRenderTargets();
    return true;
  };

  const openPopupVisual = (
    match: TileflowMapLibrePoiMatch,
    inputModality: TileflowInteractionInputModality,
  ): boolean => {
    if (!match.binding.popup) return false;
    if (activePopup && sameMatch(activePopup.match, match)) {
      try {
        updateOverlayVisual(activePopup, match);
        clearDiagnostic(overlayDiagnosticKey('popup'));
      } catch {
        reportOverlayFailure('popup', match.target);
      }
      return false;
    }
    closePopupVisual(inputModality);
    closeTooltipVisual();

    const shell = options.document.createElement('div');
    const container = options.document.createElement('div');
    const closeButton = options.document.createElement('button');
    const label = semanticAccessibleLabel(match.target);
    shell.className = 'tileflow-interaction-popup';
    container.className = 'tileflow-interaction-popup-content';
    closeButton.className = 'tileflow-interaction-popup-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    shell.id = `${idPrefix}-popup-${++overlaySequence}`;
    shell.setAttribute('data-tileflow-interaction', 'popup');
    shell.setAttribute('data-tileflow-target-kind', 'semantic-feature');
    shell.setAttribute('aria-label', label);
    shell.setAttribute('aria-modal', 'false');
    shell.setAttribute('role', 'dialog');
    closeButton.setAttribute('aria-label', `Close ${label}`);
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
        binding: match.binding,
        container: shell,
        kind: 'popup',
        target: match.target,
      });
      overlay.setLngLat(copyCoordinate(match.target.coordinate));
      overlay.addTo(options.map);
    } catch {
      retireResources([
        () => closeButton.removeEventListener('click', closeListener),
        () => shell.removeEventListener('keydown', keydownListener),
        () => overlay?.remove(),
        () => shell.remove(),
      ]);
      reportOverlayFailure('popup', match.target);
      return false;
    }
    activePopup = {
      closeListener,
      closeButton,
      container,
      keydownListener,
      kind: 'popup',
      match,
      overlay,
      shell,
    };
    configureOverlayContent(activePopup);
    clearDiagnostic(overlayDiagnosticKey('popup'));
    publishRenderTargets();
    emitPopupEvent('popup:open', match, inputModality);
    closeButton.focus({preventScroll: true});
    return true;
  };

  const updateOverlayVisual = (
    current: ActiveOverlay<TMap, TOverlay>,
    match: TileflowMapLibrePoiMatch,
  ) => {
    current.match = match;
    current.overlay.setLngLat(copyCoordinate(match.target.coordinate));
    if (current.kind === 'popup') {
      const label = semanticAccessibleLabel(match.target);
      current.shell.setAttribute('aria-label', label);
      current.closeButton?.setAttribute('aria-label', `Close ${label}`);
    }
    configureOverlayContent(current);
    publishRenderTargets();
  };

  const reportOverlayFailure = (
    kind: TileflowMapLibreDomOverlayKind,
    target: TileflowResolvedSemanticFeatureTarget,
  ) => {
    const reference = semanticTargetReference(target);
    reportDiagnostic(overlayDiagnosticKey(kind), {
      code: 'OVERLAY_FAILURE',
      level: 'error',
      message: `Tileflow could not mount or update the semantic ${kind} overlay.`,
      ...(reference ? {target: reference} : {}),
    });
  };

  const resolveAvailableMatch = (
    reference: Extract<NonNullable<TileflowInteractionState['popup']>, {kind: 'semantic-feature'}>,
  ): TileflowMapLibrePoiMatch | null => {
    for (const match of [pendingStateRequest?.match, hoveredMatch, activePopup?.match]) {
      if (!match) continue;
      if (!tileflowInteractionTargetRefsEqual(semanticTargetReference(match.target), reference)) {
        continue;
      }
      const rebound = rebindSemanticMatch(match, bindings, 'popup');
      if (rebound) return rebound;
    }
    return null;
  };

  const invalidateResolvedMatches = () => {
    pendingStateRequest = null;
    hoveredMatch = null;
    const errors = safelyRunAll([
      () => closeTooltipVisual(),
      () => closePopupVisual('programmatic'),
    ]);
    throwCollectedErrors(errors, 'Unable to invalidate stale Tileflow semantic targets.');
  };

  const syncPopupFromInteractionState = (inputModality: TileflowInteractionInputModality) => {
    const popup = interactionState.popup;
    if (popup?.kind !== 'semantic-feature' || popup.domain !== 'poi') {
      closePopupVisual(inputModality);
      clearDiagnostic('state:stale');
      return;
    }
    const match = resolveAvailableMatch(popup);
    if (!match?.binding.popup) {
      closePopupVisual(inputModality);
      reportDiagnostic('state:stale', {
        code: 'STALE_TARGET',
        level: 'warning',
        message: 'The semantic popup target is not available in the current rendered map.',
        target: popup,
      });
      return;
    }
    clearDiagnostic('state:stale');
    openPopupVisual(match, inputModality);
  };

  function requestPopupState(
    match: TileflowMapLibrePoiMatch | null,
    inputModality: TileflowInteractionInputModality,
  ): boolean {
    const target = match?.target ?? null;
    const targetRef = target ? semanticTargetReference(target) : null;
    if (target && !targetRef) return false;
    const next = Object.freeze({popup: targetRef});
    if (tileflowInteractionTargetRefsEqual(interactionState.popup, next.popup)) {
      if (target && !sameSemanticTarget(activePopup?.match.target, target)) {
        syncPopupFromInteractionState(inputModality);
        return activePopup !== null;
      }
      return false;
    }
    const previous = interactionState;
    pendingStateRequest = {inputModality, match};
    if (!controlled) {
      interactionState = next;
      syncPopupFromInteractionState(inputModality);
      pendingStateRequest = null;
    }
    options.onInteractionStateChange?.(
      next,
      previous,
      next.popup === null ? 'popup:close' : 'popup:open',
    );
    return true;
  }

  function buildRenderTargets(): readonly TileflowMapLibreSemanticDomRenderTarget[] {
    const targets: TileflowMapLibreSemanticDomRenderTarget[] = [];
    for (const current of [activeTooltip, activePopup]) {
      if (!current || !customRenderers[current.kind]) continue;
      const surface = current.match.binding[current.kind];
      if (!surface) continue;
      const reference = semanticReferenceKey(current.match.target) ?? 'unstable';
      targets.push(
        Object.freeze({
          binding: current.match.binding,
          close: () =>
            current.kind === 'popup'
              ? requestPopupState(null, 'programmatic')
              : closeTooltipVisual(),
          container: current.container,
          content: surface.content,
          key: `${current.kind}:${current.match.binding.id}:${reference}`,
          kind: current.kind,
          target: current.match.target,
          ...(surface.content.kind === 'view' ? {viewName: surface.content.name} : {}),
        }),
      );
    }
    return Object.freeze(targets);
  }

  const poiController: TileflowMapLibrePoiController = createTileflowMapLibrePoiController({
    bindings,
    cancelFrame: options.cancelFrame,
    map: options.poiMap,
    onActivate(match, inputModality) {
      clearDiagnostic('poi:UNSTABLE_FEATURE_IDENTITY');
      if (match.binding.popup) requestPopupState(match, inputModality);
    },
    onDiagnostic(diagnostic) {
      reportDiagnostic(`poi:${diagnostic.code}`, diagnostic);
    },
    onDiagnosticResolved(code) {
      clearDiagnostic(`poi:${code}`);
    },
    onHoverChange(match) {
      hoveredMatch = match;
      if (!match) {
        closeTooltipVisual();
        return;
      }
      if (
        tileflowInteractionTargetRefsEqual(
          interactionState.popup,
          semanticTargetReference(match.target),
        )
      ) {
        syncPopupFromInteractionState('programmatic');
      }
      if (match.binding.tooltip) openTooltipVisual(match);
      else closeTooltipVisual();
    },
    onInteractionEvent: emit,
    onManifestChange(available) {
      if (available) clearDiagnostic('poi:SEMANTIC_MANIFEST_MISMATCH');
      invalidateResolvedMatches();
      syncPopupFromInteractionState('programmatic');
    },
    requestFrame: options.requestFrame,
  });

  return {
    closePopup() {
      assertActive(disposed);
      return requestPopupState(null, 'programmatic');
    },
    dispose() {
      if (disposeComplete) return;
      const errors: unknown[] = [];
      if (!disposed) {
        disposed = true;
        errors.push(
          ...safelyRunAll([() => closeTooltipVisual(), () => closePopupVisual('programmatic')]),
        );
        renderTargets = Object.freeze([]);
        diagnostics = Object.freeze([]);
        eventListeners.clear();
        renderTargetListeners.clear();
        diagnosticListeners.clear();
        diagnosticsByKey.clear();
        pendingStateRequest = null;
        hoveredMatch = null;
      }
      errors.push(...flushPendingCleanupTasks());
      errors.push(...safelyRunAll([() => poiController.dispose()]));
      if (errors.length > 0) {
        throwCollectedErrors(errors, 'Unable to dispose the Tileflow semantic DOM runtime.');
      }
      disposeComplete = true;
    },
    getDiagnostics: () => diagnostics,
    getInteractionState: () => interactionState,
    getRenderTargets: () => renderTargets,
    reconcile(nextBindings) {
      assertActive(disposed);
      bindings = Object.freeze([...nextBindings]);
      if (
        bindings.every(
          (binding) =>
            binding.target.kind === 'semantic-feature' && binding.target.domain === 'poi',
        )
      ) {
        clearDiagnostic('poi:UNSUPPORTED_TARGET');
      }
      if (
        !bindings.some(
          (binding) =>
            binding.target.kind === 'semantic-feature' && binding.target.domain === 'poi',
        )
      ) {
        clearDiagnostic('poi:SEMANTIC_MANIFEST_MISMATCH');
      }
      clearDiagnostic('poi:UNSTABLE_FEATURE_IDENTITY');
      poiController.reconcile(bindings);
      if (pendingStateRequest?.match) {
        const replacement = rebindSemanticMatch(pendingStateRequest.match, bindings);
        pendingStateRequest = replacement ? {...pendingStateRequest, match: replacement} : null;
      }
      if (hoveredMatch) {
        hoveredMatch = rebindSemanticMatch(hoveredMatch, bindings);
      }
      if (activeTooltip) {
        const replacement = rebindSemanticMatch(activeTooltip.match, bindings, 'tooltip');
        if (!replacement) closeTooltipVisual();
        else if (!Object.is(replacement.binding, activeTooltip.match.binding)) {
          updateOverlayVisual(activeTooltip, replacement);
        }
      }
      if (activePopup) {
        const replacement = rebindSemanticMatch(activePopup.match, bindings, 'popup');
        if (!replacement) {
          if (controlled) closePopupVisual('programmatic');
          requestPopupState(null, 'programmatic');
        } else if (!Object.is(replacement.binding, activePopup.match.binding)) {
          updateOverlayVisual(activePopup, replacement);
        }
      }
      syncPopupFromInteractionState('programmatic');
    },
    setCustomRenderers(renderers) {
      assertActive(disposed);
      if (
        renderers.popup === customRenderers.popup &&
        renderers.tooltip === customRenderers.tooltip
      ) {
        return;
      }
      customRenderers = Object.freeze({...renderers});
      if (activeTooltip) {
        if (customRenderers.tooltip) activeTooltip.container.textContent = '';
        configureOverlayContent(activeTooltip);
      }
      if (activePopup) {
        if (customRenderers.popup) activePopup.container.textContent = '';
        configureOverlayContent(activePopup);
      }
      publishRenderTargets();
    },
    setInteractionState(state) {
      assertActive(disposed);
      const requestedRef = pendingStateRequest?.match
        ? semanticTargetReference(pendingStateRequest.match.target)
        : null;
      const inputModality = tileflowInteractionTargetRefsEqual(requestedRef, state.popup)
        ? (pendingStateRequest?.inputModality ?? 'programmatic')
        : 'programmatic';
      interactionState = state;
      syncPopupFromInteractionState(inputModality);
      pendingStateRequest = null;
    },
    subscribeDiagnostics(listener) {
      assertActive(disposed);
      diagnosticListeners.add(listener);
      return unsubscribe(diagnosticListeners, listener);
    },
    subscribeEvents(listener) {
      assertActive(disposed);
      eventListeners.add(listener);
      return unsubscribe(eventListeners, listener);
    },
    subscribeRenderTargets(listener) {
      assertActive(disposed);
      renderTargetListeners.add(listener);
      return unsubscribe(renderTargetListeners, listener);
    },
  };
}

function semanticTargetReference(target: TileflowResolvedSemanticFeatureTarget) {
  return target.feature.id === undefined
    ? null
    : Object.freeze({
        domain: target.domain,
        featureId: target.feature.id,
        kind: 'semantic-feature' as const,
      });
}

function semanticReferenceKey(target: TileflowResolvedSemanticFeatureTarget): string | null {
  return target.feature.id === undefined
    ? null
    : targetReferenceKey(target.domain, target.feature.id);
}

function targetReferenceKey(domain: string, featureId: number | string): string {
  return `${domain}\u0000${typeof featureId}\u0000${String(featureId)}`;
}

function surfaceDiagnosticKey(
  match: TileflowMapLibrePoiMatch,
  kind: TileflowMapLibreDomOverlayKind,
  code: 'INVALID_FIELD' | 'MISSING_VIEW',
): string {
  return `${match.binding.id}\u0000${semanticReferenceKey(match.target) ?? 'unstable'}\u0000${kind}\u0000${code}`;
}

function overlayDiagnosticKey(kind: TileflowMapLibreDomOverlayKind): string {
  return `overlay\u0000${kind}`;
}

function sameMatch(
  left: TileflowMapLibrePoiMatch | undefined,
  right: TileflowMapLibrePoiMatch,
): boolean {
  if (!left || left.binding.id !== right.binding.id) return false;
  const leftKey = semanticReferenceKey(left.target);
  const rightKey = semanticReferenceKey(right.target);
  return leftKey !== null && leftKey === rightKey;
}

function sameSemanticTarget(
  left: TileflowResolvedSemanticFeatureTarget | undefined,
  right: TileflowResolvedSemanticFeatureTarget,
): boolean {
  if (!left) return false;
  const leftKey = semanticReferenceKey(left);
  return leftKey !== null && leftKey === semanticReferenceKey(right);
}

function rebindSemanticMatch(
  match: TileflowMapLibrePoiMatch,
  bindings: readonly TileflowInteractionBinding[],
  surface?: TileflowMapLibreDomOverlayKind,
): TileflowMapLibrePoiMatch | null {
  const replacement = bindings.find((binding) => {
    const target = binding.target;
    return (
      binding.id === match.binding.id &&
      target.kind === 'semantic-feature' &&
      target.domain === match.target.domain &&
      target.domain === 'poi' &&
      (!target.categories ||
        (match.target.feature.category !== undefined &&
          target.categories.includes(match.target.feature.category))) &&
      (surface === undefined || binding[surface] !== undefined)
    );
  });
  if (!replacement) return null;
  if (Object.is(replacement, match.binding)) return match;
  return {
    binding: replacement,
    target: {...match.target, bindingId: replacement.id},
  };
}

function semanticAccessibleLabel(target: TileflowResolvedSemanticFeatureTarget): string {
  const name = target.feature.properties.name;
  if (typeof name === 'string' && name.trim()) return name.slice(0, 256);
  return target.feature.category
    ? `Point of interest: ${target.feature.category}`
    : 'Point of interest';
}

function configureViewAttribute(element: HTMLElement, content: TileflowInteractionContent): void {
  if (content.kind === 'view') element.setAttribute('data-tileflow-view', content.name);
  else element.removeAttribute('data-tileflow-view');
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

function resolveContent(
  content: TileflowInteractionContent,
  data: Readonly<Record<string, unknown>>,
): Readonly<{invalidField: boolean; text: string}> {
  if (content.kind === 'text') return {invalidField: false, text: content.text};
  if (content.kind === 'view') return {invalidField: false, text: ''};
  const fallback = content.fallback ?? '';
  const invalid = () => ({invalidField: content.fallback === undefined, text: fallback});
  let current: unknown = data;
  for (const segment of content.field.split('.')) {
    if (
      current === null ||
      typeof current !== 'object' ||
      segment === '__proto__' ||
      segment === 'constructor' ||
      segment === 'prototype' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return invalid();
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current === null ||
    typeof current === 'boolean' ||
    typeof current === 'number' ||
    typeof current === 'string'
    ? {invalidField: false, text: String(current)}
    : invalid();
}

function copyCoordinate(
  coordinate: readonly [longitude: number, latitude: number],
): [longitude: number, latitude: number] {
  return [coordinate[0], coordinate[1]];
}

function assertIdPrefix(idPrefix: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(idPrefix)) {
    throw new TypeError('Tileflow semantic DOM idPrefix must be a portable identifier.');
  }
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error('Tileflow semantic DOM runtime is disposed.');
}

function runCleanupTask(task: PendingCleanupTask): unknown[] {
  const errors: unknown[] = [];
  for (const operation of task.operations) {
    if (operation.complete) continue;
    try {
      operation.run();
      operation.complete = true;
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function cleanupTaskComplete(task: PendingCleanupTask): boolean {
  return task.operations.every(({complete}) => complete);
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

function notify<TValue>(listeners: Set<(value: TValue) => void>, value: TValue): void {
  const errors: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Tileflow semantic listeners failed.');
}

function unsubscribe<TValue>(values: Set<TValue>, value: TValue): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    values.delete(value);
  };
}
