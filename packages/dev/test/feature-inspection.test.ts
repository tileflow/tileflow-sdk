import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {
  defineMap,
  openMapTiles,
  parseTileflowMap,
  type TileflowMap,
  vectorTiles,
} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {inspectTileflowFeatures} from '../src/feature-inspection';
import {fixtureThemeFields} from './theme-fixture';

function defineResolvedMap(input: TileflowMap) {
  return parseTileflowMap(defineMap(input));
}

const tile = Buffer.from(
  'GqkBeAIKA3BvaSiAIBIVCAcSCAAAAQECAgMDGAEiBQmAIIAgEhUICBIIAAQBBQIGAwcYASIFCbA7sDsaBG5hbWUaBWNsYXNzGgRyYW5rGgZzZWNyZXQiDgoMQ2VudHJhbCBjYWZlIgYKBGNhZmUiAigDIg8KDURPX05PVF9FWFBPU0UiCQoHT3V0c2lkZSIGCgRzaG9wIgIoCSIQCg5PVVRTSURFX1NFQ1JFVA==',
  'base64',
);

test('inspects bounded features deterministically and projects only requested properties', async (t) => {
  let port = 0;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url?.startsWith('/tiles.json')) {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(
        JSON.stringify({
          maxzoom: 0,
          minzoom: 0,
          tiles: [`http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.pbf?token=TOP_SECRET`],
        }),
      );
      return;
    }
    if (request.url?.startsWith('/tiles/0/0/0.pbf')) {
      response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
      response.end(tile);
      return;
    }
    response.writeHead(400, {'Content-Type': 'text/plain'});
    response.end('unexpanded tile template');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;

  const project: TileflowBuildCatalog = {
    maps: {
      fixture: defineResolvedMap({
        id: 'fixture',
        version: 1,
        ...fixtureThemeFields,
        glyphs: {
          kind: 'url',
          url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
          fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
        },
        data: vectorTiles({
          attribution: 'Fixture data',
          schema: openMapTiles(),
          url: `http://127.0.0.1:${port}/tiles.json?key=HIDDEN`,
        }),
      }),
    },
  };
  const options = {
    center: [0, 0] as const,
    height: 64,
    limit: 10,
    properties: ['rank', 'name', 'missing'],
    preparedAssets: {
      icons: {
        ids: [
          'coffee',
          'culture',
          'education',
          'food',
          'health',
          'lodging',
          'major-transit',
          'parking',
          'services',
          'shopping',
        ],
        sprite: '/tileflow/icons/fixture/sprite',
      },
    },
    sourceLayers: ['poi'],
    width: 64,
    zoom: 0,
  };
  const first = await inspectTileflowFeatures(project, 'fixture', options);
  const second = await inspectTileflowFeatures(project, 'fixture', options);

  assert.deepEqual(second, first);
  assert.deepEqual(first.properties, ['missing', 'name', 'rank']);
  assert.equal(first.tilesRead, 1);
  assert.equal(first.scannedFeatures, 2);
  assert.equal(first.truncated, false);
  assert.deepEqual(first.features, [
    {
      sourceLayer: 'poi',
      id: 7,
      geometry: {
        type: 'Point',
        center: [0, 0],
        bounds: [0, 0, 0, 0],
      },
      properties: {name: 'Central cafe', rank: 3},
    },
  ]);
  assert.equal(first.source.origin, `http://127.0.0.1:${port}`);
  assert.equal(first.source.tileJsonPath, '/tiles.json');
  assert.deepEqual(first.source.tileOrigins, [`http://127.0.0.1:${port}`]);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /TOP_SECRET|HIDDEN|DO_NOT_EXPOSE|OUTSIDE_SECRET/);
  assert.ok(requests.some((request) => request.includes('token=TOP_SECRET')));
  assert.ok(requests.some((request) => request.startsWith('/tiles/0/0/0.pbf')));
  assert.equal(
    requests.some((request) => /%7B|\{/.test(request)),
    false,
  );

  const namedFirst = await inspectTileflowFeatures(project, 'fixture', {
    ...options,
    height: 512,
    limit: 1,
    width: 512,
  });
  assert.equal(namedFirst.features[0]?.properties.name, 'Central cafe');
});

test('rejects unbounded and non-HTTP inspection inputs before fetching', async () => {
  const validMap = defineResolvedMap({
    id: 'fixture',
    version: 1,
    ...fixtureThemeFields,
    data: vectorTiles({
      attribution: 'Fixture data',
      schema: openMapTiles(),
      url: 'https://tiles.example.test/tiles.json',
    }),
  });
  const project: TileflowBuildCatalog = {
    maps: {
      fixture: {
        ...validMap,
        data: {
          ...validMap.data!,
          url: 'file:///tmp/tiles.json',
        },
      },
    },
  };
  let fetched = false;
  const fetchImplementation: typeof fetch = async () => {
    fetched = true;
    throw new Error('unexpected fetch');
  };

  await assert.rejects(
    () =>
      inspectTileflowFeatures(project, 'fixture', {
        center: [0, 0],
        fetch: fetchImplementation,
        sourceLayers: Array.from({length: 13}, (_, index) => `layer${index}`),
        zoom: 5,
      }),
    /1-12 source layers/,
  );
  assert.equal(fetched, false);

  await assert.rejects(
    () =>
      inspectTileflowFeatures(project, 'fixture', {
        center: [0, 0],
        fetch: fetchImplementation,
        sourceLayers: ['poi'],
        zoom: 5,
      }),
    /must not use the file protocol/,
  );
  assert.equal(fetched, false);
});
