import assert from 'node:assert/strict';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {
  exactWorldTileJsonSelector,
  inlineTileflowExactTileJson,
  TileflowTileJsonInlineError,
} from '../src/inline-tilejson';

const releaseId = 'world-v1-a3dea8b5-43fa-425f-ae4b-798be8c166e4';
const descriptorSha256 = 'a'.repeat(64);
const exact = `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=${releaseId}&worldDescriptorSha256=${descriptorSha256}`;
const edge = `https://world.tileflow.dev/tiles/world/${releaseId}/{z}/{x}/{y}.pbf?worldDescriptorSha256=${descriptorSha256}`;
const tileJson = {
  attribution: '© Tileflow © OpenStreetMap',
  bounds: [-180, -85.0511287, 180, 85.0511287],
  maxzoom: 15,
  minzoom: 0,
  scheme: 'xyz',
  tiles: [edge],
  tileflow: {world: {descriptorSha256, releaseId}},
  vector_layers: [{id: 'water', fields: {}}],
};

const style = (url: string): MapLibreStyle => ({
  version: 8,
  sources: {
    tileflow: {type: 'vector', url, attribution: 'Own credit'},
    terrain: {type: 'raster-dem', url: 'https://tiles.example.test/tilejson.json'},
  },
  layers: [],
});

test('only an anonymous exact World release is fixed enough to publish inside a style', () => {
  assert.deepEqual(exactWorldTileJsonSelector(exact), {descriptorSha256, releaseId});
  for (const url of [
    'https://api.tileflow.dev/tiles/world/tiles.json',
    `${exact}&map=map_0123456789abcdef`,
    `${exact}&renderSignature=x`,
    exact.replace('https:', 'http:'),
    exact.replace('/tiles/world/', '/tiles/team-tileset/'),
    `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=${releaseId}`,
    `https://api.tileflow.dev/tiles/world/tiles.json?worldReleaseId=current&worldDescriptorSha256=${descriptorSha256}`,
    undefined,
  ])
    assert.equal(exactWorldTileJsonSelector(url), undefined, String(url));
});

test('exact-release sources carry their TileJSON in place of url, read once for every theme', async () => {
  const requested: string[] = [];
  const fetch = (async (url: string) => {
    requested.push(url);
    return new Response(JSON.stringify(tileJson));
  }) as typeof globalThis.fetch;
  const input = {streets: {light: style(exact), dark: style(exact)}};
  const before = JSON.stringify(input);
  const output = await inlineTileflowExactTileJson(input, {fetch});
  assert.deepEqual(requested, [exact]);
  assert.equal(JSON.stringify(input), before, 'inputs are not mutated');
  for (const theme of ['light', 'dark']) {
    const sources = output.streets![theme]!.sources;
    assert.deepEqual(sources.tileflow, {
      tiles: [edge],
      minzoom: 0,
      maxzoom: 15,
      bounds: [-180, -85.0511287, 180, 85.0511287],
      scheme: 'xyz',
      type: 'vector',
      attribution: `${tileJson.attribution} | Own credit`,
    });
    // Other sources keep their own TileJSON reference.
    assert.deepEqual(sources.terrain, input.streets.light.sources.terrain);
  }
});

test('a source without its own credit takes the TileJSON attribution', async () => {
  const fetch = (async () => new Response(JSON.stringify(tileJson))) as typeof globalThis.fetch;
  const bare = style(exact);
  delete (bare.sources.tileflow as {attribution?: string}).attribution;
  const output = await inlineTileflowExactTileJson({map: {light: bare}}, {fetch});
  assert.equal(
    (output.map!.light!.sources.tileflow as {attribution?: string}).attribution,
    tileJson.attribution,
  );
});

test('an unreadable or mismatched TileJSON fails the build instead of publishing a guess', async () => {
  const answer = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), {status})) as typeof globalThis.fetch;
  for (const fetch of [
    answer(tileJson, 503),
    answer({...tileJson, tileflow: {world: {descriptorSha256, releaseId: 'world-v1-other'}}}),
    answer({...tileJson, tiles: []}),
    answer({...tileJson, tiles: ['http://world.tileflow.dev/{z}/{x}/{y}.pbf']}),
    answer({...tileJson, tiles: ['https://world.tileflow.dev/tiles/world/{z}.pbf']}),
    answer({...tileJson, minzoom: -1}),
    answer([tileJson]),
    (async () => {
      throw new TypeError('offline');
    }) as typeof globalThis.fetch,
  ])
    await assert.rejects(
      inlineTileflowExactTileJson({map: {light: style(exact)}}, {fetch}),
      TileflowTileJsonInlineError,
    );
});

test('inlining never drops the provider credit when the authored credit is blank or different', async () => {
  for (const credit of ['', '  ', 'Own credit']) {
    const input = style(exact);
    (input.sources.tileflow as {attribution?: string}).attribution = credit;
    const output = await inlineTileflowExactTileJson(
      {map: {light: input}},
      {
        fetch: (async () => new Response(JSON.stringify(tileJson))) as typeof globalThis.fetch,
      },
    );
    const actual = (output.map!.light!.sources.tileflow as {attribution?: string}).attribution;
    assert.ok(actual?.includes(tileJson.attribution), JSON.stringify({credit, actual}));
    if (credit.trim()) assert.ok(actual?.includes(credit));
  }
});
