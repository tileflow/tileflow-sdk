import type {TileflowCaptureScene} from './capture-scene';
import {
  parseTileflowRuntimeManifest,
  tileflowRuntimeManifestVersion,
  type TileflowSelfHostedManifest,
} from './manifest';
import {collectMapLineage, createStyle, parseTileflowMap, type TileflowStyleOptions} from './map';
import {
  collectTileflowMapBuildLineage,
  type TileflowMapBuildLineageEntry,
} from './map-build-manifest';
import {type ResolvedTileflowMap, resolveMap, type TileflowMap, tileflowMapIdSchema} from './maps';
import type {MapLibreStyle} from './types';

export {
  inferTileflowDataRequirements,
  validateTileflowDataCompatibility,
} from './data/requirements';
export type {
  TileflowDataCompatibilityIssue,
  TileflowDataFieldRequirement,
  TileflowDataFieldType,
  TileflowDataLayerRequirement,
  TileflowDataRequirementsV1,
  TileflowObservedDataContractV1,
} from './data/requirements';

export {
  collectTileflowMapBuildLineage,
  createTileflowMapBuildManifest,
  hashTileflowAssetSet,
  hashTileflowAssetSetIdentities,
  hashTileflowMapRevision,
  tileflowMapBuildManifestFileName,
  tileflowMapBuildManifestSchemaVersion,
  tileflowMapRevisionCanonicalization,
  tileflowMapRevisionSchemaVersion,
} from './map-build-manifest';
export type {
  TileflowBuildAssetIdentity,
  TileflowEffectiveFontSourceIdentity,
  TileflowEffectiveIconSourceIdentity,
  TileflowEffectiveMapSourceAssets,
  TileflowHashableBuildAsset,
  TileflowMapBuildInput,
  TileflowMapBuildLineageEntry,
  TileflowMapBuildManifestEntryV1,
  TileflowMapBuildManifestV1,
  TileflowMapBuildProvenanceV1,
} from './map-build-manifest';

export {collectMapLineage};
export type {TileflowPreparedMapAssets} from './cartography/streets';

export type TileflowCompiledMapMetadata = Pick<ResolvedTileflowMap, 'id' | 'root' | 'version'> & {
  lineage: readonly TileflowMapBuildLineageEntry[];
};

/** Multi-map intermediate representation owned by Node build tooling. */
export type TileflowBuildCatalog = {
  maps: Record<string, TileflowMap>;
  mapMetadata?: Record<string, TileflowCompiledMapMetadata>;
  scenes?: Record<string, TileflowCaptureScene>;
};

export function createStyleFromCatalog<
  const TCatalog extends TileflowBuildCatalog,
  const TMapName extends keyof TCatalog['maps'] & string,
>(catalog: TCatalog, mapName: TMapName, options?: TileflowStyleOptions): MapLibreStyle;

export function createStyleFromCatalog(
  catalog: TileflowBuildCatalog,
  mapName: string,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const map = Object.hasOwn(catalog.maps, mapName) ? catalog.maps[mapName] : undefined;
  if (!map) throw new Error(`Unknown Tileflow map: ${mapName}`);

  const resolved = parseTileflowMap(map);
  assertCatalogMapIdentity(mapName, resolved.id);
  const metadata = catalog.mapMetadata?.[mapName] ?? {
    id: resolved.id,
    lineage: collectTileflowMapBuildLineage(map),
    root: resolved.root,
    version: resolved.version,
  };
  return createStyle(map, {
    ...options,
    map: {...metadata, lineage: metadata.lineage.map(({id}) => id)},
  });
}

export function createManifest(
  catalog: TileflowBuildCatalog,
  options: {styleBaseUrl?: string} = {},
): TileflowSelfHostedManifest {
  const styleBaseUrl = (options.styleBaseUrl ?? '').replace(/\/+$/u, '');
  const mapNames = Object.keys(catalog.maps).sort();
  const entries = mapNames.map((mapName) => {
    const mapId = tileflowMapIdSchema.parse(catalog.maps[mapName]?.id);
    assertCatalogMapIdentity(mapName, mapId);
    return [mapName, `${styleBaseUrl}/styles/${mapName}.json`];
  });
  const views = Object.fromEntries(
    mapNames.flatMap((mapName) => {
      const view = resolveMap(catalog.maps[mapName]!).view;
      return view === undefined ? [] : [[mapName, view]];
    }),
  );

  const manifest: TileflowSelfHostedManifest = {
    kind: 'self-hosted',
    maps: Object.fromEntries(entries),
    styles: Object.fromEntries(entries),
    version: tileflowRuntimeManifestVersion,
    ...(Object.keys(views).length > 0 ? {views} : {}),
  };
  const validated = parseTileflowRuntimeManifest(manifest);
  if (validated.kind !== 'self-hosted') {
    throw new Error('Expected a self-hosted Tileflow manifest.');
  }
  return validated;
}

function assertCatalogMapIdentity(mapName: string, mapId: string): void {
  const parsedName = tileflowMapIdSchema.safeParse(mapName);
  if (!parsedName.success || parsedName.data !== mapName) {
    throw new Error(`Tileflow build catalog map key "${mapName}" must be a canonical map id.`);
  }
  if (mapName !== mapId) {
    throw new Error(
      `Tileflow build catalog map key "${mapName}" must match the map id "${mapId}".`,
    );
  }
}
