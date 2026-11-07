import type {Command} from 'commander';
import pc from 'picocolors';
import {serializeCanonicalJson} from '@tileflow/core';
import type {TilesetBuildFormat} from './tileset-build/build';

type BuildCommandOptions = {
  attribution?: string;
  description?: string;
  exclude?: string;
  force?: boolean;
  format?: TilesetBuildFormat;
  include?: string;
  json?: boolean;
  latColumn?: string;
  layer?: string;
  lonColumn?: string;
  maxzoom?: string;
  minzoom?: string;
  name?: string;
  output?: string;
  reproject?: boolean;
  sourceCrs?: string;
};

const formats: readonly string[] = ['csv', 'geojson', 'geojsonseq', 'shapefile'];

export function registerTilesetBuildCommand(parent: Command): void {
  parent
    .command('build')
    .description('Build a PMTiles archive locally from GeoJSON, CSV or Shapefile')
    .argument('<input>', 'GeoJSON, newline-delimited GeoJSON, CSV or .shp file')
    .option('-o, --output <path>', 'archive path (default: the input name with .pmtiles)')
    .option('--force', 'replace an existing output file')
    .option('--layer <name>', 'source-layer name (default: from the input file name)')
    .option('--format <format>', `override detection: ${formats.join(', ')}`)
    .option('--minzoom <zoom>', 'lowest zoom to write', '0')
    .option('--maxzoom <zoom>', 'highest zoom to write (default: chosen from the data)')
    .option('--include <fields>', 'keep only these comma-separated attributes')
    .option('--exclude <fields>', 'drop these comma-separated attributes')
    .option('--lon-column <name>', 'CSV longitude column')
    .option('--lat-column <name>', 'CSV latitude column')
    .option('--source-crs <crs>', 'state the input CRS: EPSG:<code>, proj string, WKT or .prj path')
    .option('--reproject', 'convert a stated non-WGS84 CRS to WGS84')
    .option('--name <name>', 'archive display name')
    .option('--description <text>', 'archive description')
    .option('--attribution <text>', 'data attribution stored in the archive')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (input: string, options: BuildCommandOptions) => {
      try {
        // Loaded here so that the other tileset commands do not pay for the tiling code.
        const {buildTileset} = await import('./tileset-build/build');
        const {TilesetBuildError} = await import('./tileset-build/errors');
        if (options.format !== undefined && !formats.includes(options.format)) {
          throw new TilesetBuildError(
            'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
            'format',
            `--format must be one of: ${formats.join(', ')}.`,
          );
        }
        if (options.include !== undefined && options.exclude !== undefined) {
          throw new TilesetBuildError(
            'TF_TILESET_BUILD_FIELDS_INVALID',
            'fields',
            '--include and --exclude cannot be combined.',
          );
        }
        const result = await buildTileset({
          input,
          ...(options.attribution === undefined ? {} : {attribution: options.attribution}),
          ...(options.description === undefined ? {} : {description: options.description}),
          ...(options.exclude === undefined ? {} : {exclude: fieldList(options.exclude)}),
          ...(options.force ? {force: true} : {}),
          ...(options.format === undefined ? {} : {format: options.format}),
          ...(options.include === undefined ? {} : {include: fieldList(options.include)}),
          ...(options.latColumn === undefined ? {} : {latColumn: options.latColumn}),
          ...(options.layer === undefined ? {} : {layer: options.layer}),
          ...(options.lonColumn === undefined ? {} : {lonColumn: options.lonColumn}),
          ...(options.maxzoom === undefined ? {} : {maxzoom: zoomValue(options.maxzoom)}),
          minzoom: zoomValue(options.minzoom ?? '0'),
          ...(options.name === undefined ? {} : {name: options.name}),
          ...(options.json
            ? {}
            : {onProgress: (message: string) => process.stderr.write(`${message}\n`)}),
          ...(options.output === undefined ? {} : {output: options.output}),
          ...(options.reproject ? {reproject: true} : {}),
          ...(options.sourceCrs === undefined ? {} : {sourceCrs: options.sourceCrs}),
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

function fieldList(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function zoomValue(value: string): number {
  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}
