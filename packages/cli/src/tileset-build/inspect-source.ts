import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {
  checkContainerFormat,
  chooseCrsStatement,
  chooseLayer,
  detectFormat,
  isKmz,
  isZip,
  type TilesetBuildFormat,
} from './build';
import {type CoordinateTransform, type CrsStatement, resolveCrs} from './crs';
import {SampleComplete, TilesetBuildError} from './errors';
import {FeatureIngest, type FieldSummary} from './ingest';
import {csvColumnNames, csvColumnsNameCoordinates, readCsv} from './read-csv';
import {readGeojson, readGeojsonSequence} from './read-geojson';
import {GeoPackageLayer} from './read-geopackage';
import {readGpx} from './read-gpx';
import {readKml} from './read-kml';
import {readShapefile} from './read-shapefile';
import {fileChunks} from './read-xml';
import {ZippedKml, ZippedShapefile} from './read-zip';
import {recipeFromSettings, type RecipeSettings, type TilesetRecipe} from './recipe';
import {checkInputSignature} from './signature';
import {FeatureSpool, SpoolDirectory} from './spool';

const defaultSampleFeatures = 10_000;
const maximumSampleCoordinates = 2_000;

export type TilesetSourceInspectOptions = RecipeSettings &
  Readonly<{
    input: string;
    sampleFeatures?: number;
  }>;

export type TilesetSourceCrs = Readonly<{
  label: string;
  /** Stated in the file or by the caller; `unknown` means someone must state it. */
  status: 'needs-reproject' | 'out-of-range' | 'unknown' | 'unsupported' | 'wgs84';
  problem?: Readonly<{code: string; message: string}>;
}>;

export type TilesetSourceInspection = Readonly<{
  /** The input holds several layers or entries, and nothing else can be read until one is picked. */
  choices?: Readonly<{names: readonly string[]; option: 'inputLayer' | 'zipEntry'}>;
  /** The header of a CSV whose coordinate columns could not be identified from their names. */
  columns?: readonly string[];
  command: 'tileset build --inspect';
  crs?: TilesetSourceCrs;
  fields?: readonly FieldSummary[];
  format: TilesetBuildFormat;
  geometryTypes?: readonly string[];
  recipe?: TilesetRecipe;
  sample?: Readonly<{
    /** In WGS84, when the CRS is known and every coordinate was in range. */
    bounds: readonly [number, number, number, number] | null;
    /** True when the whole file was read. */
    complete: boolean;
    /** Evenly spread positions as stored in the file, for previewing a CRS before choosing it. */
    coordinates: readonly (readonly [number, number])[];
    features: number;
    /** The coordinates as they are in the file, whatever their CRS. */
    sourceBounds: readonly [number, number, number, number] | null;
  }>;
  schemaVersion: 1;
  warnings?: readonly string[];
}>;

/** Reads enough of a source to choose its CRS, fields and layer, without tiling or spooling it all. */
export async function inspectTilesetSource(
  options: TilesetSourceInspectOptions,
): Promise<TilesetSourceInspection> {
  const input = resolve(options.input);
  if (!statSync(input, {throwIfNoEntry: false})?.isFile()) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_MISSING',
      'input',
      `Input file not found: ${options.input}.`,
    );
  }
  const format = options.format ?? detectFormat(input);
  const zipped = isZip(input);
  const kmz = isKmz(input);
  checkContainerFormat(format, zipped, kmz);
  checkInputSignature(input, format, zipped ? 'zip' : kmz ? 'kmz' : null);
  const base = {command: 'tileset build --inspect', format, schemaVersion: 1} as const;

  let zip: ZippedShapefile | null = null;
  let zippedKml: ZippedKml | null = null;
  let geopackage: GeoPackageLayer | null = null;
  try {
    zip = zipped ? await ZippedShapefile.open(input, options.zipEntry) : null;
    zippedKml = kmz ? await ZippedKml.open(input, options.zipEntry) : null;
    geopackage = format === 'geopackage' ? GeoPackageLayer.open(input, options.inputLayer) : null;
  } catch (error) {
    if (error instanceof TilesetBuildError && error.choices) {
      const option = error.path === 'inputLayer' ? 'inputLayer' : 'zipEntry';
      return {...base, choices: {names: error.choices.slice(0, 1000), option}};
    }
    throw error;
  }

  const temporary = mkdtempSync(join(tmpdir(), 'tileflow-tileset-inspect-'));
  try {
    const shapefile = zip ? await zip.extractProjection(temporary) : input;
    const statement = await chooseCrsStatement(format, shapefile, options, geopackage);
    if (format === 'csv' && !(await csvColumnsNameCoordinates(input, options))) {
      // Without coordinate columns nothing can be read as a feature; the caller picks them.
      return {
        ...base,
        columns: await csvColumnNames(input),
        crs: {label: statement.label, status: 'unknown'},
      };
    }
    const reading = coordinateProbe(statement);
    if (zip) await zip.extractData(temporary);

    const directory = new SpoolDirectory(temporary);
    const ingest = new FeatureIngest(
      new FeatureSpool(directory),
      {exclude: null, include: null},
      reading.transform,
    );
    ingest.stopAfter = options.sampleFeatures ?? defaultSampleFeatures;
    let complete = true;
    try {
      await readSample(format, input, shapefile, ingest, options, zippedKml, geopackage);
    } catch (error) {
      if (!(error instanceof SampleComplete)) throw error;
      complete = false;
    }

    const layer = chooseLayer(options.layer, options.inputLayer, input);
    const crs = reading.crs();
    const recipe = recipeFromSettings(
      {...options, ...(crs.status === 'needs-reproject' ? {reproject: true} : {})},
      layer,
    );
    if (ingest.featureCount === 0) {
      return {
        ...base,
        crs,
        recipe,
        sample: {
          bounds: null,
          complete,
          coordinates: reading.coordinates(),
          features: 0,
          sourceBounds: reading.bounds(),
        },
      };
    }
    const summary = ingest.finish();
    return {
      ...base,
      crs,
      fields: summary.fields,
      geometryTypes: summary.geometryTypes,
      recipe,
      sample: {
        bounds: crs.status === 'wgs84' || crs.status === 'needs-reproject' ? summary.bounds : null,
        complete,
        coordinates: reading.coordinates(),
        features: summary.features,
        sourceBounds: reading.bounds(),
      },
      warnings: summary.warnings,
    };
  } finally {
    zip?.close();
    zippedKml?.close();
    geopackage?.close();
    rmSync(temporary, {force: true, recursive: true});
  }
}

async function readSample(
  format: TilesetBuildFormat,
  input: string,
  shapefile: string,
  ingest: FeatureIngest,
  options: TilesetSourceInspectOptions,
  zippedKml: ZippedKml | null,
  geopackage: GeoPackageLayer | null,
): Promise<void> {
  switch (format) {
    case 'csv':
      return readCsv(input, ingest, options);
    case 'geojson':
      return readGeojson(input, ingest, () => {});
    case 'geojsonseq':
      return readGeojsonSequence(input, ingest);
    case 'geopackage':
      return (geopackage as GeoPackageLayer).read(ingest, options.sourceCrs === undefined);
    case 'gpx':
      return readGpx(fileChunks(input), ingest);
    case 'kml':
      return readKml(zippedKml ? zippedKml.chunks() : fileChunks(input), ingest);
    case 'shapefile':
      return readShapefile(shapefile, ingest);
  }
}

/**
 * Stands in for the real transform so that no coordinate stops the sample. Inspection exists to
 * report a missing or wrong CRS, which a build would refuse before showing anything.
 */
function coordinateProbe(statement: CrsStatement) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let outOfRange = false;
  const coordinates: [number, number][] = [];
  let seen = 0;
  let stride = 1;
  let real: CoordinateTransform | null = null;
  let crs: TilesetSourceCrs;
  if (statement.definition === null) {
    crs = {label: statement.label, status: 'unknown'};
  } else {
    try {
      const resolved = resolveCrs(statement, true);
      real = resolved.transform;
      crs = {label: resolved.label, status: resolved.transform ? 'needs-reproject' : 'wgs84'};
    } catch (error) {
      if (!(error instanceof TilesetBuildError)) throw error;
      crs = {
        label: statement.label,
        problem: {code: error.code, message: error.message},
        status: 'unsupported',
      };
    }
  }
  const usable = crs.status === 'wgs84' || crs.status === 'needs-reproject';
  const transform: CoordinateTransform = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (seen % stride === 0) {
      if (coordinates.length === maximumSampleCoordinates) {
        for (let index = 0; index < coordinates.length / 2; index += 1) {
          coordinates[index] = coordinates[index * 2];
        }
        coordinates.length /= 2;
        stride *= 2;
      }
      if (seen % stride === 0) coordinates.push([x, y]);
    }
    seen += 1;
    if (!usable) return [0, 0];
    const [longitude, latitude] = real ? real(x, y) : [x, y];
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    ) {
      outOfRange = true;
      return [0, 0];
    }
    return [longitude, latitude];
  };
  return {
    coordinates: () => coordinates,
    bounds: () =>
      Number.isFinite(minX) ? ([minX, minY, maxX, maxY] as [number, number, number, number]) : null,
    crs: (): TilesetSourceCrs =>
      outOfRange
        ? {
            label: crs.label,
            problem: {
              code: 'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE',
              message: `Some coordinates are not valid longitude and latitude under ${crs.label}. The stated CRS is probably wrong.`,
            },
            status: 'out-of-range',
          }
        : crs,
    transform,
  };
}
