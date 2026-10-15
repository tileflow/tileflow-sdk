import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyCircleStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {toMapLibreStyleValue, zoom} from '../../cartography/values';
import {
  tileflowDefaultUnknownTreeForms,
  type TileflowVegetation3D,
  tileflowWorldTreeFields,
} from '../../trees-3d';
import type {TileflowResolvedModuleConfig} from '../resolved';
import type {TileflowVegetationModuleConfig} from './index';

export function compileVegetation(
  request: TileflowResolvedModuleConfig<TileflowVegetationModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const minZoom = request?.flat?.minZoom ?? 16;
  const mode = request?.mode ?? '3d';
  const config = mergeTileflowDesign<TileflowResolvedModuleConfig<TileflowVegetationModuleConfig>>(
    {
      type: 'vegetation',
      enabled: true,
      flat: {
        color: context.colors.landcover.wood,
        minZoom,
        opacity: mode === '3d' ? 0.82 : 0.9,
        pitchAlignment: 'map',
        pitchScale: 'map',
        radius:
          minZoom < 24
            ? zoom.linear([
                [minZoom, 2.2],
                [minZoom < 20 ? 20 : 24, 8],
              ])
            : 2.2,
        strokeColor: context.colors.park,
        strokeOpacity: 0.55,
        strokeWidth: 0.8,
      },
      mode,
      threeDimensional: {
        barkColor: context.colors.vegetation.tree.bark,
        broadleafColors: context.colors.vegetation.tree.broadleaf,
        coniferColors: context.colors.vegetation.tree.conifer,
        palmColors: context.colors.vegetation.tree.palm,
        crownScale: 1,
        heightScale: 1,
      },
    },
    request,
  );
  if (config.enabled === false || !context.data.schema.layers.tree) return [];

  const resolvedMode = config.mode ?? '3d';
  return [
    {
      kind: 'layer',
      layer: applyCircleStyle(
        {
          id: 'tileflow-vegetation-trees',
          type: 'circle',
          source: context.data.sourceId,
          'source-layer': context.data.schema.layers.tree,
          // The layer also holds rows of trees as lines; a circle on each vertex would misdraw them.
          filter: ['==', ['geometry-type'], 'Point'],
          metadata: {
            'tileflow:vegetation-mode': resolvedMode,
            ...(resolvedMode === '3d' ? {'tileflow:vegetation-fallback': 'flat-circle'} : {}),
          },
        },
        config.flat ?? {},
      ),
      localOrder: 1,
      owner: 'vegetation',
      slot: 'vegetation',
      target: 'vegetation.trees',
    },
  ];
}

/**
 * How a map's 3D trees look and where their data is, for the renderer that stands them: undefined
 * when vegetation is off, flat, or the data has no trees.
 */
export function tileflowVegetationDescription(
  request: TileflowResolvedModuleConfig<TileflowVegetationModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowVegetation3D | undefined {
  const {schema} = context.data;
  if (request?.enabled === false || request?.mode === 'flat' || !schema.layers.tree)
    return undefined;
  const tree = context.colors.vegetation.tree;
  const style = request?.threeDimensional ?? {};
  const colours = (value: unknown, fallback: readonly string[]) =>
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')
      ? (value as string[])
      : [...fallback];
  const number = (value: unknown) => {
    const resolved = value === undefined ? undefined : toMapLibreStyleValue(value as never);
    return typeof resolved === 'number' && resolved > 0 ? resolved : 1;
  };
  // Source, layers and fields are the data's semantic references here; the compiler binds them to
  // the physical names with the rest of the style.
  const field = (name: keyof typeof schema.fields, fallback: string) =>
    (schema.fields[name] ?? fallback) as string;
  return {
    source: context.data.sourceId,
    layers: {
      tree: schema.layers.tree,
      ...(schema.layers.canopy ? {canopy: schema.layers.canopy} : {}),
    },
    fields: {
      ...tileflowWorldTreeFields,
      height: field('height', tileflowWorldTreeFields.height),
      diameterCrown: field('diameterCrown', tileflowWorldTreeFields.diameterCrown),
      genus: field('genus', tileflowWorldTreeFields.genus),
      species: field('species', tileflowWorldTreeFields.species),
      leafType: field('leafType', tileflowWorldTreeFields.leafType),
      canopyRank: field('canopyRank', tileflowWorldTreeFields.canopyRank),
      canopyClearance: field('canopyClearanceAtZoom15', tileflowWorldTreeFields.canopyClearance),
      canopyCover: field('canopyCoverPercent', tileflowWorldTreeFields.canopyCover),
    },
    colors: {
      bark: typeof style.barkColor === 'string' ? style.barkColor : tree.bark,
      broadleaf: colours(style.broadleafColors, tree.broadleaf),
      conifer: colours(style.coniferColors, tree.conifer),
      palm: colours(style.palmColors, tree.palm),
    },
    heightScale: number(style.heightScale),
    crownScale: number(style.crownScale),
    forms: Object.fromEntries(
      Object.entries(style.forms ?? {}).map(([form, own]) => [
        form,
        {
          heightScale: number(own?.heightScale),
          crownScale: number(own?.crownScale),
          ...(own?.models?.length ? {models: [...own.models]} : {}),
        },
      ]),
    ),
    // Filled by the compiler from the map's prepared models.
    models: {},
    finish: style.finish ?? 'faceted',
    edges: (() => {
      const edges = toMapLibreStyleValue((style.edges ?? 0) as never);
      return typeof edges === 'number' ? edges : 0;
    })(),
    ...(() => {
      const edgeColor =
        style.edgeColor === undefined ? undefined : toMapLibreStyleValue(style.edgeColor as never);
      return typeof edgeColor === 'string' ? {edgeColor} : {};
    })(),
    unknownForms: style.unknownForms ?? tileflowDefaultUnknownTreeForms,
    regions: style.regions ?? [],
    // Filled by the compiler once the style's layers are final.
    flatLayers: [],
  };
}
