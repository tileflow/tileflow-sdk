import {existsSync, mkdtempSync, rmSync, statfsSync, statSync} from 'node:fs';
import {rename} from 'node:fs/promises';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {serializeCanonicalJson} from '@tileflow/core';
import {inspectTileflowPmtiles} from '@tileflow/dev/tilesets';
import {getCliVersion} from '../cli-version';
import {
  type CrsStatement,
  parseSourceCrsOption,
  resolveCrs,
  statementFromGeojsonCrs,
  wgs84Statement,
} from './crs';
import {TilesetBuildError} from './errors';
import {FeatureIngest} from './ingest';
import {TileArchiveWriter} from './pmtiles-writer';
import {csvColumnsNameCoordinates, readCsv} from './read-csv';
import {readGeojson, readGeojsonSequence} from './read-geojson';
import {GeoPackageLayer} from './read-geopackage';
import {readGpx} from './read-gpx';
import {readKml} from './read-kml';
import {readShapefile, shapefileCrsStatement} from './read-shapefile';
import {fileChunks} from './read-xml';
import {ZippedKml, ZippedShapefile} from './read-zip';
import {FeatureSpool, SpoolDirectory} from './spool';
import {buildPyramid, type ZoomStatistics} from './tiler';
import {chooseMaxzoom} from './zoom';

export type TilesetBuildFormat =
  'csv' | 'geojson' | 'geojsonseq' | 'geopackage' | 'gpx' | 'kml' | 'shapefile';

export type TilesetBuildOptions = Readonly<{
  attribution?: string;
  description?: string;
  exclude?: readonly string[];
  force?: boolean;
  format?: TilesetBuildFormat;
  include?: readonly string[];
  input: string;
  inputLayer?: string;
  latColumn?: string;
  layer?: string;
  lonColumn?: string;
  maxzoom?: number;
  minzoom?: number;
  name?: string;
  onProgress?: (message: string) => void;
  output?: string;
  rankAscending?: boolean;
  rankBy?: string;
  reproject?: boolean;
  sourceCrs?: string;
  zipEntry?: string;
}>;

export type TilesetBuildResult = Readonly<{
  archive: Readonly<{
    addressedTiles: number;
    bounds: readonly [number, number, number, number];
    byteCount: number;
    maxzoom: number;
    maxzoomSource: 'auto' | 'option';
    minzoom: number;
    path: string;
    tileContents: number;
  }>;
  command: 'tileset build';
  crs: Readonly<{authority: string; label: string; reprojected: boolean}>;
  input: Readonly<{
    features: number;
    format: TilesetBuildFormat;
    geometryTypes: readonly string[];
    skipped: Readonly<{emptyGeometry: number; outsideMercator: number}>;
  }>;
  layer: Readonly<{
    fields: readonly Readonly<{name: string; sourceName: string; type: string}>[];
    id: string;
  }>;
  schemaVersion: 1;
  warnings: readonly string[];
  zooms: readonly ZoomStatistics[];
}>;

const maximumZoom = 16;
const layerNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const minimumFreeBytes = 64 * 1024 * 1024;
const maximumArchiveBytes = 8_000_000_000;
const nullIslandDegrees = 1;

export async function buildTileset(options: TilesetBuildOptions): Promise<TilesetBuildResult> {
  const input = resolve(options.input);
  const format = options.format ?? detectFormat(input);
  const inputStat = statSync(input, {throwIfNoEntry: false});
  if (!inputStat?.isFile()) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_MISSING',
      'input',
      `Input file not found: ${options.input}.`,
    );
  }
  const zipped = isZip(input);
  if (zipped && format !== 'shapefile') {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
      'format',
      'Only Shapefiles can be read from a zip; extract other formats first.',
    );
  }
  const kmz = isKmz(input);
  if (kmz && format !== 'kml') {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
      'format',
      'A .kmz file can only be read as KML.',
    );
  }
  if (!zipped && !kmz && options.zipEntry !== undefined) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'zipEntry',
      '--zip-entry only applies to a .zip or .kmz input.',
    );
  }
  if (format !== 'geopackage' && options.inputLayer !== undefined) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_LAYER_INVALID',
      'inputLayer',
      '--input-layer only applies to a GeoPackage input.',
    );
  }
  if (options.rankAscending && options.rankBy === undefined) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_RANK_INVALID',
      'rankBy',
      '--rank-ascending needs --rank-by.',
    );
  }
  const outputOption =
    options.output ?? join(dirname(options.input), `${inputStem(input)}.pmtiles`);
  const output = resolve(outputOption);
  if (output === input) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_OUTPUT_INVALID',
      'output',
      'The output path must differ from the input.',
    );
  }
  if (existsSync(output) && !options.force) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_OUTPUT_EXISTS',
      'output',
      `${outputOption} already exists. Pass --force to replace it.`,
    );
  }
  const layer = chooseLayer(options.layer, options.inputLayer, input);
  const zoomRange = checkZooms(options);

  const outputDirectory = dirname(output);
  checkFreeSpace(outputDirectory, zipped ? 0 : inputStat.size);
  const zip = zipped ? await ZippedShapefile.open(input, options.zipEntry) : null;
  const zippedKml = kmz ? await ZippedKml.open(input, options.zipEntry) : null;
  const geopackage =
    format === 'geopackage' ? GeoPackageLayer.open(input, options.inputLayer) : null;
  const temporary = mkdtempSync(join(outputDirectory, '.tileflow-tileset-build-'));
  const removeTemporary = () => rmSync(temporary, {force: true, recursive: true});
  const interrupt = () => {
    removeTemporary();
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  let archive: TileArchiveWriter | null = null;
  try {
    // Extracted files sit beside the temporary spool, so they count on top of its estimate.
    if (zip) checkFreeSpace(outputDirectory, zip.uncompressedBytes, zip.uncompressedBytes);
    // A KMZ is streamed, not extracted, so only the spool needs room.
    if (zippedKml) checkFreeSpace(outputDirectory, zippedKml.uncompressedBytes);
    const shapefile = zip ? await zip.extractProjection(temporary) : input;
    const statement = await chooseCrsStatement(format, shapefile, options, geopackage);
    // A GeoJSON file without a crs member is WGS84 by RFC 7946; a late member is checked below.
    const crs = resolveCrs(statement, options.reproject === true);
    if (zip) await zip.extractData(temporary);

    const directory = new SpoolDirectory(temporary);
    const spool = new FeatureSpool(directory);
    const ingest = new FeatureIngest(
      spool,
      {
        exclude: options.exclude ? new Set(options.exclude) : null,
        include: options.include ? new Set(options.include) : null,
      },
      crs.transform,
      options.rankBy === undefined
        ? null
        : {ascending: options.rankAscending === true, field: options.rankBy},
    );
    if (crs.warning) ingest.warn(crs.warning);

    options.onProgress?.('Reading features.');
    switch (format) {
      case 'csv':
        await readCsv(input, ingest, options);
        break;
      case 'geojson':
        await readGeojson(input, ingest, (member) => checkDocumentCrs(member, options));
        break;
      case 'geojsonseq':
        await readGeojsonSequence(input, ingest);
        break;
      case 'geopackage':
        await (geopackage as GeoPackageLayer).read(ingest, options.sourceCrs === undefined);
        break;
      case 'gpx':
        await readGpx(fileChunks(input), ingest);
        break;
      case 'kml':
        await readKml(zippedKml ? zippedKml.chunks() : fileChunks(input), ingest);
        break;
      case 'shapefile':
        await readShapefile(shapefile, ingest);
        break;
    }

    const summary = ingest.finish();
    const maxzoom =
      zoomRange.maxzoom ?? Math.max(chooseMaxzoom(ingest, summary), zoomRange.minzoom);
    const fieldMetadata = Object.fromEntries(summary.fields.map((item) => [item.name, item.type]));
    options.onProgress?.(`Tiling ${summary.features} features through zoom ${maxzoom}.`);

    archive = new TileArchiveWriter(join(temporary, 'tiles.bin'));
    // Tiles keep the first features per cell, so this order is what decides which ones survive.
    const root = ingest.rankedSpool(spool);
    const zooms = await buildPyramid(root, {
      archive,
      directory,
      keys: ingest.keyNames(summary),
      layer,
      maxzoom,
      minzoom: zoomRange.minzoom,
      onTile: (count) => {
        if (count % 65_536 < 256) options.onProgress?.(`Wrote ${count} tiles.`);
      },
    });
    const pending = join(temporary, 'archive.pmtiles');
    const bounds = summary.bounds;
    const name = options.name ?? layer;
    const totals = await archive.finish(
      pending,
      {
        bounds,
        center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, zoomRange.minzoom],
        maxzoom,
        minzoom: zoomRange.minzoom,
      },
      serializeCanonicalJson({
        ...(options.attribution ? {attribution: options.attribution} : {}),
        ...(options.description ? {description: options.description} : {}),
        format: 'pbf',
        generator: 'tileflow tileset build',
        generator_version: getCliVersion(),
        name,
        type: 'overlay',
        vector_layers: [{fields: fieldMetadata, id: layer, maxzoom, minzoom: zoomRange.minzoom}],
        version: '1',
      }),
    );

    if (totals.byteCount > maximumArchiveBytes) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_ARCHIVE_TOO_LARGE',
        'output',
        `The archive is ${formatBytes(totals.byteCount)}; publishable archives are limited to ${formatBytes(maximumArchiveBytes)}. Lower --maxzoom, or remove attributes with --include or --exclude.`,
      );
    }

    // Use the same validation `tileset publish` applies, so success means the archive is publishable.
    options.onProgress?.('Validating the archive.');
    const inspection = await inspectTileflowPmtiles(pending, {sample: true});
    await rename(pending, output);

    return {
      archive: {
        addressedTiles: totals.addressedTiles,
        bounds,
        byteCount: totals.byteCount,
        maxzoom,
        maxzoomSource: zoomRange.maxzoom === undefined ? 'auto' : 'option',
        minzoom: zoomRange.minzoom,
        path: outputOption,
        tileContents: totals.tileContents,
      },
      command: 'tileset build',
      crs: {authority: crs.authority, label: crs.label, reprojected: crs.reprojected},
      input: {
        features: summary.features,
        format,
        geometryTypes: summary.geometryTypes,
        skipped: summary.skipped,
      },
      layer: {fields: summary.fields, id: layer},
      schemaVersion: 1,
      warnings: [
        ...summary.warnings,
        ...placementWarnings(bounds, crs.label, options.sourceCrs !== undefined || crs.reprojected),
        ...inspection.warnings.map((warning) => warning.message),
      ],
      zooms: zooms.filter((item) => item.zoom >= zoomRange.minzoom),
    };
  } catch (error) {
    if (isNoSpace(error)) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_DISK_FULL',
        'output',
        'The disk ran out of space during the build. Free space beside the output, or write the output to another disk.',
      );
    }
    throw error;
  } finally {
    archive?.close();
    zip?.close();
    zippedKml?.close();
    geopackage?.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    removeTemporary();
  }
}

function detectFormat(path: string): TilesetBuildFormat {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case '.geojson':
    case '.json':
      return 'geojson';
    case '.ndjson':
    case '.geojsonl':
    case '.geojsons':
    case '.geojsonseq':
    case '.jsonl':
      return 'geojsonseq';
    case '.csv':
    case '.tsv':
      return 'csv';
    case '.shp':
    case '.zip':
      return 'shapefile';
    case '.gpkg':
      return 'geopackage';
    case '.kml':
    case '.kmz':
      return 'kml';
    case '.gpx':
      return 'gpx';
    default:
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
        'input',
        `Unsupported input extension "${extension}". Supported: .geojson, .json, .ndjson, .geojsonl, .csv, .tsv, .shp, a .zip holding a Shapefile, .gpkg, .kml, .kmz and .gpx. Use --format if the extension is misleading.`,
      );
  }
}

async function chooseCrsStatement(
  format: TilesetBuildFormat,
  input: string,
  options: TilesetBuildOptions,
  geopackage: GeoPackageLayer | null,
): Promise<CrsStatement> {
  if (options.sourceCrs !== undefined) return parseSourceCrsOption(options.sourceCrs);
  switch (format) {
    case 'shapefile':
      return shapefileCrsStatement(input);
    case 'geopackage':
      return (geopackage as GeoPackageLayer).crsStatement;
    case 'gpx':
      return wgs84Statement('format', 'GPX (WGS84 by definition)');
    case 'kml':
      return wgs84Statement('format', 'KML (WGS84 by definition)');
    case 'geojson':
    case 'geojsonseq':
      return wgs84Statement('format', 'GeoJSON (WGS84 by RFC 7946)');
    case 'csv':
      return (await csvColumnsNameCoordinates(input, options))
        ? wgs84Statement('format', 'CSV longitude and latitude columns')
        : {authority: 'format', definition: null, label: 'This CSV'};
  }
}

/**
 * GeoJSON streams, so a `crs` member can arrive after features were projected as WGS84. Only WGS84
 * members pass; anything else must be stated up front with --source-crs so no feature is misread.
 */
function checkDocumentCrs(member: unknown, options: TilesetBuildOptions): void {
  if (options.sourceCrs !== undefined || member === null) return;
  const resolved = resolveCrs(statementFromGeojsonCrs(member), true);
  if (resolved.transform === null) return;
  throw new TilesetBuildError(
    'TF_TILESET_BUILD_CRS_NOT_WGS84',
    'crs',
    `${resolved.label} is not WGS84. Pass --source-crs with the same CRS plus --reproject.`,
  );
}

function isZip(path: string): boolean {
  return extname(path).toLowerCase() === '.zip';
}

function isKmz(path: string): boolean {
  return extname(path).toLowerCase() === '.kmz';
}

/** The name outputs and layers default to: `roads.shp.zip` means `roads`, as `roads.zip` does. */
function inputStem(path: string): string {
  const stem = basename(path, extname(path));
  return isZip(path) ? stem.replace(/\.shp$/iu, '') : stem;
}

/**
 * A wrong CRS can still land inside valid coordinates, so nothing downstream can catch it. Say where
 * the data ended up whenever a person stated the CRS, and flag the one place that is rarely real.
 */
function placementWarnings(
  bounds: readonly [number, number, number, number],
  label: string,
  stated: boolean,
): string[] {
  const warnings: string[] = [];
  const [west, south, east, north] = bounds.map((value) => value.toFixed(4));
  if (stated) {
    warnings.push(
      `With ${label}, the features cover longitude ${west} to ${east} and latitude ${south} to ${north}. If that is not where the data belongs, the stated CRS is wrong.`,
    );
  }
  if (bounds.every((value) => Math.abs(value) <= nullIslandDegrees)) {
    warnings.push(
      `Every feature is within ${nullIslandDegrees}° of longitude 0, latitude 0, in the Gulf of Guinea. Check for a wrong CRS or placeholder zero coordinates.`,
    );
  }
  return warnings;
}

function chooseLayer(
  requested: string | undefined,
  inputLayer: string | undefined,
  input: string,
): string {
  const candidate =
    requested ??
    (inputLayer ?? inputStem(input))
      .replace(/[^A-Za-z0-9._:-]+/gu, '_')
      .replace(/^[^A-Za-z0-9]+/u, '');
  if (!layerNamePattern.test(candidate)) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_LAYER_INVALID',
      'layer',
      `Layer name "${candidate}" is invalid. Use letters, digits, dots, underscores, colons and hyphens, starting with a letter or digit.`,
    );
  }
  return candidate;
}

function checkZooms(options: TilesetBuildOptions): {maxzoom?: number; minzoom: number} {
  const minzoom = options.minzoom ?? 0;
  const {maxzoom} = options;
  if (
    !Number.isInteger(minzoom) ||
    minzoom < 0 ||
    minzoom > maximumZoom ||
    (maxzoom !== undefined &&
      (!Number.isInteger(maxzoom) || maxzoom > maximumZoom || maxzoom < minzoom))
  ) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZOOM_INVALID',
      'zoom',
      `Zooms must be integers with 0 <= --minzoom <= --maxzoom <= ${maximumZoom}.`,
    );
  }
  return {...(maxzoom === undefined ? {} : {maxzoom}), minzoom};
}

function checkFreeSpace(directory: string, inputBytes: number, extractedBytes = 0): void {
  if (!existsSync(directory)) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_OUTPUT_INVALID',
      'output',
      'The output directory does not exist.',
    );
  }
  const volume = statfsSync(directory);
  const required = Math.max(minimumFreeBytes, inputBytes * 2) + extractedBytes;
  const available = Number(volume.bavail) * Number(volume.bsize);
  if (available < required) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_DISK_FULL',
      'output',
      `The build needs about ${formatBytes(required)} of free space beside the output for temporary files; ${formatBytes(available)} is available.`,
    );
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function isNoSpace(error: unknown): boolean {
  return (error as {code?: unknown} | null)?.code === 'ENOSPC';
}
