import {z} from 'zod';
import {tileflowLayerDomainMetadataKey} from './layer-domain';
import {
  readTileflowNativeDegradations,
  resolveTileflowNativeCompatibility,
  tileflowNativeCompatibilitySchema,
  tileflowNativeDegradationsSchema,
} from './native-capabilities';
import {strictNativeObject} from './native-zod-object';
import {readTileflowNotices} from './notices';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';
import {tileflowStyleRouteInks} from './route-inks';
import {readTileflowSunPreset, tileflowStyleSunPreset} from './sun';

// Blending suns and route inks needs nothing the family does not hold; native evaluators follow
// these rules (azimuths the short way round, colours in OKLab, numbers linearly).
export {mixTileflowRouteInks} from './route-inks';
export {mixTileflowSunPresets} from './sun';
import {
  createTileflowThemeBlendTemplate,
  fillTileflowThemeBlendTemplate,
  mixTileflowColours,
  planTileflowThemeBlend,
  readsTileflowFeatureData,
  TileflowThemeBlendError,
  type TileflowThemeBlendOptions,
  type TileflowThemeBlendPlan,
  tileflowThemeBlendLeafValues,
} from './theme-blend';
import {
  planTileflowEmphasis,
  tileflowEmphasisGround,
  tileflowEmphasisRange,
} from './theme-emphasis';
import type {MapLibreStyle} from './types';

/**
 * A native family document holds what a native map needs to change appearance on the device
 * without Tileflow's JavaScript runtime: every theme's normalized sun, route inks, notices and
 * degradations, an emphasis table per theme, and blend plans for the whole family. Core computes
 * it once, from the prepared native styles, with the same planners the browser uses. Devices only
 * fill templates: see `fillTileflowNativeTemplate`.
 *
 * A template is any JSON value in which a leaf `{"tileflow:leaf": [v0, v1, ...]}` stands for a
 * number or colour that varies. A blend leaf holds one value per theme of its blend group; an
 * emphasis leaf holds the value as designed and fully retracted.
 */
export const tileflowNativeLeafKey = 'tileflow:leaf' as const;
export const tileflowNativeFamilyFileName = 'family.json';
export const tileflowNativeFamilyLimits = Object.freeze({
  maximumBytes: 8 * 1024 * 1024,
  maximumThemes: 64,
  maximumGroups: 64,
});

/** Blend options native renderers need; MapLibre Native keeps no image metadata on pixel swaps. */
export const tileflowNativeBlendOptions: Required<TileflowThemeBlendOptions> = Object.freeze({
  featureSwitches: 'layers',
  iconImages: 'switch',
});

const colourSchema = z.string().min(1).max(64);
const unitSchema = z.number().min(0).max(1);
const json = z.unknown();
const layerReferenceSchema = z.string().min(1).max(256);

const sunSchema = strictNativeObject({
  azimuth: z.number().min(0).max(360),
  altitude: z.number().min(-90).max(90),
  color: colourSchema,
  intensity: unitSchema,
  shadowIntensity: unitSchema,
  ambient: strictNativeObject({color: colourSchema, intensity: unitSchema}),
});
const routeInksSchema = strictNativeObject({
  line: colourSchema,
  casing: colourSchema,
  core: colourSchema,
  glow: colourSchema,
  alternative: colourSchema,
  glowOpacity: unitSchema,
  coreOpacity: unitSchema,
});
const noticeSchema = strictNativeObject({
  id: z.string().min(1).max(64),
  sources: z.array(z.string().min(1).max(64)).max(16),
  text: z.string().min(1).max(120),
});
const emphasisTargetSchema = strictNativeObject({
  layer: layerReferenceSchema,
  property: z.string().min(1).max(64),
  kind: z.enum(['colour', 'fade', 'label']),
  domain: z.string().min(1).max(64),
  featureData: z.boolean(),
  value: json,
});
const themeSchema = strictNativeObject({
  name: tileflowThemeNameSchema,
  colorScheme: z.enum(['dark', 'light']),
  sun: sunSchema,
  /** Whether the theme describes its sun; otherwise `sun` is read from its light or a default. */
  sunPublished: z.boolean(),
  routeInks: routeInksSchema,
  notices: z.array(noticeSchema).max(8),
  degradations: tileflowNativeDegradationsSchema,
  emphasis: strictNativeObject({
    ground: colourSchema.optional(),
    targets: z.array(emphasisTargetSchema).max(4096),
  }),
});
const switchSchema = strictNativeObject({
  layer: layerReferenceSchema,
  group: z.enum(['layout', 'paint']),
  property: z.string().min(1).max(64),
  /** One value per group theme; `null` leaves the property unset. */
  values: z.array(json),
});
const groupSchema = strictNativeObject({
  /** Indices into the family's themes, in declared order. */
  themes: z.array(z.number().int().min(0)).min(2).max(64),
  /** The planned layers, with templates; they replace the theme style's layers. */
  layers: z.array(z.record(z.string(), json)).max(8192),
  paints: z
    .array(
      strictNativeObject({
        layer: layerReferenceSchema,
        property: z.string().min(1).max(64),
        follows: z.enum(['dominant', 'position']),
      }),
    )
    .max(16_384),
  switches: z.array(switchSchema).max(16_384),
  images: z
    .array(
      strictNativeObject({
        names: z.array(z.string().min(1).max(256)),
        follows: z.enum(['dominant', 'position']),
      }),
    )
    .max(4096),
  light: json.optional(),
  /** Style metadata entries whose layer references follow the planned layers. */
  metadata: z.record(z.string(), json).optional(),
  summary: strictNativeObject({
    splitLayers: z.number().int().min(0),
    copiedLayers: z.number().int().min(0),
    switchedLayers: z.number().int().min(0),
    switchedValues: z.number().int().min(0),
  }),
});

export const tileflowNativeFamilySchema = strictNativeObject({
  kind: z.literal('tileflow-native-family'),
  schemaVersion: z.literal(1),
  profile: z.literal('native-v1'),
  map: tileflowPortableIdSchema,
  compatibility: tileflowNativeCompatibilitySchema,
  /** Every theme, in the map's declared order. Indices elsewhere refer to this list. */
  themes: z.array(themeSchema).min(1).max(tileflowNativeFamilyLimits.maximumThemes),
  blend: strictNativeObject({
    options: strictNativeObject({
      featureSwitches: z.literal('layers'),
      iconImages: z.literal('switch'),
    }),
    groups: z.array(groupSchema).max(tileflowNativeFamilyLimits.maximumGroups),
  }),
}).superRefine((family, context) => {
  const names = family.themes.map((theme) => theme.name);
  if (new Set(names).size !== names.length)
    context.addIssue({code: 'custom', path: ['themes'], message: 'Expected unique theme names'});
  const grouped = new Set<number>();
  for (const [index, group] of family.blend.groups.entries()) {
    for (const theme of group.themes) {
      if (theme >= family.themes.length || grouped.has(theme))
        context.addIssue({
          code: 'custom',
          path: ['blend', 'groups', index, 'themes'],
          message: 'Each theme belongs to at most one blend group',
        });
      grouped.add(theme);
    }
    if (
      group.themes.some((theme, position) => position > 0 && theme <= group.themes[position - 1]!)
    )
      context.addIssue({
        code: 'custom',
        path: ['blend', 'groups', index, 'themes'],
        message: 'Expected themes in declared order',
      });
    for (const entry of [...group.switches, ...group.images.map(({names}) => ({values: names}))])
      if (entry.values.length !== group.themes.length)
        context.addIssue({
          code: 'custom',
          path: ['blend', 'groups', index],
          message: 'Expected one value per group theme',
        });
  }
  const expected = resolveTileflowNativeCompatibility(
    Object.fromEntries(family.themes.map((theme) => [theme.name, theme.degradations])),
  );
  if (canonical(expected) !== canonical(family.compatibility))
    context.addIssue({
      code: 'custom',
      path: ['compatibility'],
      message: 'Compatibility must follow the themes’ degradations',
    });
});
export type TileflowNativeFamily = z.infer<typeof tileflowNativeFamilySchema>;
export type TileflowNativeFamilyTheme = TileflowNativeFamily['themes'][number];
export type TileflowNativeBlendGroup = TileflowNativeFamily['blend']['groups'][number];
export type TileflowNativeEmphasisTarget = TileflowNativeFamilyTheme['emphasis']['targets'][number];

/** Parse a family document within its byte budget. */
export function parseTileflowNativeFamily(input: unknown): TileflowNativeFamily {
  const text = canonical(input);
  if (new TextEncoder().encode(text).byteLength > tileflowNativeFamilyLimits.maximumBytes)
    throw new TypeError('A native family document exceeds its byte budget.');
  return tileflowNativeFamilySchema.parse(JSON.parse(text));
}

export type CreateTileflowNativeFamilyInput = Readonly<{
  map: string;
  /** The map's theme names in declared order. */
  themes: readonly string[];
  /** The prepared native style of every theme, with its degradation metadata. */
  styles: Readonly<Record<string, MapLibreStyle>>;
}>;

/** Compute a map's family document from its prepared native styles. Deterministic. */
export function createTileflowNativeFamily(
  input: CreateTileflowNativeFamilyInput,
): TileflowNativeFamily {
  const names = [...input.themes];
  if (
    !names.length ||
    new Set(names).size !== names.length ||
    names.length !== Object.keys(input.styles).length ||
    names.some((name) => !Object.hasOwn(input.styles, name))
  )
    throw new TypeError('A native family needs exactly one style per declared theme.');
  const styles = names.map((name) => input.styles[name]!);
  const themes = names.map((name, index) => familyTheme(name, styles[index]!));
  const family = {
    kind: 'tileflow-native-family',
    schemaVersion: 1,
    profile: 'native-v1',
    map: input.map,
    compatibility: resolveTileflowNativeCompatibility(
      Object.fromEntries(themes.map((theme) => [theme.name, theme.degradations])),
    ),
    themes,
    blend: {
      options: {...tileflowNativeBlendOptions},
      groups: blendGroups(styles).map(({themes: members, plan}) => blendGroup(members, plan)),
    },
  };
  return parseTileflowNativeFamily(family);
}

function familyTheme(name: string, style: MapLibreStyle) {
  const metadata = style.metadata;
  const colorScheme = metadata?.['tileflow:colorScheme'] === 'dark' ? 'dark' : 'light';
  const layers = style.layers;
  const domains = [
    ...new Set(
      layers
        .map((layer) => record(layer.metadata)?.[tileflowLayerDomainMetadataKey])
        .filter((domain): domain is string => typeof domain === 'string'),
    ),
  ].sort();
  const ground = tileflowEmphasisGround(layers);
  // Every target any emphasis can change: each module fully receded and labels fully faded.
  const targets = planTileflowEmphasis(layers, {
    recede: Object.fromEntries(domains.map((domain) => [domain, 1])),
    labels: 0,
  });
  const paints = new Map(layers.map((layer) => [String(layer.id), record(layer.paint) ?? {}]));
  const domainOf = new Map(
    layers.map((layer) => [
      String(layer.id),
      String(record(layer.metadata)?.[tileflowLayerDomainMetadataKey] ?? ''),
    ]),
  );
  const emphasis = targets.flatMap((target) => {
    const value = paints.get(target.layer)?.[target.property];
    const range = tileflowEmphasisRange(target, value, ground);
    if (!range) return [];
    const template = createTileflowThemeBlendTemplate([range.design, range.retracted]);
    if (template === undefined) return [];
    return [
      {
        layer: target.layer,
        property: target.property,
        kind: target.kind,
        domain: domainOf.get(target.layer)!,
        featureData: readsTileflowFeatureData(value),
        value: serializeTemplate(template),
      },
    ];
  });
  const sun = tileflowStyleSunPreset(style);
  return {
    name,
    colorScheme,
    sun: {...sun, ambient: {...sun.ambient}},
    sunPublished: readTileflowSunPreset(metadata) !== undefined,
    routeInks: {...tileflowStyleRouteInks(style, colorScheme)},
    notices: readTileflowNotices(metadata).map((notice) => ({
      id: notice.id,
      sources: [...notice.sources],
      text: notice.text,
    })),
    degradations: readTileflowNativeDegradations(metadata),
    emphasis: {...(ground === undefined ? {} : {ground}), targets: emphasis},
  } satisfies z.input<typeof themeSchema>;
}

/** Themes grouped by the structure blends require, each group planned once in declared order. */
function blendGroups(
  styles: readonly MapLibreStyle[],
): {themes: number[]; plan: TileflowThemeBlendPlan}[] {
  const groups: number[][] = [];
  for (const [index, style] of styles.entries()) {
    const group = groups.find((members) => {
      try {
        planTileflowThemeBlend([styles[members[0]!]!, style], tileflowNativeBlendOptions);
        return true;
      } catch (error) {
        if (error instanceof TileflowThemeBlendError) return false;
        throw error;
      }
    });
    if (group) group.push(index);
    else groups.push([index]);
  }
  return groups
    .filter((members) => members.length > 1)
    .map((members) => ({
      themes: members,
      plan: planTileflowThemeBlend(
        members.map((member) => styles[member]!),
        tileflowNativeBlendOptions,
      ),
    }));
}

const referenceKeys = ['tileflow:interaction-manifest', 'tileflow:overlay-placement-manifest'];

function blendGroup(themes: number[], plan: TileflowThemeBlendPlan) {
  const layers = new Map(plan.layers.map((layer) => [String(layer.id), layer]));
  for (const paint of plan.paints) {
    // Every blended paint value is the planned layer's own template.
    if (record(layers.get(paint.layer)?.paint)?.[paint.property] !== paint.template)
      throw new TypeError('A blend paint does not match its planned layer.');
  }
  const metadata = record(plan.metadata);
  const references = metadata
    ? Object.fromEntries(
        referenceKeys
          .filter((key) => metadata[key] !== undefined)
          .map((key) => [key, metadata[key]]),
      )
    : {};
  return {
    themes,
    layers: plan.layers.map((layer) => serializeTemplate(layer) as Record<string, unknown>),
    paints: plan.paints.map(({layer, property, follows}) => ({layer, property, follows})),
    switches: plan.switches.map(({layer, group, property, values}) => ({
      layer,
      group,
      property,
      values: values.map((value) => (value === undefined ? null : value)),
    })),
    images: plan.images.map(({names, follows}) => ({names: [...names], follows})),
    ...(plan.light === undefined ? {} : {light: serializeTemplate(plan.light)}),
    ...(Object.keys(references).length ? {metadata: references} : {}),
    summary: {...plan.summary},
  };
}

/** A Core template as JSON: each leaf becomes `{"tileflow:leaf": values}`. */
function serializeTemplate(node: unknown): unknown {
  const values = tileflowThemeBlendLeafValues(node);
  if (values) return {[tileflowNativeLeafKey]: [...values]};
  if (Array.isArray(node)) return node.map(serializeTemplate);
  if (node && typeof node === 'object')
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, serializeTemplate(value)]),
    );
  return node;
}

/** The values of a JSON leaf, or undefined for anything else. */
export function tileflowNativeLeafValues(node: unknown): readonly (number | string)[] | undefined {
  const leaf = record(node);
  if (!leaf || Object.keys(leaf).length !== 1) return undefined;
  const values = leaf[tileflowNativeLeafKey];
  return Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => typeof value === 'number' || typeof value === 'string')
    ? (values as (number | string)[])
    : undefined;
}

export type TileflowNativeFillOptions = Readonly<{
  /**
   * The leaf values to blend, in blend order, as indices into each leaf's values: a blend of any
   * subset or order of a group's themes. All values when omitted.
   */
  select?: readonly number[];
  /** Wraps each filled leaf; emphasis uses it to keep an area at full strength. */
  wrap?: (filled: number | string, values: readonly (number | string)[]) => unknown;
}>;

/**
 * Fill a family template at a position, as native evaluators do: each leaf's selected values are
 * mixed `position` of the way along them (1.5 is halfway from the second to the third), numbers
 * linearly and colours in OKLab; anything else passes through unchanged.
 */
export function fillTileflowNativeTemplate(
  template: unknown,
  position: number,
  options: TileflowNativeFillOptions = {},
): unknown {
  const values = tileflowNativeLeafValues(template);
  if (values) {
    const selected = options.select
      ? options.select.map((index) => {
          if (!Number.isInteger(index) || index < 0 || index >= values.length)
            throw new RangeError('A blend selects a theme its leaf does not hold.');
          return values[index]!;
        })
      : values;
    const filled = mixTileflowNativeLeaf(selected, position);
    return options.wrap ? options.wrap(filled, selected) : filled;
  }
  if (Array.isArray(template))
    return template.map((item) => fillTileflowNativeTemplate(item, position, options));
  if (template && typeof template === 'object')
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [
        key,
        fillTileflowNativeTemplate(value, position, options),
      ]),
    );
  return template;
}

/** One leaf's values mixed at a position: the blend rule Core applies in the browser. */
export function mixTileflowNativeLeaf(
  values: readonly (number | string)[],
  position: number,
): number | string {
  if (values.length === 1) return values[0]!;
  // Core's own template and fill rule, so web blends and native evaluators agree.
  const template = createTileflowThemeBlendTemplate(values);
  if (template === undefined) throw new TypeError('A leaf holds values that cannot be mixed.');
  return fillTileflowThemeBlendTemplate(template, position) as number | string;
}

/** Two colours mixed in OKLab, `t` of the way from the first; undefined unless both parse. */
export function mixTileflowNativeColours(from: string, to: string, t: number): string | undefined {
  return mixTileflowColours(from, to, t);
}

/**
 * An emphasis target's value at `t = amount × strength`, from 0 (as designed) to 1. With a keep
 * area, a label value keeps its design inside the area.
 */
export function emphasizeTileflowNativeValue(
  target: Pick<TileflowNativeEmphasisTarget, 'kind' | 'value'>,
  t: number,
  keep?: unknown,
): unknown {
  const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return fillTileflowNativeTemplate(target.value, at, {
    ...(target.kind === 'label' && keep !== undefined
      ? {wrap: (filled, values) => ['case', ['within', keep], values[0], filled]}
      : {}),
  });
}

/**
 * A blend group's layers at a position over selected group themes (indices into the group's
 * `themes`, in blend order): ground values follow the position, symbol layers and switches the
 * nearest selected theme. Images are mixed by the renderer and are not part of this result.
 */
export function tileflowNativeBlendLayers(
  group: TileflowNativeBlendGroup,
  selection: readonly number[],
  position: number,
): Record<string, unknown>[] {
  if (selection.length < 2) throw new RangeError('A blend selects two or more themes.');
  const at = Math.min(selection.length - 1, Math.max(0, Number.isFinite(position) ? position : 0));
  const dominant = Math.round(at);
  const switches = new Map<string, TileflowNativeBlendGroup['switches']>();
  for (const entry of group.switches)
    switches.set(entry.layer, [...(switches.get(entry.layer) ?? []), entry]);
  return group.layers.map((layer) => {
    const filled = fillTileflowNativeTemplate(layer, layer.type === 'symbol' ? dominant : at, {
      select: selection,
    }) as Record<string, unknown>;
    for (const entry of switches.get(String(layer.id)) ?? []) {
      const values = {...record(filled[entry.group])};
      const value = entry.values[selection[dominant]!];
      if (value === null || value === undefined) delete values[entry.property];
      else values[entry.property] = value;
      filled[entry.group] = values;
    }
    // As Core's own blend: a layer without layout or paint values has no such object.
    for (const group of ['layout', 'paint'])
      if (record(filled[group]) && !Object.keys(filled[group] as object).length)
        delete filled[group];
    return filled;
  });
}

/** JSON with sorted object keys, so equal documents compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item,
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
