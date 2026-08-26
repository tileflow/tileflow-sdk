import {compareCodeUnits, type TileflowIconPackageManifest} from './icon-package';

export type TileflowIconManifestDiff = {
  added: string[];
  afterBytes: number;
  beforeBytes: number;
  modified: string[];
  removed: string[];
  unchangedCount: number;
};

export function diffTileflowIconPackageManifests(
  before: TileflowIconPackageManifest | null,
  after: TileflowIconPackageManifest | null,
): TileflowIconManifestDiff {
  const beforeIcons = new Map(
    (before?.renderedIcons ?? []).map((entry) => [entry.name, entry.pixelSha256]),
  );
  const afterIcons = new Map(
    (after?.renderedIcons ?? []).map((entry) => [entry.name, entry.pixelSha256]),
  );
  const names = [...new Set([...beforeIcons.keys(), ...afterIcons.keys()])].sort(compareCodeUnits);
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  let unchangedCount = 0;

  for (const name of names) {
    const previous = beforeIcons.get(name);
    const proposed = afterIcons.get(name);

    if (!previous) {
      added.push(name);
    } else if (!proposed) {
      removed.push(name);
    } else if (previous.oneX !== proposed.oneX || previous.twoX !== proposed.twoX) {
      modified.push(name);
    } else {
      unchangedCount += 1;
    }
  }

  return {
    added,
    afterBytes: packageBytes(after),
    beforeBytes: packageBytes(before),
    modified,
    removed,
    unchangedCount,
  };
}

function packageBytes(manifest: TileflowIconPackageManifest | null): number {
  return manifest?.files.reduce((total, file) => total + file.byteLength, 0) ?? 0;
}
