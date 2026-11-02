import {dirname, resolve} from 'node:path';
import {parseTileflowMap} from '@tileflow/core';
import {collectTileflowMapBuildLineage} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {
  createTileflowArtifactPlan,
  disposeTileflowBuildArtifacts,
  writeTileflowArtifactPlan,
} from '../packages/dev/src/artifacts';
import {prepareTileflowCatalogIcons} from '../packages/dev/src/icons';

/** Writes Streets' native-v1 artifacts, every theme, to the directory given as the argument. */
async function main(outDir: string): Promise<void> {
  const cwd = resolve(process.cwd(), 'packages/dev');
  const map = parseTileflowMap(streets);
  const prepared = await prepareTileflowCatalogIcons(
    {
      maps: {[map.id]: map},
      mapMetadata: {
        [map.id]: {id: map.id, version: map.version, lineage: collectTileflowMapBuildLineage(streets)},
      },
    },
    {cwd, baseDirectory: cwd, assetBaseUrl: '../..'},
  );
  const plan = await createTileflowArtifactPlan(prepared, {renderer: 'native', styleBaseUrl: '.'});
  try {
    await writeTileflowArtifactPlan(plan, {outDir, cwd: dirname(outDir)});
    process.stdout.write(`${JSON.stringify(Object.keys(plan.styles[map.id]!))}\n`);
  } finally {
    await disposeTileflowBuildArtifacts(plan);
  }
}

main(resolve(process.argv[2] ?? 'native-streets')).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
