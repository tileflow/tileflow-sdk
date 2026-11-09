import {type Command, Option} from 'commander';
import {resolve} from 'node:path';
import pc from 'picocolors';
import {serializeCanonicalJson} from '@tileflow/core';
import type {TilesetBuildFormat, TilesetBuildProgress} from './tileset-build/build';
import type {RecipeSettings} from './tileset-build/recipe';

type BuildCommandOptions = {
  attribution?: string;
  description?: string;
  exclude?: string;
  featureId?: string;
  force?: boolean;
  format?: TilesetBuildFormat;
  deleteInputAfterRead?: boolean;
  hashFeatureId?: boolean;
  include?: string;
  inputLayer?: string;
  inspect?: boolean;
  json?: boolean;
  latColumn?: string;
  layer?: string;
  lonColumn?: string;
  maxExtractedBytes?: string;
  maxzoom?: string;
  minzoom?: string;
  name?: string;
  output?: string;
  printRecipe?: boolean;
  progress?: string;
  rankAscending?: boolean;
  rankBy?: string;
  recipe?: string;
  reproject?: boolean;
  sampleFeatures?: string;
  sourceCrs?: string;
  zipEntry?: string;
};

const progressFormats: readonly string[] = ['text', 'ndjson'];

const formats: readonly string[] = [
  'csv',
  'geojson',
  'geojsonseq',
  'geopackage',
  'gpx',
  'kml',
  'shapefile',
];

/** Everything a recipe also sets. Mixing them would leave two sources for one value. */
const recipeFlags: readonly (keyof BuildCommandOptions)[] = [
  'attribution',
  'description',
  'exclude',
  'featureId',
  'format',
  'hashFeatureId',
  'include',
  'inputLayer',
  'latColumn',
  'layer',
  'lonColumn',
  'maxzoom',
  'minzoom',
  'name',
  'rankAscending',
  'rankBy',
  'reproject',
  'sourceCrs',
  'zipEntry',
];

export function registerTilesetBuildCommand(parent: Command): void {
  parent
    .command('build')
    .description(
      'Build a PMTiles archive locally from GeoJSON, CSV, Shapefile, GeoPackage, KML or GPX',
    )
    .argument(
      '<input>',
      'GeoJSON, newline-delimited GeoJSON, CSV, .shp, .zip holding a Shapefile, .gpkg, .kml, .kmz or .gpx',
    )
    .option('-o, --output <path>', 'archive path (default: the input name with .pmtiles)')
    .option('--force', 'replace an existing output file')
    .option('--layer <name>', 'source-layer name (default: from the input file name)')
    .option('--format <format>', `override detection: ${formats.join(', ')}`)
    .option('--minzoom <zoom>', 'lowest zoom to write', '0')
    .option('--maxzoom <zoom>', 'highest zoom to write (default: chosen from the data)')
    .option('--include <fields>', 'keep only these comma-separated attributes')
    .option('--exclude <fields>', 'drop these comma-separated attributes')
    .option('--rank-by <field>', 'keep the highest values of this numeric attribute when thinning')
    .option('--rank-ascending', 'with --rank-by, keep the lowest values instead')
    .option('--feature-id <field>', 'use this attribute as the feature ID')
    .option('--hash-feature-id', 'with --feature-id, hash each value into an integer ID')
    .option('--zip-entry <path>', 'the .shp or .kml to read from an archive holding several')
    .option('--input-layer <name>', 'the feature table to read from a GeoPackage holding several')
    .option('--lon-column <name>', 'CSV longitude column')
    .option('--lat-column <name>', 'CSV latitude column')
    .option('--source-crs <crs>', 'state the input CRS: EPSG:<code>, proj string, WKT or .prj path')
    .option('--reproject', 'convert a stated non-WGS84 CRS to WGS84')
    .option('--name <name>', 'archive display name')
    .option('--description <text>', 'archive description')
    .option('--attribution <text>', 'data attribution stored in the archive')
    .option('--recipe <path>', 'read every build setting from this recipe file')
    .option('--print-recipe', 'print the recipe these options make, without building')
    .option('--inspect', 'report the format, CRS and fields as JSON, without tiling')
    .option('--sample-features <count>', 'with --inspect, features to read (default: 10000)')
    .option('--progress <format>', 'report progress on stderr: text or ndjson')
    .option('--json', 'print deterministic schema-version-1 JSON')
    // For the hosted conversion service, where a container's disk and input are limited.
    .addOption(new Option('--delete-input-after-read').hideHelp())
    .addOption(new Option('--max-extracted-bytes <bytes>').hideHelp())
    .action(async (input: string, options: BuildCommandOptions, command: Command) => {
      try {
        // Loaded here so that the other tileset commands do not pay for the tiling code.
        const {buildTileset, chooseLayer} = await import('./tileset-build/build');
        const {TilesetBuildError} = await import('./tileset-build/errors');
        const recipes = await import('./tileset-build/recipe');
        const settings: RecipeSettings =
          options.recipe === undefined
            ? settingsFromFlags(options, TilesetBuildError)
            : (() => {
                const conflict = recipeFlags.find(
                  (name) => command.getOptionValueSource(name) === 'cli',
                );
                if (conflict !== undefined) {
                  throw new TilesetBuildError(
                    'TF_TILESET_BUILD_RECIPE_CONFLICT',
                    'recipe',
                    `--recipe holds every build setting; remove --${kebab(conflict)}.`,
                  );
                }
                return recipes.settingsFromRecipe(recipes.readTilesetRecipe(options.recipe));
              })();
        if (options.inspect) {
          const {inspectTilesetSource} = await import('./tileset-build/inspect-source');
          const inspection = await inspectTilesetSource({
            ...settings,
            input,
            ...(options.sampleFeatures === undefined
              ? {}
              : {
                  sampleFeatures: positiveInteger(
                    options.sampleFeatures,
                    '--sample-features',
                    TilesetBuildError,
                  ),
                }),
          });
          process.stdout.write(`${serializeCanonicalJson(inspection)}\n`);
          return;
        }
        if (options.printRecipe) {
          const layer = chooseLayer(settings.layer, settings.inputLayer, resolve(input));
          const recipe = recipes.recipeFromSettings(settings, layer);
          // A flag can hold an invalid value here; a recipe that prints must also load.
          recipes.parseTilesetRecipe(JSON.stringify(recipe));
          process.stdout.write(`${serializeCanonicalJson(recipe)}\n`);
          return;
        }
        if (options.progress !== undefined && !progressFormats.includes(options.progress)) {
          throw new TilesetBuildError(
            'TF_TILESET_BUILD_PROGRESS_INVALID',
            'progress',
            `--progress must be one of: ${progressFormats.join(', ')}.`,
          );
        }
        const progress = options.progress ?? (options.json ? undefined : 'text');
        const result = await buildTileset({
          ...settings,
          input,
          ...(options.deleteInputAfterRead ? {deleteInputAfterRead: true} : {}),
          ...(options.force ? {force: true} : {}),
          ...(options.maxExtractedBytes === undefined
            ? {}
            : {
                maximumExtractedBytes: positiveInteger(
                  options.maxExtractedBytes,
                  '--max-extracted-bytes',
                  TilesetBuildError,
                ),
              }),
          ...(progress === undefined
            ? {}
            : {
                onProgress: (event: TilesetBuildProgress) =>
                  process.stderr.write(
                    `${progress === 'ndjson' ? serializeCanonicalJson(event) : event.message}\n`,
                  ),
              }),
          ...(options.output === undefined ? {} : {output: options.output}),
        });
        if (options.json) {
          process.stdout.write(`${serializeCanonicalJson(result)}\n`);
          return;
        }
        const {archive, crs, layer} = result;
        console.log(`${pc.green('✓')} Wrote ${pc.bold(archive.path)}.`);
        console.log(`  Features: ${result.input.features}`);
        console.log(`  Layer: ${layer.id} (${layer.fields.length} fields)`);
        console.log(`  Zooms: ${archive.minzoom}-${archive.maxzoom}`);
        console.log(`  Size: ${archive.byteCount} bytes in ${archive.tileContents} tiles`);
        console.log(`  CRS: ${crs.label}${crs.reprojected ? ', reprojected to WGS84' : ''}`);
        console.log(`  Bounds: ${archive.bounds.map((value) => value.toFixed(4)).join(', ')}`);
        const thinned = result.zooms.reduce((total, zoom) => total + zoom.thinnedFeatures, 0);
        if (thinned > 0) {
          console.log(`  Thinned below zoom ${archive.maxzoom}: ${thinned} tile features`);
        }
        for (const warning of result.warnings) console.log(`${pc.yellow('!')} ${warning}`);
        console.log(`Next: tileflow tileset publish ${archive.path} --id ${layer.id} --team @team`);
      } catch (error) {
        const record = (error ?? {}) as {code?: unknown; path?: unknown};
        const code = typeof record.code === 'string' ? record.code : 'TF_TILESET_BUILD_FAILED';
        const path = typeof record.path === 'string' ? record.path : 'input';
        const message = error instanceof Error ? error.message : 'Tileset build failed.';
        if (options.json) {
          process.stderr.write(
            `${serializeCanonicalJson({error: {code, message, path}, ok: false, schemaVersion: 1})}\n`,
          );
        } else {
          console.error(`${pc.red('Error:')} ${message}`);
        }
        process.exitCode = 1;
      }
    });
}

function settingsFromFlags(
  options: BuildCommandOptions,
  BuildError: typeof import('./tileset-build/errors').TilesetBuildError,
): RecipeSettings {
  if (options.format !== undefined && !formats.includes(options.format)) {
    throw new BuildError(
      'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
      'format',
      `--format must be one of: ${formats.join(', ')}.`,
    );
  }
  if (options.include !== undefined && options.exclude !== undefined) {
    throw new BuildError(
      'TF_TILESET_BUILD_FIELDS_INVALID',
      'fields',
      '--include and --exclude cannot be combined.',
    );
  }
  if (options.hashFeatureId && options.featureId === undefined) {
    throw new BuildError(
      'TF_TILESET_BUILD_FEATURE_ID_INVALID',
      'featureId',
      '--hash-feature-id needs --feature-id.',
    );
  }
  return {
    ...(options.attribution === undefined ? {} : {attribution: options.attribution}),
    ...(options.description === undefined ? {} : {description: options.description}),
    ...(options.exclude === undefined ? {} : {exclude: fieldList(options.exclude)}),
    ...(options.featureId === undefined
      ? {}
      : {featureId: {field: options.featureId, ...(options.hashFeatureId ? {hash: true} : {})}}),
    ...(options.format === undefined ? {} : {format: options.format}),
    ...(options.include === undefined ? {} : {include: fieldList(options.include)}),
    ...(options.inputLayer === undefined ? {} : {inputLayer: options.inputLayer}),
    ...(options.latColumn === undefined ? {} : {latColumn: options.latColumn}),
    ...(options.layer === undefined ? {} : {layer: options.layer}),
    ...(options.lonColumn === undefined ? {} : {lonColumn: options.lonColumn}),
    ...(options.maxzoom === undefined ? {} : {maxzoom: zoomValue(options.maxzoom)}),
    minzoom: zoomValue(options.minzoom ?? '0'),
    ...(options.name === undefined ? {} : {name: options.name}),
    ...(options.rankAscending ? {rankAscending: true} : {}),
    ...(options.rankBy === undefined ? {} : {rankBy: options.rankBy}),
    ...(options.reproject ? {reproject: true} : {}),
    ...(options.sourceCrs === undefined ? {} : {sourceCrs: options.sourceCrs}),
    ...(options.zipEntry === undefined ? {} : {zipEntry: options.zipEntry}),
  };
}

function positiveInteger(
  value: string,
  flag: string,
  BuildError: typeof import('./tileset-build/errors').TilesetBuildError,
): number {
  const parsed = /^[1-9]\d*$/u.test(value) ? Number(value) : Number.NaN;
  if (Number.isSafeInteger(parsed)) return parsed;
  throw new BuildError(
    'TF_TILESET_BUILD_OPTION_INVALID',
    flag.slice(2),
    `${flag} must be a positive integer.`,
  );
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function fieldList(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function zoomValue(value: string): number {
  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}
