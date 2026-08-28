import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyCircleStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {zoom} from '../../cartography/values';
import type {
  TileflowVegetationModuleConfig,
  TileflowVegetationThreeDimensionalStyle,
} from './index';

export function compileVegetation(
  request: TileflowVegetationModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const minZoom = request?.flat?.minZoom ?? request?.minZoom ?? 16;
  const mode = request?.mode ?? '3d';
  const config = mergeTileflowDesign<TileflowVegetationModuleConfig>(
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
      minZoom,
      mode,
      threeDimensional: {
        barkColor: context.colors.vegetation.tree.bark,
        broadleafColors: context.colors.vegetation.tree.broadleaf,
        coniferColors: context.colors.vegetation.tree.conifer,
        crownScale: 1,
        heightScale: 1,
      },
    },
    request,
  );
  if (config.enabled === false || !context.data.schema.layers.tree) return [];

  const resolvedMode = config.mode ?? '3d';
  const threeDimensional = config.threeDimensional as TileflowVegetationThreeDimensionalStyle;
  return [
    {
      kind: 'layer',
      layer: applyCircleStyle(
        {
          id: 'streets-vegetation-trees',
          type: 'circle',
          source: context.data.sourceId,
          'source-layer': context.data.schema.layers.tree,
          metadata: {
            'tileflow:vegetation-mode': resolvedMode,
            ...(resolvedMode === '3d' ? {'tileflow:vegetation-fallback': 'flat-circle'} : {}),
            'tileflow:tree-bark-color': threeDimensional.barkColor,
            'tileflow:tree-broadleaf-colors': threeDimensional.broadleafColors,
            'tileflow:tree-conifer-colors': threeDimensional.coniferColors,
            'tileflow:tree-crown-field': context.data.schema.fields.diameterCrown,
            'tileflow:tree-crown-scale': threeDimensional.crownScale,
            'tileflow:tree-genus-field': context.data.schema.fields.genus,
            'tileflow:tree-height-field': context.data.schema.fields.height,
            'tileflow:tree-height-scale': threeDimensional.heightScale,
            'tileflow:tree-leaf-type-field': context.data.schema.fields.leafType,
            'tileflow:tree-species-field': context.data.schema.fields.species,
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
