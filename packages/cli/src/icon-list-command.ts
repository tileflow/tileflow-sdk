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
  type TileflowIconCatalogInspection,
  type TileflowIconCatalogMap,
  TileflowIconCompilationError,
} from '@tileflow/dev/icons';
import {withTileflowConfigSecretsHidden} from './config-execution';

export type TileflowIconListJsonV2 = {
  schemaVersion: 2;
  pathBase: 'cwd';
  maps: TileflowIconMapJson[];
};

export type TileflowIconSourceJson = {
  id: string;
  path: string;
  format: 'jpeg' | 'png' | 'svg' | 'webp';
  byteLength: number;
  dimensions: {width: number; height: number} | null;
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
        kind: 'directories';
        directories: string[];
        finalIds: string[];
        insideWorkingTree: boolean;
        replacements: TileflowIconReplacementJson[];
        packageHash: string;
        sources: TileflowIconSourceJson[];
      }
    | {
        kind: 'none';
      };
};

type IconListOptions = {
  config: string;
  json?: boolean;
  map?: string;
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
    .option('--json', 'print deterministic schema-version-2 JSON')
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
): TileflowIconListJsonV2 {
  return {
    schemaVersion: 2,
    pathBase: 'cwd',
    maps: [...inspection.maps]
      .sort((left, right) => compareCodeUnits(left.name, right.name))
      .map((map) => createMapJson(map, inspection.catalogs)),
  };
}

export function serializeTileflowIconListJson(value: TileflowIconListJsonV2): string {
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

  const inspection = await inspectTileflowIconCatalogs(project, {
    baseDirectory: dirname(loaded.configFile),
    cwd: process.cwd(),
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
      sameStrings(candidate.directories, mapIcons.directories),
  );
  if (!catalog) {
    throw new Error(`Missing inspected icon catalog for map ${map.name}`);
  }

  return {
    id: map.name,
    icons: {
      kind: 'directories',
      directories: [...mapIcons.directories],
      finalIds: [...mapIcons.iconIds],
      insideWorkingTree: catalog.insideWorkingTree,
      replacements: catalog.replacements.map((replacement) => ({
        id: replacement.id,
        replaced: replacement.replaced,
        winner: replacement.winner,
      })),
      packageHash: mapIcons.packageHash,
      sources: [...catalog.icons]
        .sort((left, right) => compareCodeUnits(left.id, right.id))
        .map((icon) => ({
          id: icon.id,
          path: icon.source.path,
          format: icon.source.format,
          byteLength: icon.source.byteLength,
          dimensions: icon.source.dimensions
            ? {width: icon.source.dimensions.width, height: icon.source.dimensions.height}
            : null,
        })),
    },
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
