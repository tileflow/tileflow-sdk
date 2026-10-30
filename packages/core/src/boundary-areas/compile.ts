import {TileflowOverlayCompilationError, type TileflowMapLibreOverlay} from '../overlays';
import {
  tileflowBoundaryChoroplethMetadataKey,
  type TileflowBoundaryChoroplethMetadata,
} from './choropleth';
import {tileflowBoundaryFamilies} from './schema';
import type {ResolvedBoundaryAreas} from './source';

export {resolveBoundaryAreas} from './source';

/**
 * Check boundary choropleths against the map's Boundaries declaration before overlays are
 * inserted, so a missing source or an impossible join fails with a specific diagnostic.
 */
export function validateBoundaryChoroplethOverlays<
  TOverlays extends Readonly<Record<string, TileflowMapLibreOverlay>> | undefined,
>(mapId: string, overlays: TOverlays, boundaryAreas: ResolvedBoundaryAreas | undefined): TOverlays {
  const entries: [string, TileflowMapLibreOverlay][] = Object.entries(overlays ?? {});
  for (const [overlayId, overlay] of entries) {
    for (const layer of overlay.layers) {
      const metadata = (layer.metadata as Record<string, unknown> | undefined)?.[
        tileflowBoundaryChoroplethMetadataKey
      ] as TileflowBoundaryChoroplethMetadata | undefined;
      if (!metadata) continue;
      const path = `map.${mapId}.overlays.${overlayId}`;
      if (!boundaryAreas || boundaryAreas.identity.family !== metadata.family) {
        throw new TileflowOverlayCompilationError(
          'TF_BOUNDARY_AREAS_REQUIRED',
          path,
          `Boundary choropleth "${overlayId}" needs the map to declare boundaryAreas with family "${metadata.family}".`,
          `Add boundaryAreas: {family: '${metadata.family}'} to the map.`,
        );
      }
      if (overlay.source !== tileflowBoundaryFamilies[metadata.family].sourceId) {
        throw new TileflowOverlayCompilationError(
          'TF_BOUNDARY_CHOROPLETH_SOURCE',
          `${path}.source`,
          `Boundary choropleth "${overlayId}" must draw from ${tileflowBoundaryFamilies[metadata.family].sourceId}.`,
        );
      }
      if (metadata.joinBy === 'id' && boundaryAreas.identity.promoteId === 'ref') {
        throw new TileflowOverlayCompilationError(
          'TF_BOUNDARY_CHOROPLETH_JOIN',
          path,
          `Boundary choropleth "${overlayId}" joins by id, but boundaryAreas promotes ref as the feature ID.`,
          'Join the values by ref, or remove promoteId from boundaryAreas.',
        );
      }
    }
  }
  return overlays;
}
