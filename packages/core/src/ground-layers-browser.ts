// Application layers that lie on the ground of a map with 3D content, such as a route, traffic or a
// highlighted area. MapLibre draws a 2D layer that comes after a 3D layer (a fill extrusion, or a
// custom layer drawn in 3D) without testing depth, so a route placed under the labels crosses in
// front of the buildings. Placed before the first 3D layer, the same route is hidden exactly where a
// building stands in front of it, since a wall drawn on a pixel always stands nearer than the ground
// there. A see-through copy of a line over the 3D content, at a lower opacity, shows the stretches
// the buildings hide, as a navigation app shows a route through them.
//
// The group owns where its layers go and how their hidden stretches show. A renderer that tests
// lines against the depth of 3D content and draws their hidden stretches at an opacity of their own
// would replace the copies inside this module, and applications would keep the same call.

const manifestKey = 'tileflow:overlay-placement-manifest';
const copySuffix = ':occluded';

/** The capabilities `tileflowGroundBeforeId` reads; importing this module never loads a renderer. */
export type TileflowGroundOrderMap = {
  getLayer(id: string): unknown;
  getLayersOrder(): string[];
  getStyle(): unknown;
};

/** Structural MapLibre capabilities of a map that holds a ground layer group. */
export type TileflowGroundLayersMap = TileflowGroundOrderMap & {
  addLayer(layer: unknown, beforeId?: string): unknown;
  getSource(id: string): unknown;
  moveLayer(id: string, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
  getCanvas?(): unknown;
  on(event: 'styledata', listener: () => void): unknown;
  off(event: 'styledata', listener: () => void): unknown;
};

/**
 * A layer of the group: a MapLibre style layer drawn in 2D, such as a line or a fill, or a custom
 * layer whose `renderingMode` is `2d`.
 */
export type TileflowGroundLayer =
  | Readonly<Record<string, unknown> & {id: string; type: string}>
  | Readonly<{id: string; type: 'custom'; renderingMode?: '2d' | '3d'}>;

export type TileflowGroundLayersOptions = Readonly<{
  /** The layers, bottom to top, such as a route's glow, casing, line and core. */
  layers: readonly TileflowGroundLayer[];
  /**
   * How much of each line layer shows where 3D content hides it, by layer id: from 0 (nothing, the
   * default) to 1 (as much as where it shows). Only line layers whose `line-opacity` is a number
   * can show through.
   */
  occludedOpacity?: Readonly<Record<string, number>>;
}>;

export type TileflowGroundLayers = {
  /** The group's layer ids, bottom to top. */
  readonly ids: readonly string[];
  /** The map's layer, so helpers that paint layers, such as line progress, can paint the group. */
  getLayer(id: string): unknown;
  /**
   * Sets a paint property of one of the group's layers, and keeps it for when a style change brings
   * the layer back. A layer that shows through 3D content passes it to its see-through copy too, at
   * its `line-opacity` times its occluded opacity. Other layers' properties pass straight to the map.
   */
  setPaintProperty(layer: string, name: string, value: unknown): void;
  /** Sets a layout property, such as `visibility`, the same way. */
  setLayoutProperty(layer: string, name: string, value: unknown): void;
  getCanvas(): unknown;
  on(event: 'styledata', listener: () => void): void;
  off(event: 'styledata', listener: () => void): void;
  /** Takes the group's layers and their copies off the map and stops following style changes. */
  dispose(): void;
};

type Spec = Record<string, unknown> & {id: string; type: string};
type Bounds = {floor?: string; ceiling?: string};

/**
 * The layer a layer lying on the ground goes before: the first 3D layer above the roads, or the
 * start of the vegetation when the buildings are flat, so the layer covers the roads and the flat
 * buildings, and every 3D layer hides it where it stands in front. A style without Tileflow's
 * overlay placements uses its first 3D layer or its first symbol layer. Undefined means the top.
 */
export function tileflowGroundBeforeId(map: TileflowGroundOrderMap): string | undefined {
  const order = map.getLayersOrder();
  return order[groundIndex(map, order, readBounds(map), new Set())];
}

/**
 * Keeps a group of application layers on the ground, under the map's 3D content, from bottom to
 * top as given. Layers already on the map are moved into place; a layer whose source is not on the
 * map yet is added when it is. The group follows the map: after a style change it brings back the
 * layers the change dropped, and it moves its layers again when a 3D layer lands above them, so
 * a layer added later in 3D hides them too. A line with an occluded opacity gets a see-through
 * copy over the 3D content, painted through the group.
 */
export function createTileflowGroundLayers(
  map: TileflowGroundLayersMap,
  options: TileflowGroundLayersOptions,
): TileflowGroundLayers {
  const {layers, occluded} = validated(options);
  const ids = layers.map(({id}) => id);
  const managed = new Set([...ids, ...[...occluded.keys()].map(copyId)]);
  let bounds = readBounds(map);
  let disposed = false;
  let busy = false;

  const find = (id: string) => layers.find((layer) => layer.id === id);
  const copies = [...occluded.keys()];
  // A layer waits for its source, which a style change drops with it until the application adds
  // it again.
  const ready = (layer: Spec) =>
    typeof layer.source !== 'string' || Boolean(map.getSource(layer.source));

  /** Where the group's layers and copies go now: before `ground`, and before `scene`. */
  function slots() {
    bounds = readBounds(map);
    const order = map.getLayersOrder();
    const ground = order[groundIndex(map, order, bounds, managed)];
    const scene = sceneBeforeId(map, order, managed);
    return {ground, scene: scene === null ? ground : scene};
  }

  /** Puts every layer and copy in place, adding the missing ones. */
  function place() {
    const {ground} = slots();
    for (const layer of layers) {
      if (map.getLayer(layer.id)) map.moveLayer(layer.id, ground);
      else if (ready(layer)) map.addLayer(fresh(layer), ground);
    }
    // The copies go over the 3D content, or over the group's layers on a map without any.
    const {scene} = slots();
    for (const id of copies) {
      if (map.getLayer(copyId(id))) map.moveLayer(copyId(id), scene);
      else if (map.getLayer(id)) map.addLayer(fresh(copyOf(find(id)!, occluded.get(id)!)), scene);
    }
  }

  /** Brings back layers a style change dropped, under the next layer of the group still there. */
  function restore() {
    const due = layers.filter((layer) => !map.getLayer(layer.id) && ready(layer));
    if (due.length > 0) {
      const {ground} = slots();
      layers.forEach((layer, index) => {
        if (!due.includes(layer)) return;
        const above = ids.slice(index + 1).find((id) => map.getLayer(id));
        map.addLayer(fresh(layer), above ?? ground);
      });
    }
    const dueCopies = copies.filter((id) => !map.getLayer(copyId(id)) && map.getLayer(id));
    if (dueCopies.length === 0) return;
    const {scene} = slots();
    copies.forEach((id, index) => {
      if (!dueCopies.includes(id)) return;
      const above = copies.slice(index + 1).find((other) => map.getLayer(copyId(other)));
      map.addLayer(
        fresh(copyOf(find(id)!, occluded.get(id)!)),
        above === undefined ? scene : copyId(above),
      );
    });
  }

  /**
   * Whether a 3D layer stands below one of the group's layers, or above one of its copies, so it
   * would not hide the layer or would hide the copy. Only these two cases move the group, so other
   * application layers can share the ground without the groups moving each other.
   */
  function misplaced(): boolean {
    const order = map.getLayersOrder();
    let floor = bounds.floor === undefined ? 0 : order.indexOf(bounds.floor);
    if (floor < 0 || (bounds.ceiling !== undefined && !order.includes(bounds.ceiling))) {
      bounds = readBounds(map);
      floor = bounds.floor === undefined ? 0 : Math.max(0, order.indexOf(bounds.floor));
    }
    let first = -1;
    let last = -1;
    order.forEach((id, index) => {
      if (managed.has(id) || !is3D(map.getLayer(id))) return;
      if (first < 0 && index >= floor) first = index;
      last = index;
    });
    return order.some((id, index) =>
      ids.includes(id) ? first >= 0 && index > first : managed.has(id) && last >= 0 && index < last,
    );
  }

  function sync() {
    if (disposed || busy) return;
    busy = true;
    try {
      restore();
      if (misplaced()) place();
    } catch {
      // The style is mid-update; the next style event puts the group back in place.
    } finally {
      busy = false;
    }
  }

  const onStyle = () => sync();
  map.on('styledata', onStyle);
  busy = true;
  try {
    place();
  } catch {
    // The style is not loaded yet; the first style event places the group.
  } finally {
    busy = false;
  }

  function write(
    kind: 'paint' | 'layout',
    layer: string,
    name: string,
    value: unknown,
    set: (layer: string, name: string, value: unknown) => unknown,
  ) {
    const spec = find(layer);
    if (!spec || disposed) {
      set(layer, name, value);
      return;
    }
    const opacity = occluded.get(layer);
    if (opacity !== undefined && kind === 'paint' && name === 'line-opacity')
      lineOpacity(value, layer);
    const values = {...(spec[kind] as Record<string, unknown> | undefined)};
    if (value === undefined) delete values[name];
    else values[name] = value;
    spec[kind] = values;
    if (map.getLayer(layer)) set(layer, name, value);
    if (opacity === undefined || !map.getLayer(copyId(layer))) return;
    const copied =
      kind === 'paint' && name === 'line-opacity' ? ((value as number) ?? 1) * opacity : value;
    set(copyId(layer), name, copied);
  }

  return {
    ids: Object.freeze([...ids]),
    getLayer: (id) => map.getLayer(id),
    setPaintProperty(layer, name, value) {
      write('paint', layer, name, value, (...args) => map.setPaintProperty(...args));
    },
    setLayoutProperty(layer, name, value) {
      write('layout', layer, name, value, (...args) => map.setLayoutProperty(...args));
    },
    getCanvas: () => map.getCanvas?.(),
    on: (event, listener) => void map.on(event, listener),
    off: (event, listener) => void map.off(event, listener),
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off('styledata', onStyle);
      for (const id of [...[...occluded.keys()].map(copyId), ...[...ids].reverse()]) {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {
          // A style mid-update has already dropped its runtime layers.
        }
      }
    },
  };
}

function copyId(id: string): string {
  return `${id}${copySuffix}`;
}

/** The see-through copy of a line layer: the same line at its opacity times `opacity`. */
function copyOf(layer: Spec, opacity: number): Spec {
  const paint = {...(layer.paint as Record<string, unknown> | undefined)};
  paint['line-opacity'] = ((paint['line-opacity'] as number | undefined) ?? 1) * opacity;
  return {...layer, id: copyId(layer.id), paint};
}

/**
 * A style layer to add: a copy, so the map never holds the group's own record. A custom layer goes
 * as it is, since it keeps its own state.
 */
function fresh(layer: Readonly<Record<string, unknown>>): unknown {
  if (layer.type === 'custom') return layer;
  return {
    ...layer,
    ...(isRecord(layer.paint) ? {paint: {...layer.paint}} : {}),
    ...(isRecord(layer.layout) ? {layout: {...layer.layout}} : {}),
  };
}

function readBounds(map: TileflowGroundOrderMap): Bounds {
  let anchors: unknown;
  try {
    const style = map.getStyle();
    const metadata = isRecord(style) ? style.metadata : undefined;
    const manifest = isRecord(metadata) ? metadata[manifestKey] : undefined;
    anchors = isRecord(manifest) ? manifest.anchors : undefined;
  } catch {
    anchors = undefined;
  }
  if (!isRecord(anchors)) return {};
  const id = (value: unknown) =>
    typeof value === 'string' && value && map.getLayer(value) ? value : undefined;
  return {floor: id(anchors['above-roads']), ceiling: id(anchors['above-buildings'])};
}

/**
 * The index of the layer ground layers go before: the first 3D layer from the floor (where layers
 * above the roads go) to the ceiling (where layers above the buildings go), else the ceiling. A
 * style without placements has no floor, and its first symbol layer is the ceiling.
 */
function groundIndex(
  map: TileflowGroundOrderMap,
  order: readonly string[],
  bounds: Bounds,
  managed: ReadonlySet<string>,
): number {
  const floor = bounds.floor === undefined ? 0 : Math.max(0, order.indexOf(bounds.floor));
  let ceiling = bounds.ceiling === undefined ? -1 : order.indexOf(bounds.ceiling);
  if (ceiling < 0) {
    ceiling = order.findIndex(
      (id, index) => index >= floor && !managed.has(id) && typeOf(map.getLayer(id)) === 'symbol',
    );
  }
  if (ceiling < floor) ceiling = order.length;
  for (let index = floor; index < ceiling; index += 1) {
    const id = order[index]!;
    if (!managed.has(id) && is3D(map.getLayer(id))) return index;
  }
  return ceiling;
}

/**
 * The first layer after the last 3D layer that is not the group's: undefined for the top, and null
 * on a map without 3D layers.
 */
function sceneBeforeId(
  map: TileflowGroundOrderMap,
  order: readonly string[],
  managed: ReadonlySet<string>,
): string | undefined | null {
  let last = order.length - 1;
  while (last >= 0 && (managed.has(order[last]!) || !is3D(map.getLayer(order[last]!)))) last -= 1;
  if (last < 0) return null;
  return order.slice(last + 1).find((id) => !managed.has(id));
}

function is3D(layer: unknown): boolean {
  if (!isRecord(layer)) return false;
  if (layer.type === 'fill-extrusion') return true;
  if (layer.type !== 'custom') return false;
  const implementation = isRecord(layer.implementation) ? layer.implementation : layer;
  return implementation.renderingMode === '3d';
}

function typeOf(layer: unknown): unknown {
  return isRecord(layer) ? layer.type : undefined;
}

function lineOpacity(value: unknown, id: string): void {
  if (value !== undefined && !(typeof value === 'number' && value >= 0 && value <= 1))
    throw new TypeError(
      `Ground layer "${id}" shows through 3D content, so its line-opacity must be a number from 0 to 1.`,
    );
}

function validated(options: TileflowGroundLayersOptions): {
  layers: Spec[];
  occluded: Map<string, number>;
} {
  const {layers, occludedOpacity = {}} = options;
  if (!Array.isArray(layers) || layers.length === 0)
    throw new TypeError('Ground layers need at least one layer.');
  const ids = new Set<string>();
  const specs = layers.map((layer) => {
    const spec = layer as unknown as Spec;
    if (!isRecord(spec) || typeof spec.id !== 'string' || !spec.id)
      throw new TypeError('Ground layers need an id.');
    if (ids.has(spec.id)) throw new TypeError(`Ground layer "${spec.id}" is listed twice.`);
    ids.add(spec.id);
    if (is3D(spec))
      throw new TypeError(
        `Ground layer "${spec.id}" is drawn in 3D; only 2D layers lie on the ground.`,
      );
    // The group keeps its own record of a style layer, which its paint and layout writes update.
    return spec.type === 'custom' ? spec : {...spec};
  });
  const occluded = new Map<string, number>();
  for (const [id, opacity] of Object.entries(occludedOpacity)) {
    const spec = specs.find((layer) => layer.id === id);
    if (!spec) throw new TypeError(`Occluded opacity names "${id}", which is not a ground layer.`);
    if (spec.type !== 'line')
      throw new TypeError(
        `Ground layer "${id}" is not a line; only lines show through 3D content.`,
      );
    if (!(typeof opacity === 'number' && opacity >= 0 && opacity <= 1))
      throw new TypeError(`Ground layer "${id}" occluded opacity runs from 0 to 1.`);
    lineOpacity(isRecord(spec.paint) ? spec.paint['line-opacity'] : undefined, id);
    if (opacity > 0) occluded.set(id, opacity);
  }
  return {layers: specs, occluded};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
