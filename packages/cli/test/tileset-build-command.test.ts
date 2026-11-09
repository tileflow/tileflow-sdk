import {VectorTile} from '@mapbox/vector-tile';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {crc32, deflateRawSync} from 'node:zlib';
import {PbfReader} from 'pbf';
import {PMTiles, type Source} from 'pmtiles';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {
  inspectNodeTeamTilesetArchive,
  openNodeTeamTilesetArchive,
  prepareTeamTilesetUpload,
} from '../src/tileset-upload';

const {DatabaseSync} = process.getBuiltinModule('node:sqlite');

type GeoJsonGeometry = {coordinates: any; type: string};
type DecodedFeature = {
  geometry: GeoJsonGeometry;
  id: number | undefined;
  properties: Record<string, boolean | number | string>;
};

const utm30nPrj =
  'PROJCS["ETRS_1989_UTM_Zone_30N",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const wgs84Prj =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const pseudoMercatorWkt =
  'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1]]';
const nad27Prj =
  'GEOGCS["GCS_North_American_1927",DATUM["D_North_American_1927",SPHEROID["Clarke_1866",6378206.4,294.9786982]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

test('GeoJSON becomes a validated archive whose tiles decode back to the source features', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'places.geojson'),
    JSON.stringify({
      features: [
        feature({coordinates: [-3.7074, 40.4155], type: 'Point'}, 'Plaza', {
          id: 7,
          properties: {nested: {a: 1}, open: true, rank: 3, ratio: 1.5, skipped: null},
        }),
        feature(
          {
            coordinates: [
              [-3.8, 40.3],
              [-3.6, 40.5],
            ],
            type: 'LineString',
          },
          'Route',
        ),
        feature(
          {
            coordinates: [
              [
                [-3.9, 40.2],
                [-3.9, 40.6],
                [-3.5, 40.6],
                [-3.5, 40.2],
                [-3.9, 40.2],
              ],
              [
                [-3.8, 40.3],
                [-3.7, 40.3],
                [-3.7, 40.4],
                [-3.8, 40.4],
                [-3.8, 40.3],
              ],
            ],
            type: 'Polygon',
          },
          'Park',
        ),
      ],
      type: 'FeatureCollection',
    }),
  );

  const result = await build(directory, ['places.geojson', '--maxzoom', '9', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout);
  assert.equal(document.command, 'tileset build');
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.archive.path, 'places.pmtiles');
  assert.equal(document.archive.maxzoomSource, 'option');
  assert.equal(document.input.features, 3);
  assert.equal(document.layer.id, 'places');
  assert.deepEqual(document.crs, {
    authority: 'format',
    label: 'GeoJSON (WGS84 by RFC 7946)',
    reprojected: false,
  });

  const inspected = await runCli(directory, ['tileset', 'inspect', 'places.pmtiles', '--json']);
  assert.equal(inspected.code, 0, inspected.stderr);
  const {contract} = JSON.parse(inspected.stdout);
  assert.equal(contract.tileType, 'mvt');
  assert.equal(contract.maxzoom, 9);
  assert.deepEqual(contract.sourceLayers[0].fields, [
    {name: 'name', type: 'String'},
    {name: 'nested', type: 'String'},
    {name: 'open', type: 'Boolean'},
    {name: 'rank', type: 'Number'},
    {name: 'ratio', type: 'Number'},
  ]);

  const decoded = await decodeZoom(join(directory, 'places.pmtiles'), 9, 'places');
  const plaza = decoded.find((item) => item.properties.name === 'Plaza')!;
  assert.equal(plaza.id, 7);
  assert.deepEqual(
    {...plaza.properties, name: undefined},
    {name: undefined, nested: '{"a":1}', open: true, rank: 3, ratio: 1.5},
  );
  assertClose(plaza.geometry.coordinates, [-3.7074, 40.4155], 0.0002);

  const parks = decoded.filter((item) => item.properties.name === 'Park');
  assert.ok(parks.every((item) => item.geometry.type === 'Polygon'));
  assert.ok(
    parks.some((item) => item.geometry.coordinates.length === 2),
    'the hole stays a hole',
  );
  const route = decoded.find((item) => item.properties.name === 'Route')!;
  assert.equal(route.geometry.type, 'LineString');
});

test('repeat builds are byte-identical and leave no temporary files', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'grid.geojson'), collection(gridPoints(400, 0.3)));

  assert.equal((await build(directory, ['grid.geojson', '-o', 'one.pmtiles'])).code, 0);
  assert.equal((await build(directory, ['grid.geojson', '-o', 'two.pmtiles'])).code, 0);
  assert.deepEqual(
    await readFile(join(directory, 'one.pmtiles')),
    await readFile(join(directory, 'two.pmtiles')),
  );
  assert.deepEqual((await readdir(directory)).sort(), [
    'grid.geojson',
    'one.pmtiles',
    'two.pmtiles',
  ]);
});

test('built archives pass the checks publish runs before uploading', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'stores.geojson'), collection(gridPoints(100, 0.2)));
  const result = await build(directory, [
    'stores.geojson',
    '--attribution',
    'Store data © Example',
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);

  const archive = join(directory, 'stores.pmtiles');
  const identity = await inspectNodeTeamTilesetArchive(archive);
  const file = await openNodeTeamTilesetArchive(archive, identity);
  t.after(() => file.close());
  await prepareTeamTilesetUpload(file);
  const inspected = await runCli(directory, ['tileset', 'inspect', 'stores.pmtiles', '--json']);
  assert.equal(JSON.parse(inspected.stdout).contract.attribution, 'Store data © Example');
});

test('streaming survives features and multibyte text that straddle read chunks', async (t) => {
  const directory = await workspace(t);
  const padding = 'ñ'.repeat(70_000);
  const features = Array.from({length: 120}, (_, index) =>
    feature({coordinates: [index / 10, 10], type: 'Point'}, `${index}-${padding}`),
  );
  // The WGS84 crs member after `features` is legal JSON and must not disturb parsing.
  await writeFile(
    join(directory, 'long.geojson'),
    `{"type":"FeatureCollection","features":${JSON.stringify(features)},"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}}}`,
  );
  const result = await build(directory, [
    'long.geojson',
    '--maxzoom',
    '10',
    '--minzoom',
    '10',
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).input.features, 120);
  const decoded = await decodeZoom(join(directory, 'long.pmtiles'), 10, 'long');
  const names = new Set(decoded.map((item) => String(item.properties.name)));
  assert.equal(names.size, 120);
  assert.ok(names.has(`7-${padding}`));
});

test('newline-delimited features and record separators are accepted', async (t) => {
  const directory = await workspace(t);
  const line = (index: number) =>
    JSON.stringify(feature({coordinates: [index, index], type: 'Point'}, `n${index}`));
  await writeFile(
    join(directory, 'seq.ndjson'),
    `${line(1)}\n\n\x1e${line(2)}\r\n${JSON.stringify({coordinates: [3, 3], type: 'Point'})}`,
  );
  const result = await build(directory, ['seq.ndjson', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).input.features, 3);
  assert.equal(JSON.parse(result.stdout).input.format, 'geojsonseq');
});

test('CSV columns are typed as a whole and quoting follows RFC 4180', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'stores.csv'),
    [
      '﻿name;Longitude;LAT;zip;visits;active',
      '"Café; ""Central""";-3.70;40.41;01234;10;true',
      '"Two\nLines";-3.71;40.42;28013;11.5;false',
      ';;;;;',
      'Blank;-3.72;40.43;;;',
    ].join('\r\n'),
  );
  const result = await build(directory, ['stores.csv', '--maxzoom', '12', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.features, 3);
  assert.equal(document.input.skipped.emptyGeometry, 1);
  assert.equal(document.crs.label, 'CSV longitude and latitude columns');
  assert.deepEqual(
    Object.fromEntries(document.layer.fields.map((item: any) => [item.name, item.type])),
    {active: 'Boolean', name: 'String', visits: 'Number', zip: 'String'},
  );

  const decoded = await decodeZoom(join(directory, 'stores.pmtiles'), 12, 'stores');
  const cafe = decoded.find((item) => item.properties.name === 'Café; "Central"')!;
  assert.deepEqual(
    {...cafe.properties},
    {
      active: true,
      name: 'Café; "Central"',
      visits: 10,
      zip: '01234',
    },
  );
  assert.ok(decoded.some((item) => item.properties.name === 'Two\nLines'));
  assert.deepEqual(
    {...decoded.find((item) => item.properties.name === 'Blank')!.properties},
    {
      name: 'Blank',
    },
  );
});

test('rows that straddle CSV read chunks stay intact', async (t) => {
  const directory = await workspace(t);
  const rows = Array.from({length: 120_000}, (_, index) => {
    return `"ñandú, ${index}",${(index % 3000) / 100},${(index % 2000) / 100}`;
  });
  await writeFile(join(directory, 'long.csv'), `name,lon,lat\n${rows.join('\n')}\n`);
  const result = await build(directory, ['long.csv', '--maxzoom', '5', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).input.features, 120_000);
  const decoded = await decodeZoom(join(directory, 'long.pmtiles'), 5, 'long');
  const names = new Set(decoded.map((item) => item.properties.name));
  assert.equal(names.size, 120_000);
  assert.ok(names.has('ñandú, 119999'));
});

test('CSV without recognizable coordinates fails with the columns it saw', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'projected.csv'), 'id,x,y\n1,440000,4470000\n');

  const unknown = await build(directory, ['projected.csv', '--json']);
  assert.equal(unknown.code, 1);
  assert.equal(failure(unknown).code, 'TF_TILESET_BUILD_CRS_UNKNOWN');

  const declared = await build(directory, ['projected.csv', '--source-crs', 'EPSG:4326', '--json']);
  assert.equal(failure(declared).code, 'TF_TILESET_BUILD_CSV_COLUMNS');
  assert.match(failure(declared).message, /id, x, y/u);

  const assumed = await build(directory, [
    'projected.csv',
    '--lon-column',
    'x',
    '--lat-column',
    'y',
    '--json',
  ]);
  assert.equal(failure(assumed).code, 'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE');
  assert.match(failure(assumed).message, /row 2/u);

  const converted = await build(directory, [
    'projected.csv',
    '--lon-column',
    'x',
    '--lat-column',
    'y',
    '--source-crs',
    'EPSG:25830',
    '--reproject',
    '--maxzoom',
    '12',
    '--json',
  ]);
  assert.equal(converted.code, 0, converted.stderr);
  assertClose(JSON.parse(converted.stdout).archive.bounds.slice(0, 2), [-3.7068, 40.3784], 0.001);
});

test('malformed CSV rows name the row', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'short.csv'), 'lon,lat,name\n1,2,a\n3,4\n');
  const short = await build(directory, ['short.csv', '--json']);
  assert.equal(failure(short).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.match(failure(short).message, /row 3/u);

  await writeFile(join(directory, 'comma.csv'), 'lon;lat\n"1,5";2\n');
  const comma = await build(directory, ['comma.csv', '--json']);
  assert.match(failure(comma).message, /row 2: .*Decimal commas/u);
});

test('Shapefiles keep attributes and holes, and require a stated CRS', async (t) => {
  const directory = await workspace(t);
  await writeShapefile(join(directory, 'parks'));

  const missing = await build(directory, ['parks.shp', '--json']);
  assert.equal(failure(missing).code, 'TF_TILESET_BUILD_CRS_UNKNOWN');
  assert.match(failure(missing).message, /--source-crs EPSG:4326/u);

  await writeFile(join(directory, 'parks.prj'), wgs84Prj);
  const result = await build(directory, ['parks.shp', '--maxzoom', '8', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.input.skipped, {emptyGeometry: 1, outsideMercator: 0});
  assert.equal(document.input.features, 1);
  assert.equal(document.crs.authority, 'declared');

  const [park] = await decodeZoom(join(directory, 'parks.pmtiles'), 8, 'parks');
  assert.deepEqual({...park.properties}, {NAME: 'Retiro', OPEN: true, SIZE: 118.5});
  assert.equal(park.geometry.type, 'Polygon');
  assert.equal(park.geometry.coordinates.length, 2);
});

test('Shapefiles larger than the read buffer stay aligned with their attributes', async (t) => {
  const directory = await workspace(t);
  const count = 200_000;
  const shp = Buffer.alloc(100 + count * 28);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE(shp.length / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(1, 32);
  const headerBytes = 32 + 32 + 1;
  const dbf = Buffer.alloc(headerBytes + count * 9 + 1, 0x20);
  dbf.fill(0, 0, headerBytes);
  dbf[0] = 3;
  dbf.writeUInt32LE(count, 4);
  dbf.writeUInt16LE(headerBytes, 8);
  dbf.writeUInt16LE(9, 10);
  dbf.write('ROW', 32, 'latin1');
  dbf.write('N', 43, 'latin1');
  dbf[48] = 8;
  dbf[headerBytes - 1] = 0x0d;
  for (let index = 0; index < count; index += 1) {
    const offset = 100 + index * 28;
    shp.writeInt32BE(index + 1, offset);
    shp.writeInt32BE(10, offset + 4);
    shp.writeInt32LE(1, offset + 8);
    shp.writeDoubleLE((index % 1000) / 100, offset + 12);
    shp.writeDoubleLE(Math.floor(index / 1000) / 100, offset + 20);
    dbf.write(String(index).padStart(8), headerBytes + index * 9 + 1, 'latin1');
  }
  await writeFile(join(directory, 'big.shp'), shp);
  await writeFile(join(directory, 'big.dbf'), dbf);
  await writeFile(join(directory, 'big.prj'), wgs84Prj);

  const result = await build(directory, ['big.shp', '--maxzoom', '5', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const decoded = await decodeZoom(join(directory, 'big.pmtiles'), 5, 'big');
  const seen = new Map(decoded.map((item) => [item.properties.ROW as number, item]));
  assert.equal(seen.size, count);
  const last = seen.get(count - 1)!;
  assertClose(last.geometry.coordinates, [9.99, 1.99], 0.03);
});

test('a non-WGS84 Shapefile is converted only when asked, and never across an unknown datum', async (t) => {
  const directory = await workspace(t);
  await writeShapefile(join(directory, 'utm'), {
    hole: [
      [441000, 4471000],
      [441000, 4472000],
      [442000, 4472000],
      [442000, 4471000],
      [441000, 4471000],
    ],
    outer: [
      [440000, 4470000],
      [445000, 4470000],
      [445000, 4475000],
      [440000, 4475000],
      [440000, 4470000],
    ],
  });
  await writeFile(join(directory, 'utm.prj'), utm30nPrj);

  const refused = await build(directory, ['utm.shp', '--json']);
  assert.equal(failure(refused).code, 'TF_TILESET_BUILD_CRS_NOT_WGS84');
  assert.match(failure(refused).message, /--reproject/u);
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.endsWith('.pmtiles')),
    [],
  );

  const converted = await build(directory, ['utm.shp', '--reproject', '--maxzoom', '8', '--json']);
  assert.equal(converted.code, 0, converted.stderr);
  const document = JSON.parse(converted.stdout);
  assert.equal(document.crs.reprojected, true);
  assert.match(document.warnings.join(' '), /coincident with WGS84/u);
  assertClose(document.archive.bounds.slice(0, 2), [-3.7068, 40.3784], 0.001);

  await writeFile(join(directory, 'utm.prj'), nad27Prj);
  const datum = await build(directory, ['utm.shp', '--reproject', '--force', '--json']);
  assert.equal(failure(datum).code, 'TF_TILESET_BUILD_DATUM_UNSUPPORTED');
  assert.match(failure(datum).message, /\+towgs84/u);
});

test('coordinates that do not look like WGS84 are refused instead of misplaced', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'metres.geojson'),
    collection([feature({coordinates: [440000, 4470000], type: 'Point'}, 'a')]),
  );
  const refused = await build(directory, ['metres.geojson', '--json']);
  assert.equal(failure(refused).code, 'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE');
  assert.match(failure(refused).message, /feature 1: \[440000, 4470000\]/u);
  assert.match(failure(refused).message, /--source-crs/u);
  assert.deepEqual(await readdir(directory), ['metres.geojson']);
});

test('a GeoJSON crs member is honoured, and a wrong statement is caught', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'mercator.geojson'),
    JSON.stringify({
      crs: {properties: {name: 'urn:ogc:def:crs:EPSG::3857'}, type: 'name'},
      features: [feature({coordinates: [-412000, 4925000], type: 'Point'}, 'a')],
      type: 'FeatureCollection',
    }),
  );
  const refused = await build(directory, ['mercator.geojson', '--json']);
  assert.equal(failure(refused).code, 'TF_TILESET_BUILD_CRS_NOT_WGS84');

  const converted = await build(directory, [
    'mercator.geojson',
    '--source-crs',
    'EPSG:3857',
    '--reproject',
    '--json',
  ]);
  assert.equal(converted.code, 0, converted.stderr);
  assertClose(JSON.parse(converted.stdout).archive.bounds.slice(0, 2), [-3.7011, 40.4052], 0.001);

  const wrong = await build(directory, [
    'mercator.geojson',
    '--source-crs',
    'EPSG:4326',
    '--force',
    '--json',
  ]);
  assert.equal(failure(wrong).code, 'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE');
});

test('an unknown CRS cannot be stated by accident', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'a.geojson'), collection(gridPoints(1, 0)));
  const code = await build(directory, ['a.geojson', '--source-crs', 'EPSG:2062', '--json']);
  assert.equal(failure(code).code, 'TF_TILESET_BUILD_CRS_UNREADABLE');
  assert.match(failure(code).message, /proj string/u);
  const text = await build(directory, ['a.geojson', '--source-crs', 'nonsense', '--json']);
  assert.equal(failure(text).code, 'TF_TILESET_BUILD_CRS_UNREADABLE');
});

test('a triangular tile stays empty outside its diagonal at higher zooms', async (t) => {
  const directory = await workspace(t);
  const latitude = 40.979898069620134;
  await writeFile(
    join(directory, 'triangle.geojson'),
    JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-45, latitude],
          [45, latitude],
          [45, -latitude],
          [-45, latitude],
        ],
      ],
    }),
  );

  const result = await build(directory, ['triangle.geojson', '--maxzoom', '6', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const archive = new PMTiles(fileSource(await readFile(join(directory, 'triangle.pmtiles'))));
  assert.ok(await archive.getZxy(6, 31, 28));
  assert.equal(await archive.getZxy(6, 28, 31), undefined);
});

for (const mismatch of ['truncated', 'missing', 'extra', 'deleted'] as const) {
  test(`Shapefile conversion accounts for DBF rows marked ${mismatch}`, async (t) => {
    const directory = await workspace(t);
    const stem = join(directory, 'parks');
    await writeShapefile(stem);
    const dbf = await readFile(stem + '.dbf');
    const header = dbf.readUInt16LE(8);
    const width = dbf.readUInt16LE(10);
    let data = dbf;
    if (mismatch === 'truncated') data = dbf.subarray(0, header + 2 * width - 1);
    if (mismatch === 'missing') {
      dbf.writeUInt32LE(1, 4);
      data = dbf.subarray(0, header + width);
    }
    if (mismatch === 'extra') {
      dbf.writeUInt32LE(3, 4);
      data = Buffer.concat([dbf.subarray(0, header + 2 * width), dbf.subarray(header + width)]);
    }
    if (mismatch === 'deleted') dbf[header + width] = 0x2a;
    await writeFile(stem + '.dbf', data);

    const result = await build(directory, [
      'parks.shp',
      '--source-crs',
      'EPSG:4326',
      '--maxzoom',
      '0',
      '--json',
    ]);
    if (mismatch === 'extra') {
      assert.equal(result.code, 0, result.stderr);
      const document = JSON.parse(result.stdout);
      assert.equal(document.input.features, 1);
      assert.match(document.warnings.join(' '), /1 extra.*row/iu);
    } else if (mismatch === 'deleted') {
      assert.equal(failure(result).code, 'TF_TILESET_BUILD_EMPTY');
    } else {
      assert.equal(result.code, 1);
      assert.equal(failure(result).code, 'TF_TILESET_BUILD_INPUT_INVALID');
      assert.match(failure(result).message, /record 2/iu);
    }
  });
}

for (const [code, point] of [
  [4258, [-3.7, 40.4]],
  [4269, [-73.99, 40.75]],
] as const) {
  test(`EPSG:${code} reprojects geographic points using the coincident datum`, async (t) => {
    const directory = await workspace(t);
    await writeFile(join(directory, 'site.csv'), `lon,lat\n${point.join(',')}\n`);
    const result = await build(directory, [
      'site.csv',
      '--source-crs',
      `EPSG:${code}`,
      '--reproject',
      '--maxzoom',
      '0',
      '--json',
    ]);
    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(result.stdout);
    assertClose(document.archive.bounds, [...point, ...point], 1e-6);
    assert.equal(document.crs.reprojected, true);
    assert.match(document.warnings.join(' '), /coincident/iu);
  });
}

test('features are clipped into every tile they cross', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'cross.geojson'),
    collection([
      feature(
        {
          coordinates: [
            [-30, 30],
            [30, 30],
          ],
          type: 'LineString',
        },
        'line',
      ),
    ]),
  );
  const result = await build(directory, ['cross.geojson', '--maxzoom', '4', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const tiles = await listTiles(join(directory, 'cross.pmtiles'), 1);
  assert.deepEqual(tiles.sort(), ['1/0/0', '1/1/0']);
  const decoded = await decodeZoom(join(directory, 'cross.pmtiles'), 4, 'cross');
  assert.ok(decoded.length >= 2);
  for (const item of decoded) assert.equal(item.properties.name, 'line');
});

test('tiles inside one large polygon share their bytes, so high zooms stay cheap', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'country.geojson'),
    collection([
      feature(
        {
          coordinates: [
            [
              [-20, -20],
              [-20, 20],
              [20, 20],
              [20, -20],
              [-20, -20],
            ],
          ],
          type: 'Polygon',
        },
        'country',
      ),
    ]),
  );
  const started = Date.now();
  const result = await build(directory, ['country.geojson', '--maxzoom', '14', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const {archive} = JSON.parse(result.stdout);
  assert.ok(archive.addressedTiles > 3_000_000, String(archive.addressedTiles));
  assert.ok(archive.tileContents < archive.addressedTiles / 1000);
  assert.ok(Date.now() - started < 60_000);

  const source = new PMTiles(fileSource(await readFile(join(directory, 'country.pmtiles'))));
  const inside = await source.getZxy(14, 8192 + 100, 8192 + 100);
  assert.ok(inside, 'an interior tile at the last zoom must exist');
});

test('a shape spanning a tile corner to corner is not mistaken for a filled tile', async (t) => {
  const directory = await workspace(t);
  // At 2/2/1 this diamond touches all four edges but leaves the corners empty.
  await writeFile(
    join(directory, 'diamond.geojson'),
    collection([
      feature(
        {
          coordinates: [
            [
              [45, 0],
              [90, 40.97],
              [45, 66.51],
              [0, 40.97],
              [45, 0],
            ],
          ],
          type: 'Polygon',
        },
        'diamond',
      ),
    ]),
  );
  const result = await build(directory, ['diamond.geojson', '--maxzoom', '6', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const reader = new PMTiles(fileSource(await readFile(join(directory, 'diamond.pmtiles'))));
  assert.equal(await reader.getZxy(6, 32, 16), undefined, 'the empty corner has no tile');
  assert.ok(await reader.getZxy(6, 40, 24), 'the middle has one');
});

test('dense data thins below the last zoom and stays complete at it', async (t) => {
  const directory = await workspace(t);
  const features = Array.from({length: 60_000}, (_, index) =>
    feature(
      {coordinates: [(index % 300) / 1000, Math.floor(index / 300) / 1000], type: 'Point'},
      `store-${index}-${createHash('sha256').update(String(index)).digest('hex')}`,
    ),
  );
  await writeFile(join(directory, 'dense.geojson'), collection(features));

  const result = await build(directory, ['dense.geojson', '--maxzoom', '12', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const {zooms} = JSON.parse(result.stdout);
  assert.ok(zooms[0].thinnedFeatures > 0, 'the world tile cannot hold every feature');
  assert.equal(zooms.at(-1).thinnedFeatures, 0);

  const decoded = await decodeZoom(join(directory, 'dense.pmtiles'), 12, 'dense');
  assert.equal(new Set(decoded.map((item) => item.properties.name)).size, 60_000);
  const low = await decodeZoom(join(directory, 'dense.pmtiles'), 0, 'dense');
  assert.ok(low.length > 0 && low.length < 60_000);
});

test('a last-zoom tile that cannot fit fails with the tile and the way out', async (t) => {
  const directory = await workspace(t);
  const features = Array.from({length: 40}, (_, index) =>
    feature({coordinates: [index / 1000, 0], type: 'Point'}, `${index}-${'y'.repeat(200_000)}`),
  );
  await writeFile(join(directory, 'heavy.geojson'), collection(features));
  const result = await build(directory, ['heavy.geojson', '--maxzoom', '3', '--json']);
  assert.equal(failure(result).code, 'TF_TILESET_BUILD_TILE_TOO_LARGE');
  assert.match(failure(result).message, /Tile 3\/\d\/\d /u);
  assert.match(failure(result).message, /--maxzoom/u);
  assert.deepEqual(await readdir(directory), ['heavy.geojson']);
});

test('large directories spill into leaves that readers can follow', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'sparse.geojson'), collection(gridPoints(40_000, 80)));
  const result = await build(directory, ['sparse.geojson', '--maxzoom', '11', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const bytes = await readFile(join(directory, 'sparse.pmtiles'));
  const header = await new PMTiles(fileSource(bytes)).getHeader();
  assert.ok((header.leafDirectoryLength ?? 0) > 0, 'expected leaf directories');
  const {archive} = JSON.parse(result.stdout);
  assert.ok(archive.tileContents > 10_000, String(archive.tileContents));
  const reader = new PMTiles(fileSource(bytes));
  const points = gridPoints(40_000, 80);
  for (const index of [0, 12_345, 39_999]) {
    const [longitude, latitude] = points[index].geometry.coordinates;
    const x = Math.floor(((longitude + 180) / 360) * 2 ** 11);
    const sine = Math.sin((latitude * Math.PI) / 180);
    const y = Math.floor((0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * 2 ** 11);
    const tile = await reader.getZxy(11, x, y);
    assert.ok(tile, `${x}/${y} should resolve through a leaf directory`);
    const layer = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers.sparse;
    assert.ok(layer.length > 0);
  }
});

test('polygons too small for a zoom stay visible and every feature survives the last zoom', async (t) => {
  const directory = await workspace(t);
  const square = (x: number, y: number) => ({
    coordinates: [
      [
        [x, y],
        [x + 0.00001, y],
        [x + 0.00001, y + 0.00001],
        [x, y + 0.00001],
        [x, y],
      ],
    ],
    type: 'Polygon',
  });
  await writeFile(
    join(directory, 'tiny.geojson'),
    collection(
      Array.from({length: 50}, (_, index) => feature(square(index * 3, 10), `tiny-${index}`)),
    ),
  );
  const result = await build(directory, ['tiny.geojson', '--maxzoom', '3', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const lowest = await decodeZoom(join(directory, 'tiny.pmtiles'), 0, 'tiny');
  assert.ok(lowest.length > 40, String(lowest.length));
  const last = await decodeZoom(join(directory, 'tiny.pmtiles'), 3, 'tiny');
  assert.equal(new Set(last.map((item) => item.properties.name)).size, 50);
  assert.ok(last.every((item) => item.geometry.type === 'Polygon'));
});

test('attribute selection works on source names and unsafe names are reported', async (t) => {
  const directory = await workspace(t);
  const properties = {'Nombre del sitio': 'Sol', código: 'a', secret: 'no'};
  await writeFile(
    join(directory, 'a.geojson'),
    collection([feature({coordinates: [1, 1], type: 'Point'}, 'x', {properties})]),
  );
  const excluded = await build(directory, ['a.geojson', '--exclude', 'secret,name', '--json']);
  assert.equal(excluded.code, 0, excluded.stderr);
  const document = JSON.parse(excluded.stdout);
  assert.deepEqual(
    document.layer.fields.map((item: any) => [item.sourceName, item.name]),
    [
      ['Nombre del sitio', 'Nombre_del_sitio'],
      ['código', 'codigo'],
    ],
  );
  assert.match(document.warnings.join(' '), /"código" was renamed to "codigo"/u);

  const included = await build(directory, [
    'a.geojson',
    '--include',
    'secret',
    '-o',
    'b.pmtiles',
    '--json',
  ]);
  assert.deepEqual(
    JSON.parse(included.stdout).layer.fields.map((item: any) => item.name),
    ['secret'],
  );

  const both = await build(directory, ['a.geojson', '--include', 'a', '--exclude', 'b', '--json']);
  assert.equal(failure(both).code, 'TF_TILESET_BUILD_FIELDS_INVALID');
});

test('field names that collide after renaming stop the build', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'a.geojson'),
    collection([
      feature({coordinates: [1, 1], type: 'Point'}, 'x', {properties: {'a b': 1, a_b: 2}}),
    ]),
  );
  const result = await build(directory, ['a.geojson', '--json']);
  assert.equal(failure(result).code, 'TF_TILESET_BUILD_FIELD_CONFLICT');
});

test('invalid requests fail fast with stable codes and keep existing output', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'a.geojson'), collection(gridPoints(4, 1)));
  await writeFile(join(directory, 'taken.pmtiles'), 'keep me');
  await writeFile(join(directory, 'a.fgb'), 'x');
  await writeFile(join(directory, 'a.zip'), 'x');
  await writeFile(join(directory, 'empty.geojson'), '{"type":"FeatureCollection","features":[]}');
  await writeFile(join(directory, 'cut.geojson'), '{"type":"FeatureCollection","features":[{');
  await writeFile(
    join(directory, 'bad.geojson'),
    collection([
      {geometry: {coordinates: [[1, 2]], type: 'Circle'}, properties: {}, type: 'Feature'},
    ]),
  );

  const cases: Array<[string[], string, RegExp?]> = [
    [['missing.geojson'], 'TF_TILESET_BUILD_INPUT_MISSING'],
    [['a.fgb'], 'TF_TILESET_BUILD_FORMAT_UNSUPPORTED', /\.shp/u],
    [['a.zip'], 'TF_TILESET_BUILD_INPUT_INVALID', /zip could not be read/u],
    [['a.geojson', '-o', 'taken.pmtiles'], 'TF_TILESET_BUILD_OUTPUT_EXISTS', /--force/u],
    [['a.geojson', '-o', 'a.geojson'], 'TF_TILESET_BUILD_OUTPUT_INVALID'],
    [['a.geojson', '--maxzoom', '40'], 'TF_TILESET_BUILD_ZOOM_INVALID'],
    [['a.geojson', '--minzoom', '5', '--maxzoom', '4'], 'TF_TILESET_BUILD_ZOOM_INVALID'],
    [['a.geojson', '--layer', 'no spaces'], 'TF_TILESET_BUILD_LAYER_INVALID'],
    [['empty.geojson'], 'TF_TILESET_BUILD_EMPTY'],
    [['cut.geojson'], 'TF_TILESET_BUILD_INPUT_INVALID', /truncated/u],
    [['bad.geojson'], 'TF_TILESET_BUILD_INPUT_INVALID', /feature 1: unsupported geometry/u],
  ];
  for (const [args, code, message] of cases) {
    const result = await build(directory, [...args, '--json']);
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(result.stdout, '');
    assert.equal(failure(result).code, code, args.join(' '));
    if (message) assert.match(failure(result).message, message);
  }
  assert.equal(await readFile(join(directory, 'taken.pmtiles'), 'utf8'), 'keep me');
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.startsWith('.')),
    [],
  );
});

test('one degenerate ring or line is reported without stopping the build', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'mixed.geojson'),
    collection([
      feature(
        {
          coordinates: [
            [
              [1, 1],
              [2, 2],
              [1, 1],
            ],
          ],
          type: 'Polygon',
        },
        'ring',
      ),
      feature({coordinates: [[3, 3]], type: 'LineString'}, 'line'),
      feature({coordinates: [4, 4], type: 'Point'}, 'kept'),
    ]),
  );
  const result = await build(directory, ['mixed.geojson', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.features, 1);
  assert.deepEqual(document.input.skipped, {emptyGeometry: 2, outsideMercator: 0});
  assert.match(document.warnings.join(' '), /2 rings or lines with too few positions/u);
});

// On Windows, child.kill() ends the process at once, so its signal handler cannot be exercised.
const signalsReachHandlers = process.platform !== 'win32';

test(
  'interrupting a build removes its temporary files',
  {skip: !signalsReachHandlers},
  async (t) => {
    const directory = await workspace(t);
    await writeFile(
      join(directory, 'big.ndjson'),
      Array.from({length: 300_000}, (_, index) =>
        JSON.stringify(
          feature(
            {coordinates: [(index % 900) / 10, (index % 700) / 10], type: 'Point'},
            `n${index}`,
          ),
        ),
      ).join('\n'),
    );
    const child = spawn(process.execPath, cliFixtureArguments(['tileset', 'build', 'big.ndjson']), {
      cwd: directory,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await new Promise<void>((resolve) => {
      child.stderr.on('data', (chunk) => {
        if (String(chunk).includes('Reading features')) resolve();
      });
    });
    child.kill('SIGINT');
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 130);
    assert.deepEqual(await readdir(directory), ['big.ndjson']);
  },
);

test('Web Mercator limits and antimeridian crossings are reported, not hidden', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'edges.geojson'),
    collection([
      feature({coordinates: [10, 89], type: 'Point'}, 'pole'),
      feature({coordinates: [10, 10], type: 'Point'}, 'ok'),
      feature(
        {
          coordinates: [
            [179, 1],
            [-179, 2],
          ],
          type: 'LineString',
        },
        'wrap',
      ),
      {geometry: null, properties: {name: 'none'}, type: 'Feature'},
    ]),
  );
  const result = await build(directory, ['edges.geojson', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.input.skipped, {emptyGeometry: 1, outsideMercator: 1});
  const warnings = document.warnings.join(' ');
  assert.match(warnings, /past latitude ±85\.05/u);
  assert.match(warnings, /antimeridian/u);
  assert.match(warnings, /without geometry/u);
});

test('coordinates barely past the limits of the world are moved to them and reported', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'edge.geojson'),
    collection([
      feature({coordinates: [-180.00003, 10], type: 'Point'}, 'edge'),
      feature({coordinates: [20, 10], type: 'Point'}, 'inside'),
    ]),
  );
  const result = await build(directory, ['edge.geojson', '--maxzoom', '4', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.features, 2);
  assert.equal(document.archive.bounds[0], -180);
  assert.match(document.warnings.join(' '), /1 coordinates up to 0\.001° past/u);

  await writeFile(
    join(directory, 'far.geojson'),
    collection([feature({coordinates: [-180.5, 10], type: 'Point'}, 'far')]),
  );
  const far = await build(directory, ['far.geojson', '--maxzoom', '4', '--json']);
  assert.equal(failure(far).code, 'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE');
});

test('a ring dropped near the pole does not take the next feature with it', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'rings.geojson'),
    collection([
      feature(
        {
          coordinates: [
            [
              [10, 89],
              [10, 89.5],
              [10, 89],
            ],
          ],
          type: 'Polygon',
        },
        'degenerate',
      ),
      feature({coordinates: [10, 10], type: 'Point'}, 'next'),
    ]),
  );
  const result = await build(directory, ['rings.geojson', '--maxzoom', '4', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.features, 1);
  assert.deepEqual(document.input.skipped, {emptyGeometry: 1, outsideMercator: 0});
  const [point] = await decodeZoom(join(directory, 'rings.pmtiles'), 4, 'rings');
  assert.equal(point.properties.name, 'next');
});

test('a MultiPoint keeps the positions Web Mercator can hold', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'multi.geojson'),
    collection([
      feature(
        {
          coordinates: [
            [10, 89],
            [11, 11],
            [12, 12],
          ],
          type: 'MultiPoint',
        },
        'partial',
      ),
      feature(
        {
          coordinates: [
            [30, 88],
            [31, 87],
          ],
          type: 'MultiPoint',
        },
        'polar',
      ),
    ]),
  );
  const result = await build(directory, ['multi.geojson', '--maxzoom', '4', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.features, 1);
  assert.equal(document.input.skipped.outsideMercator, 3);
  assertClose([...document.archive.bounds], [11, 11, 12, 12], 1e-6);
  const decoded = await decodeZoom(join(directory, 'multi.pmtiles'), 4, 'multi');
  assert.deepEqual([...new Set(decoded.map((item) => item.properties.name))], ['partial']);
  assert.equal(decoded[0].geometry.type, 'MultiPoint');
});

test('prime meridians and angular units are not mistaken for plain WGS84', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'p.csv'), 'lon,lat\n1,45\n');
  const paris =
    'GEOGCS["Paris",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Paris",2.33722917],UNIT["degree",0.0174532925199433]]';
  const refused = await build(directory, ['p.csv', '--source-crs', paris, '--json']);
  assert.equal(failure(refused).code, 'TF_TILESET_BUILD_CRS_NOT_WGS84');
  const converted = await build(directory, [
    'p.csv',
    '--source-crs',
    paris,
    '--reproject',
    '--maxzoom',
    '4',
    '--json',
  ]);
  assert.equal(converted.code, 0, converted.stderr);
  assertClose(JSON.parse(converted.stdout).archive.bounds.slice(0, 2), [3.337229, 45], 1e-5);

  const grad =
    'GEOGCS["Grad",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["grad",0.015707963267949]]';
  for (const extra of [[], ['--reproject']]) {
    const result = await build(directory, [
      'p.csv',
      '--source-crs',
      grad,
      '--force',
      ...extra,
      '--json',
    ]);
    assert.equal(failure(result).code, 'TF_TILESET_BUILD_CRS_UNSUPPORTED');
  }
});

test('a zipped Shapefile builds without being extracted first', async (t) => {
  const directory = await workspace(t);
  const parts = await shapefileParts(directory);
  await writeZip(join(directory, 'parks.shp.zip'), [
    {data: Buffer.from('ignored'), name: '__MACOSX/data/._parks.shp'},
    {data: parts.shp, name: 'data/PARKS.SHP'},
    {data: parts.dbf, name: 'data/PARKS.dbf'},
    {data: Buffer.from(wgs84Prj), name: 'data/parks.prj'},
    {data: Buffer.from('readme'), name: 'data/README.txt'},
  ]);

  const result = await build(directory, ['parks.shp.zip', '--maxzoom', '8', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.format, 'shapefile');
  assert.equal(document.archive.path, 'parks.pmtiles');
  assert.equal(document.layer.id, 'parks');
  assert.equal(document.crs.authority, 'declared');
  const [park] = await decodeZoom(join(directory, 'parks.pmtiles'), 8, 'parks');
  assert.deepEqual({...park.properties}, {NAME: 'Retiro', OPEN: true, SIZE: 118.5});
  assert.equal(park.geometry.coordinates.length, 2);
  await assertNoTemporaryFiles(directory);
});

test('a zip holding several Shapefiles asks which one, and bad zips fail clearly', async (t) => {
  const directory = await workspace(t);
  const parts = await shapefileParts(directory);
  await writeZip(join(directory, 'many.zip'), [
    {data: parts.shp, name: 'a/parks.shp'},
    {data: parts.dbf, name: 'a/parks.dbf'},
    {data: Buffer.from(wgs84Prj), name: 'a/parks.prj'},
    {data: parts.shp, name: 'b/lakes.shp'},
  ]);
  const ambiguous = await build(directory, ['many.zip', '--json']);
  assert.equal(failure(ambiguous).code, 'TF_TILESET_BUILD_ZIP_ENTRY_INVALID');
  assert.match(failure(ambiguous).message, /a\/parks\.shp, b\/lakes\.shp/u);
  const missing = await build(directory, ['many.zip', '--zip-entry', 'nope.shp', '--json']);
  assert.equal(failure(missing).code, 'TF_TILESET_BUILD_ZIP_ENTRY_INVALID');
  const chosen = await build(directory, [
    'many.zip',
    '--zip-entry',
    'a/parks.shp',
    '--maxzoom',
    '8',
    '--json',
  ]);
  assert.equal(chosen.code, 0, chosen.stderr);
  assert.equal(JSON.parse(chosen.stdout).input.features, 1);

  await writeZip(join(directory, 'empty.zip'), [{data: Buffer.from('x'), name: 'notes.txt'}]);
  const empty = await build(directory, ['empty.zip', '--json']);
  assert.equal(failure(empty).code, 'TF_TILESET_BUILD_ZIP_ENTRY_INVALID');

  await writeFile(join(directory, 'broken.zip'), 'this is not a zip');
  const broken = await build(directory, ['broken.zip', '--json']);
  assert.equal(failure(broken).code, 'TF_TILESET_BUILD_INPUT_INVALID');

  await writeZip(join(directory, 'escape.zip'), [{data: parts.shp, name: '../escape.shp'}]);
  const escape = await build(directory, ['escape.zip', '--json']);
  assert.equal(failure(escape).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.deepEqual(
    (await readdir(join(directory, '..'))).filter((name) => name === 'escape.shp'),
    [],
  );

  await writeZip(join(directory, 'noprj.zip'), [{data: parts.shp, name: 'parks.shp'}]);
  const unknown = await build(directory, ['noprj.zip', '--json']);
  assert.equal(failure(unknown).code, 'TF_TILESET_BUILD_CRS_UNKNOWN');
  await assertNoTemporaryFiles(directory);

  const notZip = await build(directory, ['many.zip', '--format', 'csv', '--json']);
  assert.equal(failure(notZip).code, 'TF_TILESET_BUILD_FORMAT_UNSUPPORTED');
});

test('the resulting location is reported, so a wrong CRS statement can be noticed', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'utm.csv'), 'x,y\n440000,4474000\n441000,4475000\n');
  const converted = await build(directory, [
    'utm.csv',
    '--lon-column',
    'x',
    '--lat-column',
    'y',
    '--source-crs',
    'EPSG:32630',
    '--reproject',
    '--maxzoom',
    '8',
    '--json',
  ]);
  assert.equal(converted.code, 0, converted.stderr);
  const warnings: string[] = JSON.parse(converted.stdout).warnings;
  assert.ok(
    warnings.some((item) =>
      /longitude -3\.\d+ to -3\.\d+ and latitude 40\.\d+ to 40\.\d+/u.test(item),
    ),
    warnings.join('; '),
  );

  // Degrees read as UTM metres are all valid numbers, and land next to the zone origin.
  await writeFile(join(directory, 'wrong.csv'), 'x,y\n-3.7,40.4\n-3.6,40.5\n');
  const misread = await build(directory, [
    'wrong.csv',
    '--lon-column',
    'x',
    '--lat-column',
    'y',
    '--source-crs',
    'EPSG:32631',
    '--reproject',
    '--maxzoom',
    '8',
    '--json',
  ]);
  assert.equal(misread.code, 0, misread.stderr);
  assert.ok(
    JSON.parse(misread.stdout).warnings.some((item: string) => /latitude -?0\.0+/u.test(item)),
  );

  await writeFile(
    join(directory, 'zero.geojson'),
    collection([feature({coordinates: [0, 0], type: 'Point'}, 'placeholder')]),
  );
  const zero = await build(directory, ['zero.geojson', '--maxzoom', '8', '--json']);
  assert.match(JSON.parse(zero.stdout).warnings.join(' '), /placeholder zero coordinates/u);

  await writeFile(
    join(directory, 'plain.geojson'),
    collection([feature({coordinates: [-3.7, 40.4], type: 'Point'}, 'Madrid')]),
  );
  const plain = await build(directory, ['plain.geojson', '--maxzoom', '8', '--json']);
  assert.deepEqual(JSON.parse(plain.stdout).warnings, []);
  const human = await build(directory, ['plain.geojson', '--maxzoom', '8', '--force']);
  assert.match(human.stdout, /Bounds: -3\.7000, 40\.4000, -3\.7000, 40\.4000/u);
});

test('--rank-by decides which features survive thinning', async (t) => {
  const directory = await workspace(t);
  // Listed from least to most important, so input order would keep the wrong ones.
  const features = Array.from({length: 40_000}, (_, index) =>
    feature(
      {coordinates: [(index % 200) / 2000, Math.floor(index / 200) / 2000], type: 'Point'},
      String(index),
      {properties: {name: String(index), score: index}},
    ),
  );
  await writeFile(join(directory, 'ranked.geojson'), collection(features));

  const descending = await build(directory, [
    'ranked.geojson',
    '--maxzoom',
    '10',
    '--rank-by',
    'score',
    '--include',
    'name',
    '--json',
  ]);
  assert.equal(descending.code, 0, descending.stderr);
  const top = await decodeZoom(join(directory, 'ranked.pmtiles'), 0, 'ranked');
  assert.ok(top.length < 40_000);
  assert.ok(top.some((item) => item.properties.name === '39999'));
  assert.ok(!top.some((item) => item.properties.name === '0'));
  // The ranking attribute does not have to be kept in the tiles.
  assert.deepEqual(Object.keys(top[0].properties), ['name']);

  const ascending = await build(directory, [
    'ranked.geojson',
    '--maxzoom',
    '10',
    '--rank-by',
    'score',
    '--rank-ascending',
    '--force',
    '--json',
  ]);
  assert.equal(ascending.code, 0, ascending.stderr);
  const bottom = await decodeZoom(join(directory, 'ranked.pmtiles'), 0, 'ranked');
  assert.ok(bottom.some((item) => item.properties.name === '0'));
  assert.ok(!bottom.some((item) => item.properties.name === '39999'));
  const complete = await decodeZoom(join(directory, 'ranked.pmtiles'), 10, 'ranked');
  assert.equal(new Set(complete.map((item) => item.properties.name)).size, 40_000);
});

test('ranking reports features it cannot rank and refuses a field with no numbers', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'mixed.geojson'),
    collection([
      feature({coordinates: [1, 1], type: 'Point'}, 'a', {properties: {score: 2}}),
      feature({coordinates: [2, 2], type: 'Point'}, 'b', {properties: {score: 'high'}}),
    ]),
  );
  const partial = await build(directory, [
    'mixed.geojson',
    '--maxzoom',
    '8',
    '--rank-by',
    'score',
    '--json',
  ]);
  assert.equal(partial.code, 0, partial.stderr);
  assert.match(
    JSON.parse(partial.stdout).warnings.join(' '),
    /1 features have no numeric "score"/u,
  );

  const absent = await build(directory, [
    'mixed.geojson',
    '--maxzoom',
    '8',
    '--rank-by',
    'nothing',
    '--force',
    '--json',
  ]);
  assert.equal(failure(absent).code, 'TF_TILESET_BUILD_RANK_INVALID');

  const orphan = await build(directory, ['mixed.geojson', '--rank-ascending', '--force', '--json']);
  assert.equal(failure(orphan).code, 'TF_TILESET_BUILD_RANK_INVALID');
  const notZip = await build(directory, ['mixed.geojson', '--zip-entry', 'a.shp', '--json']);
  assert.equal(failure(notZip).code, 'TF_TILESET_BUILD_ZIP_ENTRY_INVALID');
});

for (const [label, extra] of [
  ['the input order', []],
  ['a rank', ['--rank-by', 'score']],
] as const) {
  test(`points kept at a zoom stay at every higher zoom, ranked by ${label}`, async (t) => {
    const directory = await workspace(t);
    // Long unique text pushes the top tiles past their byte budget, not only their pixel grid.
    const features = Array.from({length: 30_000}, (_, index) => {
      const hash = createHash('sha256').update(String(index)).digest('hex');
      return feature(
        {
          coordinates: [
            (parseInt(hash.slice(0, 6), 16) / 2 ** 24) * 3,
            (parseInt(hash.slice(6, 12), 16) / 2 ** 24) * 3,
          ],
          type: 'Point',
        },
        `${index}-${hash.repeat(4)}`,
        {properties: {name: `${index}-${hash.repeat(4)}`, score: parseInt(hash.slice(12, 18), 16)}},
      );
    });
    await writeFile(join(directory, 'nested.geojson'), collection(features));
    const result = await build(directory, ['nested.geojson', '--maxzoom', '9', ...extra, '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).zooms[0].thinnedFeatures > 0);

    let previous: Set<unknown> | null = null;
    for (let zoom = 0; zoom <= 9; zoom += 1) {
      const decoded = await decodeZoom(join(directory, 'nested.pmtiles'), zoom, 'nested');
      const names = new Set(decoded.map((item) => item.properties.name));
      if (previous) {
        const lost = [...previous].filter((name) => !names.has(name));
        assert.equal(lost.length, 0, `z${zoom} lost ${lost.length} of ${previous.size} features`);
      }
      previous = names;
    }
  });
}

test('archives with too many tiles to flag as clustered still pass inspection', async (t) => {
  const directory = await workspace(t);
  // One point per zoom 10 tile, each with its own id, so that no two tiles share their bytes.
  const rows = ['lon,lat,id'];
  const size = 2 ** 10;
  for (let y = 100; y < 560; y += 1) {
    for (let x = 100; x < 560; x += 1) {
      const latitude =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / size))) * 180) / Math.PI;
      rows.push(
        `${(((x + 0.5) / size) * 360 - 180).toFixed(6)},${latitude.toFixed(6)},${rows.length}`,
      );
    }
  }
  await writeFile(join(directory, 'tiles.csv'), rows.join('\n'));
  const result = await build(directory, ['tiles.csv', '--maxzoom', '10', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).archive.tileContents > 262_144);
  const header = await readFile(join(directory, 'tiles.pmtiles'));
  assert.equal(header[96], 0, 'the header must not promise clustering');

  // The tiles are laid out in order, so the same archive is valid when it does promise clustering.
  header[96] = 1;
  await writeFile(join(directory, 'clustered.pmtiles'), header);
  const inspected = await runCli(directory, ['tileset', 'inspect', 'clustered.pmtiles', '--json']);
  assert.equal(inspected.code, 0, inspected.stderr);
});

test('archives record what generated them', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'mark.geojson'),
    collection([feature({coordinates: [10, 10], type: 'Point'}, 'a')]),
  );
  const result = await build(directory, ['mark.geojson', '--maxzoom', '8', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const archive = new PMTiles(fileSource(await readFile(join(directory, 'mark.pmtiles'))));
  const metadata = (await archive.getMetadata()) as Record<string, unknown>;
  assert.equal(metadata.generator, 'tileflow tileset build');
  assert.match(String(metadata.generator_version), /^\d+\.\d+\.\d+/u);
});

const placeKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
  <name>Atlas</name>
  <Schema name="stops" id="stops">
    <SimpleField type="int" name="riders"><displayName>Riders</displayName></SimpleField>
    <SimpleField type="bool" name="staffed"/>
    <SimpleField type="string" name="code"/>
  </Schema>
  <!-- a comment with <Placemark> inside must not count -->
  <GroundOverlay><name>Scan</name></GroundOverlay>
  <NetworkLink><Link><href>https://example.com/more.kml</href></Link></NetworkLink>
  <Folder>
    <name>Stops &amp; stations</name>
    <Placemark>
      <name>Plaza</name>
      <atom:author><atom:name>Not the feature name</atom:name></atom:author>
      <description><![CDATA[<b>Big</b> & busy]]></description>
      <TimeStamp><when>2026-01-02</when></TimeStamp>
      <ExtendedData>
        <SchemaData schemaUrl="#stops">
          <SimpleData name="riders">1200</SimpleData>
          <SimpleData name="staffed">true</SimpleData>
          <SimpleData name="code">01234</SimpleData>
        </SchemaData>
        <Data name="note"><displayName>Note</displayName><value>Caf&#233;</value></Data>
      </ExtendedData>
      <Point><coordinates>-3.7074,40.4155,650</coordinates></Point>
    </Placemark>
  </Folder>
  <Placemark>
    <name>Route</name>
    <LineString><coordinates>
      -3.8,40.3,0
      -3.6, 40.5,0
    </coordinates></LineString>
  </Placemark>
  <Placemark>
    <name>Park</name>
    <Polygon>
      <outerBoundaryIs><LinearRing><coordinates>-3.9,40.2 -3.9,40.6 -3.5,40.6 -3.5,40.2 -3.9,40.2</coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>-3.8,40.3 -3.7,40.3 -3.7,40.4 -3.8,40.4 -3.8,40.3</coordinates></LinearRing></innerBoundaryIs>
    </Polygon>
  </Placemark>
  <Placemark>
    <name>Pair</name>
    <MultiGeometry>
      <Point><coordinates>2.1,41.3</coordinates></Point>
      <Point><coordinates>2.2,41.4</coordinates></Point>
    </MultiGeometry>
  </Placemark>
  <Placemark>
    <name>Mixed</name>
    <MultiGeometry>
      <Point><coordinates>2.3,41.5</coordinates></Point>
      <LineString><coordinates>2.3,41.5 2.4,41.6</coordinates></LineString>
    </MultiGeometry>
  </Placemark>
  <Placemark>
    <name>Log</name>
    <gx:Track>
      <when>2026-01-02T10:00:00Z</when><when>2026-01-02T10:01:00Z</when>
      <gx:coord>-5.0 42.0 0</gx:coord><gx:coord>-5.1 42.1 0</gx:coord>
    </gx:Track>
  </Placemark>
  <Placemark><name>Nowhere</name></Placemark>
</Document>
</kml>
`;

test('KML placemarks keep their geometry, names, folders and declared attribute types', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'atlas.kml'), placeKml);

  const result = await build(directory, ['atlas.kml', '--maxzoom', '9', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.format, 'kml');
  assert.deepEqual(document.crs, {
    authority: 'format',
    label: 'KML (WGS84 by definition)',
    reprojected: false,
  });
  assert.equal(document.input.skipped.emptyGeometry, 1);
  assert.ok(document.warnings.includes('Altitude values in the KML were ignored.'));
  assert.ok(document.warnings.some((item: string) => item.startsWith('2 overlays')));

  const decoded = await decodeZoom(join(directory, 'atlas.pmtiles'), 9, 'atlas');
  const plaza = decoded.find((item) => item.properties.name === 'Plaza')!;
  assert.deepEqual(
    {...plaza.properties},
    {
      code: '01234',
      description: '<b>Big</b> & busy',
      folder: 'Stops & stations',
      name: 'Plaza',
      note: 'Café',
      riders: 1200,
      staffed: true,
      timestamp: '2026-01-02',
    },
  );
  assertClose(plaza.geometry.coordinates, [-3.7074, 40.4155], 0.002);
  const route = decoded.find((item) => item.properties.name === 'Route')!;
  assert.equal(route.geometry.type, 'LineString');
  assert.equal(route.properties.folder, undefined);
  assert.ok(
    decoded
      .filter((item) => item.properties.name === 'Park')
      .some((item) => item.geometry.type === 'Polygon' && item.geometry.coordinates.length === 2),
    'the hole stays a hole',
  );
  const pair = decoded.filter((item) => item.properties.name === 'Pair');
  assert.equal(distinctPositions(pair), 2);
  const mixed = decoded.filter((item) => item.properties.name === 'Mixed');
  assert.deepEqual([...new Set(mixed.map((item) => item.geometry.type))].sort(), [
    'LineString',
    'Point',
  ]);
  assert.equal(decoded.find((item) => item.properties.name === 'Log')!.geometry.type, 'LineString');
  await assertNoTemporaryFiles(directory);
});

test('KML extensions are found by namespace, and repeated built-in fields are reported', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'tracked.kml'),
    `<ns0:kml xmlns:ns0="http://www.opengis.net/kml/2.2" xmlns:ns1="http://www.google.com/kml/ext/2.2">
      <ns0:Placemark>
        <ns0:name>Log</ns0:name>
        <ns0:ExtendedData><ns0:Data name="name"><ns0:value>Other</ns0:value></ns0:Data></ns0:ExtendedData>
        <ns1:Track><ns1:coord>2.2 41.2 0</ns1:coord><ns1:coord>2.3 41.3 0</ns1:coord></ns1:Track>
      </ns0:Placemark>
    </ns0:kml>`,
  );
  const result = await build(directory, ['tracked.kml', '--maxzoom', '9', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.input.geometryTypes, ['LineString']);
  assert.ok(
    document.warnings.some((item: string) => item.includes('more than one value for "name"')),
  );
  const [log] = await decodeZoom(join(directory, 'tracked.pmtiles'), 9, 'tracked');
  assert.equal(log.properties.name, 'Other');
});

test('a character reference split across read chunks decodes the same as a whole one', async (t) => {
  const directory = await workspace(t);
  const reference = '&#x000000000000041;';
  const element = '<wpt lat="41" lon="2"><name>';
  const padding = ' '.repeat(4 * 1024 * 1024 - '<gpx>'.length - element.length - 5);
  await writeFile(
    join(directory, 'split.gpx'),
    `<gpx>${padding}${element}${reference}</name></wpt></gpx>`,
  );
  const result = await build(directory, ['split.gpx', '--maxzoom', '6', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const [point] = await decodeZoom(join(directory, 'split.pmtiles'), 6, 'split');
  assert.equal(point.properties.name, 'A');
});

test('KML under a namespace prefix reads the same, and a declared rank is numeric', async (t) => {
  const directory = await workspace(t);
  const body = placeKml
    .replace('<?xml version="1.0" encoding="UTF-8"?>\n', '')
    .replace('xmlns="http://www.opengis.net/kml/2.2"', 'xmlns:ns0="http://www.opengis.net/kml/2.2"')
    .replace(/<(\/?)(?=[A-Za-z])(?!gx:|atom:)/gu, '<$1ns0:');
  await writeFile(join(directory, 'prefixed.kml'), body);
  const result = await build(directory, [
    'prefixed.kml',
    '--maxzoom',
    '9',
    '--rank-by',
    'riders',
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).input.features, 7);
  const decoded = await decodeZoom(join(directory, 'prefixed.pmtiles'), 9, 'prefixed');
  assert.equal(decoded.find((item) => item.properties.riders === 1200)!.properties.name, 'Plaza');
});

test('a KMZ streams its main document, and asks which one when that is unclear', async (t) => {
  const directory = await workspace(t);
  const kml = (name: string) =>
    Buffer.from(
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>${name}</name><Point><coordinates>2,41</coordinates></Point></Placemark></kml>`,
    );
  await writeZip(join(directory, 'main.kmz'), [
    {data: kml('Other'), name: 'files/extra.kml'},
    {data: kml('Main'), name: 'doc.kml'},
    {data: Buffer.from('not xml'), name: '__MACOSX/doc.kml'},
  ]);
  const built = await build(directory, ['main.kmz', '--maxzoom', '6', '--json']);
  assert.equal(built.code, 0, built.stderr);
  const decoded = await decodeZoom(join(directory, 'main.pmtiles'), 6, 'main');
  assert.equal(decoded[0].properties.name, 'Main');
  assert.deepEqual((await readdir(directory)).sort(), ['main.kmz', 'main.pmtiles']);

  const picked = await build(directory, [
    'main.kmz',
    '--zip-entry',
    'files/extra.kml',
    '-o',
    'picked.pmtiles',
    '--maxzoom',
    '6',
    '--json',
  ]);
  assert.equal(picked.code, 0, picked.stderr);
  const other = await decodeZoom(join(directory, 'picked.pmtiles'), 6, 'main');
  assert.equal(other[0].properties.name, 'Other');

  await writeZip(join(directory, 'two.kmz'), [
    {data: kml('A'), name: 'a.kml'},
    {data: kml('B'), name: 'b.kml'},
  ]);
  const ambiguous = await build(directory, ['two.kmz', '--json']);
  assert.equal(failure(ambiguous).code, 'TF_TILESET_BUILD_ZIP_ENTRY_INVALID');
  assert.match(failure(ambiguous).message, /a\.kml, b\.kml/u);

  const missing = await build(directory, ['two.kmz', '--zip-entry', 'c.kml', '--json']);
  assert.equal(failure(missing).code, 'TF_TILESET_BUILD_ZIP_ENTRY_INVALID');

  await writeZip(join(directory, 'empty.kmz'), [{data: Buffer.from('x'), name: 'readme.txt'}]);
  assert.equal(
    failure(await build(directory, ['empty.kmz', '--json'])).code,
    'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
  );
  await writeFile(join(directory, 'broken.kmz'), 'not a zip');
  assert.equal(
    failure(await build(directory, ['broken.kmz', '--json'])).code,
    'TF_TILESET_BUILD_INPUT_INVALID',
  );
  const wrongFormat = await build(directory, ['main.kmz', '--format', 'gpx', '--json']);
  assert.equal(failure(wrongFormat).code, 'TF_TILESET_BUILD_FORMAT_UNSUPPORTED');
  await assertNoTemporaryFiles(directory);
});

test('a KMZ entry that lies about its size is stopped', async (t) => {
  const directory = await workspace(t);
  const data = Buffer.from(
    `<kml><Placemark><Point><coordinates>2,41</coordinates></Point></Placemark>${' '.repeat(5_000_000)}</kml>`,
  );
  await writeZip(join(directory, 'lying.kmz'), [{data, declaredBytes: 100, name: 'doc.kml'}]);
  const lying = await build(directory, ['lying.kmz', '--json']);
  assert.equal(failure(lying).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.match(failure(lying).message, /zip could not be read/u);

  await writeZip(join(directory, 'huge.kmz'), [
    {data, declaredBytes: 5 * 1024 ** 3, name: 'doc.kml'},
  ]);
  const huge = await build(directory, ['huge.kmz', '--json']);
  assert.equal(failure(huge).code, 'TF_TILESET_BUILD_INPUT_LIMIT');
  await assertNoTemporaryFiles(directory);
});

test('hostile or malformed XML is refused with a stable code and no expansion', async (t) => {
  const directory = await workspace(t);
  const inRoot = (body: string) => `<kml>${body}</kml>`;
  const laughs = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><kml><Placemark><name>&b;</name><Point><coordinates>2,41</coordinates></Point></Placemark></kml>`;
  const external = `<!DOCTYPE gpx SYSTEM "file:///etc/passwd"><gpx/>`;
  const cases: [string, string, string, RegExp][] = [
    ['laughs.kml', laughs, 'TF_TILESET_BUILD_INPUT_UNSAFE', /DOCTYPE/u],
    ['external.gpx', external, 'TF_TILESET_BUILD_INPUT_UNSAFE', /DOCTYPE/u],
    [
      'entity.kml',
      inRoot('<Placemark><name>&custom;</name></Placemark>'),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /not defined/u,
    ],
    ['ampersand.kml', inRoot('<name>AT&T</name>'), 'TF_TILESET_BUILD_INPUT_INVALID', /bare/u],
    ['truncated.kml', '<kml><Placemark>', 'TF_TILESET_BUILD_INPUT_INVALID', /truncated/u],
    ['crossed.kml', '<kml><a></b></kml>', 'TF_TILESET_BUILD_INPUT_INVALID', /does not close/u],
    ['root.kml', '<html></html>', 'TF_TILESET_BUILD_INPUT_INVALID', /not a KML document/u],
    ['root.gpx', '<kml></kml>', 'TF_TILESET_BUILD_INPUT_INVALID', /not a GPX document/u],
    ['empty.kml', '', 'TF_TILESET_BUILD_INPUT_INVALID', /no XML elements/u],
    [
      'tuple.kml',
      inRoot('<Placemark><Point><coordinates>2</coordinates></Point></Placemark>'),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /Placemark 1: a position/u,
    ],
    [
      'range.kml',
      inRoot('<Placemark><Point><coordinates>400,41</coordinates></Point></Placemark>'),
      'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE',
      /Placemark 1/u,
    ],
    [
      'deep.kml',
      inRoot('<a>'.repeat(200) + '</a>'.repeat(200)),
      'TF_TILESET_BUILD_INPUT_LIMIT',
      /nest/u,
    ],
    [
      'tag.kml',
      `<kml a="${'x'.repeat(2 * 1024 * 1024)}`,
      'TF_TILESET_BUILD_INPUT_LIMIT',
      /one tag/u,
    ],
    [
      'attributes.kml',
      `<kml ${Array.from({length: 300}, (_, index) => `a${index}="1"`).join(' ')}/>`,
      'TF_TILESET_BUILD_INPUT_LIMIT',
      /attributes/u,
    ],
    [
      'field.kml',
      inRoot(`<Placemark><name>${'x'.repeat(9 * 1024 * 1024)}</name></Placemark>`),
      'TF_TILESET_BUILD_INPUT_LIMIT',
      /Placemark 1: a text value/u,
    ],
    [
      'coordinates.kml',
      inRoot(
        `<Placemark><LineString><coordinates>${'1'.repeat(4096)}</coordinates></LineString></Placemark>`,
      ),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /tuples/u,
    ],
    [
      'commas.kml',
      inRoot(
        `<Placemark><LineString><coordinates>${', '.repeat(2_000_000)}</coordinates></LineString></Placemark>`,
      ),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /tuples/u,
    ],
    [
      'tag-one-chunk.kml',
      `<kml a="${'x'.repeat(1_500_000)}"></kml>`,
      'TF_TILESET_BUILD_INPUT_LIMIT',
      /one tag/u,
    ],
    [
      'blank.gpx',
      '<gpx><wpt lat=" " lon=" "/></gpx>',
      'TF_TILESET_BUILD_INPUT_INVALID',
      /waypoint 1: a point needs/u,
    ],
    [
      'noplacemarks.kml',
      inRoot(`<!-- ${'x'.repeat(5 * 1024 * 1024)} --><Document/>`),
      'TF_TILESET_BUILD_EMPTY',
      /no usable features/u,
    ],
  ];
  for (const [name, content, code, message] of cases) {
    await writeFile(join(directory, name), content);
    const result = await build(directory, [name, '--json']);
    assert.equal(result.code, 1, name);
    assert.equal(failure(result).code, code, `${name}: ${result.stderr}`);
    assert.match(failure(result).message, message, name);
  }
  await writeFile(
    join(directory, 'encoding.gpx'),
    Buffer.concat([
      Buffer.from('<?xml version="1.0"?><gpx><name>'),
      Buffer.from([0xff]),
      Buffer.from('</name></gpx>'),
    ]),
  );
  const badBytes = await build(directory, ['encoding.gpx', '--json']);
  assert.equal(failure(badBytes).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.match(failure(badBytes).message, /text encoding/u);
  await assertNoTemporaryFiles(directory);
});

test('one feature cannot grow without limit in memory', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'segments.gpx'),
    `<gpx><trk>${'<trkseg/>'.repeat(5_000_001)}</trk></gpx>`,
  );
  const emptyParts = await build(directory, ['segments.gpx', '--json']);
  assert.equal(failure(emptyParts).code, 'TF_TILESET_BUILD_INPUT_LIMIT');
  assert.match(failure(emptyParts).message, /track 1: the feature has more than/u);

  await writeFile(
    join(directory, 'long.kml'),
    `<kml><Placemark><LineString><coordinates>${'1,1 '.repeat(5_000_001)}</coordinates></LineString></Placemark></kml>`,
  );
  const result = await build(directory, ['long.kml', '--json']);
  assert.equal(failure(result).code, 'TF_TILESET_BUILD_INPUT_LIMIT');
  assert.match(failure(result).message, /Placemark 1: the feature has more than/u);
});

test('XML straddling read chunks stays intact, in any declared encoding', async (t) => {
  const directory = await workspace(t);
  // Each record is 50 characters, so 4 MiB boundaries land inside tags, entities and text.
  const placemarks = Array.from(
    {length: 120_000},
    (_, index) =>
      `<Placemark><name>é&amp;${String(index).padStart(6, '0')}</name><Point><coordinates>${(index % 3600) / 10 - 180},${(index % 1700) / 10 - 85}</coordinates></Point></Placemark>`,
  ).join('\n');
  await writeFile(join(directory, 'long.kml'), `<kml>${placemarks}</kml>`);
  const long = await build(directory, ['long.kml', '--maxzoom', '4', '--json']);
  assert.equal(long.code, 0, long.stderr);
  assert.equal(JSON.parse(long.stdout).input.features, 120_000);

  await writeFile(
    join(directory, 'latin.gpx'),
    Buffer.from(
      `<?xml version="1.0" encoding="ISO-8859-1"?><gpx><wpt lat="41" lon="2"><name>Peñón</name></wpt></gpx>`,
      'latin1',
    ),
  );
  const latin = await build(directory, ['latin.gpx', '--maxzoom', '6', '--json']);
  assert.equal(latin.code, 0, latin.stderr);
  const decoded = await decodeZoom(join(directory, 'latin.pmtiles'), 6, 'latin');
  assert.equal(decoded[0].properties.name, 'Peñón');

  await writeFile(
    join(directory, 'unicode.gpx'),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<gpx><wpt lat="41" lon="2"><name>日本</name></wpt></gpx>', 'utf16le'),
    ]),
  );
  const utf16 = await build(directory, ['unicode.gpx', '--maxzoom', '6', '--json']);
  assert.equal(utf16.code, 0, utf16.stderr);
  assert.equal(
    (await decodeZoom(join(directory, 'unicode.pmtiles'), 6, 'unicode'))[0].properties.name,
    '日本',
  );
});

test('GPX waypoints, routes and tracks each become features', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'trip.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ext="urn:example">
  <metadata><name>Not a feature</name><time>2026-01-01T00:00:00Z</time></metadata>
  <wpt lat="40.4155" lon="-3.7074">
    <ele>650.5</ele><time>2026-01-02T10:00:00Z</time><name>Plaza</name><desc>Centre</desc><sym>Flag</sym>
    <extensions><ext:name>ignored</ext:name></extensions>
  </wpt>
  <rte><name>Way</name><number>7</number>
    <rtept lat="40.3" lon="-3.8"/><rtept lat="40.5" lon="-3.6"/>
  </rte>
  <trk><name>Morning</name><type>run</type>
    <trkseg>
      <trkpt lat="41.2" lon="2.2"><ele>10</ele><time>2026-01-02T10:00:00Z</time></trkpt>
      <trkpt lat="41.25" lon="2.25"><ele>12</ele></trkpt>
    </trkseg>
    <trkseg><trkpt lat="41.3" lon="2.3"/><trkpt lat="41.35" lon="2.35"/></trkseg>
  </trk>
  <rte><name>Empty</name></rte>
</gpx>
`,
  );
  const result = await build(directory, ['trip.gpx', '--maxzoom', '9', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.format, 'gpx');
  assert.equal(document.input.features, 3);
  assert.equal(document.input.skipped.emptyGeometry, 1);
  assert.equal(document.crs.label, 'GPX (WGS84 by definition)');
  assert.ok(
    document.warnings.includes('Elevation and time on GPX route and track points were ignored.'),
  );
  const decoded = await decodeZoom(join(directory, 'trip.pmtiles'), 9, 'trip');
  const plaza = decoded.find((item) => item.properties.name === 'Plaza')!;
  assert.deepEqual(
    {...plaza.properties},
    {desc: 'Centre', ele: 650.5, name: 'Plaza', sym: 'Flag', time: '2026-01-02T10:00:00Z'},
  );
  assertClose(plaza.geometry.coordinates, [-3.7074, 40.4155], 0.002);
  const way = decoded.find((item) => item.properties.name === 'Way')!;
  assert.equal(way.geometry.type, 'LineString');
  assert.equal(way.properties.number, 7);
  const morning = decoded.find((item) => item.properties.name === 'Morning')!;
  assert.equal(morning.geometry.type, 'MultiLineString');
  assert.equal(morning.geometry.coordinates.length, 2);
  assert.equal(morning.properties.type, 'run');

  await writeFile(join(directory, 'nolat.gpx'), '<gpx><wpt lon="2"/></gpx>');
  const invalid = await build(directory, ['nolat.gpx', '--json']);
  assert.equal(failure(invalid).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.match(failure(invalid).message, /waypoint 1/u);
  await writeFile(join(directory, 'odd.xml'), '<gpx><wpt lat="41" lon="2"/></gpx>');
  const forced = await build(directory, ['odd.xml', '--format', 'gpx', '--maxzoom', '6', '--json']);
  assert.equal(forced.code, 0, forced.stderr);
});

test('a GeoPackage layer decodes back with its ids, types and every WKB shape', async (t) => {
  const directory = await workspace(t);
  const polygon = [
    [
      [-3.9, 40.2],
      [-3.5, 40.2],
      [-3.5, 40.6],
      [-3.9, 40.6],
      [-3.9, 40.2],
    ],
    [
      [-3.8, 40.3],
      [-3.8, 40.4],
      [-3.7, 40.4],
      [-3.7, 40.3],
      [-3.8, 40.3],
    ],
  ];
  writeGeopackage(join(directory, 'city.gpkg'), [
    {
      columns:
        'fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB, label TEXT, total INTEGER, ratio REAL, open BOOLEAN, photo BLOB, serial INTEGER, doubled INTEGER GENERATED ALWAYS AS (total * 2) VIRTUAL',
      name: 'places',
      rows: [
        {
          geometry: gpkgGeometry(wkb({coordinates: [-3.7074, 40.4155], type: 'Point'})),
          id: 7,
          values: ['Plaza', 3, 1.5, 1, Buffer.from([1, 2]), 2n ** 60n],
        },
        {
          geometry: gpkgGeometry(
            wkb(
              {
                coordinates: [
                  [-3.8, 40.3],
                  [-3.6, 40.5],
                ],
                type: 'LineString',
              },
              {littleEndian: false},
            ),
            {bigEndian: true, envelopeBytes: 32},
          ),
          id: 8,
          values: ['Route', null, null, 0, null, null],
        },
        {
          geometry: gpkgGeometry(wkb({coordinates: polygon, type: 'Polygon'}, {extra: 1000}), {
            envelopeBytes: 48,
          }),
          id: 9,
          values: ['Park', null, null, null, null, null],
        },
        {
          geometry: gpkgGeometry(
            wkb(
              {
                coordinates: [
                  [2.1, 41.3],
                  [2.2, 41.4],
                ],
                type: 'MultiPoint',
              },
              {extra: 3000},
            ),
            {envelopeBytes: 64},
          ),
          id: 10,
          values: ['Pair', null, null, null, null, null],
        },
        {
          geometry: gpkgGeometry(
            wkb({
              geometries: [
                {coordinates: [2.3, 41.5], type: 'Point'},
                {
                  coordinates: [
                    [
                      [2.4, 41.6],
                      [2.5, 41.7],
                    ],
                  ],
                  type: 'MultiLineString',
                },
                {coordinates: [polygon], type: 'MultiPolygon'},
              ],
              type: 'GeometryCollection',
            }),
          ),
          id: 11,
          values: ['Bundle', null, null, null, null, null],
        },
        {geometry: null, id: 12, values: ['No geometry', null, null, null, null, null]},
        {
          geometry: gpkgGeometry(wkb({coordinates: [NaN, NaN], type: 'Point'})),
          id: 13,
          values: ['Empty point', null, null, null, null, null],
        },
        {
          geometry: gpkgGeometry(Buffer.alloc(0), {empty: true}),
          id: 14,
          values: ['Flagged empty', null, null, null, null, null],
        },
      ],
    },
  ]);
  const before = await readFile(join(directory, 'city.gpkg'));

  const result = await build(directory, ['city.gpkg', '--maxzoom', '9', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '', 'node:sqlite must not add a warning to --json runs');
  const document = JSON.parse(result.stdout);
  assert.equal(document.input.format, 'geopackage');
  assert.equal(document.layer.id, 'city');
  assert.equal(document.input.skipped.emptyGeometry, 3);
  assert.deepEqual(document.crs, {
    authority: 'declared',
    label: 'GeoPackage layer "places" (EPSG:4326)',
    reprojected: false,
  });
  for (const expected of [
    'Z and M values in the GeoPackage were ignored.',
    'Binary (BLOB) attributes in the GeoPackage have no vector tile equivalent and were skipped.',
    'Generated columns in the GeoPackage were ignored.',
  ]) {
    assert.ok(document.warnings.includes(expected), expected);
  }

  const decoded = await decodeZoom(join(directory, 'city.pmtiles'), 9, 'city');
  const plaza = decoded.find((item) => item.properties.label === 'Plaza')!;
  assert.equal(plaza.id, 7);
  assert.deepEqual(
    {...plaza.properties},
    {label: 'Plaza', open: true, ratio: 1.5, serial: '1152921504606846976', total: 3},
  );
  assertClose(plaza.geometry.coordinates, [-3.7074, 40.4155], 0.002);
  const route = decoded.find((item) => item.properties.label === 'Route')!;
  assert.equal(route.id, 8);
  assert.equal(route.properties.open, false);
  assert.equal(route.geometry.type, 'LineString');
  assert.ok(
    decoded
      .filter((item) => item.properties.label === 'Park')
      .some((item) => item.geometry.type === 'Polygon' && item.geometry.coordinates.length === 2),
    'the hole stays a hole',
  );
  const pair = decoded.filter((item) => item.properties.label === 'Pair');
  assert.equal(distinctPositions(pair), 2);
  assert.deepEqual(
    [
      ...new Set(
        decoded
          .filter((item) => item.properties.label === 'Bundle')
          .map((item) => item.geometry.type),
      ),
    ].sort(),
    ['LineString', 'Point', 'Polygon'],
  );

  // Reading must leave the input alone, including no -wal or -shm files beside it.
  assert.deepEqual(await readFile(join(directory, 'city.gpkg')), before);
  assert.deepEqual((await readdir(directory)).sort(), ['city.gpkg', 'city.pmtiles']);
  const repeat = await build(directory, ['city.gpkg', '-o', 'again.pmtiles', '--maxzoom', '9']);
  assert.equal(repeat.code, 0, repeat.stderr);
  assert.deepEqual(
    await readFile(join(directory, 'again.pmtiles')),
    await readFile(join(directory, 'city.pmtiles')),
  );
});

test('a GeoPackage with several layers asks which one, and names the output after it', async (t) => {
  const directory = await workspace(t);
  const point = gpkgGeometry(wkb({coordinates: [2, 41], type: 'Point'}));
  writeGeopackage(join(directory, 'world.gpkg'), [
    {name: 'roads', rows: [{geometry: point, id: 1}]},
    {name: 'odd "name" table', rows: [{geometry: point, id: 2}]},
  ]);

  const ambiguous = await build(directory, ['world.gpkg', '--json']);
  assert.equal(failure(ambiguous).code, 'TF_TILESET_BUILD_INPUT_LAYER_INVALID');
  assert.match(failure(ambiguous).message, /--input-layer: odd "name" table, roads/u);

  const unknown = await build(directory, ['world.gpkg', '--input-layer', 'rivers', '--json']);
  assert.equal(failure(unknown).code, 'TF_TILESET_BUILD_INPUT_LAYER_INVALID');
  assert.match(failure(unknown).message, /no feature table named "rivers".*roads/u);

  const chosen = await build(directory, ['world.gpkg', '--input-layer', 'roads', '--json']);
  assert.equal(chosen.code, 0, chosen.stderr);
  assert.equal(JSON.parse(chosen.stdout).layer.id, 'roads');
  assert.equal(JSON.parse(chosen.stdout).archive.path, 'world.pmtiles');

  const quoted = await build(directory, [
    'world.gpkg',
    '--input-layer',
    'odd "name" table',
    '-o',
    'quoted.pmtiles',
    '--maxzoom',
    '6',
    '--json',
  ]);
  assert.equal(quoted.code, 0, quoted.stderr);
  assert.equal(JSON.parse(quoted.stdout).layer.id, 'odd_name_table');
  const decoded = await decodeZoom(join(directory, 'quoted.pmtiles'), 6, 'odd_name_table');
  assert.equal(decoded[0].id, 2);

  const named = await build(directory, [
    'world.gpkg',
    '--input-layer',
    'roads',
    '--layer',
    'streets',
    '-o',
    'named.pmtiles',
    '--json',
  ]);
  assert.equal(JSON.parse(named.stdout).layer.id, 'streets');

  await writeFile(join(directory, 'plain.geojson'), collection([]));
  const misplaced = await build(directory, ['plain.geojson', '--input-layer', 'roads', '--json']);
  assert.equal(failure(misplaced).code, 'TF_TILESET_BUILD_INPUT_LAYER_INVALID');
});

test('GeoPackage CRSs follow the same policy as every other input', async (t) => {
  const directory = await workspace(t);
  const utm = [
    {definition: utm30nPrj, organization: 'EPSG', organizationCode: 25830, srsId: 25830},
  ];
  const utmPoint = gpkgGeometry(wkb({coordinates: [440000, 4474000], type: 'Point'}), {
    srsId: 25830,
  });
  writeGeopackage(
    join(directory, 'utm.gpkg'),
    [{name: 'sites', rows: [{geometry: utmPoint, id: 1}], srsId: 25830}],
    utm,
  );

  const refused = await build(directory, ['utm.gpkg', '--json']);
  assert.equal(failure(refused).code, 'TF_TILESET_BUILD_CRS_NOT_WGS84');
  assert.match(failure(refused).message, /GeoPackage layer "sites" \(EPSG:25830\)/u);

  const converted = await build(directory, ['utm.gpkg', '--reproject', '--maxzoom', '9', '--json']);
  assert.equal(converted.code, 0, converted.stderr);
  assert.equal(JSON.parse(converted.stdout).crs.reprojected, true);
  const [site] = await decodeZoom(join(directory, 'utm.pmtiles'), 9, 'utm');
  assertClose(site.geometry.coordinates, [-3.7072, 40.4145], 0.002);

  const mercator = [
    (-3.7 * 20037508.342789244) / 180,
    Math.log(Math.tan(Math.PI / 4 + (40.4 * Math.PI) / 360)) * 6378137,
  ];
  writeGeopackage(
    join(directory, 'web.gpkg'),
    [
      {
        name: 'web',
        rows: [
          {
            geometry: gpkgGeometry(wkb({coordinates: mercator, type: 'Point'}), {srsId: 3857}),
            id: 1,
          },
        ],
        srsId: 3857,
      },
    ],
    [{definition: pseudoMercatorWkt, organization: 'EPSG', organizationCode: 3857, srsId: 3857}],
  );
  const web = await build(directory, ['web.gpkg', '--reproject', '--maxzoom', '9', '--json']);
  assert.equal(web.code, 0, web.stderr);
  const [spherical] = await decodeZoom(join(directory, 'web.pmtiles'), 9, 'web');
  assertClose(spherical.geometry.coordinates, [-3.7, 40.4], 0.002);

  writeGeopackage(
    join(directory, 'nad27.gpkg'),
    [{name: 'old', rows: [{geometry: utmPoint, id: 1}], srsId: 4267}],
    [{definition: nad27Prj, organization: 'EPSG', organizationCode: 4267, srsId: 4267}],
  );
  const datum = await build(directory, ['nad27.gpkg', '--reproject', '--json']);
  assert.equal(failure(datum).code, 'TF_TILESET_BUILD_DATUM_UNSUPPORTED');

  for (const srsId of [-1, 0]) {
    const name = `undefined${srsId}.gpkg`;
    const point = gpkgGeometry(wkb({coordinates: [2, 41], type: 'Point'}), {srsId});
    writeGeopackage(join(directory, name), [
      {name: 'data', rows: [{geometry: point, id: 1}], srsId},
    ]);
    const unknown = await build(directory, [name, '--json']);
    assert.equal(failure(unknown).code, 'TF_TILESET_BUILD_CRS_UNKNOWN', name);
    const stated = await build(directory, [name, '--source-crs', 'EPSG:4326', '--json']);
    assert.equal(stated.code, 0, stated.stderr);
    assert.ok(
      JSON.parse(stated.stdout).warnings.some((item: string) => item.includes('longitude 2.0000')),
    );
  }

  const dangling = gpkgGeometry(wkb({coordinates: [2, 41], type: 'Point'}), {srsId: 999});
  writeGeopackage(join(directory, 'dangling.gpkg'), [
    {name: 'data', rows: [{geometry: dangling, id: 1}], srsId: 999},
  ]);
  assert.equal(
    failure(await build(directory, ['dangling.gpkg', '--json'])).code,
    'TF_TILESET_BUILD_CRS_UNKNOWN',
  );

  writeGeopackage(
    join(directory, 'garbled.gpkg'),
    [{name: 'data', rows: [{geometry: dangling, id: 1}], srsId: 999}],
    [{definition: 'NOT WKT[', organization: 'NONE', organizationCode: 999, srsId: 999}],
  );
  assert.equal(
    failure(await build(directory, ['garbled.gpkg', '--json'])).code,
    'TF_TILESET_BUILD_CRS_UNREADABLE',
  );

  writeGeopackage(join(directory, 'mixed.gpkg'), [
    {
      name: 'data',
      rows: [
        {geometry: gpkgGeometry(wkb({coordinates: [2, 41], type: 'Point'})), id: 1},
        {geometry: gpkgGeometry(wkb({coordinates: [3, 42], type: 'Point'}), {srsId: 3857}), id: 2},
      ],
    },
  ]);
  const mixed = await build(directory, ['mixed.gpkg', '--json']);
  assert.equal(failure(mixed).code, 'TF_TILESET_BUILD_CRS_MIXED');
  assert.match(failure(mixed).message, /row 2/u);
  const overridden = await build(directory, ['mixed.gpkg', '--source-crs', 'EPSG:4326', '--json']);
  assert.equal(overridden.code, 0, overridden.stderr);
  await assertNoTemporaryFiles(directory);
});

test('hostile or broken GeoPackages stop with a stable code and never run their SQL', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'text.gpkg'), 'this is not a database, not even close to one');
  const notDatabase = await build(directory, ['text.gpkg', '--json']);
  assert.equal(failure(notDatabase).code, 'TF_TILESET_BUILD_INPUT_INVALID');

  const empty = new DatabaseSync(join(directory, 'plain.gpkg'));
  empty.exec('CREATE TABLE unrelated(a)');
  empty.close();
  const notGeopackage = await build(directory, ['plain.gpkg', '--json']);
  assert.equal(failure(notGeopackage).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.match(failure(notGeopackage).message, /not a GeoPackage/u);

  // Would never finish if the build evaluated it.
  const endless =
    'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT max(x) AS a FROM c';
  const point = gpkgGeometry(wkb({coordinates: [2, 41], type: 'Point'}));
  const viewContents = join(directory, 'view-contents.gpkg');
  writeGeopackage(viewContents, [{name: 'data', rows: [{geometry: point, id: 1}]}]);
  const contents = new DatabaseSync(viewContents);
  contents.exec(
    `DROP TABLE gpkg_contents; CREATE VIEW gpkg_contents AS SELECT a AS table_name, 'features' AS data_type FROM (${endless})`,
  );
  contents.close();
  const hostileMetadata = await build(directory, ['view-contents.gpkg', '--json']);
  assert.equal(failure(hostileMetadata).code, 'TF_TILESET_BUILD_INPUT_INVALID');
  assert.match(failure(hostileMetadata).message, /gpkg_contents/u);

  const viewLayer = join(directory, 'view-layer.gpkg');
  writeGeopackage(viewLayer, []);
  const layered = new DatabaseSync(viewLayer);
  layered.exec(`CREATE VIEW evil AS ${endless};
    INSERT INTO gpkg_contents(table_name, data_type, srs_id) VALUES ('evil', 'features', 4326);
    INSERT INTO gpkg_geometry_columns VALUES ('evil', 'a', 'POINT', 4326, 0, 0);`);
  layered.close();
  const hostileLayer = await build(directory, ['view-layer.gpkg', '--json']);
  assert.equal(failure(hostileLayer).code, 'TF_TILESET_BUILD_INPUT_LAYER_INVALID');
  assert.match(failure(hostileLayer).message, /views are not read/u);

  const header = (code: number) => {
    const bytes = Buffer.alloc(5);
    bytes[0] = 1;
    bytes.writeUInt32LE(code, 1);
    return bytes;
  };
  const count = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };
  let nested = wkb({coordinates: [2, 41], type: 'Point'});
  for (let level = 0; level < 40; level += 1) {
    nested = Buffer.concat([header(7), count(1), nested]);
  }
  const cases: [string, Buffer, string, RegExp][] = [
    [
      'magic',
      Buffer.from('XXxxxxxxxxxxxxxx'),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /row 1: the geometry has no/u,
    ],
    [
      'short',
      gpkgGeometry(Buffer.from([1, 1, 0])),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /ends early/u,
    ],
    [
      'huge-count',
      gpkgGeometry(Buffer.concat([header(2), count(4_000_000_000)])),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /ends early/u,
    ],
    [
      'huge-parts',
      gpkgGeometry(Buffer.concat([header(7), count(4_000_000_000)])),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /ends early/u,
    ],
    ['nested', gpkgGeometry(nested), 'TF_TILESET_BUILD_INPUT_LIMIT', /nest/u],
    ['unknown', gpkgGeometry(header(99)), 'TF_TILESET_BUILD_INPUT_INVALID', /unknown geometry/u],
    [
      'wrong-member',
      gpkgGeometry(
        Buffer.concat([
          header(4),
          count(1),
          wkb({
            coordinates: [
              [1, 1],
              [2, 2],
            ],
            type: 'LineString',
          }),
        ]),
      ),
      'TF_TILESET_BUILD_INPUT_INVALID',
      /multi-geometry/u,
    ],
    ['curve', gpkgGeometry(header(8)), 'TF_TILESET_BUILD_FORMAT_UNSUPPORTED', /curved/u],
    [
      'extended',
      gpkgGeometry(header(1), {flagBits: 0x20}),
      'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
      /extended/u,
    ],
  ];
  for (const [name, geometry, code, message] of cases) {
    const file = `${name}.gpkg`;
    writeGeopackage(join(directory, file), [{name: 'data', rows: [{geometry, id: 1}]}]);
    const result = await build(directory, [file, '--json']);
    assert.equal(failure(result).code, code, `${name}: ${result.stderr}`);
    assert.match(failure(result).message, message, name);
  }

  const textGeometry = join(directory, 'text-geometry.gpkg');
  writeGeopackage(textGeometry, [{name: 'data', rows: [{geometry: 'POINT(1 1)', id: 1}]}]);
  assert.equal(
    failure(await build(directory, ['text-geometry.gpkg', '--json'])).code,
    'TF_TILESET_BUILD_INPUT_INVALID',
  );
  await assertNoTemporaryFiles(directory);
});

test('a GeoPackage only needs the runtime check when one is actually read', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'a.gpkg'), 'x');
  await writeFile(join(directory, 'a.geojson'), collection(gridPoints(1, 1)));
  // Stands in for a Node.js 22 release from before the module was available without a flag.
  const env = {
    NODE_OPTIONS:
      "--import=data:text/javascript,globalThis.o=process.getBuiltinModule;process.getBuiltinModule=(n)=>n==='node:sqlite'?undefined:globalThis.o(n)",
  };
  const refused = await runCli(directory, ['tileset', 'build', 'a.gpkg', '--json'], env);
  assert.equal(failure(refused).code, 'TF_TILESET_BUILD_RUNTIME_UNSUPPORTED');
  assert.match(failure(refused).message, /Node\.js 22\.13/u);
  const other = await runCli(directory, ['tileset', 'build', 'a.geojson', '--json'], env);
  assert.equal(other.code, 0, other.stderr);
});

test('every spelling of Pseudo-Mercator converts on the sphere it means', async (t) => {
  const directory = await workspace(t);
  const mercator = [
    (-3.7 * 20037508.342789244) / 180,
    Math.log(Math.tan(Math.PI / 4 + (40.4 * Math.PI) / 360)) * 6378137,
  ];
  const variants: GeopackageFixtureSrs[] = [
    {definition: pseudoMercatorWkt, organization: 'EPSG', organizationCode: 900913, srsId: 900913},
    {definition: pseudoMercatorWkt, organization: 'EPSG', organizationCode: 3785, srsId: 3785},
    {definition: pseudoMercatorWkt, organization: 'CUSTOM', organizationCode: 77, srsId: 77},
  ];
  for (const srs of variants) {
    const name = `web${srs.srsId}`;
    writeGeopackage(
      join(directory, `${name}.gpkg`),
      [
        {
          name,
          rows: [
            {
              geometry: gpkgGeometry(wkb({coordinates: mercator, type: 'Point'}), {
                srsId: srs.srsId,
              }),
              id: 1,
            },
          ],
          srsId: srs.srsId,
        },
      ],
      [srs],
    );
    const result = await build(directory, [
      `${name}.gpkg`,
      '--reproject',
      '--maxzoom',
      '9',
      '--json',
    ]);
    assert.equal(result.code, 0, result.stderr);
    const [point] = await decodeZoom(join(directory, `${name}.pmtiles`), 9, name);
    assertClose(point.geometry.coordinates, [-3.7, 40.4], 0.002);
  }
});

test('a transaction left unfinished by a crashed writer is refused, not read in half', async (t) => {
  const directory = await workspace(t);
  const path = join(directory, 'crashed.gpkg');
  const point = (x: number) => gpkgGeometry(wkb({coordinates: [x, 41], type: 'Point'}));
  writeGeopackage(path, [
    {
      name: 'data',
      rows: Array.from({length: 3000}, (_, index) => ({geometry: point(2), id: index + 1})),
    },
  ]);
  const script = `
    const {DatabaseSync} = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(${JSON.stringify(path)});
    database.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; BEGIN; UPDATE data SET geom = zeroblob(600);');
    process.kill(process.pid, 'SIGKILL');
  `;
  spawnSync(process.execPath, ['--no-warnings', '-e', script]);
  assert.ok((await readFile(`${path}-journal`)).length > 0, 'the writer left a hot journal');
  const result = await build(directory, ['crashed.gpkg', '--json']);
  assert.equal(failure(result).code, 'TF_TILESET_BUILD_INPUT_INVALID');
});

test('pending edits in a GeoPackage write-ahead log are read', async (t) => {
  const directory = await workspace(t);
  const path = join(directory, 'live.gpkg');
  const point = (x: number) => gpkgGeometry(wkb({coordinates: [x, 41], type: 'Point'}));
  writeGeopackage(path, [{name: 'data', rows: [{geometry: point(2), id: 1}]}]);
  // Closed here, not in a hook: Windows cannot delete the workspace while this handle is open.
  const writer = new DatabaseSync(path);
  try {
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
    writer.prepare('INSERT INTO data(id, geom) VALUES (2, ?)').run(point(3));
    assert.ok((await readFile(`${path}-wal`)).length > 0);
    const result = await build(directory, ['live.gpkg', '--maxzoom', '6', '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).input.features, 2);
  } finally {
    writer.close();
  }
});

test(
  'interrupting a GeoPackage read removes its temporary files and touches nothing else',
  {skip: !signalsReachHandlers},
  async (t) => {
    const directory = await workspace(t);
    writeGeopackage(join(directory, 'big.gpkg'), [
      {
        name: 'data',
        rows: Array.from({length: 300_000}, (_, index) => ({
          geometry: gpkgGeometry(
            wkb({coordinates: [(index % 900) / 10, (index % 700) / 10], type: 'Point'}),
          ),
          id: index + 1,
        })),
      },
    ]);
    const child = spawn(process.execPath, cliFixtureArguments(['tileset', 'build', 'big.gpkg']), {
      cwd: directory,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await new Promise<void>((resolve) => {
      child.stderr.on('data', (chunk) => {
        if (String(chunk).includes('Reading features')) resolve();
      });
    });
    child.kill('SIGINT');
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 130);
    assert.deepEqual(await readdir(directory), ['big.gpkg']);
  },
);

test(
  'interrupting a KML read removes its temporary files',
  {skip: !signalsReachHandlers},
  async (t) => {
    const directory = await workspace(t);
    const placemark = (index: number) =>
      `<Placemark><name>n${index}</name><Point><coordinates>${(index % 900) / 10},${(index % 700) / 10}</coordinates></Point></Placemark>`;
    await writeFile(
      join(directory, 'big.kml'),
      `<kml>${Array.from({length: 600_000}, (_, index) => placemark(index)).join('')}</kml>`,
    );
    const child = spawn(process.execPath, cliFixtureArguments(['tileset', 'build', 'big.kml']), {
      cwd: directory,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await new Promise<void>((resolve) => {
      child.stderr.on('data', (chunk) => {
        if (String(chunk).includes('Reading features')) resolve();
      });
    });
    child.kill('SIGINT');
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 130);
    assert.deepEqual(await readdir(directory), ['big.kml']);
  },
);

async function assertNoTemporaryFiles(directory: string): Promise<void> {
  const names = await readdir(directory);
  assert.deepEqual(
    names.filter((name) => name.startsWith('.tileflow-tileset-build-')),
    [],
  );
}

async function shapefileParts(directory: string): Promise<{dbf: Buffer; shp: Buffer}> {
  const scratch = join(directory, 'scratch-source');
  await mkdir(scratch);
  await writeShapefile(join(scratch, 'parks'));
  return {
    dbf: await readFile(join(scratch, 'parks.dbf')),
    shp: await readFile(join(scratch, 'parks.shp')),
  };
}

/** A minimal zip with deflated members, so tests do not depend on a system tool. */
async function writeZip(
  path: string,
  members: {data: Buffer; declaredBytes?: number; name: string}[],
): Promise<void> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const {data, declaredBytes = data.length, name} of members) {
    const compressed = deflateRawSync(data);
    // Above 32 bits the size moves to a Zip64 extra field in the central directory.
    const zip64 = declaredBytes > 0xffffffff;
    const extra = Buffer.alloc(zip64 ? 12 : 0);
    if (zip64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(declaredBytes), 4);
    }
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(zip64 ? 0xffffffff : declaredBytes, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes, extra);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(path, Buffer.concat([...locals, directoryBytes, end]));
}

/** Tiles repeat a point inside their buffer, so a feature is counted by where its points are. */
function distinctPositions(features: DecodedFeature[]): number {
  const points = features.flatMap(({geometry}) =>
    geometry.type === 'MultiPoint' ? geometry.coordinates : [geometry.coordinates],
  );
  return new Set(points.map(([x, y]: number[]) => `${x.toFixed(3)},${y.toFixed(3)}`)).size;
}

type WkbInput = {coordinates?: any; geometries?: WkbInput[]; type: string};

/** ISO WKB, written by hand so that the fixtures do not trust the code under test. */
function wkb(geometry: WkbInput, options: {extra?: number; littleEndian?: boolean} = {}): Buffer {
  const {extra = 0, littleEndian = true} = options;
  const size = extra === 0 ? 2 : extra === 3000 ? 4 : 3;
  const codes: Record<string, number> = {
    GeometryCollection: 7,
    LineString: 2,
    MultiLineString: 5,
    MultiPoint: 4,
    MultiPolygon: 6,
    Point: 1,
    Polygon: 3,
  };
  const parts: Buffer[] = [];
  const uint32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    if (littleEndian) bytes.writeUInt32LE(value);
    else bytes.writeUInt32BE(value);
    parts.push(bytes);
  };
  const position = (values: number[]) => {
    for (let index = 0; index < size; index += 1) {
      const bytes = Buffer.alloc(8);
      if (littleEndian) bytes.writeDoubleLE(values[index] ?? 7);
      else bytes.writeDoubleBE(values[index] ?? 7);
      parts.push(bytes);
    }
  };
  const line = (values: number[][]) => {
    uint32(values.length);
    values.forEach(position);
  };
  const child = (value: WkbInput) => parts.push(wkb(value, options));
  parts.push(Buffer.from([littleEndian ? 1 : 0]));
  uint32(codes[geometry.type] + extra);
  const {coordinates} = geometry;
  switch (geometry.type) {
    case 'Point':
      position(coordinates);
      break;
    case 'LineString':
      line(coordinates);
      break;
    case 'Polygon':
      uint32(coordinates.length);
      coordinates.forEach(line);
      break;
    case 'MultiPoint':
      uint32(coordinates.length);
      coordinates.forEach((item: unknown) => child({coordinates: item, type: 'Point'}));
      break;
    case 'MultiLineString':
      uint32(coordinates.length);
      coordinates.forEach((item: unknown) => child({coordinates: item, type: 'LineString'}));
      break;
    case 'MultiPolygon':
      uint32(coordinates.length);
      coordinates.forEach((item: unknown) => child({coordinates: item, type: 'Polygon'}));
      break;
    default:
      uint32(geometry.geometries!.length);
      geometry.geometries!.forEach(child);
  }
  return Buffer.concat(parts);
}

function gpkgGeometry(
  body: Buffer,
  options: {
    bigEndian?: boolean;
    empty?: boolean;
    envelopeBytes?: number;
    flagBits?: number;
    srsId?: number;
  } = {},
): Buffer {
  const {bigEndian = false, empty = false, envelopeBytes = 0, flagBits = 0, srsId = 4326} = options;
  const kind = {0: 0, 32: 1, 48: 2, 64: 4}[envelopeBytes] ?? 0;
  const header = Buffer.alloc(8 + envelopeBytes);
  header.write('GP', 0, 'latin1');
  header[3] = (bigEndian ? 0 : 1) | (kind << 1) | (empty ? 0x10 : 0) | flagBits;
  if (bigEndian) header.writeInt32BE(srsId, 4);
  else header.writeInt32LE(srsId, 4);
  return Buffer.concat([header, body]);
}

type GeopackageFixtureLayer = {
  columns?: string;
  name: string;
  rows: {geometry: Buffer | string | null; id: number; values?: unknown[]}[];
  srsId?: number;
};

type GeopackageFixtureSrs = {
  definition: string;
  organization: string;
  organizationCode: number;
  srsId: number;
};

function writeGeopackage(
  path: string,
  layers: GeopackageFixtureLayer[],
  extraSrs: GeopackageFixtureSrs[] = [],
): void {
  const database = new DatabaseSync(path);
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  database.exec(`PRAGMA application_id = 1196444487;
    CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT, description TEXT DEFAULT '', last_change TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER);
    CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z INTEGER NOT NULL, m INTEGER NOT NULL);
    BEGIN;`);
  const insertSrs = database.prepare(
    'INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, NULL)',
  );
  insertSrs.run('WGS 84', 4326, 'EPSG', 4326, wgs84Prj);
  insertSrs.run('Undefined Cartesian', -1, 'NONE', -1, 'undefined');
  insertSrs.run('Undefined geographic', 0, 'NONE', 0, 'undefined');
  for (const srs of extraSrs) {
    insertSrs.run(
      `custom ${srs.srsId}`,
      srs.srsId,
      srs.organization,
      srs.organizationCode,
      srs.definition,
    );
  }
  for (const layer of layers) {
    const srsId = layer.srsId ?? 4326;
    const columns = layer.columns ?? 'id INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB';
    database.exec(`CREATE TABLE ${quote(layer.name)} (${columns})`);
    database
      .prepare("INSERT INTO gpkg_contents(table_name, data_type, srs_id) VALUES (?, 'features', ?)")
      .run(layer.name, srsId);
    database
      .prepare("INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'GEOMETRY', ?, 0, 0)")
      .run(layer.name, srsId);
    const width = (layer.rows[0]?.values?.length ?? 0) + 2;
    const insert = database.prepare(
      `INSERT INTO ${quote(layer.name)} VALUES (${Array.from({length: width}, () => '?').join(', ')})`,
    );
    for (const row of layer.rows) {
      insert.run(row.id, row.geometry, ...((row.values ?? []) as never[]));
    }
  }
  database.exec('COMMIT;');
  database.close();
}

function feature(
  geometry: GeoJsonGeometry,
  name: string,
  extra: {id?: number; properties?: Record<string, unknown>} = {},
) {
  return {
    geometry,
    ...(extra.id === undefined ? {} : {id: extra.id}),
    properties: {name, ...extra.properties},
    type: 'Feature',
  };
}

function collection(features: unknown[]): string {
  return JSON.stringify({features, type: 'FeatureCollection'});
}

function gridPoints(count: number, spread: number) {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({length: count}, (_, index) =>
    feature(
      {
        coordinates: [((index % side) / side) * spread, (Math.floor(index / side) / side) * spread],
        type: 'Point',
      },
      `p${index}`,
    ),
  );
}

async function workspace(t: {after: (run: () => Promise<void>) => void}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-build-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  await mkdir(directory, {recursive: true});
  return directory;
}

function failure(result: {stderr: string}): {code: string; message: string} {
  return JSON.parse(result.stderr).error;
}

function assertClose(actual: number[], expected: number[], tolerance: number): void {
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= tolerance,
      `${actual.join(',')} is not within ${tolerance} of ${expected.join(',')}`,
    );
  });
}

function fileSource(bytes: Buffer): Source {
  return {
    getBytes: async (offset, length) => ({
      data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length),
    }),
    getKey: () => 'test',
  } as Source;
}

async function listTiles(archive: string, zoom: number): Promise<string[]> {
  const source = new PMTiles(fileSource(await readFile(archive)));
  const tiles: string[] = [];
  for (let x = 0; x < 2 ** zoom; x += 1) {
    for (let y = 0; y < 2 ** zoom; y += 1) {
      if (await source.getZxy(zoom, x, y)) tiles.push(`${zoom}/${x}/${y}`);
    }
  }
  return tiles;
}

/** Walk every tile at one zoom through the public PMTiles reader and the reference MVT decoder. */
async function decodeZoom(archive: string, zoom: number, layer: string): Promise<DecodedFeature[]> {
  const bytes = await readFile(archive);
  const source = new PMTiles(fileSource(bytes));
  const features: DecodedFeature[] = [];
  const header = await source.getHeader();
  const scale = 2 ** zoom;
  const toColumn = (longitude: number) => Math.floor(((longitude + 180) / 360) * scale);
  const toRow = (latitude: number) => {
    const sine = Math.sin((latitude * Math.PI) / 180);
    return Math.floor((0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale);
  };
  const clamp = (value: number) => Math.max(0, Math.min(scale - 1, value));
  for (let x = clamp(toColumn(header.minLon)); x <= clamp(toColumn(header.maxLon)); x += 1) {
    for (let y = clamp(toRow(header.maxLat)); y <= clamp(toRow(header.minLat)); y += 1) {
      const tile = await source.getZxy(zoom, x, y);
      if (!tile) continue;
      const decoded = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers[layer];
      if (!decoded) continue;
      for (let index = 0; index < decoded.length; index += 1) {
        const item = decoded.feature(index);
        features.push({
          geometry: item.toGeoJSON(x, y, zoom).geometry as GeoJsonGeometry,
          id: item.id,
          properties: item.properties as DecodedFeature['properties'],
        });
      }
    }
  }
  return features;
}

async function build(directory: string, args: string[]) {
  return runCli(directory, ['tileset', 'build', ...args]);
}

async function runCli(directory: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{code: number | null; stderr: string; stdout: string}>((resolve, reject) => {
    const child = spawn(process.execPath, cliFixtureArguments(args), {
      cwd: directory,
      env: {...process.env, ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stderr, stdout}));
  });
}

/** A two-record Shapefile: a null shape, then a polygon with a hole, plus its .dbf. */
async function writeShapefile(
  stem: string,
  rings: {hole: number[][]; outer: number[][]} = {
    hole: [
      [-3.68, 40.41],
      [-3.68, 40.42],
      [-3.67, 40.42],
      [-3.67, 40.41],
      [-3.68, 40.41],
    ],
    outer: [
      [-3.7, 40.4],
      [-3.65, 40.4],
      [-3.65, 40.45],
      [-3.7, 40.45],
      [-3.7, 40.4],
    ],
  },
): Promise<void> {
  // Shapefile exteriors are clockwise, the opposite of the ring order above.
  const parts = [[...rings.outer].reverse(), [...rings.hole].reverse()];
  const points = parts.flat();
  const nullRecord = Buffer.alloc(12);
  nullRecord.writeInt32BE(1, 0);
  nullRecord.writeInt32BE(2, 4);
  nullRecord.writeInt32LE(0, 8);

  const contentBytes = 44 + parts.length * 4 + points.length * 16;
  const polygon = Buffer.alloc(8 + contentBytes);
  polygon.writeInt32BE(2, 0);
  polygon.writeInt32BE(contentBytes / 2, 4);
  polygon.writeInt32LE(5, 8);
  polygon.writeInt32LE(parts.length, 44);
  polygon.writeInt32LE(points.length, 48);
  polygon.writeInt32LE(0, 52);
  polygon.writeInt32LE(parts[0].length, 56);
  points.forEach(([x, y], index) => {
    polygon.writeDoubleLE(x, 60 + index * 16);
    polygon.writeDoubleLE(y, 68 + index * 16);
  });

  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE((100 + nullRecord.length + polygon.length) / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  await writeFile(`${stem}.shp`, Buffer.concat([header, nullRecord, polygon]));

  const fields: Array<[string, string, number, number]> = [
    ['NAME', 'C', 10, 0],
    ['SIZE', 'N', 8, 1],
    ['OPEN', 'L', 1, 0],
  ];
  const recordBytes = 1 + fields.reduce((sum, item) => sum + item[2], 0);
  const headerBytes = 32 + fields.length * 32 + 1;
  const dbf = Buffer.alloc(headerBytes + recordBytes * 2 + 1, 0x20);
  dbf.fill(0, 0, headerBytes);
  dbf[0] = 3;
  dbf.writeUInt32LE(2, 4);
  dbf.writeUInt16LE(headerBytes, 8);
  dbf.writeUInt16LE(recordBytes, 10);
  fields.forEach(([name, type, length, decimals], index) => {
    const start = 32 + index * 32;
    dbf.write(name, start, 'latin1');
    dbf.write(type, start + 11, 'latin1');
    dbf[start + 16] = length;
    dbf[start + 17] = decimals;
  });
  dbf[headerBytes - 1] = 0x0d;
  const row = (offset: number, name: string, size: string, open: string) => {
    dbf.write(name.padEnd(10), offset + 1, 'latin1');
    dbf.write(size.padStart(8), offset + 11, 'latin1');
    dbf.write(open, offset + 19, 'latin1');
  };
  row(headerBytes, 'Empty', '1.0', 'F');
  row(headerBytes + recordBytes, 'Retiro', '118.5', 'T');
  await writeFile(`${stem}.dbf`, dbf);
}
