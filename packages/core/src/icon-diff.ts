import {compareCodeUnits, type TileflowIconPackageManifest} from './icon-package';
import type {TileflowProjectConfig} from './project';
import type {TileflowIconSet} from './types';

export type TileflowIconManifestDiff = {
  added: string[];
  afterBytes: number;
  beforeBytes: number;
  modified: string[];
  removed: string[];
  unchangedCount: number;
};

export type TileflowIconMappingChange = {
  after?: string;
  before?: string;
  key: string;
};

export type TileflowIconMappingDiff = {
  added: TileflowIconMappingChange[];
  changed: TileflowIconMappingChange[];
  removed: TileflowIconMappingChange[];
};

export type TileflowIconReferenceAnalysis = {
  analysisComplete: boolean;
  dangling: Array<{
    iconName: string;
    kind: 'mapping' | 'style-override-literal';
    path: string;
  }>;
  unanalyzable: Array<{
    kind: 'style-override-expression';
    path: string;
  }>;
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

export function diffTileflowIconMappings(
  before: Record<string, string> | null,
  after: Record<string, string> | null,
): TileflowIconMappingDiff {
  const previous = before ?? {};
  const proposed = after ?? {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(proposed)])].sort(
    compareCodeUnits,
  );
  const result: TileflowIconMappingDiff = {added: [], changed: [], removed: []};

  for (const key of keys) {
    const beforeTarget = previous[key];
    const afterTarget = proposed[key];

    if (beforeTarget === undefined && afterTarget !== undefined) {
      result.added.push({after: afterTarget, key});
    } else if (beforeTarget !== undefined && afterTarget === undefined) {
      result.removed.push({before: beforeTarget, key});
    } else if (beforeTarget !== afterTarget) {
      result.changed.push({after: afterTarget, before: beforeTarget, key});
    }
  }

  return result;
}

export function inspectTileflowIconReferences(
  project: TileflowProjectConfig,
  mapName: string,
  availableIconNames: readonly string[],
): TileflowIconReferenceAnalysis {
  const map = Object.hasOwn(project.maps, mapName) ? project.maps[mapName] : undefined;

  if (!map) {
    throw new Error(`Unknown Tileflow map: ${mapName}`);
  }

  const available = new Set(availableIconNames);
  const dangling: TileflowIconReferenceAnalysis['dangling'] = [];
  const unanalyzable: TileflowIconReferenceAnalysis['unanalyzable'] = [];
  const mapping = resolveMappingReferences(project, mapName, map.icons);

  for (const reference of mapping.values()) {
    if (!available.has(reference.iconName)) {
      dangling.push({...reference, kind: 'mapping'});
    }
  }

  for (const [index, override] of (map.overrides ?? []).entries()) {
    const layout =
      override.kind === 'patch'
        ? (override.patch.layout as Record<string, unknown> | undefined)
        : override.kind === 'add'
          ? (override.layer.layout as Record<string, unknown> | undefined)
          : undefined;
    if (!layout || !Object.hasOwn(layout, 'icon-image')) continue;
    const path = `maps.${mapName}.overrides.${index}.${override.kind === 'add' ? 'layer' : 'patch'}.layout.icon-image`;
    const inspection = inspectIconImageValue(layout['icon-image']);
    for (const iconName of inspection.managedIconNames) {
      if (!available.has(iconName)) {
        dangling.push({iconName, kind: 'style-override-literal', path});
      }
    }
    if (!inspection.complete) {
      unanalyzable.push({kind: 'style-override-expression', path});
    }
  }

  const uniqueDangling = uniqueBy(
    dangling,
    (item) => `${item.kind}\0${item.path}\0${item.iconName}`,
  ).sort(compareReferences);
  const uniqueUnanalyzable = uniqueBy(unanalyzable, (item) => `${item.kind}\0${item.path}`).sort(
    (left, right) => compareCodeUnits(left.path, right.path),
  );

  return {
    analysisComplete: uniqueUnanalyzable.length === 0,
    dangling: uniqueDangling,
    unanalyzable: uniqueUnanalyzable,
  };
}

export function resolveTileflowIconMapping(
  project: TileflowProjectConfig,
  mapName: string,
): Record<string, string> {
  const map = Object.hasOwn(project.maps, mapName) ? project.maps[mapName] : undefined;

  if (!map) {
    throw new Error(`Unknown Tileflow map: ${mapName}`);
  }

  return Object.fromEntries(
    [...resolveMappingReferences(project, mapName, map.icons).entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, reference]) => [key, reference.iconName]),
  );
}

function packageBytes(manifest: TileflowIconPackageManifest | null): number {
  return manifest?.files.reduce((total, file) => total + file.byteLength, 0) ?? 0;
}

function resolveMappingReferences(
  project: TileflowProjectConfig,
  mapName: string,
  icons: TileflowIconSet | undefined,
): Map<string, {iconName: string; path: string}> {
  const result = new Map<string, {iconName: string; path: string}>();

  function apply(
    value: TileflowIconSet | undefined,
    path: string,
    rootPath: readonly string[],
  ): void {
    if (!value) {
      return;
    }

    if (typeof value === 'string') {
      const referenced = Object.hasOwn(project.icons ?? {}, value)
        ? project.icons?.[value]
        : undefined;

      if (!referenced) {
        return;
      }

      if (rootPath.includes(value)) {
        throw new Error(`Circular Tileflow icon set extends: ${[...rootPath, value].join(' -> ')}`);
      }

      apply(referenced, `icons.${value}`, [...rootPath, value]);
      return;
    }

    if (value.extends) {
      apply(value.extends, path, rootPath);
    }

    for (const [key, iconName] of Object.entries(value.mapping ?? {}).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      result.set(key, {iconName, path: `${path}.mapping.${key}`});
    }
  }

  apply(icons, `maps.${mapName}.icons`, []);
  return result;
}

function inspectIconImageValue(value: unknown): {
  complete: boolean;
  managedIconNames: string[];
} {
  if (typeof value === 'string') {
    const managed = managedIconName(value);
    return {complete: true, managedIconNames: managed ? [managed] : []};
  }

  if (!Array.isArray(value)) {
    return {complete: false, managedIconNames: []};
  }

  const managedIconNames = new Set<string>();
  collectManagedImageLiterals(value, managedIconNames);
  const isSingleLiteralImage =
    value.length === 2 &&
    (value[0] === 'image' || value[0] === 'literal') &&
    typeof value[1] === 'string';

  return {
    complete: isSingleLiteralImage,
    managedIconNames: [...managedIconNames].sort(compareCodeUnits),
  };
}

function collectManagedImageLiterals(value: unknown, result: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  if ((value[0] === 'image' || value[0] === 'literal') && typeof value[1] === 'string') {
    const managed = managedIconName(value[1]);

    if (managed) {
      result.add(managed);
    }
  }

  for (const child of value) {
    collectManagedImageLiterals(child, result);
  }
}

function managedIconName(value: string): string | null {
  return value.startsWith('tileflow:') && value.length > 'tileflow:'.length
    ? value.slice('tileflow:'.length)
    : null;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function compareReferences(
  left: TileflowIconReferenceAnalysis['dangling'][number],
  right: TileflowIconReferenceAnalysis['dangling'][number],
): number {
  return (
    compareCodeUnits(left.path, right.path) ||
    compareCodeUnits(left.kind, right.kind) ||
    compareCodeUnits(left.iconName, right.iconName)
  );
}
