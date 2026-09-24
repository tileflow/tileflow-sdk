import {realpath} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {tileflowIconsLockfileName} from '@tileflow/core';
import {
  collectTileflowIconSetReferences,
  compareCodeUnits,
  parseTileflowIconComposition,
  parseTileflowIconsLockfile,
  type TileflowIconCompositionV1,
  type TileflowIconContributorIdentity,
  tileflowIconPackageLimits,
  TileflowIconSetError,
  type TileflowIconSource,
} from '@tileflow/core';
import type {TileflowEffectiveIconSourceIdentity} from '@tileflow/core/build';
import {loadTileflowIconSetArtifact, type TileflowIconCacheOptions} from './icon-cache';
import {readTileflowIconsLockfile} from './icon-lockfile';
import {packTileflowRenderedIcons, type TileflowRenderedIcon} from './icon-sprite';
import {
  type CompiledTileflowIconPackage,
  readTileflowIconDirectory,
  type TileflowIconCompilationTarget,
  type TileflowIconDirectoryEntry,
  type TileflowIconDirectorySourceFile,
} from './icons';

export type ComposeTileflowIconSourcesOptions = TileflowIconCacheOptions & {
  cwd: string;
  baseDirectory?: string;
  /** Trusted caller-owned diagnostic prefix, such as `maps.main.icons`. */
  configPath?: string;
  lock?: unknown;
  target?: TileflowIconCompilationTarget;
};

/** One declared contributor, retained even when later contributors shadow all of its exports. */
export type TileflowComposedIconContributor =
  | {
      /** Ordered declared entries, before later contributors replace any of them. */
      entries: readonly TileflowIconDirectoryEntry[];
      iconIds: readonly string[];
      insideWorkingTree: boolean;
      kind: 'local' | 'package';
      label: string;
    }
  | {
      iconIds: readonly string[];
      kind: 'icon-set';
      /** Canonical `@team/set` reference; the exact revision lives in the receipt. */
      label: string;
      packageId: string;
      reference: string;
      setId: string;
      version: number;
      versionId: string;
    };

/** One effective icon after ordered last-wins replacement has completed. */
export type TileflowComposedIconWinner = {
  contributor: number;
  id: string;
  identity: TileflowEffectiveIconSourceIdentity;
  /** Present only for filesystem-backed winners; verified shared cells expose no original. */
  source: TileflowIconDirectorySourceFile | null;
};

export type TileflowComposedIconSources = {
  package: CompiledTileflowIconPackage | null;
  composition: TileflowIconCompositionV1 | null;
  contributors: TileflowComposedIconContributor[];
  sourceIdentities: TileflowEffectiveIconSourceIdentity[];
  replacements: Array<{id: string; replaced: number; winner: number}>;
  /** Exact files whose contents select this composition, such as the icon lock. */
  watchFiles: string[];
  /** Local directories whose children can change the composition without a config edit. */
  watchPaths: string[];
  winners: TileflowComposedIconWinner[];
};

/** The single normal icon-preparation path for declared local, package and shared contributors. */
export async function composeTileflowIconSources(
  input: readonly TileflowIconSource[],
  options: ComposeTileflowIconSourcesOptions,
): Promise<TileflowComposedIconSources> {
  const sources = structuredClone(input);
  const references = collectTileflowIconSetReferences(sources);
  let realCwd: string | undefined;
  const lock =
    references.length > 0
      ? options.lock === undefined
        ? await readTileflowIconsLockfile(options.baseDirectory ?? options.cwd, sources)
        : await parseTileflowIconsLockfile(options.lock, sources)
      : await parseTileflowIconsLockfile(options.lock ?? {lockfileVersion: 1, sets: {}}, sources);
  const contributors = new Array<TileflowIconContributorIdentity>(sources.length);
  const details = new Array<TileflowComposedIconContributor>(sources.length);
  const winners = new Map<
    string,
    {
      ordinal: number;
      icon: TileflowRenderedIcon;
      identity: TileflowEffectiveIconSourceIdentity;
      source: TileflowIconDirectorySourceFile | null;
    }
  >();
  const watchPaths = new Set<string>();
  const watchFiles = new Set<string>();
  if (references.length > 0 && options.lock === undefined)
    watchFiles.add(resolve(options.baseDirectory ?? options.cwd, tileflowIconsLockfileName));
  let reused: CompiledTileflowIconPackage | undefined;
  let pixelBytes = 0;
  let localSourceBytes = 0;
  // Reverse traversal selects winners before decoding local originals and releases each input atlas.
  for (let ordinal = sources.length - 1; ordinal >= 0; ordinal -= 1) {
    const source = sources[ordinal]!;
    if (typeof source === 'object' && source.kind === 'icon-set') {
      const pin = lock.sets[source.reference]!;
      const loaded = await loadTileflowIconSetArtifact(pin, options);
      contributors[ordinal] = {
        kind: 'icon-set',
        reference: source.reference,
        teamId: pin.teamId,
        setId: pin.setId,
        versionId: pin.versionId,
        version: pin.version,
        packageId: pin.packageId,
        contentHash: pin.contentHash,
        iconIds: [...pin.manifest.iconNames],
      };
      details[ordinal] = {
        iconIds: [...pin.manifest.iconNames],
        kind: 'icon-set',
        label: source.reference,
        packageId: pin.packageId,
        reference: source.reference,
        setId: pin.setId,
        version: pin.version,
        versionId: pin.versionId,
      };
      if (sources.length === 1) reused = loaded.package;
      for (const icon of loaded.icons) {
        if (winners.has(icon.id)) continue;
        const pixels = pin.manifest.renderedIcons.find(
          (entry) => entry.name === icon.id,
        )!.pixelSha256;
        addWinner(
          ordinal,
          icon,
          {
            kind: 'rendered-icon',
            id: icon.id,
            width: icon.oneX.width,
            height: icon.oneX.height,
            pixelSha256: {...pixels},
          },
          null,
        );
      }
    } else {
      const directory = await readTileflowIconDirectory(source, {
        cwd: options.cwd,
        baseDirectory: options.baseDirectory ?? options.cwd,
        ...(options.configPath === undefined ? {} : {configPath: options.configPath}),
        ordinal,
        target: options.target ?? 'local',
      });
      if (directory.watchPath) watchPaths.add(directory.watchPath);
      contributors[ordinal] =
        typeof source === 'string'
          ? {kind: 'local', iconIds: directory.iconIds}
          : {kind: 'package', package: source.package, iconIds: directory.iconIds};
      details[ordinal] = {
        entries: directory.entries,
        iconIds: directory.iconIds,
        insideWorkingTree: isPathInside(
          (realCwd ??= await realpath(options.cwd)),
          directory.realPath,
        ),
        kind: typeof source === 'string' ? 'local' : 'package',
        label: directory.label,
      };
      const selected = directory.iconIds.filter((id) => !winners.has(id));
      if (winners.size + selected.length > tileflowIconPackageLimits.maxIconCount)
        throw new TileflowIconSetError(
          'ICON_COMPOSITION_INVALID',
          `Composed icon set exceeds ${tileflowIconPackageLimits.maxIconCount} effective icons`,
        );
      for (const item of await directory.render(selected)) {
        localSourceBytes += item.sourceBytes;
        if (localSourceBytes > tileflowIconPackageLimits.maxSourceBytes)
          throw new TileflowIconSetError(
            'ICON_COMPOSITION_INVALID',
            'Effective local icon originals exceed the source-byte limit',
          );
        addWinner(ordinal, item.icon, item.identity, item.source);
      }
    }
  }
  const sorted = [...winners.values()].sort((left, right) =>
    compareCodeUnits(left.icon.id, right.icon.id),
  );
  const iconPackage = sorted.length
    ? (reused ?? (await packTileflowRenderedIcons(sorted.map((winner) => winner.icon))))
    : null;
  const composition =
    references.length && iconPackage
      ? parseTileflowIconComposition({
          format: 'tileflow-icon-composition-v1',
          compositionVersion: 1,
          packageHash: iconPackage.contentHash,
          contributors,
          winners: sorted.map(({ordinal, icon}, index) => ({
            id: icon.id,
            contributor: ordinal,
            width: icon.oneX.width,
            height: icon.oneX.height,
            pixelSha256: iconPackage.manifest.renderedIcons[index]!.pixelSha256,
          })),
        })
      : null;
  const previous = new Map<string, number>();
  const replacements: TileflowComposedIconSources['replacements'] = [];
  for (const [ordinal, contributor] of contributors.entries()) {
    for (const id of contributor.iconIds) {
      const replaced = previous.get(id);
      if (replaced !== undefined) replacements.push({id, replaced, winner: ordinal});
      previous.set(id, ordinal);
    }
  }
  return {
    package: iconPackage,
    composition,
    contributors: details,
    sourceIdentities: sorted.map((winner) => winner.identity),
    replacements,
    watchFiles: [...watchFiles].sort(compareCodeUnits),
    watchPaths: [...watchPaths].sort(compareCodeUnits),
    winners: sorted.map((winner) => ({
      contributor: winner.ordinal,
      id: winner.icon.id,
      identity: winner.identity,
      source: winner.source,
    })),
  };

  function addWinner(
    ordinal: number,
    icon: TileflowRenderedIcon,
    identity: TileflowEffectiveIconSourceIdentity,
    source: TileflowIconDirectorySourceFile | null,
  ): void {
    pixelBytes += icon.oneX.rgba.byteLength + icon.twoX.rgba.byteLength;
    const maximumPixelBytes =
      (tileflowIconPackageLimits.maxAtlasDimension ** 2 +
        (tileflowIconPackageLimits.maxAtlasDimension / 2) ** 2) *
      4;
    if (winners.size >= tileflowIconPackageLimits.maxIconCount || pixelBytes > maximumPixelBytes)
      throw new TileflowIconSetError(
        'ICON_COMPOSITION_INVALID',
        'Composed rendered cells exceed the final sprite capacity',
      );
    winners.set(icon.id, {ordinal, icon, identity, source});
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  );
}
