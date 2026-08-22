import {
  compareCodeUnits,
  type MapLibreStyle,
  tileflowHostedAlphaCompatibility,
} from '@tileflow/core';

export type TileflowHostedCompatibilityIssue = {
  map?: string;
  message: string;
  path: string;
};

export function inspectTileflowHostedCompatibility(
  mapNames: readonly string[],
  styles: Readonly<Record<string, MapLibreStyle>>,
): TileflowHostedCompatibilityIssue[] {
  const issues: TileflowHostedCompatibilityIssue[] = [];

  if (mapNames.length > tileflowHostedAlphaCompatibility.maxMapsPerDeploy) {
    issues.push({
      message: `Hosted alpha accepts at most ${tileflowHostedAlphaCompatibility.maxMapsPerDeploy} maps per deploy.`,
      path: 'maps',
    });
  }

  for (const mapName of [...mapNames].sort(compareCodeUnits)) {
    const data = styles[mapName]?.metadata?.['tileflow:data'];

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      (data as {kind?: unknown}).kind !== 'tileflow-world'
    ) {
      issues.push({
        map: mapName,
        message: `Hosted deploy supports only Tileflow World data. Map ${mapName} uses an external vector dataset; keep it local or switch to tileflowWorld().`,
        path: `maps.${mapName}.data`,
      });
    }
  }

  return issues;
}
