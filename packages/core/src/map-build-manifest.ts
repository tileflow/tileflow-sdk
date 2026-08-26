import {getResolvedModuleEffects} from './cartography/module-effects';
import {inferTileflowDataRequirements, type TileflowDataRequirementsV1} from './data/requirements';
import {compareCodeUnits, serializeCanonicalJson, sha256Hex} from './icon-package';
import {parseTileflowMap} from './map';
import {type TileflowMap, tileflowMapIdSchema} from './maps';
import type {MapLibreStyle} from './types';

export const tileflowMapRevisionSchemaVersion = 1 as const;
export const tileflowMapRevisionCanonicalization = 'tileflow-canonical-json-v1' as const;
export const tileflowMapBuildManifestSchemaVersion = 1 as const;
export const tileflowMapBuildManifestFileName = 'build-manifest.json' as const;

const tileflowMapRevisionDomain = 'tileflow-map-revision-v1\0';
const tileflowAssetSetDomain = 'tileflow-map-asset-set-v1\0';
const sha256Pattern = /^[a-f0-9]{64}$/u;

/** One effective icon source after ordered directory replacement has completed. */
export type TileflowEffectiveIconSourceIdentity = {
  format: 'jpeg' | 'png' | 'svg' | 'webp';
  id: string;
  kind: 'icon' | 'pattern';
  sha256: string;
};

/** One effective local font face actually referenced by the compiled map. */
export type TileflowEffectiveFontSourceIdentity = {
  family: string;
  sha256: string;
  style: 'italic' | 'normal' | 'oblique';
  weight: '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
};

export type TileflowEffectiveMapSourceAssets = {
  fonts: readonly TileflowEffectiveFontSourceIdentity[];
  icons: readonly TileflowEffectiveIconSourceIdentity[];
};

export type TileflowHashableBuildAsset = {
  contentType: string;
  fileName: string;
  source: string | Uint8Array;
};

/** Canonical byte identity used by the immutable asset-set hash. */
export type TileflowBuildAssetIdentity = {
  byteLength: number;
  contentType: string;
  fileName: string;
  sha256: string;
};

/** One authoring node in leaf-to-root order, retained only for auditability. */
export type TileflowMapBuildLineageEntry = {
  id: string;
  mapVersion: number;
};

export type TileflowMapBuildInput = {
  assets: readonly TileflowHashableBuildAsset[];
  lineage: readonly TileflowMapBuildLineageEntry[];
  map: TileflowMap;
  sourceAssets: TileflowEffectiveMapSourceAssets;
  style: MapLibreStyle;
};

export type TileflowMapBuildManifestEntryV1 = {
  assetSetSha256: string;
  dataRequirements: TileflowDataRequirementsV1;
  lineage: readonly TileflowMapBuildLineageEntry[];
  mapRevisionSha256: string;
  mapVersion: number;
  recipe: {
    compiler: 'streets';
    compilerVersion: number;
  };
  sourceAssets: TileflowEffectiveMapSourceAssets;
  styleSha256: string;
};

/**
 * Collect leaf-to-root editorial identities for manifest auditability.
 *
 * This lineage is deliberately not an additional `mapRevisionSha256` input. The resolved effective
 * map already determines that identity, so a fully shadowed ancestor change stays non-material.
 */
export function collectTileflowMapBuildLineage(input: TileflowMap): TileflowMapBuildLineageEntry[] {
  parseTileflowMap(input);
  const lineage: TileflowMapBuildLineageEntry[] = [];
  const seen = new Set<TileflowMap>();
  let current: TileflowMap | undefined = input;
  while (current && !seen.has(current)) {
    seen.add(current);
    lineage.push({id: tileflowMapIdSchema.parse(current.id), mapVersion: current.version});
    current = current.extends;
  }
  return lineage;
}

export type TileflowMapBuildProvenanceV1 = {
  lockfile?: {
    format: 'bun' | 'npm' | 'pnpm' | 'yarn';
    sha256: string;
  };
  packages: Readonly<Record<string, string>>;
  schemaVersion: 1;
};

export type TileflowMapBuildManifestV1 = {
  maps: Record<string, TileflowMapBuildManifestEntryV1>;
  provenance?: TileflowMapBuildProvenanceV1;
  schemaVersion: typeof tileflowMapBuildManifestSchemaVersion;
};

/**
 * Create the portable map build identity document.
 *
 * `mapRevisionSha256` identifies the effective cartographic definition and effective source
 * icon/font bytes. Editorial identity, default view, capture scenes, delivery policy, package
 * versions, compiler ABI versions, compiled Style JSON, generated sprite/font outputs, filesystem
 * paths, and a concrete resolution of a floating World selector are outside that hash. They have
 * their own identities or remain tooling/delivery state.
 */
export async function createTileflowMapBuildManifest(
  maps: Readonly<Record<string, TileflowMapBuildInput>>,
  options: {provenance?: TileflowMapBuildProvenanceV1} = {},
): Promise<TileflowMapBuildManifestV1> {
  const entries = await Promise.all(
    Object.entries(maps)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(async ([mapId, input]) => {
        const map = parseTileflowMap(input.map);
        if (map.id !== mapId) {
          throw new Error(`Tileflow build manifest key "${mapId}" must match map id "${map.id}".`);
        }
        const lineage = normalizeLineage(input.lineage, map);
        const sourceAssets = normalizeSourceAssets(input.sourceAssets);
        const [mapRevisionSha256, styleSha256, assetSetSha256] = await Promise.all([
          hashTileflowMapRevision(map, sourceAssets),
          sha256Hex(serializeCanonicalJson(input.style)),
          hashTileflowAssetSet(input.assets),
        ]);

        return [
          mapId,
          {
            assetSetSha256,
            dataRequirements: inferTileflowDataRequirements(input.style),
            lineage,
            mapRevisionSha256,
            mapVersion: map.version,
            recipe: {...map.root},
            sourceAssets,
            styleSha256,
          },
        ] as const;
      }),
  );

  return {
    maps: Object.fromEntries(entries),
    ...(options.provenance ? {provenance: normalizeProvenance(options.provenance)} : {}),
    schemaVersion: tileflowMapBuildManifestSchemaVersion,
  };
}

function normalizeProvenance(input: TileflowMapBuildProvenanceV1): TileflowMapBuildProvenanceV1 {
  if (input.schemaVersion !== 1) {
    throw new Error('Tileflow map build provenance schema version is unsupported.');
  }
  const packages = Object.fromEntries(
    Object.entries(input.packages)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, version]) => {
        if (
          !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(name) ||
          !version ||
          version !== version.trim() ||
          /[\p{Cc}\\]/u.test(version)
        ) {
          throw new Error(`Invalid Tileflow build package provenance: ${name}.`);
        }
        return [name, version];
      }),
  );
  if (Object.keys(packages).length === 0) {
    throw new Error('Tileflow map build provenance must identify at least one package.');
  }
  if (input.lockfile) assertSha256(input.lockfile.sha256, 'lockfile');
  return {
    ...(input.lockfile ? {lockfile: {...input.lockfile}} : {}),
    packages,
    schemaVersion: 1,
  };
}

/** Hash a resolved map definition with the versioned, domain-separated revision contract. */
export async function hashTileflowMapRevision(
  input: TileflowMap,
  sourceAssets: TileflowEffectiveMapSourceAssets,
): Promise<string> {
  const map = parseTileflowMap(input);
  const {
    delivery: _delivery,
    fonts: _fonts,
    icons: _icons,
    id: _id,
    name: _name,
    root,
    version: _version,
    view: _view,
    ...effectiveCartography
  } = map;
  const compilerEffects = getResolvedModuleEffects(map);
  const revisionDocument = {
    canonicalization: tileflowMapRevisionCanonicalization,
    compilerEffects,
    effectiveCartography: {
      ...effectiveCartography,
      // The compiler family is map semantics. Its ABI version is a separate compatibility axis.
      root: {compiler: root.compiler},
    },
    schemaVersion: tileflowMapRevisionSchemaVersion,
    sourceAssets: normalizeSourceAssets(sourceAssets),
  };
  return sha256Hex(`${tileflowMapRevisionDomain}${serializeCanonicalJson(revisionDocument)}`);
}

/** Hash the exact compiled resources bound to one map, independently from its Style JSON. */
export async function hashTileflowAssetSet(
  input: readonly TileflowHashableBuildAsset[],
): Promise<string> {
  const identities = await Promise.all(
    input.map(async (asset) => ({
      byteLength:
        typeof asset.source === 'string'
          ? new TextEncoder().encode(asset.source).byteLength
          : asset.source.byteLength,
      contentType: asset.contentType,
      fileName: asset.fileName,
      sha256: await sha256Hex(asset.source),
    })),
  );
  return hashTileflowAssetSetIdentities(identities);
}

/**
 * Hash already-verified resource identities with the same v1 contract as byte-backed build assets.
 *
 * Hosted uses this after independently confirming immutable object bytes against their manifests;
 * package or bundle hashes are not substitutes for this per-file identity closure.
 */
export async function hashTileflowAssetSetIdentities(
  input: readonly TileflowBuildAssetIdentity[],
): Promise<string> {
  const seen = new Set<string>();
  const files = [...input]
    .sort((left, right) => compareCodeUnits(left.fileName, right.fileName))
    .map((asset) => {
      assertPortableAssetName(asset.fileName);
      if (seen.has(asset.fileName)) {
        throw new Error(`Duplicate Tileflow map asset: ${asset.fileName}`);
      }
      seen.add(asset.fileName);
      if (!asset.contentType || asset.contentType !== asset.contentType.trim()) {
        throw new Error(`Invalid Tileflow map asset content type: ${asset.fileName}`);
      }
      if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0) {
        throw new Error(`Invalid Tileflow map asset byte length: ${asset.fileName}`);
      }
      assertSha256(asset.sha256, `map asset ${asset.fileName}`);
      return {
        byteLength: asset.byteLength,
        contentType: asset.contentType,
        fileName: asset.fileName,
        sha256: asset.sha256,
      };
    });
  return sha256Hex(`${tileflowAssetSetDomain}${serializeCanonicalJson({files, schemaVersion: 1})}`);
}

function normalizeLineage(
  input: readonly TileflowMapBuildLineageEntry[],
  map: TileflowMap,
): TileflowMapBuildLineageEntry[] {
  if (input.length === 0 || input[0]?.id !== map.id || input[0].mapVersion !== map.version) {
    throw new Error(`Tileflow map "${map.id}" has an invalid build lineage.`);
  }
  for (const entry of input) {
    if (
      !tileflowMapIdSchema.safeParse(entry.id).success ||
      !Number.isSafeInteger(entry.mapVersion) ||
      entry.mapVersion < 1
    ) {
      throw new Error(`Tileflow map "${map.id}" has an invalid build lineage.`);
    }
  }
  return input.map((entry) => ({...entry}));
}

function normalizeSourceAssets(
  input: TileflowEffectiveMapSourceAssets,
): TileflowEffectiveMapSourceAssets {
  const icons = [...input.icons]
    .map((icon) => {
      assertSha256(icon.sha256, `icon ${icon.id}`);
      return {...icon};
    })
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const fonts = [...input.fonts]
    .map((font) => {
      assertSha256(font.sha256, `font ${font.family}`);
      return {...font};
    })
    .sort((left, right) => compareCodeUnits(fontIdentity(left), fontIdentity(right)));
  if (new Set(icons.map((icon) => icon.id)).size !== icons.length) {
    throw new Error('Effective Tileflow icon source identities must have unique ids.');
  }
  if (new Set(fonts.map(fontIdentity)).size !== fonts.length) {
    throw new Error('Effective Tileflow font source identities must have unique faces.');
  }
  return {fonts, icons};
}

function fontIdentity(font: TileflowEffectiveFontSourceIdentity): string {
  return `${font.family}\0${font.style}\0${font.weight}`;
}

function assertSha256(value: string, subject: string): void {
  if (!sha256Pattern.test(value)) {
    throw new Error(`Effective Tileflow ${subject} must have a lowercase SHA-256 identity.`);
  }
}

function assertPortableAssetName(value: string): void {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\p{Cc}]/u.test(value) ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid Tileflow map asset name: ${value}`);
  }
}
