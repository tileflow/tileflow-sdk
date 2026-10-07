import assert from 'node:assert/strict';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {tileflowSyntheticAssetOrigin} from '../src/assets';
import {
  resolveTileflowCaptureWorldTileJson,
  TileflowCaptureError,
  TileflowCaptureWorldSession,
  tileflowWorldCurrentTileJsonUrl,
} from '../src/index';

const digest = (character: string) => character.repeat(64);
const releaseId = 'world-v1-capture-release';
const descriptorSha256 = digest('d');

test('resolves current once and reuses one exact World identity across scenes and retries', async () => {
  let requests = 0;
  let response = exactTileJson();
  const world = new TileflowCaptureWorldSession(async (url, init) => {
    requests += 1;
    assert.equal(url, tileflowWorldCurrentTileJsonUrl);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    return jsonResponse(response);
  });
  const first = await world.prepare(currentStyle('first'));
  response = exactTileJson({releaseId: 'world-v1-newer-release'});
  const second = await world.prepare(currentStyle('second'));
  const retry = await world.prepare(currentStyle('first'));

  assert.equal(requests, 1);
  assert.deepEqual(first.data, second.data);
  assert.deepEqual(second.data, retry.data);
  assert.equal(first.data.kind, 'tileflow-world');
  if (first.data.kind === 'tileflow-world') {
    assert.equal(first.data.releaseId, releaseId);
    assert.equal(first.data.descriptorSha256, descriptorSha256);
  }
  for (const prepared of [first, second, retry]) {
    assert.equal('tiles' in prepared.style.sources.tileflow!, false);
    const asset = prepared.assets?.[0];
    assert.ok(asset);
    assert.equal(asset.contentType, 'application/json');
    assert.equal(
      prepared.style.sources.tileflow!.url,
      `${tileflowSyntheticAssetOrigin}/${asset.fileName}`,
    );
    assert.deepEqual(JSON.parse(String(asset.source)), exactTileJson());
  }
  assert.deepEqual(first.assets, retry.assets);
});

test('preserves complete TileJSON metadata and native source-option precedence without mutation', async () => {
  const tileJson = {
    ...exactTileJson(),
    minzoom: 2,
    maxzoom: 12,
    bounds: [-10, -20, 30, 40],
    scheme: 'tms',
    attribution: 'World metadata fixture',
    vector_layers: [{id: 'water', fields: {class: 'String'}, minzoom: 2, maxzoom: 12}],
    encoding: 'mvt',
    description: 'Complete source metadata',
  };
  const world = new TileflowCaptureWorldSession(async () => jsonResponse(tileJson));
  const style = currentStyle('overrides');
  Object.assign(style.sources.tileflow!, {
    minzoom: 3,
    maxzoom: 10,
    bounds: [-5, -10, 20, 30],
    scheme: 'xyz',
    attribution: 'Explicit attribution',
    promoteId: 'id',
    tiles: ['https://example.test/unverified/{z}/{x}/{y}.pbf'],
  });
  const original = structuredClone(style);
  const prepared = await world.prepare(style);
  const asset = prepared.assets?.[0];
  assert.ok(asset);

  assert.deepEqual(JSON.parse(String(asset.source)), tileJson);
  const {tiles: _tiles, ...expectedSource} = original.sources.tileflow!;
  assert.deepEqual(prepared.style.sources.tileflow, {
    ...expectedSource,
    url: `${tileflowSyntheticAssetOrigin}/${asset.fileName}`,
  });
  assert.deepEqual(style, original);
});

test('retains validated TileJSON response bytes without reserializing metadata', async () => {
  const body = JSON.stringify({...exactTileJson(), maxzoom: 15}, null, 2);
  const resolution = await resolveTileflowCaptureWorldTileJson(tileflowWorldCurrentTileJsonUrl, {
    fetchTileJson: async () => ({ok: true, status: 200, text: async () => body}),
  });

  assert.equal(resolution.tileJson, body);
});

test('freezes resolved TileJSON against caller mutation and later metadata changes', async () => {
  let tileJson: Record<string, unknown> = {...exactTileJson(), maxzoom: 12};
  let requests = 0;
  const world = new TileflowCaptureWorldSession(async () => {
    requests += 1;
    return jsonResponse(tileJson);
  });
  const first = await world.prepare(currentStyle('first'));
  const originalUrl = first.style.sources.tileflow!.url;
  const originalBody = first.assets?.[0]?.source;
  assert.ok(originalBody);

  first.assets![0]!.source = '{}';
  first.style.sources.tileflow!.url = 'https://example.test/changed.json';
  tileJson = {...exactTileJson(), maxzoom: 15};
  const retry = await world.prepare(currentStyle('retry'));

  assert.equal(requests, 1);
  assert.equal(retry.style.sources.tileflow!.url, originalUrl);
  assert.equal(retry.assets?.[0]?.source, originalBody);
  assert.equal(JSON.parse(String(retry.assets?.[0]?.source)).maxzoom, 12);
});

test('retains a failed resolution without discovering a different release on retry', async () => {
  let requests = 0;
  const world = new TileflowCaptureWorldSession(async () => {
    requests += 1;
    return {ok: false, status: 503, text: async () => ''};
  });

  for (let retry = 0; retry < 2; retry += 1) {
    await assert.rejects(world.prepare(currentStyle('failed')), /TileJSON returned HTTP 503/);
  }
  assert.equal(requests, 1);
});

test('leaves non-World sources unchanged without discovery or synthetic resources', async () => {
  const world = new TileflowCaptureWorldSession(async () => {
    assert.fail('Non-World capture must not discover World');
  });
  const style = currentStyle('vector');
  style.metadata = {'tileflow:data': {kind: 'vector-tiles'}};
  const prepared = await world.prepare(style);

  assert.equal(prepared.style, style);
  assert.equal(prepared.assets, undefined);
});

test('uses an exact TileJSON selection without replacing it with current', async () => {
  const exactSelector =
    `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=${releaseId}` +
    `&worldDescriptorSha256=${descriptorSha256}`;
  const requested: string[] = [];
  const world = new TileflowCaptureWorldSession(async (url) => {
    requested.push(url);
    return jsonResponse(exactTileJson());
  });
  const prepared = await world.prepare(currentStyle('exact', exactSelector));

  assert.deepEqual(requested, [exactSelector]);
  assert.equal(prepared.data.kind, 'tileflow-world');
  if (prepared.data.kind === 'tileflow-world') {
    assert.equal(prepared.data.releaseId, releaseId);
  }
});

test('rejects selector mixing before performing a second World lookup', async () => {
  let requests = 0;
  const world = new TileflowCaptureWorldSession(async () => {
    requests += 1;
    return jsonResponse(exactTileJson());
  });
  await world.prepare(currentStyle('current'));

  await assert.rejects(
    world.prepare(
      currentStyle(
        'other',
        `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=${releaseId}` +
          `&worldDescriptorSha256=${descriptorSha256}`,
      ),
    ),
    (error: unknown) =>
      error instanceof TileflowCaptureError && error.code === 'WORLD_RESOLUTION_FAILED',
  );
  assert.equal(requests, 1);
});

test('rejects a TileJSON response that conflicts with an exact selector', async () => {
  const exactSelector =
    `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=${releaseId}` +
    `&worldDescriptorSha256=${descriptorSha256}`;
  await assert.rejects(
    resolveTileflowCaptureWorldTileJson(exactSelector, {
      fetchTileJson: async () =>
        jsonResponse(exactTileJson({releaseId: 'world-v1-conflicting-release'})),
    }),
    /conflicts with the requested exact release/,
  );
  await assert.rejects(
    resolveTileflowCaptureWorldTileJson(
      `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=${releaseId}`,
      {fetchTileJson: async () => jsonResponse(exactTileJson())},
    ),
    /requires releaseId and descriptorSha256 together/,
  );
});

test('requires every exact World identity field and rejects mutable or conflicting templates', async () => {
  for (const field of [
    'archiveSha256',
    'contractSha256',
    'dataContractSha256',
    'descriptorSha256',
    'product',
    'releaseId',
  ] as const) {
    const tileJson = exactTileJson();
    delete (tileJson.tileflow.world as Record<string, unknown>)[field];
    await assert.rejects(
      resolveTileflowCaptureWorldTileJson(tileflowWorldCurrentTileJsonUrl, {
        fetchTileJson: async () => jsonResponse(tileJson),
      }),
      /missing or unsupported fields/,
      field,
    );
  }

  for (const tiles of [
    [
      `https://world.tileflow.dev/tiles/world/current/{z}/{x}/{y}.pbf?worldDescriptorSha256=${descriptorSha256}`,
    ],
    [
      `https://world.tileflow.dev/tiles/world/${releaseId}/{z}/{x}/{y}.pbf?worldDescriptorSha256=${digest('e')}`,
    ],
  ]) {
    await assert.rejects(
      resolveTileflowCaptureWorldTileJson(tileflowWorldCurrentTileJsonUrl, {
        fetchTileJson: async () => jsonResponse(exactTileJson({tiles})),
      }),
      /did not bind tiles to its exact release and descriptor/,
    );
  }
});

test('rejects the retired mutable World tile template without performing discovery', async () => {
  let requests = 0;
  const world = new TileflowCaptureWorldSession(async () => {
    requests += 1;
    return jsonResponse(exactTileJson());
  });
  const style = currentStyle('legacy');
  style.sources.tileflow = {
    type: 'vector',
    tiles: ['https://world.tileflow.dev/world/v1/{z}/{x}/{y}.pbf'],
  };
  await assert.rejects(world.prepare(style), /requires a current or exact TileJSON selector/u);
  assert.equal(requests, 0);
});

function currentStyle(name: string, url = tileflowWorldCurrentTileJsonUrl): MapLibreStyle {
  return {
    version: 8,
    name,
    metadata: {
      'tileflow:data': {
        generation: 'v1',
        kind: 'tileflow-world',
        schema: 'openmaptiles',
        schemaVersion: 1,
        semantics: {parkLayer: 'protected-only'},
        sourceId: 'tileflow',
      },
    },
    sources: {tileflow: {type: 'vector', url}},
    layers: [],
  };
}

function exactTileTemplate(
  input: {
    descriptorSha256?: string;
    releaseId?: string;
  } = {},
): string {
  return (
    `https://world.tileflow.dev/tiles/world/${input.releaseId ?? releaseId}/{z}/{x}/{y}.pbf` +
    `?worldDescriptorSha256=${input.descriptorSha256 ?? descriptorSha256}`
  );
}

function exactTileJson(input: {releaseId?: string; tiles?: string[]} = {}) {
  const selectedReleaseId = input.releaseId ?? releaseId;
  return {
    tilejson: '3.0.0',
    tiles: input.tiles ?? [exactTileTemplate({releaseId: selectedReleaseId})],
    tileflow: {
      tileVersion: selectedReleaseId,
      world: {
        archiveSha256: digest('a'),
        contractSha256: digest('b'),
        dataContractSha256: digest('c'),
        descriptorSha256,
        product: 'world-v1',
        releaseId: selectedReleaseId,
      },
    },
  };
}

function jsonResponse(value: unknown): Pick<Response, 'ok' | 'status' | 'text'> {
  return {ok: true, status: 200, text: async () => JSON.stringify(value)};
}
