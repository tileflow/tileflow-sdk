import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseTileflowMap, serializeCanonicalJson} from '@tileflow/core';
import {collectTileflowMapBuildLineage} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {
  createTileflowArtifactPlan,
  disposeTileflowBuildArtifacts,
  writeTileflowArtifactPlan,
} from '../../../../packages/dev/src/artifacts';
import {prepareTileflowCatalogIcons} from '../../../../packages/dev/src/icons';

// Writes Streets' native styles, one file per theme, with the same preparation as the native
// catalog report. Run from the SDK root after `pnpm build`:
//   pnpm --filter @tileflow/dev exec tsx ../../platforms/ios/NativeEngineSpikes/scripts/streets-native-styles.ts <out>
async function main(out: string): Promise<void> {
  const cwd = resolve(process.cwd());
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
  const artifacts = await createTileflowArtifactPlan(prepared, {renderer: 'native', styleBaseUrl: '.'});
  try {
    await mkdir(out, {recursive: true});
    await writeTileflowArtifactPlan(artifacts, {cwd: resolve(out), outDir: 'build'});
    await mkdir(out, {recursive: true});
    const themes = Object.keys(artifacts.styles[map.id]!).sort();
    for (const theme of themes) {
      await writeFile(
        resolve(out, `${theme}.json`),
        serializeCanonicalJson(artifacts.styles[map.id]![theme]!),
      );
    }
    await writeFile(resolve(out, 'themes.json'), JSON.stringify({map: map.id, themes}));
    console.log(`${themes.length} themes: ${themes.join(', ')}`);
  } finally {
    await disposeTileflowBuildArtifacts(artifacts);
  }
}

main(process.argv[2] ?? 'streets-native').catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
