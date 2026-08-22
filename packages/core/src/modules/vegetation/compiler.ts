import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowVegetationModuleConfig} from './index';

export function compileVegetation(
  request: TileflowVegetationModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowVegetationModuleConfig>(
    {type: 'vegetation', enabled: true, minZoom: 16, mode: '3d'},
    request,
  );
  if (config.enabled === false || !context.data.schema.layers.tree) return [];

  const minZoom = config.minZoom ?? 16;
  const requestedMode = config.mode ?? 'flat';
  // A generic vector-tile binding guarantees tree attributes, not the
  // Tileflow runtime that upgrades the portable circle layer to custom 3D.
  // Keep the emitted style truthful until the data/runtime contract exposes
  // an explicit renderer capability.
  const portableFallback = context.data.kind === 'vector-tiles' && requestedMode === '3d';
  const mode = portableFallback ? 'flat' : requestedMode;
  const color = context.colors.landcover.wood;
  const radius =
    minZoom < 20
      ? ['interpolate', ['linear'], ['zoom'], minZoom, 2.2, 20, 8]
      : minZoom < 24
        ? ['interpolate', ['linear'], ['zoom'], minZoom, 2.2, 24, 8]
        : 2.2;
  return [
    {
      kind: 'layer',
      layer: {
        id: 'streets-vegetation-trees',
        type: 'circle',
        source: context.data.sourceId,
        'source-layer': context.data.schema.layers.tree,
        minzoom: minZoom,
        paint: {
          'circle-color': color,
          'circle-opacity': mode === '3d' ? 0.82 : 0.9,
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
          'circle-radius': radius,
          'circle-stroke-color': context.colors.park,
          'circle-stroke-opacity': 0.55,
          'circle-stroke-width': 0.8,
        },
        metadata: {
          'tileflow:vegetation-mode': mode,
          ...(portableFallback ? {'tileflow:vegetation-fallback': 'portable-flat'} : {}),
          'tileflow:tree-height-field': context.data.schema.fields.height,
          'tileflow:tree-crown-field': context.data.schema.fields.diameterCrown,
          'tileflow:tree-genus-field': context.data.schema.fields.genus,
          'tileflow:tree-leaf-type-field': context.data.schema.fields.leafType,
          'tileflow:tree-species-field': context.data.schema.fields.species,
        },
      },
      localOrder: 1,
      owner: 'vegetation',
      slot: 'vegetation',
      target: 'vegetation.trees',
    },
  ];
}
