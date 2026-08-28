import type {TileflowCaptureScene} from './capture-scene';
import {
  compileSemanticStyle,
  compileSemanticStyleWithInspection,
  type TileflowPreparedMapAssets,
} from './cartography/streets';
import {
  parseTileflowRuntimeManifest,
  type TileflowRuntimeManifest,
  tileflowRuntimeManifestVersion,
} from './manifest';
import {collectMapLineage, type TileflowStyleOptions} from './map';
import {
  collectTileflowMapBuildLineage,
  type TileflowMapBuildLineageEntry,
} from './map-build-manifest';
import {type ResolvedTileflowMap, type TileflowMap, tileflowMapIdSchema} from './maps';
import {parseResolvedTileflowMap} from './resolved-map-schema';
import {createStyleWithInspection, type TileflowInspectedStyle} from './style-inspection';
import type {MapLibreStyle} from './types';

export {
  inferTileflowDataRequirements,
  inferTileflowSourceRequirements,
  validateTileflowDataCompatibility,
} from './data/requirements';
export type {
  TileflowDataCompatibilityIssue,
  TileflowDataFieldRequirement,
  TileflowDataFieldType,
  TileflowDataLayerRequirement,
  TileflowDataRequirementsV1,
  TileflowObservedDataContractV1,
  TileflowSourceRequirementsV1,
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
  TileflowThemeBuildManifestEntryV1,
} from './map-build-manifest';

export {collectMapLineage};
export type {TileflowPreparedMapAssets} from './cartography/streets';
export {createStyleWithInspection, tileflowStyleInspectionSchemaVersion} from './style-inspection';
export type {
  TileflowInspectedStyle,
  TileflowStyleInspection,
  TileflowStyleInspectionContribution,
  TileflowStyleInspectionRenderOperation,
  TileflowStyleInspectionLayer,
} from './style-inspection';

export type TileflowCompiledMapMetadata = Pick<ResolvedTileflowMap, 'id' | 'version'> & {
  lineage: readonly TileflowMapBuildLineageEntry[];
};

/** Multi-map intermediate representation owned by Node build tooling. */
export type TileflowBuildCatalog = {
  /** Validated, inheritance-free compiler inputs. Authoring definitions live outside the catalog. */
  maps: Record<string, ResolvedTileflowMap>;
  mapMetadata?: Record<string, TileflowCompiledMapMetadata>;
  scenes?: Record<string, TileflowCaptureScene>;
};

/** Complete compiled style family, addressed first by logical map and then by theme name. */
export type TileflowBuildStyles = Record<string, Record<string, MapLibreStyle>>;

/** Style family plus opt-in, read-only, non-addressable physical-output diagnostics. */
export type TileflowBuildInspectedStyles = Record<string, Record<string, TileflowInspectedStyle>>;

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

  const resolved = parseResolvedTileflowMap(map);
  assertCatalogMapIdentity(mapName, resolved.id);
  const metadata = catalog.mapMetadata?.[mapName] ?? {
    id: resolved.id,
    lineage: [{id: resolved.id, mapVersion: resolved.version}],
    version: resolved.version,
  };
  return compileSemanticStyle(resolved, {
    ...options,
    map: {...metadata, lineage: metadata.lineage.map(({id}) => id)},
  });
}

export function createStyleFromCatalogWithInspection<
  const TCatalog extends TileflowBuildCatalog,
  const TMapName extends keyof TCatalog['maps'] & string,
>(catalog: TCatalog, mapName: TMapName, options?: TileflowStyleOptions): TileflowInspectedStyle;

export function createStyleFromCatalogWithInspection(
  catalog: TileflowBuildCatalog,
  mapName: string,
  options: TileflowStyleOptions = {},
): TileflowInspectedStyle {
  const map = Object.hasOwn(catalog.maps, mapName) ? catalog.maps[mapName] : undefined;
  if (!map) throw new Error(`Unknown Tileflow map: ${mapName}`);

  const resolved = parseResolvedTileflowMap(map);
  assertCatalogMapIdentity(mapName, resolved.id);
  const metadata = catalog.mapMetadata?.[mapName] ?? {
    id: resolved.id,
    lineage: [{id: resolved.id, mapVersion: resolved.version}],
    version: resolved.version,
  };
  return compileSemanticStyleWithInspection(resolved, {
    ...options,
    map: {...metadata, lineage: metadata.lineage.map(({id}) => id)},
  });
}

/** Compile every declared theme for every logical map in deterministic key order. */
export function createStylesFromCatalog(
  catalog: TileflowBuildCatalog,
  options: Omit<TileflowStyleOptions, 'preparedAssets' | 'theme'> & {
    mapAssets?: Readonly<Record<string, TileflowPreparedMapAssets>>;
  } = {},
): TileflowBuildStyles {
  const {mapAssets, ...styleOptions} = options;
  return Object.fromEntries(
    Object.keys(catalog.maps)
      .sort(compareCodeUnits)
      .map((mapName) => {
        const map = catalog.maps[mapName]!;
        const resolved = parseResolvedTileflowMap(map);
        assertCatalogMapIdentity(mapName, resolved.id);
        return [
          mapName,
          Object.fromEntries(
            Object.keys(resolved.themes)
              .sort(compareCodeUnits)
              .map((theme) => [
                theme,
                createStyleFromCatalog(catalog, mapName, {
                  ...styleOptions,
                  preparedAssets: mapAssets?.[mapName],
                  theme,
                }),
              ]),
          ),
        ];
      }),
  );
}

/** Compile every declared theme with a separate read-only physical-output diagnostic sidecar. */
export function createStylesFromCatalogWithInspection(
  catalog: TileflowBuildCatalog,
  options: Omit<TileflowStyleOptions, 'preparedAssets' | 'theme'> & {
    mapAssets?: Readonly<Record<string, TileflowPreparedMapAssets>>;
  } = {},
): TileflowBuildInspectedStyles {
  const {mapAssets, ...styleOptions} = options;
  return Object.fromEntries(
    Object.keys(catalog.maps)
      .sort(compareCodeUnits)
      .map((mapName) => {
        const map = catalog.maps[mapName]!;
        const resolved = parseResolvedTileflowMap(map);
        assertCatalogMapIdentity(mapName, resolved.id);
        return [
          mapName,
          Object.fromEntries(
            Object.keys(resolved.themes)
              .sort(compareCodeUnits)
              .map((theme) => [
                theme,
                createStyleFromCatalogWithInspection(catalog, mapName, {
                  ...styleOptions,
                  preparedAssets: mapAssets?.[mapName],
                  theme,
                }),
              ]),
          ),
        ];
      }),
  );
}

export function createManifest(
  catalog: TileflowBuildCatalog,
  options: {styleBaseUrl?: string} = {},
): TileflowRuntimeManifest {
  const styleBaseUrl = (options.styleBaseUrl ?? '').replace(/\/+$/u, '');
  const maps = Object.fromEntries(
    Object.keys(catalog.maps)
      .sort(compareCodeUnits)
      .map((mapName) => {
        const map = catalog.maps[mapName]!;
        const resolved = parseResolvedTileflowMap(map);
        assertCatalogMapIdentity(mapName, resolved.id);
        const themes = Object.fromEntries(
          Object.entries(resolved.themes)
            .sort(([left], [right]) => compareCodeUnits(left, right))
            .map(([themeName, theme]) => [
              themeName,
              {
                colorScheme: theme.colorScheme,
                styleUrl: `${styleBaseUrl}/styles/${mapName}/${themeName}.json`,
              },
            ]),
        );
        return [
          mapName,
          {
            defaultTheme: resolved.defaultTheme,
            ...(resolved.systemThemes ? {systemThemes: resolved.systemThemes} : {}),
            themes,
            ...(resolved.view ? {view: resolved.view} : {}),
          },
        ];
      }),
  );

  const manifest: TileflowRuntimeManifest = {
    maps,
    version: tileflowRuntimeManifestVersion,
  };
  return parseTileflowRuntimeManifest(manifest);
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

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
