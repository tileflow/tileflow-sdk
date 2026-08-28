import type {
  TileflowInteractionBinding,
  TileflowInteractionEvent,
  TileflowInteractionInputModality,
  TileflowInteractionJsonValue,
  TileflowPoiCategory,
  TileflowPoiFilterRank,
  TileflowPoiProperties,
  TileflowPoiSizeRank,
  TileflowResolvedPoiFeatureTarget,
} from './contracts';
import {tileflowInteractionLimits, tileflowPoiCategories} from './contracts';
import type {TileflowInteractionDiagnostic} from './validation';

const interactionManifestMetadataKey = 'tileflow:interaction-manifest';
const interactionManifestVersion = 2;
const missingSourceLayerNamespace = '\u0001tileflow-no-source-layer';

export type TileflowMapLibrePoiFeature = Readonly<{
  id?: number | string;
  layer: Readonly<{id: string}>;
  properties?: Readonly<Record<string, unknown>>;
  source?: string;
  sourceLayer?: string;
}>;

export type TileflowMapLibrePoiPointerEvent = Readonly<{
  lngLat: Readonly<{lat: number; lng: number}>;
  originalEvent?: Readonly<{pointerType?: string; touches?: unknown}>;
  point: unknown;
}>;

export type TileflowMapLibrePoiMap = Readonly<{
  getStyle: () => unknown;
  off?: (event: string, listener: (event: unknown) => void) => unknown;
  on: (
    event: string,
    listener: (event: unknown) => void,
  ) => Readonly<{unsubscribe?: () => void}> | unknown;
  queryRenderedFeatures: (
    point: unknown,
    options: Readonly<{layers: readonly string[]}>,
  ) => readonly TileflowMapLibrePoiFeature[];
}>;

export type TileflowMapLibrePoiMatch = Readonly<{
  binding: TileflowInteractionBinding;
  target: TileflowResolvedPoiFeatureTarget;
}>;

export type TileflowMapLibrePoiControllerOptions = Readonly<{
  bindings?: readonly TileflowInteractionBinding[];
  cancelFrame: (frame: number) => void;
  map: TileflowMapLibrePoiMap;
  onActivate?: (
    match: TileflowMapLibrePoiMatch,
    inputModality: TileflowInteractionInputModality,
  ) => void;
  onDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
  onDiagnosticResolved?: (
    code: Extract<TileflowInteractionDiagnostic['code'], 'SEMANTIC_MANIFEST_MISMATCH'>,
  ) => void;
  onHoverChange?: (match: TileflowMapLibrePoiMatch | null) => void;
  onInteractionEvent?: (event: TileflowInteractionEvent) => void;
  onManifestChange?: (available: boolean) => void;
  requestFrame: (callback: () => void) => number;
}>;

export type TileflowMapLibrePoiController = Readonly<{
  dispose: () => void;
  getHovered: () => TileflowMapLibrePoiMatch | null;
  reconcile: (bindings: readonly TileflowInteractionBinding[]) => void;
  refreshManifest: () => void;
}>;

type PoiManifestLayer = Readonly<{
  category: TileflowPoiCategory;
  layerId: string;
  priority: number;
  representation: 'combined' | 'icon' | 'label' | 'marker';
  source: string;
  sourceLayer?: string;
}>;

type PoiManifest = Readonly<{
  deduplication: Readonly<{
    representationPriority: readonly PoiManifestLayer['representation'][];
  }>;
  fields: Readonly<{
    category: string;
    filterRank: string;
    icon: string;
    name: string;
    sizeRank: string;
    type: string;
  }>;
  layers: readonly PoiManifestLayer[];
}>;

type PoiCandidate = Readonly<{
  layer: PoiManifestLayer;
  match: TileflowMapLibrePoiMatch;
  renderedIndex: number;
}>;

/**
 * Resolves semantic POIs from compiler metadata without exposing physical layers to applications.
 * Pointer hit testing is coalesced to one query per animation frame.
 */
export function createTileflowMapLibrePoiController(
  options: TileflowMapLibrePoiControllerOptions,
): TileflowMapLibrePoiController {
  let bindings = semanticPoiBindings(options.bindings ?? [], options.onDiagnostic);
  let manifest: PoiManifest | null = null;
  let hovered: TileflowMapLibrePoiMatch | null = null;
  let pendingMove: TileflowMapLibrePoiPointerEvent | null = null;
  let pendingFrame: number | null = null;
  let disposed = false;
  let disposeComplete = false;
  let framePendingCancellation: number | null = null;
  let hoverClearPending = false;
  const subscriptionDisposers: Array<{active: boolean; dispose: () => void}> = [];

  const emit = (
    type: TileflowInteractionEvent['type'],
    match: TileflowMapLibrePoiMatch,
    modality: TileflowInteractionInputModality,
  ) => {
    options.onInteractionEvent?.({
      bindingId: match.binding.id,
      coordinate: match.target.coordinate,
      inputModality: modality,
      target: match.target,
      type,
    });
  };

  const setHovered = (
    next: TileflowMapLibrePoiMatch | null,
    modality: TileflowInteractionInputModality,
  ) => {
    if (matchesEqual(hovered, next)) {
      if (next && !Object.is(hovered, next)) {
        hovered = next;
        options.onHoverChange?.(hovered);
      }
      return;
    }
    if (hovered) emit('target:leave', hovered, modality);
    hovered = next;
    if (hovered) emit('target:enter', hovered, modality);
    options.onHoverChange?.(hovered);
  };

  const hitTest = (event: TileflowMapLibrePoiPointerEvent): TileflowMapLibrePoiMatch | null => {
    if (!manifest || bindings.length === 0) return null;
    const layerIds = relevantLayerIds(manifest, bindings);
    if (layerIds.length === 0) return null;

    let features: readonly TileflowMapLibrePoiFeature[];
    try {
      features = options.map.queryRenderedFeatures(event.point, {layers: layerIds});
    } catch {
      diagnostic(
        options.onDiagnostic,
        'SEMANTIC_MANIFEST_MISMATCH',
        'Tileflow could not query the semantic POI layers declared by this style.',
      );
      return null;
    }

    const candidates: PoiCandidate[] = [];
    let manifestMismatch = false;
    for (const [renderedIndex, feature] of features.entries()) {
      const layer = manifest.layers.find((candidate) => candidate.layerId === feature.layer.id);
      if (!layer) continue;
      if (
        (feature.source !== undefined && feature.source !== layer.source) ||
        sourceLayerNamespace(feature.sourceLayer) !== sourceLayerNamespace(layer.sourceLayer)
      ) {
        manifestMismatch = true;
        diagnostic(
          options.onDiagnostic,
          'SEMANTIC_MANIFEST_MISMATCH',
          'A rendered POI feature does not match its semantic interaction metadata.',
        );
        continue;
      }
      const binding = bindings.find((candidate) => {
        const target = candidate.target;
        return (
          target.kind === 'semantic-feature' &&
          target.domain === 'poi' &&
          (!target.categories || target.categories.includes(layer.category))
        );
      });
      if (!binding) continue;
      const featureId = normalizeFeatureId(feature.id);
      candidates.push({
        layer,
        renderedIndex,
        match: {
          binding,
          target: {
            bindingId: binding.id,
            coordinate: [event.lngLat.lng, event.lngLat.lat],
            domain: 'poi',
            feature: {
              category: layer.category,
              ...(featureId === undefined ? {} : {id: featureId}),
              properties: normalizePoiProperties(feature.properties, manifest.fields),
            },
            kind: 'semantic-feature',
          },
        },
      });
    }
    if (!manifestMismatch) {
      options.onDiagnosticResolved?.('SEMANTIC_MANIFEST_MISMATCH');
    }
    return choosePoiCandidate(candidates, manifest)?.match ?? null;
  };

  const handleMove = (value: unknown) => {
    const event = parsePointerEvent(value);
    if (!event || disposed) return;
    pendingMove = event;
    if (pendingFrame !== null) return;
    pendingFrame = options.requestFrame(() => {
      pendingFrame = null;
      const current = pendingMove;
      pendingMove = null;
      if (current && !disposed) setHovered(hitTest(current), inputModality(current));
    });
  };

  const handleLeave = () => {
    pendingMove = null;
    if (pendingFrame !== null) {
      options.cancelFrame(pendingFrame);
      pendingFrame = null;
    }
    setHovered(null, 'pointer');
  };

  const handleClick = (value: unknown) => {
    const event = parsePointerEvent(value);
    if (!event || disposed) return;
    const modality = inputModality(event);
    const match = hitTest(event);
    if (!match) return;
    emit('target:activate', match, modality);
    if (match.binding.popup && match.target.feature.id === undefined) {
      diagnostic(
        options.onDiagnostic,
        'UNSTABLE_FEATURE_IDENTITY',
        'This semantic POI has no stable feature ID, so Tileflow cannot open durable popup state.',
      );
      return;
    }
    options.onActivate?.(match, modality);
  };

  const refreshManifest = () => {
    if (disposed) return;
    setHovered(null, 'programmatic');
    if (bindings.length === 0) {
      manifest = null;
      options.onManifestChange?.(true);
      return;
    }
    const style = options.map.getStyle();
    if (style === undefined) {
      manifest = null;
      options.onManifestChange?.(false);
      return;
    }
    manifest = parsePoiManifest(style, options.onDiagnostic);
    options.onManifestChange?.(manifest !== null);
  };

  let manifestRefreshScheduled = false;
  const scheduleManifestRefresh = () => {
    if (disposed || manifestRefreshScheduled) return;
    manifestRefreshScheduled = true;
    queueMicrotask(() => {
      if (!manifestRefreshScheduled) return;
      manifestRefreshScheduled = false;
      refreshManifest();
    });
  };
  const handleStyleLoad = () => {
    manifestRefreshScheduled = false;
    refreshManifest();
  };

  try {
    for (const [event, listener] of [
      ['mousemove', handleMove],
      ['mouseout', handleLeave],
      ['click', handleClick],
      ['styledata', scheduleManifestRefresh],
      ['style.load', handleStyleLoad],
    ] as const) {
      subscriptionDisposers.push({
        active: true,
        dispose: subscribe(options.map, event, listener),
      });
    }
    refreshManifest();
  } catch (error) {
    disposed = true;
    const rollbackErrors = disposeSubscriptions(subscriptionDisposers);
    throwWithCleanupErrors(
      error,
      rollbackErrors,
      'Tileflow semantic POI controller construction failed during cleanup.',
    );
  }

  return {
    dispose() {
      if (disposeComplete) return;
      disposed = true;
      if (framePendingCancellation === null) framePendingCancellation = pendingFrame;
      pendingFrame = null;
      pendingMove = null;
      const errors: unknown[] = [];
      if (framePendingCancellation !== null) {
        try {
          options.cancelFrame(framePendingCancellation);
          framePendingCancellation = null;
        } catch (error) {
          errors.push(error);
        }
      }
      errors.push(...disposeSubscriptions(subscriptionDisposers));
      if (hovered) {
        hovered = null;
        hoverClearPending = true;
      }
      if (hoverClearPending) {
        try {
          options.onHoverChange?.(null);
          hoverClearPending = false;
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throwCollectedErrors(errors, 'Unable to dispose the Tileflow semantic POI controller.');
      }
      disposeComplete = true;
    },
    getHovered: () => hovered,
    reconcile(nextBindings) {
      if (disposed) throw new Error('Tileflow semantic POI controller is disposed.');
      const previouslyRequiredManifest = bindings.length > 0;
      bindings = semanticPoiBindings(nextBindings, options.onDiagnostic);
      if (bindings.length === 0 || !previouslyRequiredManifest || manifest === null) {
        refreshManifest();
      }
      if (hovered) {
        const replacement = bindings.find(
          (binding) =>
            binding.id === hovered?.binding.id && bindingMatchesTarget(binding, hovered.target),
        );
        if (!replacement) setHovered(null, 'programmatic');
        else if (!Object.is(replacement, hovered.binding)) {
          hovered = {
            binding: replacement,
            target: {...hovered.target, bindingId: replacement.id},
          };
          options.onHoverChange?.(hovered);
        }
      }
    },
    refreshManifest,
  };
}

function semanticPoiBindings(
  bindings: readonly TileflowInteractionBinding[],
  onDiagnostic: TileflowMapLibrePoiControllerOptions['onDiagnostic'],
): TileflowInteractionBinding[] {
  const result: TileflowInteractionBinding[] = [];
  let hasUnsupportedTarget = false;
  for (const binding of bindings) {
    if (binding.target.kind === 'semantic-feature' && binding.target.domain === 'poi') {
      result.push(binding);
      continue;
    }
    hasUnsupportedTarget = true;
  }
  if (hasUnsupportedTarget) {
    diagnostic(
      onDiagnostic,
      'UNSUPPORTED_TARGET',
      'One or more Tileflow interaction targets are not available in the current semantic runtime.',
    );
  }
  return result;
}

function parsePoiManifest(
  styleInput: unknown,
  onDiagnostic: TileflowMapLibrePoiControllerOptions['onDiagnostic'],
): PoiManifest | null {
  const style = asRecord(styleInput);
  const metadata = asRecord(style?.metadata);
  const artifact = asRecord(metadata?.[interactionManifestMetadataKey]);
  const domains = asRecord(artifact?.domains);
  const poi = asRecord(domains?.poi);
  if (!artifact || !poi) {
    diagnostic(
      onDiagnostic,
      'SEMANTIC_MANIFEST_MISMATCH',
      'This style does not include Tileflow semantic POI interaction metadata.',
      'warning',
    );
    return null;
  }
  if (artifact.version !== interactionManifestVersion) {
    diagnostic(
      onDiagnostic,
      'SEMANTIC_MANIFEST_MISMATCH',
      'This style uses an unsupported Tileflow interaction metadata version.',
    );
    return null;
  }
  const fields = asRecord(poi.fields);
  const deduplication = asRecord(poi.deduplication);
  const hitTesting = asRecord(poi.hitTesting);
  const identityFields = Array.isArray(deduplication?.identity) ? deduplication.identity : [];
  const representationPriority = Array.isArray(deduplication?.representationPriority)
    ? deduplication.representationPriority
    : [];
  const layerInputs = Array.isArray(poi.layers) ? poi.layers : [];
  const styleLayers = Array.isArray(style?.layers) ? style.layers : [];
  const styleLayersById = new Map(
    styleLayers.flatMap((layer) => {
      const record = asRecord(layer);
      const id = record?.id;
      return typeof id === 'string' && record ? [[id, record] as const] : [];
    }),
  );
  if (
    !fields ||
    !['category', 'filterRank', 'icon', 'name', 'sizeRank', 'type'].every((field) =>
      isSafeManifestName(fields[field]),
    ) ||
    poi.identity !== 'maplibre-feature-id-if-present' ||
    identityFields.length !== 3 ||
    identityFields[0] !== 'source' ||
    identityFields[1] !== 'source-layer' ||
    identityFields[2] !== 'feature-id' ||
    !isRepresentationPriority(representationPriority) ||
    hitTesting?.frequency !== 'animation-frame' ||
    hitTesting.order !== 'rendered-topmost' ||
    layerInputs.length === 0 ||
    layerInputs.length > 256
  ) {
    diagnostic(onDiagnostic, 'SEMANTIC_MANIFEST_MISMATCH', 'Invalid semantic POI metadata.');
    return null;
  }

  const layers: PoiManifestLayer[] = [];
  const ids = new Set<string>();
  let identityNamespace: readonly [source: string, sourceLayerNamespace: string] | undefined;
  for (const input of layerInputs) {
    const layer = asRecord(input);
    const sourceLayer = layer?.sourceLayer;
    if (
      !layer ||
      !isTileflowPoiCategory(layer.category) ||
      !isSafeManifestName(layer.layerId) ||
      !isSafeManifestName(layer.source) ||
      (sourceLayer !== undefined && !isSafeManifestName(sourceLayer)) ||
      layer.anchor !== 'pointer-coordinate' ||
      !isPoiRepresentation(layer.representation) ||
      !Number.isSafeInteger(layer.priority) ||
      (layer.priority as number) < 0 ||
      (layer.priority as number) > 100_000 ||
      ids.has(layer.layerId as string)
    ) {
      diagnostic(onDiagnostic, 'SEMANTIC_MANIFEST_MISMATCH', 'Invalid semantic POI layer lookup.');
      return null;
    }
    const styleLayer = styleLayersById.get(layer.layerId as string);
    if (
      !styleLayer ||
      styleLayer.source !== layer.source ||
      styleLayer['source-layer'] !== sourceLayer
    ) {
      diagnostic(
        onDiagnostic,
        'SEMANTIC_MANIFEST_MISMATCH',
        'Semantic POI metadata does not match the finalized style layer.',
      );
      return null;
    }
    const namespace = [
      layer.source as string,
      sourceLayerNamespace(sourceLayer as string | undefined),
    ] as const;
    if (
      identityNamespace &&
      (identityNamespace[0] !== namespace[0] || identityNamespace[1] !== namespace[1])
    ) {
      diagnostic(
        onDiagnostic,
        'SEMANTIC_MANIFEST_MISMATCH',
        'Semantic POI metadata spans multiple feature-ID namespaces.',
      );
      return null;
    }
    identityNamespace = namespace;
    ids.add(layer.layerId as string);
    layers.push({
      category: layer.category,
      layerId: layer.layerId as string,
      priority: layer.priority as number,
      representation: layer.representation,
      source: layer.source as string,
      ...(sourceLayer === undefined ? {} : {sourceLayer: sourceLayer as string}),
    });
  }

  return {
    deduplication: {
      representationPriority,
    },
    fields: {
      category: fields.category as string,
      filterRank: fields.filterRank as string,
      icon: fields.icon as string,
      name: fields.name as string,
      sizeRank: fields.sizeRank as string,
      type: fields.type as string,
    },
    layers: layers.sort((left, right) => right.priority - left.priority),
  };
}

function choosePoiCandidate(
  candidates: readonly PoiCandidate[],
  manifest: PoiManifest,
): PoiCandidate | undefined {
  const deduplicated: PoiCandidate[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const candidate of candidates) {
    const id = candidate.match.target.feature.id;
    if (id === undefined) {
      deduplicated.push(candidate);
      continue;
    }

    const identity = `${candidate.layer.source}\u0000${sourceLayerNamespace(candidate.layer.sourceLayer)}\u0000${typeof id}\u0000${String(id)}`;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, deduplicated.length);
      deduplicated.push(candidate);
      continue;
    }

    const existing = deduplicated[existingIndex];
    if (preferPoiRepresentation(candidate, existing, manifest)) {
      deduplicated[existingIndex] = {
        ...candidate,
        renderedIndex: Math.min(existing.renderedIndex, candidate.renderedIndex),
      };
    }
  }

  return deduplicated.sort(
    (left, right) =>
      left.renderedIndex - right.renderedIndex || right.layer.priority - left.layer.priority,
  )[0];
}

function preferPoiRepresentation(
  candidate: PoiCandidate,
  existing: PoiCandidate,
  manifest: PoiManifest,
): boolean {
  const priority = manifest.deduplication.representationPriority;
  const candidateIndex = priority.indexOf(candidate.layer.representation);
  const existingIndex = priority.indexOf(existing.layer.representation);
  return (
    candidateIndex < existingIndex ||
    (candidateIndex === existingIndex && candidate.layer.priority > existing.layer.priority)
  );
}

function isRepresentationPriority(
  input: readonly unknown[],
): input is readonly PoiManifestLayer['representation'][] {
  return (
    input.length === 4 && input.every(isPoiRepresentation) && new Set(input).size === input.length
  );
}

function isPoiRepresentation(value: unknown): value is PoiManifestLayer['representation'] {
  return value === 'combined' || value === 'icon' || value === 'label' || value === 'marker';
}

function isTileflowPoiCategory(value: unknown): value is TileflowPoiCategory {
  return typeof value === 'string' && (tileflowPoiCategories as readonly string[]).includes(value);
}

function sourceLayerNamespace(sourceLayer: string | undefined): string {
  return sourceLayer ?? missingSourceLayerNamespace;
}

function relevantLayerIds(
  manifest: PoiManifest,
  bindings: readonly TileflowInteractionBinding[],
): string[] {
  return manifest.layers
    .filter((layer) =>
      bindings.some(
        (binding) =>
          binding.target.kind === 'semantic-feature' &&
          (!binding.target.categories || binding.target.categories.includes(layer.category)),
      ),
    )
    .map((layer) => layer.layerId);
}

function normalizePoiProperties(
  properties: Readonly<Record<string, unknown>> | undefined,
  fields: PoiManifest['fields'],
): TileflowPoiProperties {
  const source = properties ?? {};
  const normalized: Record<string, TileflowInteractionJsonValue> = {};
  const read = (field: keyof PoiManifest['fields']): unknown => {
    try {
      return source[fields[field]];
    } catch {
      return undefined;
    }
  };
  const category = read('category');
  const filterRank = read('filterRank');
  const icon = read('icon');
  const name = read('name');
  const sizeRank = read('sizeRank');
  const type = read('type');

  if (isTileflowPoiCategory(category)) normalized.category = category;
  if (isIntegerInRange(filterRank, 0, 5)) {
    normalized.filter_rank = filterRank as TileflowPoiFilterRank;
  }
  if (isSnakeCaseValue(icon)) normalized.icon = icon;
  if (isBoundedText(name)) normalized.name = name;
  if (isIntegerInRange(sizeRank, 0, 16)) {
    normalized.size_rank = sizeRank as TileflowPoiSizeRank;
  }
  if (isSnakeCaseValue(type)) normalized.type = type;
  return Object.freeze(normalized) as TileflowPoiProperties;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= tileflowInteractionLimits.maxContentTextLength
  );
}

function isSnakeCaseValue(value: unknown): value is string {
  return isBoundedText(value) && /^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(value);
}

function normalizeFeatureId(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= tileflowInteractionLimits.maxFeatureIdLength
  ) {
    return value;
  }
  return undefined;
}

function matchesEqual(
  left: TileflowMapLibrePoiMatch | null,
  right: TileflowMapLibrePoiMatch | null,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.binding.id !== right.binding.id) return false;
  const leftFeature = left.target.feature;
  const rightFeature = right.target.feature;
  if (leftFeature.id !== undefined || rightFeature.id !== undefined) {
    return leftFeature.id === rightFeature.id && left.target.domain === right.target.domain;
  }
  return (
    leftFeature.category === rightFeature.category &&
    JSON.stringify(leftFeature.properties) === JSON.stringify(rightFeature.properties)
  );
}

function bindingMatchesTarget(
  binding: TileflowInteractionBinding,
  target: TileflowResolvedPoiFeatureTarget,
): boolean {
  const selector = binding.target;
  if (
    selector.kind !== 'semantic-feature' ||
    selector.domain !== target.domain ||
    selector.domain !== 'poi'
  ) {
    return false;
  }
  return (
    !selector.categories ||
    (target.feature.category !== undefined && selector.categories.includes(target.feature.category))
  );
}

function parsePointerEvent(value: unknown): TileflowMapLibrePoiPointerEvent | null {
  const event = asRecord(value);
  const lngLat = asRecord(event?.lngLat);
  if (
    !event ||
    !lngLat ||
    event.point === undefined ||
    typeof lngLat.lng !== 'number' ||
    !Number.isFinite(lngLat.lng) ||
    typeof lngLat.lat !== 'number' ||
    !Number.isFinite(lngLat.lat)
  ) {
    return null;
  }
  return value as TileflowMapLibrePoiPointerEvent;
}

function inputModality(event: TileflowMapLibrePoiPointerEvent): TileflowInteractionInputModality {
  return event.originalEvent?.pointerType === 'touch' || event.originalEvent?.touches !== undefined
    ? 'touch'
    : 'pointer';
}

function subscribe(
  map: TileflowMapLibrePoiMap,
  event: string,
  listener: (event: unknown) => void,
): () => void {
  const subscription = map.on(event, listener) as {unsubscribe?: () => void} | undefined;
  if (typeof subscription?.unsubscribe === 'function') return () => subscription.unsubscribe?.();
  return () => map.off?.(event, listener);
}

function disposeSubscriptions(
  subscriptions: Array<{active: boolean; dispose: () => void}>,
): unknown[] {
  const errors: unknown[] = [];
  for (const subscription of [...subscriptions].reverse()) {
    if (!subscription.active) continue;
    try {
      subscription.dispose();
      subscription.active = false;
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function throwWithCleanupErrors(
  error: unknown,
  cleanupErrors: readonly unknown[],
  message: string,
): never {
  if (cleanupErrors.length === 0) throw error;
  throw new AggregateError([error, ...cleanupErrors], message, {cause: error});
}

function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

function diagnostic(
  listener: TileflowMapLibrePoiControllerOptions['onDiagnostic'],
  code: TileflowInteractionDiagnostic['code'],
  message: string,
  level: TileflowInteractionDiagnostic['level'] = 'error',
): void {
  listener?.({code, level, message});
}

function isSafeManifestName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
