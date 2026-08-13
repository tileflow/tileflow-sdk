import type {Command} from 'commander';
import {compareCodeUnits, type TileflowIconPackageFileName} from '@tileflow/core';
import {
  getTileflowMapNames,
  inspectTileflowIconCatalogs,
  loadValidTileflowConfig,
  type TileflowIconCatalog,
  type TileflowIconCatalogInspection,
  type TileflowIconCatalogMap,
  type TileflowIconCatalogMapping,
  TileflowIconCompilationError,
  TileflowValidationError,
} from '@tileflow/dev';

export type TileflowIconListJsonV1 = {
  schemaVersion: 1;
  pathBase: 'cwd';
  catalogs: TileflowIconCatalogJson[];
  maps: TileflowIconMapJson[];
};

export type TileflowIconCatalogJson = {
  sourcePath: string;
  insideWorkingTree: boolean;
  packageHash: string;
  iconCount: number;
  generatedByteLength: number;
  atlas: {
    oneX: TileflowIconAtlasJson;
    twoX: TileflowIconAtlasJson;
  };
  icons: TileflowIconJson[];
};

export type TileflowIconAtlasJson = {
  pixelRatio: 1 | 2;
  width: number;
  height: number;
  index: TileflowIconGeneratedFileJson;
  image: TileflowIconGeneratedFileJson;
};

export type TileflowIconGeneratedFileJson = {
  fileName: string;
  byteLength: number;
  sha256: string;
};

export type TileflowIconJson = {
  id: string;
  source: {
    path: string;
    format: 'jpeg' | 'png' | 'svg' | 'webp';
    byteLength: number;
    dimensions: {width: number; height: number} | null;
  };
  rendered: {
    oneX: TileflowRenderedIconJson;
    twoX: TileflowRenderedIconJson;
  };
  mappedFrom: Array<{map: string; semantic: string}>;
};

export type TileflowRenderedIconJson = {
  pixelRatio: 1 | 2;
  width: number;
  height: number;
  pixelSha256: string;
  atlas: {x: number; y: number; width: number; height: number};
};

export type TileflowIconMappingJson = {
  semantic: string;
  iconId: string;
  targetStatus: 'missing' | 'present' | 'unknown';
};

export type TileflowIconMapJson = {
  name: string;
  icons:
    | {
        kind: 'local';
        label: string;
        catalogSourcePath: string;
        packageHash: string;
        mappings: TileflowIconMappingJson[];
      }
    | {
        kind: 'external';
        inspectable: false;
        mappings: TileflowIconMappingJson[];
      }
    | {
        kind: 'none';
        inspectable: false;
        mappings: TileflowIconMappingJson[];
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
    .description('List local icon catalogs as deterministic agent JSON')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--map <name>', 'inspect one exact configured map')
    .option('--json', 'print deterministic schema-version-1 JSON')
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
): TileflowIconListJsonV1 {
  return {
    schemaVersion: 1,
    pathBase: 'cwd',
    catalogs: [...inspection.catalogs]
      .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath))
      .map(createCatalogJson),
    maps: [...inspection.maps]
      .sort((left, right) => compareCodeUnits(left.name, right.name))
      .map(createMapJson),
  };
}

export function serializeTileflowIconListJson(value: TileflowIconListJsonV1): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runIconList(options: IconListOptions): Promise<void> {
  delete process.env.TILEFLOW_API_KEY;
  const project = await loadValidTileflowConfig(options.config);
  const mapNames = getTileflowMapNames(project).sort(compareCodeUnits);

  if (options.map && !Object.hasOwn(project.maps, options.map)) {
    throw new Error(
      `Unknown map "${options.map}". Available maps: ${mapNames.join(', ') || '(none)'}`,
    );
  }

  const inspection = await inspectTileflowIconCatalogs(project, {
    cwd: process.cwd(),
    ...(options.map ? {mapNames: [options.map]} : {}),
  });
  const document = createTileflowIconListJson(inspection);

  process.stdout.write(serializeTileflowIconListJson(document));
}

function createCatalogJson(catalog: TileflowIconCatalog): TileflowIconCatalogJson {
  const manifest = catalog.compiledPackage.manifest;

  return {
    sourcePath: catalog.sourcePath,
    insideWorkingTree: catalog.insideWorkingTree,
    packageHash: catalog.compiledPackage.contentHash,
    iconCount: catalog.icons.length,
    generatedByteLength: manifest.files.reduce((total, file) => total + file.byteLength, 0),
    atlas: {
      oneX: {
        pixelRatio: 1,
        width: manifest.sprites.oneX.width,
        height: manifest.sprites.oneX.height,
        index: createGeneratedFileJson(catalog, 'sprite.json'),
        image: createGeneratedFileJson(catalog, 'sprite.png'),
      },
      twoX: {
        pixelRatio: 2,
        width: manifest.sprites.twoX.width,
        height: manifest.sprites.twoX.height,
        index: createGeneratedFileJson(catalog, 'sprite@2x.json'),
        image: createGeneratedFileJson(catalog, 'sprite@2x.png'),
      },
    },
    icons: [...catalog.icons]
      .sort((left, right) => compareCodeUnits(left.id, right.id))
      .map((icon) => ({
        id: icon.id,
        source: {
          path: icon.source.path,
          format: icon.source.format,
          byteLength: icon.source.byteLength,
          dimensions: icon.source.dimensions
            ? {width: icon.source.dimensions.width, height: icon.source.dimensions.height}
            : null,
        },
        rendered: {
          oneX: {
            pixelRatio: 1,
            width: icon.rendered.oneX.width,
            height: icon.rendered.oneX.height,
            pixelSha256: icon.rendered.oneX.pixelSha256,
            atlas: createAtlasRectangleJson(icon.rendered.oneX.atlas),
          },
          twoX: {
            pixelRatio: 2,
            width: icon.rendered.twoX.width,
            height: icon.rendered.twoX.height,
            pixelSha256: icon.rendered.twoX.pixelSha256,
            atlas: createAtlasRectangleJson(icon.rendered.twoX.atlas),
          },
        },
        mappedFrom: [...icon.mappedFrom]
          .sort(
            (left, right) =>
              compareCodeUnits(left.map, right.map) ||
              compareCodeUnits(left.semantic, right.semantic),
          )
          .map((reference) => ({map: reference.map, semantic: reference.semantic})),
      })),
  };
}

function createAtlasRectangleJson(rectangle: {
  height: number;
  width: number;
  x: number;
  y: number;
}): {x: number; y: number; width: number; height: number} {
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  };
}

function createGeneratedFileJson(
  catalog: TileflowIconCatalog,
  fileName: TileflowIconPackageFileName,
): TileflowIconGeneratedFileJson {
  const file = catalog.compiledPackage.manifest.files.find(
    (candidate) => candidate.name === fileName,
  );

  if (!file) {
    throw new Error(`Missing generated icon file metadata for ${fileName}`);
  }

  return {fileName: file.name, byteLength: file.byteLength, sha256: file.sha256};
}

function createMapJson(map: TileflowIconCatalogMap): TileflowIconMapJson {
  if (map.icons.kind === 'local') {
    return {
      name: map.name,
      icons: {
        kind: 'local',
        label: map.icons.label,
        catalogSourcePath: map.icons.catalogSourcePath,
        packageHash: map.icons.packageHash,
        mappings: createMappingsJson(map.icons.mappings),
      },
    };
  }

  return {
    name: map.name,
    icons: {
      kind: map.icons.kind,
      inspectable: false,
      mappings: createMappingsJson(map.icons.mappings),
    },
  };
}

function createMappingsJson(
  mappings: readonly TileflowIconCatalogMapping[],
): TileflowIconMappingJson[] {
  return [...mappings]
    .sort((left, right) => compareCodeUnits(left.semantic, right.semantic))
    .map((mapping) => ({
      semantic: mapping.semantic,
      iconId: mapping.iconId,
      targetStatus: mapping.targetStatus,
    }));
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
