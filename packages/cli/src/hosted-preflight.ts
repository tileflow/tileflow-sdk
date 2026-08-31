import {
  compareCodeUnits,
  type MapLibreStyle,
  type ResolvedTileflowMap,
  tileflowHostedAlphaCompatibility,
} from '@tileflow/core';
import type {TileflowBuildCatalog, TileflowBuildStyles} from '@tileflow/core/build';

export type TileflowHostedCompatibilityIssue = {
  map?: string;
  message: string;
  path: string;
};

export type TileflowHostedSourceBinding = Readonly<{
  tileset: string;
  type: 'raster' | 'vector';
}>;

export type TileflowHostedTeamSources = Readonly<Record<string, TileflowHostedSourceBinding>>;

export function prepareTileflowHostedThemeFamily(
  mapName: string,
  map: ResolvedTileflowMap,
  styles: Readonly<Record<string, MapLibreStyle>>,
): {styles: Record<string, MapLibreStyle>; teamSources: TileflowHostedTeamSources} {
  const prepared = Object.fromEntries(
    Object.entries(styles)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([themeName, style]) => [themeName, cloneStyle(style)]),
  );
  const teamSources = Object.fromEntries(
    Object.entries(map.sources ?? {})
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([sourceId, source]) => {
        for (const [themeName, style] of Object.entries(prepared)) {
          const definition = style.sources[sourceId];
          if (!definition) {
            throw Object.assign(
              new Error(`Hosted theme ${themeName} is missing logical source ${sourceId}.`),
              {
                code: 'TF_HOSTED_SOURCE_MISSING',
                path: `maps.${mapName}.themes.${themeName}.sources.${sourceId}`,
              },
            );
          }
          definition.url = `tileflow://hosted-sources/${sourceId}`;
          delete definition.tiles;
        }
        return [
          sourceId,
          Object.freeze({
            tileset: source.tileset,
            type: source.type,
          }),
        ];
      }),
  );
  return {styles: prepared, teamSources};
}

export function inspectTileflowHostedCompatibility(
  project: TileflowBuildCatalog,
  styles: TileflowBuildStyles,
): TileflowHostedCompatibilityIssue[] {
  const issues: TileflowHostedCompatibilityIssue[] = [];
  const mapNames = Object.keys(project.maps).sort(compareCodeUnits);

  if (mapNames.length > tileflowHostedAlphaCompatibility.maxMapsPerDeploy) {
    issues.push({
      message: `Hosted alpha accepts at most ${tileflowHostedAlphaCompatibility.maxMapsPerDeploy} maps per deploy.`,
      path: 'maps',
    });
  }

  for (const mapName of [...mapNames].sort(compareCodeUnits)) {
    const themes = styles[mapName] ?? {};
    for (const themeName of Object.keys(themes).sort(compareCodeUnits)) {
      const data = themes[themeName]?.metadata?.['tileflow:data'];

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        (data as {kind?: unknown}).kind !== 'tileflow-world'
      ) {
        issues.push({
          map: mapName,
          message: `Hosted deploy supports only Tileflow World data. Map ${mapName} theme ${themeName} uses an external vector dataset; keep it local or switch to tileflowWorld().`,
          path: `maps.${mapName}.themes.${themeName}.data`,
        });
      }
    }
  }

  return issues;
}

function cloneStyle(style: MapLibreStyle): MapLibreStyle {
  return JSON.parse(JSON.stringify(style)) as MapLibreStyle;
}
