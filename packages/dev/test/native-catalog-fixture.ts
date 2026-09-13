import {createHash} from 'node:crypto';
import {parseTileflowMap, serializeCanonicalJson} from '@tileflow/core';
import {collectTileflowMapBuildLineage} from '@tileflow/core/build';
import {
  TileflowNativeCompatibilityError,
  tileflowNativeProfile,
  type TileflowNativeDiagnostic,
} from '@tileflow/core/native-profile';
import {
  baedeker, cyberpunk, ferraris, harad, matrix, sanFrancisto,
  siegfried, soundings, streets, verdant,
} from '@tileflow/maps';
import {createTileflowArtifactPlan, disposeTileflowBuildArtifacts} from '../src/artifacts';
import {prepareTileflowCatalogIcons} from '../src/icons';

export const nativeCatalogMaps = [
  baedeker, cyberpunk, ferraris, harad, matrix, sanFrancisto,
  siegfried, soundings, streets, verdant,
] as const;

export type NativeCatalogRow = {
  map: string;
  theme: string;
  status: 'compatible-artifacts' | 'incompatible';
  styleSha256?: string;
  diagnostics: readonly TileflowNativeDiagnostic[];
};

/** Replays individual themes through the ordinary compiler and artifact preparation path. */
export async function evaluateNativeCatalog(cwd: string) {
  const rows: NativeCatalogRow[] = [];
  for (const definition of [...nativeCatalogMaps].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const resolved = parseTileflowMap(definition);
    for (const theme of Object.keys(resolved.themes).sort()) {
      // Each row is a theme compatibility check, not a new identity for the full authored map.
      const {systemThemes: _systemThemes, ...common} = resolved;
      const map = {...common, defaultTheme: theme, themes: {[theme]: resolved.themes[theme]!}};
      const prepared = await prepareTileflowCatalogIcons({
        maps: {[map.id]: map},
        mapMetadata: {[map.id]: {id: map.id, version: map.version, lineage: collectTileflowMapBuildLineage(definition)}},
      }, {
        cwd, baseDirectory: cwd, assetBaseUrl: '../..',
      });
      try {
        const artifacts = await createTileflowArtifactPlan(prepared, {renderer: 'native', styleBaseUrl: '.'});
        try {
          rows.push({
            map: map.id, theme, status: 'compatible-artifacts', diagnostics: [],
            styleSha256: createHash('sha256').update(serializeCanonicalJson(artifacts.styles[map.id]![theme]!)).digest('hex'),
          });
        } finally {
          await disposeTileflowBuildArtifacts(artifacts);
        }
      } catch (error) {
        if (!(error instanceof TileflowNativeCompatibilityError)) throw error;
        rows.push({map: map.id, theme, status: 'incompatible', diagnostics: error.issues});
      }
    }
  }
  return {
    schemaVersion: 1,
    profile: tileflowNativeProfile,
    scope: 'individual-theme-static-artifacts',
    rows,
  };
}
