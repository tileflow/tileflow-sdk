import assert from 'node:assert/strict';
import test from 'node:test';
import {describeDegradedResource, tileflowDatasetOf} from '../src/standalone';

test('names the hosted dataset a refused tile request reads', () => {
  const dataset = (url: string) => tileflowDatasetOf(new URL(url));
  assert.equal(dataset('https://api.tileflow.dev/tiles/bathymetry/tiles.json'), 'bathymetry');
  assert.equal(dataset('https://api.tileflow.dev/v1/tiles/nautical/9/250/198.pbf'), 'nautical');
  assert.equal(
    dataset('https://api.tileflow.dev/tiles/world%2Cworld-detail/tiles.json'),
    'world,world-detail',
  );
  assert.equal(dataset('https://example.com/data/tiles.json'), undefined);
  assert.equal(dataset('https://api.tileflow.dev/tiles/%3Cscript%3E/x.pbf'), undefined);
});

test('a refused dataset or a missing model degrades the image; glyphs and other errors fail it', () => {
  const bathymetry = describeDegradedResource(
    'https://api.tileflow.dev/tiles/bathymetry/tiles.json',
    403,
  );
  assert.match(bathymetry!, /^Tileflow dataset "bathymetry" returned HTTP 403/u);
  assert.match(
    describeDegradedResource('https://tiles.example.com/v3/1/2/3.pbf', 401)!,
    /^Data from https:\/\/tiles\.example\.com returned HTTP 401/u,
  );
  assert.match(
    describeDegradedResource('https://cdn.tileflow.dev/models/tower-0123456789abcdef.glb', 404)!,
    /3D model .* returned HTTP 404/u,
  );
  assert.equal(
    describeDegradedResource('https://api.tileflow.dev/fonts/Inter/0-255.pbf', 403),
    undefined,
  );
  assert.equal(
    describeDegradedResource('https://api.tileflow.dev/sprites/sprite.json', 401),
    undefined,
  );
  assert.equal(
    describeDegradedResource('https://api.tileflow.dev/tiles/world/1/2/3.pbf', 404),
    undefined,
  );
  assert.equal(
    describeDegradedResource('https://api.tileflow.dev/tiles/world/1/2/3.pbf', 500),
    undefined,
  );
  assert.equal(
    describeDegradedResource('https://api.tileflow.dev/tiles/world/1/2/3.pbf'),
    undefined,
  );
});
