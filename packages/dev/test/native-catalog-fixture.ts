import {createHash} from 'node:crypto';
import {parseTileflowMap, serializeCanonicalJson} from '@tileflow/core';
import {collectTileflowMapBuildLineage} from '@tileflow/core/build';
import {
  readTileflowNativeDegradations,
  resolveTileflowNativeCompatibility,
  TileflowNativeCompatibilityError,
  type TileflowNativeCompatibility,
  type TileflowNativeDegradation,
  type TileflowNativeDiagnostic,
  tileflowNativeProfile,
} from '@tileflow/core/native-profile';
import {baedeker, blueprint, map1777, siegfried, soundings, streets} from '@tileflow/maps';
import {createTileflowArtifactPlan, disposeTileflowBuildArtifacts} from '../src/artifacts';
import {prepareTileflowCatalogIcons} from '../src/icons';

export const nativeCatalogMaps = [
  baedeker,

  map1777,
  blueprint,
  siegfried,
  soundings,
  streets,
] as const;

export type NativeCatalogRow = {
  map: string;
  theme: string;
  status: 'compatible-artifacts' | 'incompatible';
  styleSha256?: string;
  diagnostics: readonly TileflowNativeDiagnostic[];
  /** What the native artifact leaves out or draws differently; empty when incompatible. */
  degradations: readonly TileflowNativeDegradation[];
};

/**
 * A map is `mobile-compatible` when every theme prepares and loses no content; `web-only` maps
 * either fail preparation (`diagnostics`) or lose content (`compatibility.reasons`).
 */
export type NativeCatalogMap = {
  map: string;
  status: 'mobile-compatible' | 'web-only';
  compatibility?: TileflowNativeCompatibility;
  incompatibleThemes: readonly string[];
};

/** Replays individual themes through the ordinary compiler and artifact preparation path. */
export async function evaluateNativeCatalog(cwd: string) {
  const rows: NativeCatalogRow[] = [];
  for (const definition of [...nativeCatalogMaps].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const resolved = parseTileflowMap(definition);
    for (const theme of Object.keys(resolved.themes).sort()) {
      // Each row is a theme compatibility check, not a new identity for the full authored map.
      const {systemThemes: _systemThemes, timeOfDay: _timeOfDay, ...common} = resolved;
      const map = {...common, defaultTheme: theme, themes: {[theme]: resolved.themes[theme]!}};
      const prepared = await prepareTileflowCatalogIcons(
        {
          maps: {[map.id]: map},
          mapMetadata: {
            [map.id]: {
              id: map.id,
              version: map.version,
              lineage: collectTileflowMapBuildLineage(definition),
            },
          },
        },
        {
          cwd,
          baseDirectory: cwd,
          assetBaseUrl: '../..',
        },
      );
      try {
        const artifacts = await createTileflowArtifactPlan(prepared, {
          renderer: 'native',
          styleBaseUrl: '.',
        });
        try {
          const style = artifacts.styles[map.id]![theme]!;
          rows.push({
            map: map.id,
            theme,
            status: 'compatible-artifacts',
            diagnostics: [],
            degradations: readTileflowNativeDegradations(style.metadata),
            styleSha256: createHash('sha256').update(serializeCanonicalJson(style)).digest('hex'),
          });
        } finally {
          await disposeTileflowBuildArtifacts(artifacts);
        }
      } catch (error) {
        if (!(error instanceof TileflowNativeCompatibilityError)) throw error;
        rows.push({
          map: map.id,
          theme,
          status: 'incompatible',
          diagnostics: error.issues,
          degradations: [],
        });
      }
    }
  }
  const maps: NativeCatalogMap[] = [...new Set(rows.map((row) => row.map))].map((map) => {
    const themes = rows.filter((row) => row.map === map);
    const incompatibleThemes = themes
      .filter((row) => row.status === 'incompatible')
      .map((row) => row.theme);
    if (incompatibleThemes.length) return {map, status: 'web-only', incompatibleThemes};
    const compatibility = resolveTileflowNativeCompatibility(
      Object.fromEntries(themes.map((row) => [row.theme, row.degradations])),
    );
    return {
      map,
      status: compatibility.status === 'compatible' ? 'mobile-compatible' : 'web-only',
      compatibility,
      incompatibleThemes,
    };
  });
  return {
    schemaVersion: 2,
    profile: tileflowNativeProfile,
    scope: 'individual-theme-static-artifacts',
    maps,
    rows,
  };
}
