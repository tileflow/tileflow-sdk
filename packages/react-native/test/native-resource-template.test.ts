import assert from 'node:assert/strict';
import test from 'node:test';
import type {NativeAdmissionResource} from '../src/native-admission-contract';
import {normalizeNativeResources} from '../src/native-admission-url';
import {matchNativeResource} from '../src/native-resource-template';

const tile = {
  url: 'https://tiles.example.test/world/{z}/{x}/{y}.pbf?revision=3',
  scope: 'tile',
  tilesetId: 'world',
  template: 'tile',
} as const;
const glyph = {
  url: 'https://assets.example.test/fonts/{fontstack}/{range}.pbf',
  scope: 'glyph',
  template: 'glyphs',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Regular,Noto Sans Bold'],
} as const;

function match(rule: NativeAdmissionResource, url: string) {
  return matchNativeResource(normalizeNativeResources([rule]), url);
}

test('tile expansions preserve origin path query class and tileset identity', () => {
  const url = 'https://tiles.example.test/world/2/3/1.pbf?revision=3';
  assert.deepEqual(match(tile, url), {url, scope: 'tile', tilesetId: 'world'});
  for (const candidate of [
    url.replace('example.test', 'example.test.attacker.test'),
    url.replace('https:', 'http:'),
    url.replace('/world/', '/other/'),
    url.replace('/2/3/1', '/2/4/1'),
    url.replace('/2/3/1', '/02/3/1'),
    url.replace('/2/3/1', '/2/3/-1'),
    url.replace('/2/3/1', '/2/%33/1'),
    url.replace('revision=3', 'revision=4'),
    `${url}&map=other`,
    `${url}#fragment`,
  ])
    assert.equal(match(tile, candidate), undefined);
});

test('glyph expansions cannot select another font stack or arbitrary byte ranges', () => {
  const url = 'https://assets.example.test/fonts/Noto%20Sans%20Regular/0-255.pbf';
  assert.deepEqual(match(glyph, url), {url, scope: 'glyph'});
  assert.ok(match(glyph, url.replace('Regular/', 'Regular%2CNoto%20Sans%20Bold/')));
  for (const candidate of [
    url.replace('Regular', 'Italic'),
    url.replace('0-255', '1-256'),
    url.replace('0-255', '0-511'),
    url.replace('0-255', '00-255'),
    url.replace('Regular', 'Regular%2F..'),
  ])
    assert.equal(match(glyph, candidate), undefined);
});

test('templates cannot change authorities or introduce unknown expansion grammars', () => {
  for (const rule of [
    {...tile, url: 'https://{x}.example.test/{z}/{x}/{y}.pbf'},
    {...tile, url: tile.url.replace('{x}', '{unknown}')},
    {...tile, scope: 'style'},
    {...tile, template: 'arbitrary'},
    {...glyph, fontStacks: []},
    {...glyph, fontStacks: ['Noto', 'Noto']},
    {...glyph, fontStacks: ['Noto/Other']},
    {...glyph, fontStacks: Array.from({length: 17}, (_, index) => `Face ${index}`)},
    {...glyph, fontStacks: ['x'.repeat(257)]},
    {...glyph, template: undefined},
    {...tile, fontStacks: ['Noto']},
  ])
    assert.throws(() => normalizeNativeResources([rule as NativeAdmissionResource]));
});

test('overlapping identities fail closed instead of choosing a scope by array order', () => {
  const url = 'https://tiles.example.test/world/2/3/1.pbf?revision=3';
  for (const rules of [
    [tile, {url, scope: 'tile', tilesetId: 'other'}],
    [{url, scope: 'tile', tilesetId: 'other'}, tile],
  ])
    assert.throws(() =>
      matchNativeResource(normalizeNativeResources(rules as NativeAdmissionResource[]), url),
    );
});

test('repeated slots must agree and reserved context never participates in catalog identity', () => {
  const repeated = {...tile, url: 'https://tiles.example.test/{z}/{x}/{x}/{y}.pbf'};
  assert.ok(match(repeated, 'https://tiles.example.test/2/3/3/1.pbf'));
  assert.equal(match(repeated, 'https://tiles.example.test/2/3/2/1.pbf'), undefined);
  assert.throws(() =>
    normalizeNativeResources([{...tile, url: `${tile.url}&__tf_native_context=x`}]),
  );
});

test('catalog templates are bounded immutable snapshots, not native admission counters', () => {
  const stacks = [...glyph.fontStacks];
  const resources = normalizeNativeResources([{...glyph, fontStacks: stacks}]);
  stacks[0] = 'changed';
  assert.deepEqual(resources[0]!.fontStacks, glyph.fontStacks);
  assert.ok(Object.isFrozen(resources));
  assert.ok(Object.isFrozen(resources[0]!.fontStacks));
  assert.throws(() =>
    normalizeNativeResources(
      Array.from({length: 129}, (_, index) => ({
        url: `https://assets.example.test/sprite-${index}.png`,
        scope: 'sprite',
      })),
    ),
  );
});
