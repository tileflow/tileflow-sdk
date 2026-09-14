import type {Command} from 'commander';
import {dirname} from 'node:path';
import {compareCodeUnits} from '@tileflow/core';
import {
  getTileflowMapNames,
  loadValidTileflowConfigWithInputs,
  TileflowValidationError,
} from '@tileflow/dev/config';
import {
  inspectTileflowIconCatalogs,
  type TileflowIconCatalog,
  type TileflowIconCatalogContributor,
  type TileflowIconCatalogInspection,
  type TileflowIconCatalogMap,
  TileflowIconCompilationError,
  type TileflowIconResolutionOptions,
} from '@tileflow/dev/icons';
import type {TileflowIconCompositionV1} from '@tileflow/core';
import {withTileflowConfigSecretsHidden} from './config-execution';

export type TileflowIconListJsonV3 = {
  schemaVersion: 3;
  pathBase: 'cwd';
  maps: TileflowIconMapJson[];
};

/** One declared contributor in exact authoring order, retained even when fully shadowed. */
export type TileflowIconContributorJson =
  | {
      kind: 'local' | 'package';
      label: string;
      iconIds: string[];
      insideWorkingTree: boolean;
    }
  | {
      kind: 'icon-set';
      label: string;
      iconIds: string[];
      reference: string;
      version: number;
    };

export type TileflowIconSourceJson =
  | {
      kind: 'file';
      id: string;
      contributor: number;
      path: string;
      format: 'jpeg' | 'png' | 'svg' | 'webp';
      byteLength: number;
      dimensions: {width: number; height: number} | null;
    }
  | {
      kind: 'icon-set';
      id: string;
      contributor: number;
      reference: string;
      version: number;
    };

export type TileflowIconReplacementJson = {
  id: string;
  replaced: string;
  winner: string;
};

export type TileflowIconMapJson = {
  id: string;
  icons:
    | {
        kind: 'sources';
        contributors: TileflowIconContributorJson[];
        finalIds: string[];
        insideWorkingTree: boolean;
        replacements: TileflowIconReplacementJson[];
        packageHash: string;
        /** Exact ordered shared dependencies; `null` when the map declares no Icon Set. */
        composition: TileflowIconCompositionV1 | null;
        sources: TileflowIconSourceJson[];
      }
    | {
        kind: 'none';
      };
};

type IconListOptions = {
  cacheDir?: string;
  config: string;
  json?: boolean;
  map?: string;
  offline?: boolean;
};

export function registerIconListCommand(
  icons: Command,
  dependencies: {defaultConfigPath: string},
): void {
  icons
    .command('list')
    .description('List each map icon directory composition as deterministic agent JSON')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--map <id>', 'inspect one exact configured map')
    .option('--cache-dir <path>', 'verified Icon Set artifact cache root')
    .option('--offline', 'fail a locked Icon Set cache miss instead of hydrating it')
    .option('--json', 'print deterministic schema-version-3 JSON')
    .action(async (options: IconListOptions) => {
      if (!options.json) {
        console.error(
          'tileflow icons list currently requires --json. Run tileflow icons list --json.',
        );
        process.exitCode = 1;
        return;
      }

      try {
        await runIconList(options);
      } catch (error) {
        printIconListError(error);
        process.exitCode = 1;
      }
    });
}

export function createTileflowIconListJson(
  inspection: TileflowIconCatalogInspection,
): TileflowIconListJsonV3 {
  return {
    schemaVersion: 3,
    pathBase: 'cwd',
    maps: [...inspection.maps]
      .sort((left, right) => compareCodeUnits(left.name, right.name))
      .map((map) => createMapJson(map, inspection.catalogs)),
  };
}

export function serializeTileflowIconListJson(value: TileflowIconListJsonV3): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runIconList(options: IconListOptions): Promise<void> {
  const loaded = await withTileflowConfigSecretsHidden(() =>
    loadValidTileflowConfigWithInputs(options.config),
  );
  const project = loaded.project;
  const mapIds = getTileflowMapNames(project).sort(compareCodeUnits);

  if (options.map && !Object.hasOwn(project.maps, options.map)) {
    throw new Error(
      `Unknown map "${options.map}". Available maps: ${mapIds.join(', ') || '(none)'}`,
    );
  }

  const icons: TileflowIconResolutionOptions = {
    ...(options.cacheDir ? {cacheRoot: options.cacheDir} : {}),
    ...(options.offline ? {offline: true} : {}),
  };
  const inspection = await inspectTileflowIconCatalogs(project, {
    baseDirectory: dirname(loaded.configFile),
    cwd: process.cwd(),
    ...(Object.keys(icons).length > 0 ? {icons} : {}),
    ...(options.map ? {mapNames: [options.map]} : {}),
  });
  process.stdout.write(serializeTileflowIconListJson(createTileflowIconListJson(inspection)));
}

function createMapJson(
  map: TileflowIconCatalogMap,
  catalogs: readonly TileflowIconCatalog[],
): TileflowIconMapJson {
  if (map.icons.kind === 'none') {
    return {id: map.name, icons: {kind: 'none'}};
  }
  const mapIcons = map.icons;

  const catalog = catalogs.find(
    (candidate) =>
      candidate.compiledPackage.contentHash === mapIcons.packageHash &&
      sameContributors(candidate.contributors, mapIcons.contributors),
  );
  if (!catalog) {
    throw new Error(`Missing inspected icon catalog for map ${map.name}`);
  }

  return {
    id: map.name,
    icons: {
      kind: 'sources',
      contributors: mapIcons.contributors.map(createContributorJson),
      finalIds: [...mapIcons.iconIds],
      insideWorkingTree: catalog.insideWorkingTree,
      replacements: catalog.replacements.map((replacement) => ({
        id: replacement.id,
        replaced: replacement.replaced,
        winner: replacement.winner,
      })),
      packageHash: mapIcons.packageHash,
      composition: mapIcons.composition,
      sources: [...catalog.icons]
        .sort((left, right) => compareCodeUnits(left.id, right.id))
        .map((icon): TileflowIconSourceJson =>
          icon.source.kind === 'icon-set'
            ? {
                kind: 'icon-set',
                id: icon.id,
                contributor: icon.source.contributor,
                reference: icon.source.reference,
                version: icon.source.version,
              }
            : {
                kind: 'file',
                id: icon.id,
                contributor: icon.source.contributor,
                path: icon.source.path,
                format: icon.source.format,
                byteLength: icon.source.byteLength,
                dimensions: icon.source.dimensions
                  ? {width: icon.source.dimensions.width, height: icon.source.dimensions.height}
                  : null,
              },
        ),
    },
  };
}

function createContributorJson(
  contributor: TileflowIconCatalogContributor,
): TileflowIconContributorJson {
  return contributor.kind === 'icon-set'
    ? {
        kind: 'icon-set',
        label: contributor.label,
        iconIds: [...contributor.iconIds],
        reference: contributor.reference,
        version: contributor.version,
      }
    : {
        kind: contributor.kind,
        label: contributor.label,
        iconIds: [...contributor.iconIds],
        insideWorkingTree: contributor.insideWorkingTree,
      };
}

function sameContributors(
  left: readonly TileflowIconCatalogContributor[],
  right: readonly TileflowIconCatalogContributor[],
): boolean {
  return (
    left.length === right.length &&
    left.every((contributor, index) => contributor.label === right[index]?.label)
  );
}

function printIconListError(error: unknown): void {
  if (error instanceof TileflowValidationError) {
    printIssues('Tileflow config has errors.', error.messages);
    return;
  }

  if (error instanceof TileflowIconCompilationError) {
    printIssues('Tileflow icon catalog has errors.', error.issues);
    return;
  }

  console.error(error instanceof Error ? error.message : 'Icon catalog listing failed.');
}

function printIssues(heading: string, issues: readonly {message: string; path: string}[]): void {
  console.error(
    [heading, ...issues.map((issue) => `- ${issue.path || '(root)'}: ${issue.message}`)].join('\n'),
  );
}
