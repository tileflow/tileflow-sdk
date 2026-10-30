import {parseResolvedTileflowMap, tileflowStyleFontFacesMetadataKey} from '@tileflow/core';
import {createStyleFromCatalogWithInspection} from '@tileflow/core/build';
import type {TileflowBuildArtifacts} from './artifacts';

type ControlValue = string | number | boolean;
type ModulePatch = {
  enabled?: boolean;
  mode?: string;
  fallback?: string;
  visible?: boolean;
  threeDimensional?: Record<string, ControlValue>;
};
const moduleNames = [
  'land',
  'water',
  'nautical',
  'roads',
  'boundaries',
  'labels',
  'poi',
  'aeroways',
  'transit',
  'addresses',
  'landforms',
  'buildings',
  'vegetation',
];
const fieldRules: Record<string, readonly (string | number)[] | 'boolean'> = {
  'buildings.mode': ['flat', '3d'],
  'buildings.threeDimensional.lighting': ['style', 'sun'],
  'buildings.threeDimensional.shadows': 'boolean',
  'buildings.threeDimensional.occlusion': 'boolean',
  'buildings.threeDimensional.windows': 'boolean',
  'buildings.threeDimensional.edges': [0, 1],
  'buildings.threeDimensional.colorVariation': [0, 1],
  'buildings.threeDimensional.nightLight': [0, 2],
  'vegetation.mode': ['3d', 'flat', 'auto'],
  'vegetation.fallback': ['flat', 'none'],
  'vegetation.visible': 'boolean',
  'vegetation.threeDimensional.finish': ['faceted', 'smooth', 'toon'],
  'vegetation.threeDimensional.edges': [0, 1],
  'vegetation.threeDimensional.heightScale': [0, 10],
  'vegetation.threeDimensional.crownScale': [0, 10],
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parsePreviewControls(text: string): Record<string, ModulePatch> {
  if (text.length > 8192) throw new Error('Map controls exceed 8 KiB.');
  const input: unknown = JSON.parse(text);
  if (!record(input)) throw new Error('Map controls must be an object.');
  for (const [module, patch] of Object.entries(input)) {
    if (!moduleNames.includes(module) || !record(patch))
      throw new Error('Unknown map control module: ' + module);
    const validate = (path: string, value: unknown) => {
      const rule = path === module + '.enabled' ? 'boolean' : fieldRules[path];
      const valid =
        rule === 'boolean'
          ? typeof value === 'boolean'
          : rule &&
            (typeof rule[0] === 'number'
              ? typeof value === 'number' &&
                Number.isFinite(value) &&
                value >= rule[0] &&
                value <= (rule[1] as number)
              : typeof value === 'string' && rule.includes(value));
      if (!valid) throw new Error('Invalid map control: ' + path);
    };
    for (const [key, value] of Object.entries(patch)) {
      if (
        key === 'threeDimensional' &&
        record(value) &&
        ['buildings', 'vegetation'].includes(module)
      ) {
        for (const [nested, entry] of Object.entries(value))
          validate(module + '.' + key + '.' + nested, entry);
      } else validate(module + '.' + key, value);
    }
  }
  return input as Record<string, ModulePatch>;
}

export type PreviewControlField = {
  path: string;
  label: string;
  value: string | number | boolean;
  choices?: readonly string[];
  /** Offer Auto as an unset override, following the map's authored value. */
  inherit?: boolean;
  min?: number;
  max?: number;
  step?: number;
};

export function describePreviewControls(
  artifacts: TileflowBuildArtifacts,
  map: string,
  theme: string,
) {
  const definition = artifacts.project.maps[map];
  const style = artifacts.styles[map]?.[theme];
  if (!definition || !style) throw new Error('Unknown map theme.');
  const modules = definition.modules ?? {};
  const metadata = style.metadata ?? {};
  return {
    map,
    theme,
    modules: moduleNames.map((id) => {
      const config = modules[id as keyof typeof modules] ?? {type: id};
      const fields: PreviewControlField[] = [];
      const record = config as unknown as Record<string, unknown>;
      const add = (
        path: string,
        label: string,
        value: PreviewControlField['value'],
        choices?: string[],
        min?: number,
        max?: number,
        step?: number,
        inherit = false,
      ) =>
        fields.push({
          path,
          label,
          value,
          ...(choices ? {choices} : {}),
          ...(inherit ? {inherit: true} : {}),
          ...(min !== undefined ? {min, max, step} : {}),
        });
      if (id === 'buildings') {
        const design = metadata['tileflow:buildings'] as Record<string, unknown> | undefined;
        const authored = record.threeDimensional as Record<string, unknown> | undefined;
        const value = (key: string, fallback: string | number | boolean) => {
          const resolved = design?.[key] ?? authored?.[key];
          return typeof resolved === typeof fallback
            ? (resolved as PreviewControlField['value'])
            : fallback;
        };
        add('threeDimensional.lighting', 'Building light', value('lighting', 'style'), [
          'style',
          'sun',
        ]);
        for (const [key, label] of [
          ['shadows', 'Cast shadows'],
          ['occlusion', 'Contact shadows'],
          ['windows', 'Night windows'],
        ])
          add('threeDimensional.' + key, label!, value(key!, false));
        for (const [key, label] of [
          ['edges', 'Edge definition'],
          ['colorVariation', 'Color variation'],
          ['nightLight', 'Night glow'],
        ])
          add(
            'threeDimensional.' + key,
            label!,
            value(key!, 0),
            undefined,
            0,
            key === 'nightLight' ? 2 : 1,
            0.05,
          );
      }
      if (id === 'vegetation') {
        add(
          'mode',
          'Tree representation',
          String(record.mode ?? '3d'),
          ['3d', 'auto', 'flat'],
          undefined,
          undefined,
          undefined,
          true,
        );
        add('fallback', 'Without 3D support', String(record.fallback ?? 'flat'), ['flat', 'none']);
        add('visible', 'Visible by default', record.visible !== false);
        const authored = record.threeDimensional as Record<string, unknown> | undefined;
        const design = metadata['tileflow:vegetation'] as Record<string, unknown> | undefined;
        add('threeDimensional.finish', 'Tree finish', String(authored?.finish ?? 'faceted'), [
          'faceted',
          'smooth',
          'toon',
        ]);
        for (const [key, label] of [
          ['heightScale', 'Tree height'],
          ['crownScale', 'Crown size'],
        ]) {
          const value = design?.[key!] ?? authored?.[key!];
          add(
            'threeDimensional.' + key,
            label!,
            typeof value === 'number' ? value : 1,
            undefined,
            0,
            10,
            0.1,
          );
        }
      }
      return {id, enabled: record.enabled !== false, fields};
    }),
  };
}

/** Reuses this generation's assets and delivery URLs; changes only semantic modules. */
export function compilePreviewControls(
  artifacts: TileflowBuildArtifacts,
  map: string,
  theme: string,
  text: string,
  apiBaseUrl: string,
) {
  if (artifacts.nativeBuild) throw new Error('Map controls require a web preview.');
  const overrides = parsePreviewControls(text);
  const definition = artifacts.project.maps[map];
  const base = artifacts.styles[map]?.[theme];
  if (!definition || !base) throw new Error('Unknown map theme.');
  const modules = {...definition.modules};
  for (const [id, patch] of Object.entries(overrides)) {
    const key = id as keyof typeof modules;
    const original = modules[key] ?? {type: id};
    const merged = {...original, ...patch};
    if ('threeDimensional' in patch && patch.threeDimensional)
      Object.assign(merged, {
        threeDimensional: {
          ...('threeDimensional' in original ? original.threeDimensional : {}),
          ...patch.threeDimensional,
        },
      });
    Object.assign(modules, {[id]: merged});
  }
  const resolved = parseResolvedTileflowMap({...definition, modules});
  const result = createStyleFromCatalogWithInspection(
    {...artifacts.project, maps: {...artifacts.project.maps, [map]: resolved}},
    map,
    {
      theme,
      apiBaseUrl,
      preparedAssets: artifacts.mapAssets?.[map],
    },
  );
  // Local fonts and PMTiles have already been prepared and pinned by the owning session.
  result.style.sources = Object.fromEntries(
    Object.entries(result.style.sources).map(([id, source]) => [id, base.sources[id] ?? source]),
  );
  if (base.glyphs) result.style.glyphs = base.glyphs;
  if (base.sprite) result.style.sprite = base.sprite;
  if (base.metadata?.[tileflowStyleFontFacesMetadataKey])
    result.style.metadata = {
      ...result.style.metadata,
      [tileflowStyleFontFacesMetadataKey]: base.metadata[tileflowStyleFontFacesMetadataKey],
    };
  return result;
}
