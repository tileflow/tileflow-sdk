import {
  defineMap,
  resolveMap,
  type TileflowStreetsModules,
  type TileflowThemeConfig,
} from '@tileflow/core';
import {
  addModuleLayer,
  defineModuleEffects,
  getResolvedModuleEffects,
  type TileflowModuleEffect,
} from '@tileflow/core/recipe';
import {cyberpunkFonts, matrixIcons, streetsIcons} from '../assets';
import {cyberpunk} from './cyberpunk';

/**
 * Matrix keeps Cyberpunk's sparse HUD geometry but collapses every authored
 * color into one reviewed phosphor-green ramp. Grouping the source literals
 * here makes a future Cyberpunk color fail closed instead of leaking another
 * hue into this deliberately monochrome map.
 */
const matrixColorGroups = {
  '#010704': ['#010208', '#03050B'],
  '#020D06': ['#060B18'],
  '#031509': ['#020A20'],
  '#05210E': [
    '#06152E',
    '#061634',
    '#061737',
    '#071733',
    '#071E31',
    '#082229',
    '#09142A',
    '#0A2425',
    '#0C1528',
    '#0D2828',
    '#0D2928',
    '#0F2527',
    '#102826',
    '#102A2A',
    '#102F2D',
    '#11182B',
    '#201E14',
    '#29132A',
  ],
  '#082F15': [
    '#06183A',
    '#071A3F',
    '#071B43',
    '#081F47',
    '#091B43',
    '#0A1D48',
    '#0A2143',
    '#0A2146',
    '#0B1944',
    '#10183F',
    '#101C42',
    '#10302D',
    '#10312E',
    '#11352F',
    '#121638',
    '#163D38',
    '#173A36',
    '#1A2138',
    '#302A12',
    '#351235',
  ],
  '#0C421D': ['#0B2C4A', '#433812', '#48123F', '#5A4B0E'],
  '#115827': ['#123469', '#292D4B', '#2A405F', '#5B144D'],
  '#197234': ['#168F96', '#1B447A', '#33486F'],
  '#23933F': ['#274A99', '#45608C'],
  '#30B94E': ['#28D7A5', '#AAA13D', '#B64996'],
  '#43DB60': ['#147DFF', '#2CF58A', '#D654B5', '#D6CA3D', '#E63BB0', '#E82098', '#FF9F1C'],
  '#63F77B': [
    '#43E4FF',
    '#6C8CCB',
    '#7657FF',
    '#F24CB6',
    '#F3E941',
    '#F8EF42',
    '#FF4D6D',
    '#FF4D87',
    '#FF5CCF',
    '#FF8A3D',
  ],
  '#87FF98': ['#8EB8FF', '#8EBBFF', '#9D73FF', '#FF668C', '#FF809F', '#FF86DD', '#FFF27A'],
  '#B3FFC0': ['#B69BFF', '#B9CDEF', '#FFF7B2'],
  '#D9FFDE': ['#EAF6FF', '#FFE6F6', '#FFF4FB', '#FFFFFF'],
} as const;

const matrixColorMap = new Map<string, string>([
  ...Object.entries(matrixColorGroups).flatMap(([replacement, originals]) =>
    originals.map((original) => [original, replacement] as const),
  ),
  ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
]);

const matrixAssetIdMap = new Map<string, string>([
  ['cyber-data-grid', 'matrix-data-grid'],
  ['cyber-target-brackets', 'matrix-poi-node'],
  ['cyberpunk-destination-target-brackets', 'matrix-destination-poi-node'],
]);

const omittedMatrixEffectTargets = new Set([
  'buildings.effects.circuitFill',
  'roads.effects.principalNeon.core',
]);

const colorLiteralPattern = /^(?:#[0-9a-f]+|hsla?\(|rgba?\()/iu;

function selectMatrixEffects(
  effects: readonly TileflowModuleEffect[],
): readonly TileflowModuleEffect[] {
  return effects.flatMap((effect) => {
    if (omittedMatrixEffectTargets.has(effect.target)) return [];
    if (effect.kind === 'add' && effect.target === 'buildings.effects.ghostAura') {
      return [{...effect, placement: {after: 'buildings.flat.fill'}}];
    }
    return [effect];
  });
}

function matrixizeValue<T>(value: T, path = 'cyberpunk'): T {
  if (typeof value === 'string') {
    const color = matrixColorMap.get(value);
    if (color !== undefined) return color as T;
    if (colorLiteralPattern.test(value)) {
      throw new Error(`Matrix has no reviewed phosphor color for ${value} at ${path}.`);
    }

    const assetId = matrixAssetIdMap.get(value);
    if (assetId !== undefined) return assetId as T;
    if (value.startsWith('cyberpunk-')) return value.replace('cyberpunk-', 'matrix-') as T;
    if (value.startsWith('cyber-')) {
      throw new Error(
        `Matrix has no reviewed replacement for Cyberpunk asset ${value} at ${path}.`,
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => matrixizeValue(entry, `${path}[${index}]`)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, matrixizeValue(entry, `${path}.${key}`)]),
    ) as T;
  }

  return value;
}

const resolvedCyberpunk = resolveMap(cyberpunk);
const matrixModules = matrixizeValue(
  resolvedCyberpunk.modules ?? {},
  'cyberpunk.modules',
) satisfies TileflowStreetsModules;
const matrixTheme = matrixizeValue(
  resolvedCyberpunk.theme ?? {},
  'cyberpunk.theme',
) satisfies TileflowThemeConfig;
const inheritedMatrixEffects = matrixizeValue<readonly TileflowModuleEffect[]>(
  selectMatrixEffects(getResolvedModuleEffects(resolvedCyberpunk)),
  'cyberpunk.effects',
);
const matrixEffects: readonly TileflowModuleEffect[] = [
  ...inheritedMatrixEffects,
  addModuleLayer(
    'labels',
    'labels.effects.crtMask',
    {
      id: 'matrix-crt-mask',
      type: 'background',
      metadata: {'tileflow:module': 'labels'},
      paint: {
        'background-opacity': 0.84,
        'background-pattern': 'matrix-crt-scanlines',
      },
    },
    {before: 'labels.roads.motorway'},
    {requires: ['roads']},
  ),
];

export const matrix = defineMap({
  id: 'matrix',
  version: 1,
  name: 'Matrix',
  extends: cyberpunk,
  fonts: [cyberpunkFonts],
  icons: [streetsIcons, matrixIcons],
  light: {
    anchor: 'viewport',
    color: '#B3FFC0',
    intensity: 0.08,
    position: [1.15, 210, 40],
  },
  modules: matrixModules,
  ...defineModuleEffects(matrixEffects),
  theme: matrixTheme,
  view: {
    bearing: 0,
    center: [-3.6942, 40.4146],
    pitch: 0,
    zoom: 15.25,
  },
});
