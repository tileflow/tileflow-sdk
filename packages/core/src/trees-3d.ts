// Places a vector tile's trees for Tileflow's 3D trees: the trees the map's data maps one by one
// (World's `tree`), each in the form and at the size its data gives, trees along mapped rows of trees
// (`tree_row`), and one to three trees for each of World's decorative canopy points (`canopy`),
// inside the room the point leaves. A tree keeps its form, size, turn and shade wherever and whenever
// it is read. It has no DOM dependency.
import type {TileflowTileLayer} from './vector-tile-decode';

/** The forms a 3D tree takes. */
export const tileflowTreeForms = ['round', 'open', 'tall', 'conifer', 'columnar', 'palm'] as const;
export type TileflowTreeForm = (typeof tileflowTreeForms)[number];

/** Relative weights of the forms given to trees whose data gives none. */
export type TileflowTreeFormMix = Readonly<Partial<Record<TileflowTreeForm, number>>>;

/** A region whose trees without a form in the data take their own mix. */
export type TileflowTreeRegion = Readonly<{
  /** `[west, south, east, north]` in degrees. */
  bounds: readonly [number, number, number, number];
  unknownForms: TileflowTreeFormMix;
}>;

/** The fields of the tree and canopy layers, as World names them. */
export type TileflowTreeFields = Readonly<{
  height: string;
  diameterCrown: string;
  circumference: string;
  genus: string;
  species: string;
  leafType: string;
  /** The tree's taxon at any rank, such as `Arecaceae` for palms or a genus or species. */
  taxon: string;
  canopyRank: string;
  canopyClearance: string;
  canopyCover: string;
  /** A canopy point's measured canopy height, in metres. */
  canopyHeight: string;
}>;

export const tileflowWorldTreeFields: TileflowTreeFields = Object.freeze({
  height: 'height',
  diameterCrown: 'diameter_crown',
  circumference: 'circumference',
  genus: 'genus',
  species: 'species',
  leafType: 'leaf_type',
  taxon: 'taxon',
  canopyRank: 'rank',
  canopyClearance: 'clearance_px_z15',
  canopyCover: 'cover_pct',
  canopyHeight: 'height_m',
});

/** Trees of unknown form by default: the three broadleaf forms, evenly. */
export const tileflowDefaultUnknownTreeForms: TileflowTreeFormMix = Object.freeze({
  round: 1,
  open: 1,
  tall: 1,
});

export type TileflowTreePlacementOptions = Readonly<{
  /** The tile's address, for regions and for a stable look per tree. */
  tile: Readonly<{x: number; y: number; z: number}>;
  /** The tile's width in metres. */
  tileMetres: number;
  fields?: Partial<TileflowTreeFields>;
  unknownForms?: TileflowTreeFormMix;
  regions?: readonly TileflowTreeRegion[];
  /** Metres between the trees of a row; defaults to 8. */
  rowSpacing?: number;
}>;

/** A tile's layers trees come from, as World names them. */
export type TileflowTreeLayers = Readonly<{
  /** Trees mapped one by one (World's `tree`). */
  trees?: TileflowTileLayer;
  /** Rows of trees mapped as lines (World's `tree_row`), planted every `rowSpacing` metres. */
  rows?: TileflowTileLayer;
  /** Decorative canopy points in parks and gardens (World's `canopy`). */
  canopy?: TileflowTileLayer;
}>;

/** Where a form's trees are in a placement, and how many of them have each rank or a lower one. */
export type TileflowTreeFormRange = Readonly<{
  start: number;
  count: number;
  /** `upTo[r]`: trees of this form with a rank of `r` or lower, from 0 to 15. */
  upTo: readonly number[];
}>;

/** One tile's trees, ready to upload. */
export type TileflowTreePlacement = Readonly<{
  /** `tileflowTreeBytes` bytes per tree, ordered by form, then rank; see the layout below. */
  trees: Uint8Array;
  forms: Readonly<Record<TileflowTreeForm, TileflowTreeFormRange>>;
  /** The tallest tree, in metres. */
  tallest: number;
  /** Trees from the data's trees and rows, and trees from canopy points. */
  mapped: number;
  canopy: number;
}>;

/**
 * Bytes per tree: x and y in tile units of 8192 (uint16 each), height and crown diameter in
 * decimetres (uint16 each), then one byte each for its turn (of a full turn), its shade among the
 * theme's colours, its form, its rank (0–15, lower shows first), a seed and whether it stands for
 * a canopy point (1) or a mapped tree (0), and two bytes of padding.
 */
export const tileflowTreeBytes = 16;

const extent = 8192;
const ranks = 16;

// A form's height range in metres and its crown's width as a share of its height.
const formSizes: Readonly<
  Record<TileflowTreeForm, {height: [number, number]; crown: [number, number]}>
> = {
  round: {height: [6, 12], crown: [0.66, 0.9]},
  open: {height: [5, 10], crown: [0.8, 1.05]},
  tall: {height: [9, 17], crown: [0.48, 0.68]},
  conifer: {height: [7, 16], crown: [0.46, 0.66]},
  columnar: {height: [9, 18], crown: [0.22, 0.36]},
  palm: {height: [8, 16], crown: [0.34, 0.5]},
};
const heightBounds: readonly [number, number] = [2, 45];
const crownBounds: readonly [number, number] = [1, 25];

// Genera whose form is known: palms, columns, conifers and the three broadleaf forms.
const palms = new Set([
  'acoelorrhaphe',
  'adonidia',
  'archontophoenix',
  'areca',
  'arecastrum',
  'bismarckia',
  'brahea',
  'butia',
  'caryota',
  'chamaedorea',
  'chamaerops',
  'coccothrinax',
  'cocos',
  'dypsis',
  'elaeis',
  'howea',
  'jubaea',
  'licuala',
  'livistona',
  'phoenix',
  'pritchardia',
  'ptychosperma',
  'rhapis',
  'roystonea',
  'sabal',
  'serenoa',
  'syagrus',
  'thrinax',
  'trachycarpus',
  'veitchia',
  'washingtonia',
  'wodyetia',
]);
const columns = new Set(['cupressus', 'calocedrus', 'thuja']);
const conifers = new Set([
  'abies',
  'araucaria',
  'cedrus',
  'cryptomeria',
  'juniperus',
  'larix',
  'metasequoia',
  'picea',
  'pinus',
  'pseudotsuga',
  'sequoia',
  'sequoiadendron',
  'taxodium',
  'taxus',
  'tsuga',
]);
const broadleaves: Readonly<Record<string, TileflowTreeForm>> = Object.freeze({
  ...Object.fromEntries(
    [
      'acacia',
      'albizia',
      'arbutus',
      'bursera',
      'ceratonia',
      'delonix',
      'ficus',
      'gleditsia',
      'jacaranda',
      'olea',
      'quercus',
      'robinia',
      'schinus',
      'sophora',
      'styphnolobium',
      'tamarix',
    ].map((genus) => [genus, 'open' as const]),
  ),
  ...Object.fromEntries(
    [
      'betula',
      'celtis',
      'fraxinus',
      'ginkgo',
      'liquidambar',
      'liriodendron',
      'magnolia',
      'platanus',
      'populus',
      'pyrus',
      'ulmus',
      'zelkova',
    ].map((genus) => [genus, 'tall' as const]),
  ),
  ...Object.fromEntries(
    [
      'acer',
      'aesculus',
      'carpinus',
      'castanea',
      'catalpa',
      'cercis',
      'citrus',
      'fagus',
      'lagerstroemia',
      'malus',
      'melia',
      'morus',
      'prunus',
      'sorbus',
      'tilia',
    ].map((genus) => [genus, 'round' as const]),
  ),
});

/**
 * The form a tree's data gives it, or undefined when its data says nothing about its form: a palm
 * by `leaf_type` or genus, a column, a conifer by `leaf_type` or genus, or one of the broadleaf
 * forms by genus. `broadleaf` means the data says broadleaved without a known genus.
 */
export function tileflowTreeFormOf(
  properties: Readonly<Record<string, unknown>>,
  fields: Partial<TileflowTreeFields> = {},
): TileflowTreeForm | 'broadleaf' | undefined {
  const named = {...tileflowWorldTreeFields, ...fields};
  const leaf = String(properties[named.leafType] ?? '').toLowerCase();
  const taxon = String(properties[named.taxon] ?? '').toLowerCase();
  const genus =
    genusOf(properties[named.genus]) ??
    genusOf(properties[named.species]) ??
    (taxon.endsWith('aceae') ? undefined : genusOf(properties[named.taxon]));
  if (leaf.includes('palm') || taxon.includes('arecaceae') || (genus && palms.has(genus)))
    return 'palm';
  if (taxon.includes('cupressaceae') && !genus) return 'conifer';
  if (taxon.includes('pinaceae')) return 'conifer';
  if (genus && columns.has(genus)) return 'columnar';
  if (leaf.includes('needle') || (genus && conifers.has(genus))) return 'conifer';
  if (genus && broadleaves[genus]) return broadleaves[genus];
  if (leaf.includes('broad')) return 'broadleaf';
  return undefined;
}

function genusOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const word = value.trim().split(/\s+/u)[0]?.toLowerCase();
  return word || undefined;
}

/** Whether a mix of forms is valid: known forms, finite weights of zero or more, some above zero. */
export function tileflowTreeFormMixProblem(mix: unknown): string | undefined {
  if (typeof mix !== 'object' || mix === null || Array.isArray(mix))
    return 'a mix of forms is an object of weights, such as {round: 1, palm: 2}';
  let total = 0;
  for (const [form, weight] of Object.entries(mix)) {
    if (!(tileflowTreeForms as readonly string[]).includes(form))
      return `"${form}" is not a tree form; forms are ${tileflowTreeForms.join(', ')}`;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)
      return `the weight of "${form}" must be a number of 0 or more`;
    total += weight;
  }
  return total > 0 ? undefined : 'a mix of forms needs at least one weight above 0';
}

/** Places a tile's trees. Points in the tile's buffer belong to the neighbouring tile. */
export function placeTileflowTrees(
  layers: TileflowTreeLayers,
  options: TileflowTreePlacementOptions,
): TileflowTreePlacement {
  const fields = {...tileflowWorldTreeFields, ...options.fields};
  const unknown = options.unknownForms ?? tileflowDefaultUnknownTreeForms;
  const regions = options.regions ?? [];
  const {tile, tileMetres} = options;
  // A z15 pixel of a 512-pixel tile, in metres, for the canopy's room.
  const pixelMetres = tileMetres / 2 ** (15 - tile.z) / 512;
  const placed: {
    x: number;
    y: number;
    height: number;
    crown: number;
    turn: number;
    shade: number;
    form: number;
    rank: number;
    seed: number;
    canopy: number;
  }[] = [];
  let mapped = 0;
  let canopy = 0;

  const unknownAt = (x: number, y: number): TileflowTreeFormMix => {
    if (regions.length === 0) return unknown;
    const [lng, lat] = lngLatOf(tile, x / extent, y / extent);
    for (const region of regions) {
      const [west, south, east, north] = region.bounds;
      const inside =
        lat >= south &&
        lat <= north &&
        (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east);
      if (inside) return region.unknownForms;
    }
    return unknown;
  };

  const sized = (form: TileflowTreeForm, seed: number, height?: number, crown?: number) => {
    const size = formSizes[form];
    const share = mixed(size.crown, unit(seed, 2));
    let h = height;
    let c = crown;
    if (h === undefined && c === undefined) h = mixed(size.height, unit(seed, 1));
    if (h === undefined) h = c! / share;
    if (c === undefined) c = h * share;
    return {
      height: clamp(h, heightBounds),
      crown: clamp(c, crownBounds),
    };
  };

  /** Stands a mapped tree at a point of the tile, in its data's form and size. */
  const standMapped = (
    x: number,
    y: number,
    data: ReturnType<typeof tileflowTreeFormOf>,
    height: number | undefined,
    crown: number | undefined,
    girth: number | undefined,
  ) => {
    const seed = hash(tile.x * extent + x, tile.y * extent + y, 7);
    const form =
      data === undefined
        ? pick(unknownAt(x, y), unit(seed, 3))
        : data === 'broadleaf'
          ? pick(broadleafOf(unknownAt(x, y)), unit(seed, 3))
          : data;
    // A trunk's girth sizes a tree with no height or crown: a 1.5 m girth is a middling tree.
    const grown =
      height === undefined && crown === undefined && girth !== undefined
        ? sized(form, seed, mixed(formSizes[form].height, clamp(girth / 3, [0, 1])))
        : sized(form, seed, height, crown);
    placed.push({
      x,
      y,
      ...grown,
      turn: unit(seed, 4),
      shade: unit(seed, 5),
      form: tileflowTreeForms.indexOf(form),
      rank: Math.floor(unit(seed, 6) * ranks),
      seed: unit(seed, 7),
      canopy: 0,
    });
    mapped += 1;
  };

  const trees = layers.trees;
  if (trees) {
    const scale = extent / trees.extent;
    for (const feature of trees.features) {
      if (feature.type !== 'Point') continue;
      const properties = feature.properties;
      const data = tileflowTreeFormOf(properties, fields);
      const height = measured(properties[fields.height], heightBounds);
      const crown = measured(properties[fields.diameterCrown], crownBounds);
      const girth = measured(properties[fields.circumference], [0.1, 12]);
      for (const set of feature.geometry)
        for (let index = 0; index + 1 < set.length; index += 2) {
          const px = set[index]!;
          const py = set[index + 1]!;
          if (px < 0 || py < 0 || px >= trees.extent || py >= trees.extent) continue;
          standMapped(px * scale, py * scale, data, height, crown, girth);
        }
    }
  }

  // A row of trees stands a tree every `rowSpacing` metres along its line, from half a spacing in.
  const rows = layers.rows;
  if (rows) {
    const scale = extent / rows.extent;
    const step = (options.rowSpacing ?? 8) / (tileMetres / rows.extent);
    for (const feature of rows.features) {
      if (feature.type !== 'LineString') continue;
      const properties = feature.properties;
      const data = tileflowTreeFormOf(properties, fields);
      const height = measured(properties[fields.height], heightBounds);
      const crown = measured(properties[fields.diameterCrown], crownBounds);
      for (const line of feature.geometry) {
        let next = step / 2;
        let along = 0;
        for (let index = 0; index + 3 < line.length; index += 2) {
          const [ax, ay, bx, by] = [
            line[index]!,
            line[index + 1]!,
            line[index + 2]!,
            line[index + 3]!,
          ];
          const length = Math.hypot(bx - ax, by - ay);
          while (next <= along + length) {
            const t = length > 0 ? (next - along) / length : 0;
            const px = ax + (bx - ax) * t;
            const py = ay + (by - ay) * t;
            if (px >= 0 && py >= 0 && px < rows.extent && py < rows.extent)
              standMapped(px * scale, py * scale, data, height, crown, undefined);
            next += step;
          }
          along += length;
        }
      }
    }
  }

  const points = layers.canopy;
  if (points) {
    const scale = extent / points.extent;
    for (const feature of points.features) {
      if (feature.type !== 'Point') continue;
      const properties = feature.properties;
      const rank = clamp(Math.floor(Number(properties[fields.canopyRank] ?? 8)), [0, ranks - 1]);
      const room = Math.max(4, Number(properties[fields.canopyClearance] ?? 8)) * pixelMetres;
      const cover = Number(properties[fields.canopyCover] ?? 30);
      const count = cover >= 60 ? 3 : cover >= 30 ? 2 : 1;
      for (const set of feature.geometry)
        for (let index = 0; index + 1 < set.length; index += 2) {
          const px = set[index]!;
          const py = set[index + 1]!;
          if (px < 0 || py < 0 || px >= points.extent || py >= points.extent) continue;
          const cx = px * scale;
          const cy = py * scale;
          const cell = hash(tile.x * extent + cx, tile.y * extent + cy, 11);
          const mix = unknownAt(cx, cy);
          const canopyHeight = measured(properties[fields.canopyHeight], heightBounds);
          // One crown fills a narrow room; two or three share a wider one under closed canopy.
          const crown = clamp(
            Math.min(room * (count === 1 ? 1.3 : 0.95), 11) * (0.85 + unit(cell, 1) * 0.25),
            [3, 12],
          );
          const spread = Math.max(0, Math.min(crown * 0.5, room - crown / 2));
          const start = unit(cell, 2) * Math.PI * 2;
          for (let member = 0; member < count; member += 1) {
            const seed = hash(cell, member, 13);
            const angle = start + (member * Math.PI * 2) / count;
            const reach = count === 1 ? spread * 0.3 * unit(seed, 1) : spread;
            const x = cx + (Math.cos(angle) * reach) / (tileMetres / extent);
            const y = cy + (Math.sin(angle) * reach) / (tileMetres / extent);
            if (x < 0 || y < 0 || x >= extent || y >= extent) continue;
            const form = pick(mix, unit(seed, 3));
            const own = crown * (0.85 + unit(seed, 2) * 0.3);
            // The measured canopy height, where the data has it, gives each tree its height.
            const tall =
              canopyHeight === undefined ? undefined : canopyHeight * (0.85 + unit(seed, 6) * 0.25);
            const grown = sized(form, seed, tall, form === 'palm' ? undefined : own);
            placed.push({
              x,
              y,
              ...grown,
              turn: unit(seed, 4),
              shade: unit(seed, 5),
              form: tileflowTreeForms.indexOf(form),
              rank,
              seed: unit(seed, 7),
              canopy: 1,
            });
            canopy += 1;
          }
        }
    }
  }

  placed.sort((a, b) => a.form - b.form || a.rank - b.rank);
  const bytes = new Uint8Array(placed.length * tileflowTreeBytes);
  const view = new DataView(bytes.buffer);
  let tallest = 0;
  const forms = Object.fromEntries(
    tileflowTreeForms.map((form) => [
      form,
      {start: 0, count: 0, upTo: new Array<number>(ranks).fill(0)},
    ]),
  ) as Record<TileflowTreeForm, {start: number; count: number; upTo: number[]}>;
  placed.forEach((tree, index) => {
    const at = index * tileflowTreeBytes;
    view.setUint16(at, Math.min(extent - 1, Math.round(tree.x)), true);
    view.setUint16(at + 2, Math.min(extent - 1, Math.round(tree.y)), true);
    view.setUint16(at + 4, Math.round(tree.height * 10), true);
    view.setUint16(at + 6, Math.round(tree.crown * 10), true);
    bytes[at + 8] = Math.floor(tree.turn * 256) & 255;
    bytes[at + 9] = Math.floor(tree.shade * 256) & 255;
    bytes[at + 10] = tree.form;
    bytes[at + 11] = tree.rank;
    bytes[at + 12] = Math.floor(tree.seed * 256) & 255;
    bytes[at + 13] = tree.canopy;
    tallest = Math.max(tallest, tree.height);
    const range = forms[tileflowTreeForms[tree.form]!];
    if (range.count === 0) range.start = index;
    range.count += 1;
    for (let rank = tree.rank; rank < ranks; rank += 1) range.upTo[rank]! += 1;
  });
  return {trees: bytes, forms, tallest, mapped, canopy};
}

function broadleafOf(mix: TileflowTreeFormMix): TileflowTreeFormMix {
  const broad = {round: mix.round ?? 0, open: mix.open ?? 0, tall: mix.tall ?? 0};
  return broad.round + broad.open + broad.tall > 0 ? broad : tileflowDefaultUnknownTreeForms;
}

function pick(mix: TileflowTreeFormMix, value: number): TileflowTreeForm {
  let total = 0;
  for (const form of tileflowTreeForms) total += Math.max(0, mix[form] ?? 0);
  if (total <= 0) return pick(tileflowDefaultUnknownTreeForms, value);
  let at = value * total;
  for (const form of tileflowTreeForms) {
    const weight = Math.max(0, mix[form] ?? 0);
    if (at < weight) return form;
    at -= weight;
  }
  return 'round';
}

function measured(value: unknown, bounds: readonly [number, number]): number | undefined {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(number) && number > 0 ? clamp(number, bounds) : undefined;
}

function clamp(value: number, [low, high]: readonly [number, number]): number {
  return Math.min(high, Math.max(low, value));
}

function mixed([low, high]: readonly [number, number], t: number): number {
  return low + (high - low) * t;
}

function lngLatOf(
  tile: {x: number; y: number; z: number},
  fx: number,
  fy: number,
): [number, number] {
  const n = 2 ** tile.z;
  const lng = ((tile.x + fx) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + fy)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/** A 32-bit hash of two numbers and a salt. */
function hash(a: number, b: number, salt: number): number {
  let h =
    (Math.imul(Math.floor(a) | 0, 0x27d4eb2d) ^
      Math.imul(Math.floor(b) | 0, 0x165667b1) ^
      Math.imul(salt, 0x9e3779b1)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A number from 0 to 1 from a hash and a salt. */
function unit(seed: number, salt: number): number {
  return hash(seed, salt, 0x51ed) / 4294967296;
}

/** The style metadata key under which a compiled map describes its 3D trees. */
export const tileflowVegetationMetadataKey = 'tileflow:vegetation';

/** How a compiled map's 3D trees look and where their data is, resolved for one theme. */
export type TileflowVegetation3D = Readonly<{
  /** The vector source and its layers with the trees and the canopy points. */
  source: string;
  layers: Readonly<{tree: string; treeRow?: string; canopy?: string}>;
  fields: TileflowTreeFields;
  /** Sunlit colours: bark, and the leaves of each kind of tree from darkest to lightest. */
  colors: Readonly<{
    bark: string;
    broadleaf: readonly string[];
    conifer: readonly string[];
    palm: readonly string[];
  }>;
  heightScale: number;
  crownScale: number;
  unknownForms: TileflowTreeFormMix;
  regions: readonly TileflowTreeRegion[];
}>;

/** The metadata a compiled style publishes for its 3D trees. */
export function tileflowVegetationMetadata(
  vegetation: TileflowVegetation3D,
): Readonly<{version: 1} & TileflowVegetation3D> {
  return {version: 1, ...vegetation};
}

/**
 * Reads the 3D trees a compiled style describes, or undefined when its metadata has none or holds
 * a version or shape this Core does not know.
 */
export function readTileflowVegetation3D(metadata: unknown): TileflowVegetation3D | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata[tileflowVegetationMetadataKey];
  if (!isRecord(value) || value.version !== 1) return undefined;
  const {source, layers, fields, colors, heightScale, crownScale, unknownForms, regions} = value;
  if (typeof source !== 'string' || !isRecord(layers) || typeof layers.tree !== 'string')
    return undefined;
  if (!isRecord(fields) || !isRecord(colors) || typeof colors.bark !== 'string') return undefined;
  const palette = (list: unknown) =>
    Array.isArray(list) && list.length > 0 && list.every((entry) => typeof entry === 'string')
      ? (list as string[])
      : undefined;
  const broadleaf = palette(colors.broadleaf);
  const conifer = palette(colors.conifer);
  const palm = palette(colors.palm) ?? broadleaf;
  if (!broadleaf || !conifer || !palm) return undefined;
  const scale = (number: unknown) =>
    typeof number === 'number' && number > 0 && number <= 10 ? number : 1;
  const mix = tileflowTreeFormMixProblem(unknownForms) === undefined ? unknownForms : undefined;
  const zones = Array.isArray(regions)
    ? regions.filter(
        (region): region is TileflowTreeRegion =>
          isRecord(region) && tileflowTreeRegionProblem(region) === undefined,
      )
    : [];
  const named = Object.fromEntries(
    Object.entries(tileflowWorldTreeFields).map(([key, fallback]) => [
      key,
      typeof fields[key] === 'string' ? fields[key] : fallback,
    ]),
  ) as TileflowTreeFields;
  return {
    source,
    layers: {
      tree: layers.tree,
      ...(typeof layers.treeRow === 'string' ? {treeRow: layers.treeRow} : {}),
      ...(typeof layers.canopy === 'string' ? {canopy: layers.canopy} : {}),
    },
    fields: named,
    colors: {bark: colors.bark, broadleaf, conifer, palm},
    heightScale: scale(heightScale),
    crownScale: scale(crownScale),
    unknownForms: (mix as TileflowTreeFormMix | undefined) ?? tileflowDefaultUnknownTreeForms,
    regions: zones,
  };
}

/** Whether a region is valid: bounds in degrees with south below north, and a valid mix. */
export function tileflowTreeRegionProblem(region: unknown): string | undefined {
  if (!isRecord(region)) return 'a region is an object with bounds and unknownForms';
  const bounds = region.bounds;
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
    return 'bounds are [west, south, east, north] in degrees';
  const [west, south, east, north] = bounds as number[];
  if (
    Math.abs(west!) > 180 ||
    Math.abs(east!) > 180 ||
    Math.abs(south!) > 90 ||
    Math.abs(north!) > 90
  )
    return 'bounds are [west, south, east, north] in degrees, longitudes within ±180 and latitudes within ±90';
  if (south! > north!) return 'a region’s south lies below its north';
  const mix = tileflowTreeFormMixProblem(region.unknownForms);
  return mix ? `unknownForms: ${mix}` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
