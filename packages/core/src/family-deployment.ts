import {createTileflowStyleFamily, expandTileflowStyleFamily} from './style-family';
import type {MapLibreStyle} from './types';

/** Compact transport versions: v3 is web; v4 contains web plus a conventional Native artifact. */
export function compactTileflowDeploymentArtifact(input: unknown): Record<string, unknown> {
  const artifact = object(input);
  if (artifact.kind !== 'tileflow-map-deployment') throw new TypeError('Invalid deployment kind.');
  if (artifact.schemaVersion === 1) {
    const {styles, ...rest} = artifact;
    return {
      ...rest,
      ...compactRequirements(rest.buildManifest),
      schemaVersion: 3,
      family: createTileflowStyleFamily(object(styles) as Record<string, MapLibreStyle>),
    };
  }
  if (artifact.schemaVersion === 2) {
    const renderers = object(artifact.renderers);
    const {styles, ...web} = object(renderers.web);
    return {
      ...artifact,
      schemaVersion: 4,
      renderers: {
        ...renderers,
        web: {
          ...web,
          ...compactRequirements(web.buildManifest),
          family: createTileflowStyleFamily(object(styles) as Record<string, MapLibreStyle>),
        },
      },
    };
  }
  throw new TypeError('Expected deployment schema version 1 or 2.');
}

/** Decode before existing hash/resource verification. Expansion grants no publication authority. */
export function expandTileflowDeploymentArtifact(input: unknown): unknown {
  const artifact = object(input);
  if (artifact.schemaVersion === 3) {
    if (Object.hasOwn(artifact, 'styles'))
      throw new TypeError('A compact deployment cannot include flat styles.');
    const {family, sharedRequirements, ...rest} = artifact;
    return {
      ...rest,
      buildManifest: expandRequirements(rest.buildManifest, sharedRequirements),
      schemaVersion: 1,
      styles: expandTileflowStyleFamily(family),
    };
  }
  if (artifact.schemaVersion === 4) {
    const renderers = object(artifact.renderers);
    const web = object(renderers.web);
    if (Object.hasOwn(web, 'styles'))
      throw new TypeError('A compact deployment cannot include flat web styles.');
    const {family, sharedRequirements, ...rest} = web;
    return {
      ...artifact,
      schemaVersion: 2,
      renderers: {
        ...renderers,
        web: {
          ...rest,
          buildManifest: expandRequirements(rest.buildManifest, sharedRequirements),
          styles: expandTileflowStyleFamily(family),
        },
      },
    };
  }
  return input;
}

// Requirements describe the shared data contract, but the verified build manifest has one copy
// per theme. Share identical documents only on the wire; restore them before hash/authority checks.
const requirementKeys = ['dataRequirements', 'sourceRequirements'] as const;
function compactRequirements(input: unknown) {
  const manifest = object(input);
  const sharedRequirements: Record<string, Record<string, unknown>> = {};
  const maps = Object.fromEntries(
    Object.entries(object(manifest.maps)).map(([name, raw]) => {
      const map = object(raw);
      const themes = Object.entries(object(map.themes));
      const common: Record<string, unknown> = {};
      for (const key of requirementKeys) {
        const frequencies = new Map<string, {value: unknown; count: number}>();
        for (const [, rawTheme] of themes) {
          const value = object(rawTheme)[key];
          if (value === undefined) continue;
          const serialized = JSON.stringify(value);
          const entry = frequencies.get(serialized) ?? {value, count: 0};
          entry.count += 1;
          frequencies.set(serialized, entry);
        }
        const frequent = [...frequencies.values()].sort((a, b) => b.count - a.count)[0];
        // Every theme must have the field: a default must never invent a missing requirement.
        if (
          frequent &&
          frequent.count > 1 &&
          themes.every(([, theme]) => Object.hasOwn(object(theme), key))
        )
          common[key] = frequent.value;
      }
      if (!Object.keys(common).length) return [name, map];
      sharedRequirements[name] = common;
      return [
        name,
        {
          ...map,
          themes: Object.fromEntries(
            themes.map(([theme, value]) => [
              theme,
              Object.fromEntries(
                Object.entries(object(value)).filter(
                  ([key, field]) =>
                    !Object.hasOwn(common, key) ||
                    JSON.stringify(field) !== JSON.stringify(common[key]),
                ),
              ),
            ]),
          ),
        },
      ];
    }),
  );
  return {
    buildManifest: {...manifest, maps},
    ...(Object.keys(sharedRequirements).length ? {sharedRequirements} : {}),
  };
}

function expandRequirements(input: unknown, shared: unknown): unknown {
  if (shared === undefined) return input;
  const manifest = object(input);
  const maps = {...object(manifest.maps)};
  let expandedBytes = 0;
  for (const [name, raw] of Object.entries(object(shared))) {
    if (!Object.hasOwn(maps, name))
      throw new TypeError('Shared requirements refer to an unknown map.');
    const map = object(maps[name]);
    const common = object(raw);
    if (
      !Object.keys(common).length ||
      Object.keys(common).some(
        (key) => !requirementKeys.includes(key as (typeof requirementKeys)[number]),
      )
    )
      throw new TypeError('Invalid shared requirements.');
    const themes = Object.entries(object(map.themes));
    if (!themes.length || themes.length > 64)
      throw new TypeError('Invalid requirement theme count.');
    expandedBytes += new TextEncoder().encode(JSON.stringify(common)).length * themes.length;
    if (expandedBytes > 8 * 1024 * 1024)
      throw new TypeError('Expanded requirements are too large.');
    maps[name] = {
      ...map,
      themes: Object.fromEntries(
        themes.map(([theme, rawTheme]) => {
          const value = object(rawTheme);
          // An explicit per-theme requirement overrides the shared default. Authority and hash
          // validation still compare the reconstructed contract with the actual compiled style.
          return [theme, {...common, ...value}];
        }),
      ),
    };
  }
  return {...manifest, maps};
}

/** Web quota excludes Native and the two independently bounded icon receipts, never map content. */
export function tileflowDeploymentWebBytes(input: unknown): number {
  const {iconComposition: _receipt, ...body} = object(input);
  const source = object(body.artifact);
  const artifact: Record<string, unknown> =
    source.schemaVersion === 2 || source.schemaVersion === 4
      ? {
          kind: source.kind,
          schemaVersion: source.schemaVersion === 4 ? 3 : 1,
          mapId: source.mapId,
          teamSources: source.teamSources,
          ...object(object(source.renderers).web),
        }
      : {...source};
  const buildManifest = object(artifact.buildManifest);
  const maps = Object.fromEntries(
    Object.entries(object(buildManifest.maps)).map(([name, raw]) => {
      const map = object(raw);
      const {iconComposition: _embedded, ...sourceAssets} = object(map.sourceAssets);
      return [name, {...map, sourceAssets}];
    }),
  );
  return new TextEncoder().encode(
    JSON.stringify({...body, artifact: {...artifact, buildManifest: {...buildManifest, maps}}}),
  ).length;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a deployment object.');
  return value as Record<string, unknown>;
}
