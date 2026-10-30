import assert from 'node:assert/strict';
import test from 'node:test';
import {absoluteResource, createStyleResourceLoader} from '../src/style-resources';

test('nested document addresses retain their own base and native fetch is the only network owner', async () => {
  const calls: string[] = [];
  const documents: Record<string, unknown> = {
    'https://maps.example/themes/day.json': {
      version: 8,
      glyphs: '../fonts/{fontstack}/{range}.pbf',
      sprite: [{id: 'main', url: '../sprites/main'}],
      metadata: {'tileflow:fontFaces': [{family: 'Example', source: '../fonts/example.woff2'}]},
      sources: {
        world: {type: 'vector', url: '../sources/world.json', minzoom: 4},
        terrain: {type: 'raster-dem', url: '../sources/terrain.json'},
        places: {type: 'geojson', data: './places.json'},
      },
      layers: [],
    },
    'https://maps.example/sources/world.json': {
      tiles: ['../tiles/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
    },
    'https://maps.example/sources/terrain.json': {
      tiles: ['https://terrain.example/{z}/{x}/{y}.webp'],
      encoding: 'terrarium',
    },
  };
  const fetchResource: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    assert.ok(Object.hasOwn(documents, url));
    return Response.json(documents[url]);
  };
  const loader = createStyleResourceLoader(fetchResource, new AbortController().signal);
  const [first, second] = await Promise.all([
    loader.load('https://maps.example/themes/day.json'),
    loader.load('https://maps.example/themes/day.json'),
  ]);
  assert.equal(first, second);
  assert.equal(calls.length, 3);
  assert.equal(first.glyphs, 'https://maps.example/fonts/{fontstack}/{range}.pbf');
  assert.deepEqual(first.sources.world, {
    type: 'vector',
    tiles: ['https://maps.example/tiles/{z}/{x}/{y}.pbf'],
    minzoom: 4,
    maxzoom: 14,
  });
  assert.deepEqual(first.sources.places, {
    type: 'geojson',
    data: 'https://maps.example/themes/places.json',
  });
  assert.deepEqual(first.metadata?.['tileflow:fontFaces'], [
    {family: 'Example', source: 'https://maps.example/fonts/example.woff2'},
  ]);
});

test('unsupported authorities fail before dispatch and a failed document can retry', async () => {
  for (const url of [
    'file:///etc/passwd',
    'https://user:secret@maps.example/style.json',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => absoluteResource(url, 'https://maps.example/style.json'));
  }
  let count = 0;
  const loader = createStyleResourceLoader(async () => {
    count++;
    return count === 1
      ? new Response(null, {status: 503})
      : Response.json({version: 8, sources: {}, layers: []});
  }, new AbortController().signal);
  await assert.rejects(loader.load('https://maps.example/style.json'));
  await loader.load('https://maps.example/style.json');
  assert.equal(count, 2);
});

test('explicit tiles keep the style base and authored layers cannot use the application namespace', async () => {
  const loader = createStyleResourceLoader(
    async (input) =>
      Response.json(
        String(input).endsWith('/source.json')
          ? {tiles: ['./descriptor/{z}/{x}/{y}.pbf'], maxzoom: 14}
          : {
              version: 8,
              sources: {
                world: {type: 'vector', url: '../source.json', tiles: ['./own/{z}/{x}/{y}.pbf']},
              },
              layers: [],
            },
      ),
    new AbortController().signal,
  );
  const style = await loader.load('https://maps.example/themes/day.json');
  assert.deepEqual(style.sources.world, {
    type: 'vector',
    tiles: ['https://maps.example/themes/own/{z}/{x}/{y}.pbf'],
    maxzoom: 14,
  });
  const collision = createStyleResourceLoader(
    async () =>
      Response.json({
        version: 8,
        sources: {},
        layers: [{id: '__tileflow_app_selection', type: 'background'}],
      }),
    new AbortController().signal,
  );
  await assert.rejects(collision.load('https://maps.example/style.json'));
});
