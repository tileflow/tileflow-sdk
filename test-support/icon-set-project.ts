import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  serializeTileflowIconsLockfile,
  tileflowIconsLockfileName,
  type TileflowIconPackageManifest,
  type TileflowIconSetPin,
} from '@tileflow/core';
import {
  type CompiledTileflowIconPackage,
  packTileflowRenderedIcons,
  storeTileflowIconSetArtifact,
  type TileflowRenderedIcon,
} from '@tileflow/dev/icons';
import {linkWorkspacePackages} from './workspace-packages';

export const tileflowIconSetFixtureGlyphs =
  "{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold']}";

const unreferencedModules = "{poi:{type:'poi',icons:false},roads:disable()}";
const localOverrideSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2563eb"/></svg>';

export type TileflowIconSetFixture = {
  /** The seeded verified artifact cache root; a build never reaches the network from it. */
  cacheRoot: string;
  pins: Record<string, TileflowIconSetPin>;
  /** Publish a newer catalog revision that no consumer may adopt without a lock change. */
  publishNewerRevision: (reference: string) => Promise<TileflowIconSetPin>;
  references: string[];
};

function renderedIcon(
  id: string,
  color: readonly [number, number, number, number],
  width = 4,
  height = 2,
): TileflowRenderedIcon {
  const cell = (ratio: number) => {
    const rgba = new Uint8Array(width * height * ratio * ratio * 4);
    for (let index = 0; index < rgba.length; index += 4) rgba.set(color, index);
    return {width: width * ratio, height: height * ratio, rgba};
  };
  return {id, oneX: cell(1), twoX: cell(2)};
}

async function pinFor(
  index: number,
  version: number,
  artifact: CompiledTileflowIconPackage,
): Promise<TileflowIconSetPin> {
  const packageId = `icp_${artifact.contentHash.slice(0, 16)}`;
  return {
    teamId: 'team_fixture',
    setId: `ics_${String(index).padStart(16, '0')}`,
    versionId: `icv_${`${index}-${version}`.padStart(16, '0')}`,
    version,
    packageId,
    contentHash: artifact.contentHash,
    manifest: artifact.manifest as TileflowIconPackageManifest,
    spriteUrl: `https://api.tileflow.dev/sprites/${packageId}/sprite`,
  };
}

/**
 * Write one repository fixture that composes two exact shared pins plus a later local override.
 *
 * Every normal consumer reads the same fixture through the one Dev preparation path, so a
 * consumer-specific icon resolver would immediately diverge from these expectations.
 */
export async function createTileflowIconSetProject(
  cwd: string,
  options: {mapId?: string} = {},
): Promise<TileflowIconSetFixture> {
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  const brandArtifact = await packTileflowRenderedIcons([
    renderedIcon('hospital', [255, 0, 0, 255]),
    renderedIcon('shop', [0, 255, 0, 255]),
  ]);
  const transportArtifact = await packTileflowRenderedIcons([
    renderedIcon('hospital', [10, 20, 30, 255]),
    renderedIcon('bus', [0, 0, 255, 255]),
  ]);
  const brand = await pinFor(1, 1, brandArtifact);
  const transport = await pinFor(2, 2, transportArtifact);
  await storeTileflowIconSetArtifact(brand, brandArtifact, {cacheRoot: cwd});
  await storeTileflowIconSetArtifact(transport, transportArtifact, {cacheRoot: cwd});

  await mkdir(join(cwd, 'icons'), {recursive: true});
  await writeFile(join(cwd, 'icons', 'shop.svg'), localOverrideSvg);
  await writeFile(
    join(cwd, tileflowIconsLockfileName),
    await serializeTileflowIconsLockfile({
      lockfileVersion: 1,
      sets: {'@acme/brand': brand, '@acme/transport': transport},
    }),
  );
  const mapId = options.mapId ?? 'main';
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, disable, iconSet} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:${JSON.stringify(mapId)},version:1,extends:streets,icons:[iconSet('@acme/brand'),iconSet('@acme/transport'),'./icons'],modules:${unreferencedModules},glyphs:${tileflowIconSetFixtureGlyphs}});\n`,
  );

  return {
    cacheRoot: cwd,
    pins: {'@acme/brand': brand, '@acme/transport': transport},
    references: ['@acme/brand', '@acme/transport'],
    async publishNewerRevision(reference) {
      const artifact = await packTileflowRenderedIcons([
        renderedIcon('hospital', [1, 2, 3, 255]),
        renderedIcon(reference === '@acme/brand' ? 'shop' : 'bus', [4, 5, 6, 255]),
      ]);
      const next = await pinFor(reference === '@acme/brand' ? 1 : 2, 9, artifact);
      await storeTileflowIconSetArtifact(next, artifact, {cacheRoot: cwd});
      return next;
    },
  };
}
