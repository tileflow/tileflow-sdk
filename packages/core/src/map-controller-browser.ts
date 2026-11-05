import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import type {TileflowLayerPositionContext} from './layer-position-context';
import {type TileflowOverlayPlacement, tileflowOverlayPlacements} from './overlays';
import type {MapLibreStyle} from './types';

export type TileflowRuntimeSourceDefinition = Readonly<Record<string, unknown>>;
export type TileflowRuntimeLayerDefinition = Readonly<
  Record<string, unknown> & {id: string; type: string; slot?: TileflowOverlayPlacement | null}
>;
export type TileflowLayerPosition = Readonly<{
  slot?: TileflowOverlayPlacement | null;
  slotIndex?: number;
  aboveLayerId?: string;
  belowLayerId?: string;
}>;
export type TileflowMapErrorContext = Omit<Partial<TileflowLayerPositionContext>, 'reason'> & {
  reason?: string;
  message?: string;
};

export class TileflowMapError extends Error {
  readonly name = 'TileflowMapError';
  constructor(
    readonly code: 'invalidRequest' | 'disposed' | 'resourceFailed',
    readonly context: TileflowMapErrorContext = {},
  ) {
    super(context.message ?? `Tileflow map operation failed: ${context.reason ?? code}.`);
  }
}

/** Application-owned sources and layers. Calls wait for the attached map's style. */
export type TileflowMapController = {
  addSource(id: string, source: TileflowRuntimeSourceDefinition): Promise<void>;
  removeSource(id: string): Promise<void>;
  addLayer(layer: TileflowRuntimeLayerDefinition, position?: TileflowLayerPosition): Promise<void>;
  moveLayer(id: string, position?: TileflowLayerPosition): Promise<void>;
  removeLayer(id: string): Promise<void>;
  dispose(): void;
};

/** Structural adapter implemented by the existing MapLibre map. */
export type TileflowRuntimeStyleMap = {
  getStyle(): unknown;
  isStyleLoaded?(): boolean | void;
  getSource(id: string): unknown;
  getLayer(id: string): unknown;
  addSource(id: string, source: never): unknown;
  removeSource(id: string): unknown;
  addLayer(layer: never, beforeId?: string): unknown;
  moveLayer(id: string, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
};

export type TileflowMapControllerBinding = {
  controller: TileflowMapController;
  attach(map: TileflowRuntimeStyleMap, initialStyle?: MapLibreStyle): void;
  fail(error: Error): void;
  dispose(): void;
};

type Layer = {
  id: string;
  definition: Record<string, unknown>;
  slot: TileflowOverlayPlacement | null;
};
type Pending = {run(): void; resolve(): void; reject(error: unknown): void};
type Runtime = {
  compose(style: MapLibreStyle): MapLibreStyle;
  strip(style: MapLibreStyle): MapLibreStyle;
  begin(): void;
  end(): void;
};
const runtimes = new WeakMap<object, Runtime>();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const invalid = (reason: string, message?: string): never => {
  throw new TileflowMapError('invalidRequest', {
    reason,
    ...(message ? {message} : {}),
  } as TileflowMapErrorContext);
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function json<T>(input: T): T {
  const visit = (value: unknown): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (record(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      Object.values(value).forEach(visit);
      return;
    }
    invalid('invalidStyle', 'Use finite JSON values for runtime sources and layers.');
  };
  try {
    visit(input);
    return JSON.parse(JSON.stringify(input)) as T;
  } catch (error) {
    if (error instanceof TileflowMapError) throw error;
    return invalid('invalidStyle');
  }
}

function equivalent(a: unknown, b: unknown): boolean {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : record(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !idPattern.test(value)) invalid('invalidIdentifier');
}
function slot(value: unknown): TileflowOverlayPlacement | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !tileflowOverlayPlacements.includes(value as TileflowOverlayPlacement)
  )
    invalid('invalidLayerPosition');
  return value as TileflowOverlayPlacement;
}
function styleOf(map: TileflowRuntimeStyleMap): MapLibreStyle | undefined {
  const style = map.getStyle();
  return record(style) && record(style.sources) && Array.isArray(style.layers)
    ? (style as MapLibreStyle)
    : undefined;
}
function validate(style: {
  sources: Record<string, unknown>;
  layers: Record<string, unknown>[];
  glyphs?: string;
  sprite?: unknown;
}) {
  const errors = validateStyleMin({version: 8, ...style} as never);
  if (errors.length) invalid('invalidStyle', errors[0]!.message);
}
function rank(value: TileflowOverlayPlacement | null) {
  return value === null
    ? tileflowOverlayPlacements.length
    : tileflowOverlayPlacements.indexOf(value);
}
function anchor(style: MapLibreStyle, value: TileflowOverlayPlacement | null): string | undefined {
  if (value === null || value === 'above-labels') return undefined;
  const manifest = style.metadata?.['tileflow:overlay-placement-manifest'];
  const anchors = record(manifest) && record(manifest.anchors) ? manifest.anchors : undefined;
  const candidate = anchors
    ? anchors[value]
    : style.layers.find((layer) => layer.type === 'symbol')?.id;
  return typeof candidate === 'string' && style.layers.some((layer) => layer.id === candidate)
    ? candidate
    : undefined;
}

function placement(
  layers: Layer[],
  layer: Layer,
  position: TileflowLayerPosition,
  operation: string,
): Layer[] {
  const keys = Object.keys(position);
  if (keys.some((key) => !['slot', 'slotIndex', 'aboveLayerId', 'belowLayerId'].includes(key)))
    invalid('invalidLayerPosition');
  const requested = ['slotIndex', 'aboveLayerId', 'belowLayerId'].filter((key) =>
    Object.hasOwn(position, key),
  );
  const context = (
    reason: TileflowLayerPositionContext['reason'],
    path: string,
    rule: string,
    corrections: TileflowLayerPositionContext['corrections'],
    extra: Partial<TileflowLayerPositionContext> = {},
  ): never => {
    throw new TileflowMapError('invalidRequest', {
      reason,
      operation,
      path,
      layerId: layer.id,
      slot: layer.slot,
      referenceSlot: null,
      rule,
      corrections,
      ...extra,
    });
  };
  if (requested.length > 1)
    context('invalidLayerPosition', 'position', 'onePosition', [
      {code: 'chooseOnePosition', message: 'Choose one layer position.'},
    ]);
  const siblings = layers.filter((item) => item.slot === layer.slot);
  let index = layers.length;
  if (Object.hasOwn(position, 'slotIndex')) {
    const at = position.slotIndex;
    if (!Number.isSafeInteger(at) || at! < 0 || at! > siblings.length)
      context(
        'invalidLayerPosition',
        'position.slotIndex',
        'indexRange',
        [
          {
            code: 'chooseSlotIndex',
            message: "Choose an index within this slot's application layers.",
          },
        ],
        {limit: siblings.length, ...(Number.isSafeInteger(at) ? {count: at} : {})},
      );
    const before = siblings[at!];
    const last = siblings.at(-1);
    index = before ? layers.indexOf(before) : last ? layers.indexOf(last) + 1 : layers.length;
  } else if (requested.length) {
    const above = Object.hasOwn(position, 'aboveLayerId');
    const key = above ? 'aboveLayerId' : 'belowLayerId';
    const referenceId = position[key];
    const reference = layers.find((item) => item.id === referenceId);
    if (!reference)
      context(
        'unknownLayer',
        `position.${key}`,
        'knownReference',
        [{code: 'referenceExistingLayer', message: 'Reference an existing application layer.'}],
        {referenceLayerId: referenceId},
      );
    if (reference!.slot !== layer.slot)
      context(
        'layerPositionConflict',
        `position.${key}`,
        'sameSlot',
        [
          {code: 'alignSlot', message: "Choose the reference layer's slot."},
          {code: 'referenceSameSlot', message: 'Reference a layer in the same slot.'},
        ],
        {referenceLayerId: reference!.id, referenceSlot: reference!.slot},
      );
    index = layers.indexOf(reference!) + (above ? 1 : 0);
  }
  const next = [...layers];
  next.splice(index, 0, layer);
  return next;
}

/** Bind once per map instance; retain the controller while its initial style loads. */
export function createTileflowMapControllerBinding(
  options: {onError?: (error: Error) => void} = {},
): TileflowMapControllerBinding {
  let map: TileflowRuntimeStyleMap | undefined;
  let terminal: Error | undefined;
  let locks = 0;
  let pumping = false;
  let restoring = false;
  const pending: Pending[] = [];
  const sources = new Map<string, Record<string, unknown>>();
  let layers: Layer[] = [];
  const installedSources = new Map<string, unknown>();
  const installedLayers = new Map<string, unknown>();
  let base: MapLibreStyle | undefined;
  const report = (error: unknown) =>
    (options.onError ?? console.error)(error instanceof Error ? error : new Error(String(error)));
  const ready = () =>
    Boolean(
      map &&
      !locks &&
      !restoring &&
      (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded() === true) &&
      styleOf(map),
    );
  const requireMap = () => {
    if (!map) throw new TileflowMapError('disposed');
    return map;
  };
  function pump() {
    if (pumping || terminal || !ready()) return;
    pumping = true;
    try {
      while (pending.length && !terminal && ready()) {
        const entry = pending.shift()!;
        try {
          assertOwnership();
          entry.run();
          entry.resolve();
        } catch (error) {
          entry.reject(
            error instanceof TileflowMapError
              ? error
              : new TileflowMapError('invalidRequest', {
                  message: error instanceof Error ? error.message : String(error),
                }),
          );
        }
      }
    } finally {
      pumping = false;
    }
  }
  function enqueue(run: () => void): Promise<void> {
    if (terminal) return Promise.reject(terminal);
    return new Promise((resolve, reject) => {
      pending.push({run, resolve, reject});
      pump();
    });
  }
  function input<T>(value: T, run: (value: T) => void): Promise<void> {
    if (terminal) return Promise.reject(terminal);
    try {
      const snapshot = json(value);
      return enqueue(() => run(snapshot));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  function assertOwnership() {
    const target = requireMap();
    for (const [id, installed] of installedSources) {
      const current = target.getSource(id);
      if (current && current !== installed) invalid('sourceOwnershipChanged');
    }
    for (const [id, installed] of installedLayers) {
      const current = target.getLayer(id);
      if (current && current !== installed) invalid('layerOwnershipChanged');
    }
  }
  function currentBase() {
    const current = styleOf(requireMap());
    if (!current) throw new TileflowMapError('resourceFailed');
    return strip(current);
  }
  function strip(style: MapLibreStyle): MapLibreStyle {
    return {
      ...style,
      sources: Object.fromEntries(Object.entries(style.sources).filter(([id]) => !sources.has(id))),
      layers: style.layers.filter((layer) => !layers.some((own) => own.id === layer.id)),
    };
  }
  function compose(style: MapLibreStyle): MapLibreStyle {
    for (const id of sources.keys())
      if (Object.hasOwn(style.sources, id))
        invalid('sourceAlreadyExists', `The destination style already owns source "${id}".`);
    for (const layer of layers)
      if (style.layers.some((item) => item.id === layer.id))
        invalid('layerAlreadyExists', `The destination style already owns layer "${layer.id}".`);
    const combined = {
      ...style,
      sources: {
        ...style.sources,
        ...Object.fromEntries([...sources].map(([id, value]) => [id, json(value)])),
      },
      layers: [...style.layers],
    };
    for (const layer of [...layers].sort((a, b) => rank(a.slot) - rank(b.slot))) {
      const before = anchor(style, layer.slot);
      const index = before
        ? combined.layers.findIndex((item) => item.id === before)
        : combined.layers.length;
      combined.layers.splice(index, 0, json(layer.definition));
    }
    return combined;
  }
  function beforeLayer(layer: Layer, order: Layer[], style: MapLibreStyle): string | undefined {
    const combined = composeFor(order, style);
    const index = combined.findIndex((item) => item.id === layer.id);
    return combined.slice(index + 1).find((item) => requireMap().getLayer(item.id as string))
      ?.id as string | undefined;
  }
  function composeFor(order: Layer[], style: MapLibreStyle): Record<string, unknown>[] {
    const result = [...style.layers];
    for (const layer of [...order].sort((a, b) => rank(a.slot) - rank(b.slot))) {
      const before = anchor(style, layer.slot);
      const index = before ? result.findIndex((item) => item.id === before) : result.length;
      result.splice(index, 0, layer.definition);
    }
    return result;
  }
  function sync() {
    if (!map || terminal || locks || restoring || !styleOf(map)) return;
    restoring = true;
    try {
      const current = styleOf(map)!;
      // External style replacement may omit our resources; never claim a conflicting resource.
      for (const [id, definition] of sources) {
        if (map.getSource(id) && !equivalent(current.sources[id], definition))
          invalid('sourceAlreadyExists');
      }
      for (const layer of layers) {
        const existing = current.layers.find((item) => item.id === layer.id);
        if (existing && !equivalent(existing, layer.definition)) invalid('layerAlreadyExists');
      }
      base = strip(current);
      for (const [id, definition] of sources)
        if (!map.getSource(id)) map.addSource(id, json(definition) as never);
      const ordered = [...layers].sort((a, b) => rank(a.slot) - rank(b.slot));
      for (const layer of ordered) {
        if (!map.getLayer(layer.id))
          map.addLayer(json(layer.definition) as never, beforeLayer(layer, layers, base));
      }
      for (const id of sources.keys()) installedSources.set(id, map.getSource(id));
      for (const layer of layers) installedLayers.set(layer.id, map.getLayer(layer.id));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      terminate(failure);
      report(failure);
    } finally {
      restoring = false;
    }
    pump();
  }
  function terminate(error: Error) {
    if (terminal) return;
    terminal = error;
    for (const entry of pending.splice(0)) entry.reject(error);
  }
  function dispose() {
    if (terminal?.name === 'TileflowMapError' && (terminal as TileflowMapError).code === 'disposed')
      return;
    terminal = new TileflowMapError('disposed');
    for (const entry of pending.splice(0)) entry.reject(terminal);
    if (map) {
      map.off('style.load', sync);
      map.off('render', pump);
      map.off('remove', dispose);
      runtimes.delete(map);
      for (const layer of [...layers].reverse()) {
        try {
          if (map.getLayer(layer.id) === installedLayers.get(layer.id)) map.removeLayer(layer.id);
        } catch (error) {
          report(error);
        }
      }
      for (const id of sources.keys()) {
        try {
          if (map.getSource(id) === installedSources.get(id)) map.removeSource(id);
        } catch (error) {
          report(error);
        }
      }
    }
    layers = [];
    sources.clear();
    installedSources.clear();
    installedLayers.clear();
    map = undefined;
  }
  const controller: TileflowMapController = {
    addSource(id, definition) {
      return input({id, definition}, ({id, definition}) => {
        identifier(id);
        const target = requireMap();
        if (sources.has(id) || target.getSource(id)) invalid('sourceAlreadyExists');
        if (!record(definition)) invalid('invalidStyle');
        validate({sources: {[id]: definition}, layers: []});
        target.addSource(id, json(definition) as never);
        if (!target.getSource(id)) invalid('rendererRejected');
        sources.set(id, json(styleOf(target)?.sources[id] ?? definition));
        installedSources.set(id, target.getSource(id));
      });
    },
    removeSource(id) {
      return input(id, (id) => {
        if (!sources.has(id)) invalid('unknownSource');
        if (styleOf(requireMap())?.layers.some((layer) => layer.source === id))
          invalid('sourceInUse');
        requireMap().removeSource(id);
        if (requireMap().getSource(id)) invalid('rendererRejected');
        sources.delete(id);
        installedSources.delete(id);
      });
    },
    addLayer(definition, position = {}) {
      return input({definition, position}, ({definition, position}) => {
        identifier(definition.id);
        const target = requireMap();
        if (layers.some((layer) => layer.id === definition.id) || target.getLayer(definition.id))
          invalid('layerAlreadyExists');
        const properties = {...definition};
        delete properties.slot;
        const chosen = Object.hasOwn(position, 'slot')
          ? slot(position.slot)
          : slot(definition.slot);
        if (properties.type !== 'background' && !sources.has(properties.source as string))
          invalid('unknownSource');
        const current = currentBase();
        validate({
          sources: Object.fromEntries(sources),
          layers: [properties],
          ...(current.glyphs ? {glyphs: current.glyphs} : {}),
          ...(current.sprite ? {sprite: current.sprite} : {}),
        });
        const layer: Layer = {id: definition.id, definition: properties, slot: chosen};
        const next = placement(layers, layer, position, 'addLayer');
        target.addLayer(json(properties) as never, beforeLayer(layer, next, current));
        if (!target.getLayer(layer.id)) invalid('rendererRejected');
        layer.definition = json(
          styleOf(target)?.layers.find((item) => item.id === layer.id) ?? properties,
        );
        layers = next;
        installedLayers.set(layer.id, target.getLayer(layer.id));
      });
    },
    moveLayer(id, position = {}) {
      return input({id, position}, ({id, position}) => {
        const previous = layers.find((layer) => layer.id === id);
        if (!previous) invalid('unknownLayer');
        const moved = {
          ...previous!,
          slot: Object.hasOwn(position, 'slot') ? slot(position.slot) : previous!.slot,
        };
        const next = placement(
          layers.filter((layer) => layer.id !== id),
          moved,
          position,
          'moveLayer',
        );
        requireMap().moveLayer(id, beforeLayer(moved, next, currentBase()));
        layers = next;
        installedLayers.set(id, requireMap().getLayer(id));
      });
    },
    removeLayer(id) {
      return input(id, (id) => {
        if (!layers.some((layer) => layer.id === id)) invalid('unknownLayer');
        requireMap().removeLayer(id);
        if (requireMap().getLayer(id)) invalid('rendererRejected');
        layers = layers.filter((layer) => layer.id !== id);
        installedLayers.delete(id);
      });
    },
    dispose,
  };
  return {
    controller,
    attach(next, initialStyle) {
      if (terminal) throw terminal;
      if (map && map !== next)
        throw new TileflowMapError('invalidRequest', {
          message: 'Create a new controller binding for a new map instance.',
        });
      if (map === next) return;
      if (runtimes.has(next)) invalid('controllerAlreadyAttached');
      map = next;
      base = initialStyle;
      runtimes.set(next, {
        compose,
        strip,
        begin() {
          locks += 1;
        },
        end() {
          locks = Math.max(0, locks - 1);
          if (!locks) sync();
        },
      });
      next.on('style.load', sync);
      next.on('render', pump);
      next.on('remove', dispose);
      sync();
    },
    fail: terminate,
    dispose,
  };
}

export function createTileflowMapController(options: {
  map: TileflowRuntimeStyleMap;
  initialStyle?: MapLibreStyle;
  onError?: (error: Error) => void;
}): TileflowMapController {
  const binding = createTileflowMapControllerBinding(options);
  binding.attach(options.map, options.initialStyle);
  return binding.controller;
}

/** Compose application resources before the theme controller submits its next style. */
export function composeTileflowRuntimeStyle(map: object, style: MapLibreStyle): MapLibreStyle {
  return runtimes.get(map)?.compose(style) ?? style;
}

/** Remove only registered resources from a live snapshot used to prepare a base transition. */
export function stripTileflowRuntimeStyle(map: object, style: MapLibreStyle): MapLibreStyle {
  return runtimes.get(map)?.strip(style) ?? style;
}

/** Hold queued mutations until the style switch, including its load event, settles. */
export function beginTileflowRuntimeStyleChange(map: object): () => void {
  const runtime = runtimes.get(map);
  runtime?.begin();
  let ended = false;
  return () => {
    if (!ended) {
      ended = true;
      runtime?.end();
    }
  };
}
