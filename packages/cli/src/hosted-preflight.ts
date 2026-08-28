import {compareCodeUnits, tileflowHostedAlphaCompatibility} from '@tileflow/core';
import type {TileflowBuildCatalog, TileflowBuildStyles} from '@tileflow/core/build';

export type TileflowHostedCompatibilityIssue = {
  map?: string;
  message: string;
  path: string;
};

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
