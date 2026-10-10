import type {MapLibreStyle} from './types';

/**
 * Theme blending plans one MapLibre style that can show any point between the themes of one map.
 *
 * The themes of a Tileflow map compile to the same sources, layers, filters, and expressions; they
 * differ only in token values: colours, numbers, and image names. A plan keeps the first theme's
 * structure and records every value that differs as a template the browser fills in for a blend
 * position: 0 is the first theme, 1 the second, and 1.25 a quarter of the way from the second to
 * the third. Filling a template needs no expression parsing in the browser, so the renderer only
 * receives plain values.
 *
 * Values that MapLibre evaluates per feature (data-driven values, such as a fill colour chosen by
 * land-use class) are baked into tiles, and changing them re-lays the whole source out. A plan
 * splits such a layer into one layer per branch that a feature can take through the value's
 * decisions on feature data, each filtered to the features that take it, so each value depends
 * only on zoom and the blend position. A value that reads feature data continuously is drawn once
 * per theme instead, and the copies cross-fade by opacity. Images are mixed in their pixels.
 * Values that read feature state cannot be split, because filters cannot read state; they switch
 * when the dominant theme changes.
 */

/** A paint value that the browser sets as the blend moves. */
export type TileflowThemeBlendPaint = Readonly<{
  layer: string;
  property: string;
  template: unknown;
  /** Ground values follow the blend position; symbol values follow the label cross-fade. */
  follows: TileflowThemeBlendClock;
}>;

/** Image names whose artwork differs between themes and is mixed in pixels. */
export type TileflowThemeBlendImage = Readonly<{
  names: readonly string[];
  follows: TileflowThemeBlendClock;
}>;

/** A value that can only change all at once, when the dominant theme changes. */
export type TileflowThemeBlendSwitch = Readonly<{
  layer: string;
  group: 'layout' | 'paint';
  property: string;
  values: readonly unknown[];
}>;

/**
 * `position` values follow the blend; `dominant` values follow a short cross-fade that starts when
 * the nearest theme changes. Labels use it because light lettering on a dark plate and dark
 * lettering on a light plate meet in the same grey halfway.
 */
export type TileflowThemeBlendClock = 'dominant' | 'position';

export type TileflowThemeBlendPlan = Readonly<{
  /** Number of themes; blend positions run from 0 to `themes - 1`. */
  themes: number;
  paints: readonly TileflowThemeBlendPaint[];
  images: readonly TileflowThemeBlendImage[];
  switches: readonly TileflowThemeBlendSwitch[];
  /** Root sky and light, when they differ between themes. */
  sky?: unknown;
  light?: unknown;
  summary: Readonly<{
    splitLayers: number;
    copiedLayers: number;
    /** Per-theme layers of which only the nearest theme's copy is shown. */
    switchedLayers: number;
    switchedValues: number;
  }>;
  /** The style at a blend position: every template filled, every switch at the nearest theme. */
  styleAt(position: number): MapLibreStyle;
}>;

export type TileflowThemeBlendOptions = Readonly<{
  /**
   * How icon images that differ between themes change. `mix` (the default) mixes their artwork in
   * pixels under the first theme's image names. `switch` changes the image names when the nearest
   * theme changes, for renderers that cannot replace an image's pixels while keeping its stretch
   * and content metadata.
   */
  iconImages?: 'mix' | 'switch';
  /**
   * How values that read feature data change when they can be neither split nor cross-faded.
   * `values` (the default) sets each value when the nearest theme changes. `layers` draws such a
   * layer once per theme and shows only the nearest theme's copy, for renderers that cannot set
   * data-driven values at run time reliably.
   */
  featureSwitches?: 'layers' | 'values';
}>;

export class TileflowThemeBlendError extends Error {
  override name = 'TileflowThemeBlendError';
}

/** A leaf whose value differs between themes; it is filled for a blend position. */
class BlendLeaf {
  constructor(readonly values: readonly (number | string)[]) {}
}

const imageProperties = new Set([
  'icon-image',
  'fill-pattern',
  'line-pattern',
  'background-pattern',
  'fill-extrusion-pattern',
]);
const opacityProperties: Readonly<Record<string, string>> = {
  background: 'background-opacity',
  circle: 'circle-opacity',
  fill: 'fill-opacity',
  'fill-extrusion': 'fill-extrusion-opacity',
  heatmap: 'heatmap-opacity',
  line: 'line-opacity',
  raster: 'raster-opacity',
};
const featureOperators = new Set([
  'feature-state',
  'geometry-type',
  'get',
  'has',
  'id',
  'in',
  'properties',
]);
const maximumBranches = 24;

/** Plans a blend of two or more compiled themes of one map, in blend order. */
export function planTileflowThemeBlend(
  styles: readonly MapLibreStyle[],
  options: TileflowThemeBlendOptions = {},
): TileflowThemeBlendPlan {
  if (styles.length < 2)
    throw new TileflowThemeBlendError('A theme blend needs two or more themes.');
  const [base] = styles as [MapLibreStyle, ...MapLibreStyle[]];
  assertSameStructure(styles, base);

  const mixedImages = new Set(imageProperties);
  if (options.iconImages === 'switch') mixedImages.delete('icon-image');
  const paints: TileflowThemeBlendPaint[] = [];
  const switches: TileflowThemeBlendSwitch[] = [];
  const imageGroups = collectImageNames(styles, base, mixedImages);
  const symbolLayers = new Set<string>();
  const images = new Map<string, TileflowThemeBlendImage>();
  let splitLayers = 0;
  let copiedLayers = 0;
  let switchedLayers = 0;

  const layers: Record<string, unknown>[] = [];
  for (const [index, layer] of base.layers.entries()) {
    const variants = styles.map((style) => style.layers[index] as Record<string, unknown>);
    layers.push(...planLayer(variants, String(layer.type)));
  }
  const switchesByLayer = new Map<string, TileflowThemeBlendSwitch[]>();
  for (const entry of switches) {
    const list = switchesByLayer.get(entry.layer) ?? [];
    list.push(entry);
    switchesByLayer.set(entry.layer, list);
  }
  const sky = differingRoot(styles, 'sky');
  const light = differingRoot(styles, 'light');
  const metadata = alignInteractionManifest(base.metadata, layers);

  return {
    themes: styles.length,
    paints,
    images: [...images.values()],
    switches,
    ...(sky === undefined ? {} : {sky}),
    ...(light === undefined ? {} : {light}),
    summary: {splitLayers, copiedLayers, switchedLayers, switchedValues: switches.length},
    styleAt(position) {
      const at = clampPosition(position, styles.length);
      const dominant = Math.round(at);
      const style: MapLibreStyle = {
        ...base,
        ...(metadata === undefined ? {} : {metadata}),
        // Symbols show the nearest theme, as the label cross-fade leaves them between changes.
        layers: layers.map((layer) =>
          fillLayer(
            layer,
            symbolLayers.has(String(layer.id)) ? dominant : at,
            dominant,
            switchesByLayer.get(String(layer.id)),
          ),
        ),
      };
      if (sky !== undefined) style.sky = fillTemplate(sky, at) as MapLibreStyle['sky'];
      if (light !== undefined) style.light = fillTemplate(light, at) as MapLibreStyle['light'];
      return style;
    },
  };

  /** A layer as one or more planned layers, recording its templates, images, and switches. */
  function planLayer(variants: Record<string, unknown>[], type: string): Record<string, unknown>[] {
    const [layer] = variants as [Record<string, unknown>, ...Record<string, unknown>[]];
    const id = String(layer.id);
    const paint = {...(layer.paint as Record<string, unknown> | undefined)};
    const layout = {...(layer.layout as Record<string, unknown> | undefined)};
    const follows: TileflowThemeBlendClock = type === 'symbol' ? 'dominant' : 'position';
    const ownPaints: {property: string; template: unknown}[] = [];
    const ownSwitches: Omit<TileflowThemeBlendSwitch, 'layer'>[] = [];
    const driven: string[] = [];
    const paintOf = (variant: Record<string, unknown>) =>
      (variant.paint as Record<string, unknown> | undefined) ?? {};

    for (const group of ['layout', 'paint'] as const) {
      const target = group === 'paint' ? paint : layout;
      for (const property of propertyNames(variants, group)) {
        const values = variants.map(
          (variant) => (variant[group] as Record<string, unknown> | undefined)?.[property],
        );
        if (values.every((value) => same(value, values[0]))) continue;
        if (mixedImages.has(property)) {
          const tuples = imageTuples(values);
          if (tuples && tuples.every((names) => imageGroups.get(names[0]!)?.size === 1)) {
            for (const names of tuples) {
              if (names.every((name) => name === names[0])) continue;
              images.set(JSON.stringify(names), {
                names,
                follows: property === 'icon-image' ? 'dominant' : 'position',
              });
            }
            continue;
          }
        }
        if (group === 'layout' || values.includes(undefined) || imageProperties.has(property)) {
          ownSwitches.push({group, property, values});
          continue;
        }
        if (values.some(isDataDriven)) {
          driven.push(property);
          continue;
        }
        const template = tryMixTemplate(values);
        if (template === undefined) {
          ownSwitches.push({group, property, values});
          continue;
        }
        ownPaints.push({property, template});
        target[property] = template;
      }
    }

    const planned: Record<string, unknown> = {...layer, paint, layout};
    let results: {
      layer: Record<string, unknown>;
      extra: {property: string; template: unknown}[];
      /** Per-theme copies switch their visibility instead of their values. */
      visibility?: string[];
    }[] = [{layer: planned, extra: []}];

    if (driven.length > 0) {
      const split = type === 'symbol' ? undefined : splitLayer();
      const copies = split ?? (type === 'symbol' ? undefined : copyLayer());
      if (copies) results = copies;
      else
        for (const property of driven)
          ownSwitches.push({
            group: 'paint',
            property,
            values: variants.map((variant) => paintOf(variant)[property]),
          });
    }
    if (
      options.featureSwitches === 'layers' &&
      results.length === 1 &&
      ownSwitches.some((entry) => entry.values.some(isDataDriven))
    )
      results = switchLayer();

    for (const result of results) {
      const resultId = String(result.layer.id);
      if (type === 'symbol') symbolLayers.add(resultId);
      const overridden = new Set(result.extra.map((entry) => entry.property));
      for (const entry of [
        ...ownPaints.filter((own) => !overridden.has(own.property)),
        ...result.extra,
      ])
        paints.push({layer: resultId, property: entry.property, template: entry.template, follows});
      if (result.visibility)
        switches.push({
          layer: resultId,
          group: 'layout',
          property: 'visibility',
          values: result.visibility,
        });
      else for (const entry of ownSwitches) switches.push({layer: resultId, ...entry});
    }
    return results.map((result) => result.layer);

    /** One copy per theme with that theme's switched values; only the nearest one is shown. */
    function switchLayer() {
      switchedLayers += variants.length;
      return variants.map((_, theme) => {
        const copyPaint: Record<string, unknown> = {...paint};
        const copyLayout: Record<string, unknown> = {...layout};
        for (const entry of ownSwitches) {
          const target = entry.group === 'paint' ? copyPaint : copyLayout;
          const value = entry.values[theme];
          if (value === undefined) delete target[entry.property];
          else target[entry.property] = value;
        }
        const shown = copyLayout.visibility === 'none' ? 'none' : 'visible';
        return {
          layer: {...planned, id: `${id}::theme-${theme}`, paint: copyPaint, layout: copyLayout},
          extra: [],
          visibility: variants.map((__, nearest) => (nearest === theme ? shown : 'none')),
        };
      });
    }

    /** Data-driven values split into one camera-only layer per branch, or undefined. */
    function splitLayer() {
      if (isLegacyFilter(layer.filter)) return undefined;
      const branches = splitBranches(
        Object.fromEntries(
          driven.map((property) => [
            property,
            variants.map((variant) => paintOf(variant)[property]),
          ]),
        ),
      );
      if (!branches) return undefined;
      const groups = new Map<string, {templates: Record<string, unknown>; conditions: unknown[]}>();
      for (const branch of branches) {
        const key = JSON.stringify(branch.valuesByProperty);
        let group = groups.get(key);
        if (!group) {
          const templates: Record<string, unknown> = {};
          for (const [property, values] of Object.entries(branch.valuesByProperty)) {
            const template = tryMixTemplate(values);
            if (template === undefined) return undefined;
            templates[property] = template;
          }
          group = {templates, conditions: []};
          groups.set(key, group);
        }
        group.conditions.push(
          branch.conditions.length === 1 ? branch.conditions[0] : ['all', ...branch.conditions],
        );
      }
      splitLayers += groups.size;
      return [...groups.values()].map((group, number) => {
        const chosen =
          group.conditions.length === 1 ? group.conditions[0] : ['any', ...group.conditions];
        return {
          layer: {
            ...planned,
            id: `${id}::branch-${number}`,
            filter: layer.filter === undefined ? chosen : ['all', layer.filter, chosen],
            paint: {...paint, ...group.templates},
          },
          extra: Object.entries(group.templates)
            .filter(([, template]) => containsLeaf(template))
            .map(([property, template]) => ({property, template})),
        };
      });
    }

    /** One copy per theme, cross-faded by opacity, for values that cannot be split. */
    function copyLayer() {
      const opacity = opacityProperties[type];
      if (!opacity || variants.some((variant) => isDataDriven(paintOf(variant)[opacity])))
        return undefined;
      copiedLayers += variants.length;
      return variants.map((variant, theme) => {
        const weight = new BlendLeaf(variants.map((_, other) => (other === theme ? 1 : 0)));
        const template = scaleByWeight(paint[opacity] ?? 1, weight);
        const copyPaint: Record<string, unknown> = {...paint, [opacity]: template};
        for (const property of driven) copyPaint[property] = paintOf(variant)[property];
        return {
          layer: {...planned, id: `${id}::theme-${theme}`, paint: copyPaint},
          extra: [{property: opacity, template}],
        };
      });
    }
  }
}

/** Fills one blend template for a position. Plain values pass through unchanged. */
export function fillTileflowThemeBlendTemplate(template: unknown, position: number): unknown {
  return fillTemplate(template, position);
}

/** Two CSS colours mixed in OKLab, `t` of the way from the first; undefined unless both parse. */
export function mixTileflowColours(from: string, to: string, t: number): string | undefined {
  const a = oklab(from);
  const b = oklab(to);
  if (!a || !b) return undefined;
  return colourFromOklab(a.map((value, channel) => value + (b[channel]! - value) * t));
}

/**
 * Whether MapLibre evaluates a value per feature: it reads feature properties, state, identity,
 * or geometry. Writing such a value at run time re-lays its source out.
 */
export function readsTileflowFeatureData(value: unknown): boolean {
  return isDataDriven(value) || reads(value, 'within') || reads(value, 'distance');
}

function fillLayer(
  layer: Record<string, unknown>,
  position: number,
  dominant: number,
  layerSwitches: readonly TileflowThemeBlendSwitch[] | undefined,
): Record<string, unknown> {
  const filled: Record<string, unknown> = {...layer};
  for (const group of ['layout', 'paint'] as const) {
    const values = layer[group] as Record<string, unknown> | undefined;
    if (!values) continue;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) out[key] = fillTemplate(value, position);
    for (const entry of layerSwitches ?? []) {
      if (entry.group !== group) continue;
      const value = entry.values[dominant];
      if (value === undefined) delete out[entry.property];
      else out[entry.property] = value;
    }
    if (Object.keys(out).length > 0) filled[group] = out;
    else delete filled[group];
  }
  return filled;
}

function fillTemplate(node: unknown, position: number): unknown {
  if (node instanceof BlendLeaf) return mixLeaf(node.values, position);
  if (Array.isArray(node)) return node.map((item) => fillTemplate(item, position));
  if (node && typeof node === 'object' && containsLeaf(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, fillTemplate(value, position)]),
    );
  }
  return node;
}

function containsLeaf(node: unknown): boolean {
  if (node instanceof BlendLeaf) return true;
  if (Array.isArray(node)) return node.some(containsLeaf);
  if (node && typeof node === 'object') return Object.values(node).some(containsLeaf);
  return false;
}

function mixLeaf(values: readonly (number | string)[], position: number): number | string {
  const at = clampPosition(position, values.length);
  const index = Math.min(values.length - 2, Math.floor(at));
  const t = at - index;
  const from = values[index]!;
  const to = values[index + 1]!;
  if (t <= 0 || from === to) return from;
  if (t >= 1) return to;
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t;
  const a = oklab(String(from));
  const b = oklab(String(to));
  if (!a || !b) return t < 0.5 ? from : to;
  return colourFromOklab(a.map((value, channel) => value + (b[channel]! - value) * t));
}

function clampPosition(position: number, themes: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.min(themes - 1, Math.max(0, position));
}

function assertSameStructure(styles: readonly MapLibreStyle[], base: MapLibreStyle): void {
  const ids = (style: MapLibreStyle) => style.layers.map((layer) => layer.id);
  for (const style of styles) {
    if (!same(ids(style), ids(base)))
      throw new TileflowThemeBlendError(
        'Blended themes must have the same layers in the same order.',
      );
    if (!same(style.sources, base.sources))
      throw new TileflowThemeBlendError('Blended themes must use the same sources.');
    if (!same(style.sprite, base.sprite) || !same(style.glyphs, base.glyphs))
      throw new TileflowThemeBlendError('Blended themes must use the same sprite and glyphs.');
    for (const [index, layer] of style.layers.entries()) {
      const other = base.layers[index]!;
      for (const key of ['type', 'source', 'source-layer', 'filter', 'minzoom', 'maxzoom'])
        if (!same(layer[key], other[key]))
          throw new TileflowThemeBlendError(
            `Blended themes differ in ${key} of layer ${JSON.stringify(layer.id)}.`,
          );
    }
  }
}

function propertyNames(variants: Record<string, unknown>[], group: 'layout' | 'paint'): string[] {
  const names = new Set<string>();
  for (const variant of variants)
    for (const name of Object.keys((variant[group] as object | undefined) ?? {})) names.add(name);
  return [...names];
}

/** A root value (sky or light) as a template when it differs between themes. */
function differingRoot(styles: readonly MapLibreStyle[], key: 'light' | 'sky'): unknown {
  const values = styles.map((style) => style[key] as unknown);
  if (values.every((value) => same(value, values[0]))) return undefined;
  return tryMixTemplate(values);
}

/** Each first-theme image name may stand for one set of artworks only, wherever it is mixed. */
function collectImageNames(
  styles: readonly MapLibreStyle[],
  base: MapLibreStyle,
  properties: ReadonlySet<string>,
): Map<string, Set<string>> {
  const uses = new Map<string, Set<string>>();
  for (const [index] of base.layers.entries()) {
    for (const group of ['layout', 'paint'] as const) {
      for (const property of properties) {
        const values = styles.map(
          (style) =>
            (style.layers[index]?.[group] as Record<string, unknown> | undefined)?.[property],
        );
        if (values[0] === undefined) continue;
        for (const names of imageTuples(values) ?? []) {
          const set = uses.get(names[0]!) ?? new Set<string>();
          set.add(JSON.stringify(names));
          uses.set(names[0]!, set);
        }
      }
    }
  }
  return uses;
}

/**
 * Tileflow's interaction metadata names each POI layer with a priority equal to its index in the
 * style. Split and copied layers move later layers, so the planned style carries the new indices.
 */
function alignInteractionManifest(
  metadata: unknown,
  layers: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) return undefined;
  // A planned layer ID is the original, or the original followed by `::` and a branch or theme.
  const planned = new Map<string, {id: string; index: number}[]>();
  for (const [index, layer] of layers.entries()) {
    const id = String(layer.id);
    const original = /^(.+)::(?:branch|theme)-\d+$/u.exec(id)?.[1] ?? id;
    planned.set(original, [...(planned.get(original) ?? []), {id, index}]);
  }
  let aligned: Record<string, unknown> | undefined;
  const interactions = metadata['tileflow:interaction-manifest'];
  const domains = isRecord(interactions) ? interactions.domains : undefined;
  if (isRecord(interactions) && isRecord(domains) && isRecord(domains.poi)) {
    const poi = domains.poi;
    if (Array.isArray(poi.layers)) {
      // Every planned copy of a POI layer answers for it; only the shown copies have features.
      const poiLayers = poi.layers.flatMap((entry: unknown) => {
        if (!isRecord(entry) || typeof entry.layerId !== 'string') return [entry];
        const copies = planned.get(entry.layerId);
        if (!copies) return [entry];
        return copies.map(({id, index}) => ({...entry, layerId: id, priority: index}));
      });
      aligned = {
        ...metadata,
        'tileflow:interaction-manifest': {
          ...interactions,
          domains: {...domains, poi: {...poi, layers: poiLayers}},
        },
      };
    }
  }
  const overlays = metadata['tileflow:overlay-placement-manifest'];
  if (isRecord(overlays) && isRecord(overlays.anchors)) {
    // Anchors insert before a layer; an expanded layer starts at its first planned copy.
    const anchors = Object.fromEntries(
      Object.entries(overlays.anchors).map(([placement, anchor]) => [
        placement,
        typeof anchor === 'string' ? (planned.get(anchor)?.[0]?.id ?? anchor) : anchor,
      ]),
    );
    aligned = {
      ...(aligned ?? metadata),
      'tileflow:overlay-placement-manifest': {...overlays, anchors},
    };
  }
  return aligned;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The image names an image value can show across themes, as tuples, read only from the output
 * positions of the expressions that choose them. Undefined when the themes build their names in a
 * way this module cannot follow, such as names read from feature data or concatenated.
 */
function imageTuples(values: readonly unknown[], out: string[][] = []): string[][] | undefined {
  const [first] = values;
  if (values.every((value) => typeof value === 'string')) {
    out.push(values as string[]);
    return out;
  }
  if (!Array.isArray(first) || typeof first[0] !== 'string') {
    return values.every((value) => same(value, first)) ? out : undefined;
  }
  const operator = first[0];
  if (
    !values.every(
      (value) => Array.isArray(value) && value[0] === operator && value.length === first.length,
    )
  ) {
    return undefined;
  }
  const at = (index: number) => values.map((value) => (value as unknown[])[index]);
  const sameAt = (index: number) => at(index).every((value) => same(value, first[index]));
  const outputs: number[] = [];
  if (operator === 'literal' || operator === 'image') outputs.push(1);
  else if (operator === 'coalesce')
    for (let index = 1; index < first.length; index += 1) outputs.push(index);
  else if (operator === 'match') {
    if (!sameAt(1)) return undefined;
    for (let index = 2; index < first.length - 1; index += 2) {
      if (!sameAt(index)) return undefined;
      outputs.push(index + 1);
    }
    outputs.push(first.length - 1);
  } else if (operator === 'case') {
    for (let index = 1; index < first.length - 1; index += 2) {
      if (!sameAt(index)) return undefined;
      outputs.push(index + 1);
    }
    outputs.push(first.length - 1);
  } else if (operator === 'step') {
    if (!sameAt(1)) return undefined;
    outputs.push(2);
    for (let index = 3; index < first.length; index += 2) {
      if (!sameAt(index)) return undefined;
      outputs.push(index + 1);
    }
  } else {
    return values.every((value) => same(value, first)) ? out : undefined;
  }
  for (const index of outputs) if (!imageTuples(at(index), out)) return undefined;
  return out;
}

/** One value across themes as a template, or undefined when its shapes differ. */
function tryMixTemplate(values: readonly unknown[]): unknown {
  const [first] = values;
  if (values.every((value) => same(value, first))) return first;
  if (
    Array.isArray(first) &&
    first[0] !== 'literal' &&
    values.every((value) => Array.isArray(value) && value.length === first.length)
  ) {
    const items: unknown[] = [];
    for (let index = 0; index < first.length; index += 1) {
      const item = tryMixTemplate(values.map((value) => (value as unknown[])[index]));
      if (item === undefined && (first as unknown[])[index] !== undefined) return undefined;
      items.push(item);
    }
    return items;
  }
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const keys = Object.keys(first);
    if (
      !values.every((value) => value && typeof value === 'object' && same(Object.keys(value), keys))
    )
      return undefined;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const item = tryMixTemplate(values.map((value) => (value as Record<string, unknown>)[key]));
      if (item === undefined) return undefined;
      out[key] = item;
    }
    return out;
  }
  if (values.every((value) => typeof value === 'number')) return new BlendLeaf(values as number[]);
  if (values.every((value) => typeof value === 'string' && oklab(value)))
    return new BlendLeaf(values as string[]);
  return undefined;
}

function isDataDriven(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (typeof value[0] === 'string' && featureOperators.has(value[0])) return true;
  return value.some(isDataDriven);
}

const reads = (value: unknown, operator: string): boolean =>
  Array.isArray(value) && (value[0] === operator || value.some((item) => reads(item, operator)));

type Decision = {index: unknown[]; outputs: unknown[]};

/** The decision a node makes on feature data: its branch index expression and its outputs. */
function decisionOf(node: unknown): Decision | undefined {
  if (!Array.isArray(node) || typeof node[0] !== 'string') return undefined;
  const [operator] = node;
  if (operator === 'match' && isDataDriven(node[1])) {
    const labels: unknown[] = [];
    const outputs: unknown[] = [];
    for (let index = 2; index < node.length - 1; index += 2) {
      labels.push(node[index]);
      outputs.push(node[index + 1]);
    }
    outputs.push(node.at(-1));
    return {
      index: ['match', node[1], ...labels.flatMap((label, index) => [label, index]), labels.length],
      outputs,
    };
  }
  if (operator === 'case') {
    const conditions: unknown[] = [];
    const outputs: unknown[] = [];
    for (let index = 1; index < node.length - 1; index += 2) {
      conditions.push(node[index]);
      outputs.push(node[index + 1]);
    }
    outputs.push(node.at(-1));
    if (!conditions.some(isDataDriven)) return undefined;
    return {
      index: [
        'case',
        ...conditions.flatMap((condition, index) => [condition, index]),
        conditions.length,
      ],
      outputs,
    };
  }
  if (operator === 'step' && isDataDriven(node[1])) {
    const outputs: unknown[] = [node[2]];
    const stops: unknown[] = [];
    for (let index = 3; index < node.length; index += 2) {
      stops.push(node[index]);
      outputs.push(node[index + 1]);
    }
    return {
      index: ['step', node[1], 0, ...stops.flatMap((stop, index) => [stop, index + 1])],
      outputs,
    };
  }
  return undefined;
}

function firstDecision(value: unknown): Decision | undefined {
  const decision = decisionOf(value);
  if (decision) return decision;
  if (!Array.isArray(value) || value[0] === 'literal') return undefined;
  for (const item of value) {
    const found = firstDecision(item);
    if (found) return found;
  }
  return undefined;
}

/** The expression with every occurrence of one decision replaced by its output on one branch. */
function choose(value: unknown, key: string, branch: number): unknown {
  const decision = decisionOf(value);
  if (decision && JSON.stringify(decision.index) === key)
    return choose(decision.outputs[branch], key, branch);
  if (!Array.isArray(value) || value[0] === 'literal') return value;
  return value.map((item) => choose(item, key, branch));
}

type Branch = {conditions: unknown[]; valuesByProperty: Record<string, unknown[]>};

/**
 * Splits data-driven values (one array of per-theme values per property) into branches whose
 * values read no feature data, each with the conditions a feature meets to take it. Undefined
 * when a decision reads zoom or feature state, feature data is used continuously, or the branches
 * exceed the bound.
 */
function splitBranches(
  valuesByProperty: Record<string, unknown[]>,
  conditions: unknown[] = [],
): Branch[] | undefined {
  let decision: Decision | undefined;
  for (const values of Object.values(valuesByProperty)) {
    decision = firstDecision(values[0]);
    if (decision) break;
  }
  if (!decision) {
    const residual = Object.values(valuesByProperty).some((values) => values.some(isDataDriven));
    return residual ? undefined : [{conditions, valuesByProperty}];
  }
  if (reads(decision.index, 'zoom') || reads(decision.index, 'feature-state')) return undefined;
  const key = JSON.stringify(decision.index);
  const branches: Branch[] = [];
  for (let branch = 0; branch < decision.outputs.length; branch += 1) {
    const chosen = Object.fromEntries(
      Object.entries(valuesByProperty).map(([property, values]) => [
        property,
        values.map((value) => choose(value, key, branch)),
      ]),
    );
    const nested = splitBranches(chosen, [...conditions, ['==', decision.index, branch]]);
    if (!nested) return undefined;
    branches.push(...nested);
    if (branches.length > maximumBranches) return undefined;
  }
  return branches;
}

const isLegacyFilter = (filter: unknown): boolean =>
  Array.isArray(filter) && typeof filter[1] === 'string' && !Array.isArray(filter[1]);

/** An opacity scaled by a weight; zoom curves stay at the top, so the weight goes inside. */
function scaleByWeight(opacity: unknown, weight: BlendLeaf): unknown {
  const input = Array.isArray(opacity)
    ? opacity[0] === 'interpolate'
      ? opacity[2]
      : opacity[1]
    : undefined;
  if (
    Array.isArray(opacity) &&
    (opacity[0] === 'interpolate' || opacity[0] === 'step') &&
    reads(input, 'zoom')
  ) {
    const head = opacity[0] === 'interpolate' ? 3 : 2;
    return opacity.map((item, index) =>
      index >= head && (index - head) % 2 === (opacity[0] === 'interpolate' ? 1 : 0)
        ? scaleByWeight(item, weight)
        : item,
    );
  }
  if (typeof opacity === 'number')
    return new BlendLeaf(weight.values.map((value) => opacity * Number(value)));
  return ['*', opacity, weight];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const oklabCache = new Map<string, readonly number[] | null>();

/** A CSS colour as OKLab with alpha, or null when it is not a colour this module mixes. */
function oklab(colour: string): readonly number[] | null {
  const cached = oklabCache.get(colour);
  if (cached !== undefined) return cached;
  const rgba = parseColour(colour);
  let result: readonly number[] | null = null;
  if (rgba) {
    const [r, g, b] = rgba.slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    result = [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      rgba[3]!,
    ];
  }
  if (oklabCache.size > 4096) oklabCache.clear();
  oklabCache.set(colour, result);
  return result;
}

function colourFromOklab([lightness, a, b, alpha]: readonly number[]): string {
  const l = (lightness! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (lightness! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (lightness! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  const [red, green, blue] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((value) => {
    const clamped = Math.min(1, Math.max(0, value));
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha!.toFixed(3))})`;
}

/** Hex, rgb(a), and hsl(a) colours as 0–255 channels and 0–1 alpha. */
function parseColour(colour: string): [number, number, number, number] | null {
  const text = colour.trim().toLowerCase();
  const hex = /^#([\da-f]{3,8})$/u.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const channels = full.match(/../gu)!.map((pair) => Number.parseInt(pair, 16));
    return [channels[0]!, channels[1]!, channels[2]!, channels.length > 3 ? channels[3]! / 255 : 1];
  }
  const functional = /^(rgba?|hsla?)\(([^)]+)\)$/u.exec(text);
  if (!functional) return null;
  const parts = functional[2]!.split(/[\s,/]+/u).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts[3] === undefined ? 1 : parseUnit(parts[3], 1);
  if (functional[1]!.startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((part) => parseUnit(part, 255));
    if ([r, g, b, alpha].some((value) => value === null)) return null;
    return [r!, g!, b!, alpha!];
  }
  const hue = Number.parseFloat(parts[0]!);
  const saturation = parseUnit(parts[1]!, 1);
  const light = parseUnit(parts[2]!, 1);
  if (!Number.isFinite(hue) || saturation === null || light === null || alpha === null) return null;
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r1, g1, b1] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = light - chroma / 2;
  return [(r1 + offset) * 255, (g1 + offset) * 255, (b1 + offset) * 255, alpha];
}

/** A CSS number or percentage scaled to `scale`; null when it is neither. */
function parseUnit(part: string, scale: number): number | null {
  const percentage = part.endsWith('%');
  const value = Number.parseFloat(part);
  if (!Number.isFinite(value)) return null;
  return percentage ? (value / 100) * scale : value;
}
