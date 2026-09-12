import {resolve} from 'node:path';
import {tileflowIconsLockfileName} from '@tileflow/core';
import {
  collectTileflowIconSetReferences,
  compareCodeUnits,
  parseTileflowIconComposition,
  parseTileflowIconsLockfile,
  TileflowIconSetError,
  tileflowIconPackageLimits,
  type TileflowIconCompositionV1,
  type TileflowIconContributorIdentity,
  type TileflowIconSource,
} from '@tileflow/core';
import type {TileflowEffectiveIconSourceIdentity} from '@tileflow/core/build';
import {loadTileflowIconSetArtifact, type TileflowIconCacheOptions} from './icon-cache';
import {readTileflowIconsLockfile} from './icon-lockfile';
import {
  readTileflowIconDirectory,
  type CompiledTileflowIconPackage,
  type TileflowIconCompilationTarget,
} from './icons';
import {packTileflowRenderedIcons, type TileflowRenderedIcon} from './icon-sprite';

export type ComposeTileflowIconSourcesOptions = TileflowIconCacheOptions & {
  cwd: string;
  baseDirectory?: string;
  lock?: unknown;
  target?: TileflowIconCompilationTarget;
};
export type TileflowComposedIconSources = {
  package: CompiledTileflowIconPackage | null;
  composition: TileflowIconCompositionV1 | null;
  sourceIdentities: TileflowEffectiveIconSourceIdentity[];
  replacements: Array<{id: string; replaced: number; winner: number}>;
  watchPaths: string[];
};

/** Foundational build port. Registry and command integration are intentionally separate. */
export async function composeTileflowIconSources(
  input: readonly TileflowIconSource[],
  options: ComposeTileflowIconSourcesOptions,
): Promise<TileflowComposedIconSources> {
  const sources = structuredClone(input);
  const references = collectTileflowIconSetReferences(sources);
  const lock =
    references.length > 0
      ? options.lock === undefined
        ? await readTileflowIconsLockfile(options.baseDirectory ?? options.cwd, sources)
        : await parseTileflowIconsLockfile(options.lock, sources)
      : await parseTileflowIconsLockfile(options.lock ?? {lockfileVersion: 1, sets: {}}, sources);
  const contributors = new Array<TileflowIconContributorIdentity>(sources.length);
  const winners = new Map<
    string,
    {ordinal: number; icon: TileflowRenderedIcon; identity: TileflowEffectiveIconSourceIdentity}
  >();
  const watchPaths = new Set<string>();
  if (references.length > 0 && options.lock === undefined)
    watchPaths.add(resolve(options.baseDirectory ?? options.cwd, tileflowIconsLockfileName));
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
      if (sources.length === 1) reused = loaded.package;
      for (const icon of loaded.icons) {
        if (winners.has(icon.id)) continue;
        const pixels = pin.manifest.renderedIcons.find(
          (entry) => entry.name === icon.id,
        )!.pixelSha256;
        addWinner(ordinal, icon, {
          kind: 'rendered-icon',
          id: icon.id,
          width: icon.oneX.width,
          height: icon.oneX.height,
          pixelSha256: {...pixels},
        });
      }
    } else {
      const directory = await readTileflowIconDirectory(source, {
        cwd: options.cwd,
        baseDirectory: options.baseDirectory ?? options.cwd,
        target: options.target ?? 'local',
      });
      if (directory.watchPath) watchPaths.add(directory.watchPath);
      contributors[ordinal] =
        typeof source === 'string'
          ? {kind: 'local', iconIds: directory.iconIds}
          : {kind: 'package', package: source.package, iconIds: directory.iconIds};
      const selected = directory.iconIds.filter((id) => !winners.has(id));
      if (winners.size + selected.length > tileflowIconPackageLimits.maxIconCount)
        throw new TileflowIconSetError(
          'ICON_COMPOSITION_INVALID',
          'Composed icon set exceeds 256 effective icons',
        );
      for (const item of await directory.render(selected)) {
        localSourceBytes += item.sourceBytes;
        if (localSourceBytes > tileflowIconPackageLimits.maxSourceBytes)
          throw new TileflowIconSetError(
            'ICON_COMPOSITION_INVALID',
            'Effective local icon originals exceed the source-byte limit',
          );
        addWinner(ordinal, item.icon, item.identity);
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
    sourceIdentities: sorted.map((winner) => winner.identity),
    replacements,
    watchPaths: [...watchPaths].sort(compareCodeUnits),
  };

  function addWinner(
    ordinal: number,
    icon: TileflowRenderedIcon,
    identity: TileflowEffectiveIconSourceIdentity,
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
    winners.set(icon.id, {ordinal, icon, identity});
  }
}
