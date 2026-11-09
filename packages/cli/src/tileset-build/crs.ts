import {existsSync, readFileSync} from 'node:fs';
import proj4 from 'proj4';
import {TilesetBuildError} from './errors';

export type CoordinateTransform = (x: number, y: number) => readonly [number, number];

export type ResolvedCrs = Readonly<{
  /** Where the CRS statement came from. */
  authority: 'declared' | 'format' | 'option';
  label: string;
  reprojected: boolean;
  transform: CoordinateTransform | null;
  warning?: string;
}>;

export type CrsStatement = Readonly<{
  authority: 'declared' | 'format' | 'option';
  /** Proj string or WKT; `null` means the input states nothing about its coordinates. */
  definition: string | null;
  label: string;
}>;

const wgs84Definition = '+proj=longlat +datum=WGS84 +no_defs';
const radiansPerDegree = Math.PI / 180;

/**
 * Datums whose realizations stay within a few metres of WGS84. proj4 carries no shift for them, so
 * treating them as coincident is the only behavior available and it is reported to the caller.
 */
const coincidentDatumPattern =
  /etrs|european_terrestrial_reference_system|rgf_?(19)?93|reseau_geodesique_francais_1993|nad_?(19)?83|north_american_(datum_)?1983|gda_?(19)?94|gda_?2020|geocentric_datum_of_australia|nzgd_?2000|new_zealand_geodetic_datum_2000|sirgas|jgd_?20(00|11)|japanese_geodetic_datum_20(00|11)/u;

/** Translate a CRS statement into the transform the build may apply, or refuse it. */
export function resolveCrs(statement: CrsStatement, reproject: boolean): ResolvedCrs {
  const {authority, definition, label} = statement;
  if (definition === null) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_CRS_UNKNOWN',
      'crs',
      `${label} does not state its coordinate reference system. Pass --source-crs EPSG:4326 if the coordinates are WGS84 longitude and latitude, or --source-crs <crs> --reproject if they are not. The build never guesses.`,
    );
  }

  const parsed = parseDefinition(definition, label);
  const datum = String(parsed.datumCode ?? 'none').toLowerCase();
  // proj4 reads grads as degrees in a geographic CRS, so conversion would misplace everything too.
  const angularUnit = parsed.projName === 'longlat' ? parsed.UNIT?.convert : undefined;
  if (angularUnit !== undefined && Math.abs(angularUnit - radiansPerDegree) > 1e-9) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_CRS_UNSUPPORTED',
      'crs',
      `${label} measures coordinates in "${parsed.UNIT?.name}"; only degrees can be converted here. Reproject the data to WGS84 with another tool first.`,
    );
  }
  // A non-Greenwich prime meridian shifts every longitude, however WGS84 the datum looks.
  const greenwich = Math.abs(parsed.from_greenwich ?? 0) < 1e-12;
  if (parsed.projName === 'longlat' && datum === 'wgs84' && greenwich) {
    return {authority, label, reprojected: false, transform: null};
  }

  if (!reproject) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_CRS_NOT_WGS84',
      'crs',
      `${label} is not WGS84 longitude and latitude. Add --reproject to convert it, or reproject the data yourself first. The build never reprojects without being asked.`,
    );
  }

  // datum_type 1 and 2 carry a 3- or 7-parameter shift to WGS84, 4 is WGS84 itself; 5 means proj4
  // has no shift and would silently return coordinates offset by up to hundreds of metres.
  const datumType = parsed.datum?.datum_type;
  // `+nadgrids=@null` is how proj strings spell Web Mercator's spherical shortcut: no shift is correct.
  const hasShift =
    datumType === 1 || datumType === 2 || datumType === 4 || definition.includes('+nadgrids=@null');
  const coincident = (!hasShift || datumType === 4) && coincidentDatumPattern.test(datum);
  if (!hasShift && !coincident) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_DATUM_UNSUPPORTED',
      'crs',
      `${label} uses datum "${datum}", which has no known shift to WGS84 here; converting it would misplace features by up to hundreds of metres. Reproject with a tool that supports the datum, or pass a --source-crs proj string with +towgs84=.`,
    );
  }

  const converter = proj4(definition, wgs84Definition);
  return {
    authority,
    label,
    reprojected: true,
    transform: (x, y) => converter.forward([x, y]) as unknown as readonly [number, number],
    ...(coincident
      ? {
          warning: `${label} uses datum "${datum}", treated as coincident with WGS84 (typically within 2 m).`,
        }
      : {}),
  };
}

/** Accept EPSG shorthands, proj strings, WKT and paths to .prj files. */
/** True for a CRS written out in full. A recipe accepts only these, never a path to read. */
export function isInlineCrs(value: string): boolean {
  const trimmed = value.trim();
  return /^epsg:\d{4,6}$/iu.test(trimmed) || isProjOrWkt(trimmed);
}

function isProjOrWkt(trimmed: string): boolean {
  return trimmed.startsWith('+') || /^[A-Z_]+\[/u.test(trimmed);
}

/** The value to store in a recipe: `.prj` paths become their contents, so the recipe can travel. */
export function portableCrs(value: string): string {
  if (isInlineCrs(value)) return value.trim();
  return parseSourceCrsOption(value).definition as string;
}

export function parseSourceCrsOption(value: string): CrsStatement {
  const trimmed = value.trim();
  const epsg = /^epsg:(\d{4,6})$/iu.exec(trimmed)?.[1];
  if (epsg) {
    const definition = epsgDefinition(Number(epsg));
    if (!definition) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_CRS_UNREADABLE',
        'crs',
        `EPSG:${epsg} has no built-in definition. Pass a proj string, WKT, or the path to a .prj file instead.`,
      );
    }
    return {authority: 'option', definition, label: `EPSG:${epsg}`};
  }
  if (isProjOrWkt(trimmed)) {
    return {authority: 'option', definition: trimmed, label: '--source-crs'};
  }
  if (existsSync(trimmed)) {
    return {
      authority: 'option',
      definition: readFileSync(trimmed, 'utf8').trim(),
      label: '--source-crs',
    };
  }
  throw new TilesetBuildError(
    'TF_TILESET_BUILD_CRS_UNREADABLE',
    'crs',
    `Could not read --source-crs "${trimmed}". Expected EPSG:<code>, a proj string, WKT, or a .prj file path.`,
  );
}

/** A GeoJSON `crs` member: only named CRSs exist, and most files omit the member entirely. */
export function statementFromGeojsonCrs(member: unknown): CrsStatement {
  const name = (member as {properties?: {name?: unknown}} | null)?.properties?.name;
  if (typeof name !== 'string') {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_CRS_UNREADABLE',
      'crs',
      'The GeoJSON crs member is not a named CRS. Pass --source-crs to state it.',
    );
  }
  const code = /(?:epsg:(?::?[\d.]*:)?|ogc:(?:[\d.]*:)?crs)(\d+)/iu.exec(name)?.[1];
  if (/crs:?84/iu.test(name) || code === '84' || code === '4326') {
    return {authority: 'declared', definition: wgs84Definition, label: `GeoJSON crs ${name}`};
  }
  const definition = code ? epsgDefinition(Number(code)) : null;
  if (!definition) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_CRS_UNREADABLE',
      'crs',
      `The GeoJSON crs "${name}" has no built-in definition. Pass --source-crs with a proj string, WKT, or .prj path, plus --reproject.`,
    );
  }
  return {authority: 'declared', definition, label: `GeoJSON crs ${name}`};
}

export type GeopackageSrs = Readonly<{
  definition: string | null;
  /** WKT2 from the optional `definition_12_063` column. */
  definition12063: string | null;
  organization: string | null;
  organizationCode: number | null;
  srsId: number;
}>;

/**
 * A row of `gpkg_spatial_ref_sys`, or nothing when the layer points at a missing one. srs_id -1 and 0
 * are the records the standard reserves for undefined coordinates, so they state nothing.
 */
export function statementFromGeopackageSrs(
  layer: string,
  srs: GeopackageSrs | undefined,
): CrsStatement {
  if (!srs || srs.srsId === -1 || srs.srsId === 0) {
    return {
      authority: 'declared',
      definition: null,
      label: `GeoPackage layer "${layer}"`,
    };
  }
  const epsg = srs.organization?.toUpperCase() === 'EPSG' ? srs.organizationCode : null;
  const label =
    epsg === null
      ? `GeoPackage layer "${layer}" (srs_id ${srs.srsId})`
      : `GeoPackage layer "${layer}" (EPSG:${epsg})`;
  // proj4 reads a Pseudo-Mercator WKT without its PROJ4 extension as ellipsoidal, tens of kilometres off.
  const pseudoMercator =
    epsg === 3857 ||
    epsg === 3785 ||
    epsg === 900913 ||
    /^PROJCS\["[^"]*pseudo[ _-]?mercator/iu.test(srs.definition ?? '');
  const exact = pseudoMercator ? epsgDefinition(3857) : epsg === 4326 ? wgs84Definition : null;
  const known = epsg === null ? null : epsgDefinition(epsg);
  return {
    authority: 'declared',
    definition: exact ?? statedWkt(srs.definition) ?? known ?? statedWkt(srs.definition12063),
    label,
  };
}

function statedWkt(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.toLowerCase() !== 'undefined' ? trimmed : null;
}

export const wgs84Statement = (
  authority: CrsStatement['authority'],
  label: string,
): CrsStatement => ({authority, definition: wgs84Definition, label});

function epsgDefinition(code: number): string | null {
  if (code === 4326) return wgs84Definition;
  if (code === 3857 || code === 900913) {
    return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
  }
  if (code === 4258)
    return '+proj=longlat +ellps=GRS80 +datum=ETRS89 +towgs84=0,0,0,0,0,0,0 +no_defs';
  if (code === 4269)
    return '+proj=longlat +ellps=GRS80 +datum=NAD83 +towgs84=0,0,0,0,0,0,0 +no_defs';
  const zone = code % 100;
  if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${zone} +datum=WGS84 +no_defs`;
  if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${zone} +south +datum=WGS84 +no_defs`;
  // proj4 knows these only as GRS80 without a datum; the +towgs84 zeros state they coincide.
  if ((code >= 25801 && code <= 25860) || (code >= 26901 && code <= 26923)) {
    return `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  }
  return null;
}

type ParsedProjection = {
  datum?: {datum_type?: number};
  datumCode?: unknown;
  from_greenwich?: number;
  projName?: unknown;
  UNIT?: {convert?: number; name?: unknown};
};

function parseDefinition(definition: string, label: string): ParsedProjection {
  try {
    return new proj4.Proj(definition) as unknown as ParsedProjection;
  } catch {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_CRS_UNREADABLE',
      'crs',
      `${label} could not be parsed as a coordinate reference system. Pass --source-crs with a proj string, WKT, or .prj path.`,
    );
  }
}
