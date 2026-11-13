import assert from 'node:assert/strict';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {rebaseTileflowFamilyStyle} from '../src/family-style-resources';

const styleUrl = 'https://example.test/maps/generations/revision/styles/main/light.json';
const familyUrl = 'https://example.test/maps/generations/revision/families/main.json';

test('moving a theme into a family preserves the resource URL and opaque query', () => {
  for (const sprite of [
    '../../icons/main/sprite',
    '../../../shared/sprite?version=2#atlas',
    './icons/%2e%2e/../sprite',
    '../../tiles/{z}/{x}/{y}?dem=https%3A%2F%2Fexample.test%2F%7Bz%7D%2F%7Bx%7D%2F%7By%7D',
    '?version=2',
    '#sprite',
    '',
    '  ../../icons/main/sprite  ',
    String.fromCharCode(0, 9) + '../../icons/main/sprite' + String.fromCharCode(13, 0),
    '/shared/sprite',
    '//cdn.example.test/sprite',
    'https://cdn.example.test/sprite',
    'data:application/json,%7B%7D',
    'tileflow-path-ground://source/{z}/{x}/{y}?nested=%7Bz%7D',
  ]) {
    const style: MapLibreStyle = {version: 8, sources: {}, layers: [], sprite};
    const actual = rebaseTileflowFamilyStyle(style, 'main', 'light');
    assert.equal(new URL(actual.sprite as string, familyUrl).href, new URL(sprite, styleUrl).href);
    assert.equal(style.sprite, sprite);
  }
});

test('rebases resource-bearing fields and preserves application data', () => {
  const reference = '../../resources/item?nested=%7Bz%7D';
  const style = {
    version: 8,
    sprite: [{id: 'icons', url: reference}],
    glyphs: reference,
    'font-faces': {
      Plain: reference,
      Detailed: {url: reference, family: 'Detailed'},
      Ranged: [{url: reference, 'unicode-range': ['U+0020-007E']}],
    },
    sources: {
      tilejson: {type: 'vector', url: reference},
      tiles: {type: 'raster', tiles: [reference]},
      geojson: {type: 'geojson', data: reference},
      image: {type: 'image', url: reference},
      video: {type: 'video', urls: [reference]},
      inline: {type: 'geojson', data: {type: 'FeatureCollection', features: [], label: reference}},
    },
    metadata: {
      'tileflow:fontLicenses': [reference],
      'tileflow:fontFaces': [{family: 'Font', source: reference}],
      'tileflow:buildings': {models: [{url: reference}], landmarks: {url: reference}},
      'tileflow:vegetation': {models: [{url: reference}], landmarks: {url: reference}},
      application: {label: reference},
    },
    layers: [{id: 'background', type: 'background', paint: {'background-pattern': reference}}],
  } as unknown as MapLibreStyle;
  const before = structuredClone(style);
  const actual = rebaseTileflowFamilyStyle(style, 'main', 'light');
  for (const path of [
    ['sprite', 0, 'url'],
    ['glyphs'],
    ['font-faces', 'Plain'],
    ['font-faces', 'Detailed', 'url'],
    ['font-faces', 'Ranged', 0, 'url'],
    ['metadata', 'tileflow:fontLicenses', 0],
    ['sources', 'tilejson', 'url'],
    ['sources', 'tiles', 'tiles', 0],
    ['sources', 'geojson', 'data'],
    ['sources', 'image', 'url'],
    ['sources', 'video', 'urls', 0],
    ['metadata', 'tileflow:fontFaces', 0, 'source'],
    ['metadata', 'tileflow:buildings', 'models', 0, 'url'],
    ['metadata', 'tileflow:buildings', 'landmarks', 'url'],
    ['metadata', 'tileflow:vegetation', 'models', 0, 'url'],
    ['metadata', 'tileflow:vegetation', 'landmarks', 'url'],
  ]) {
    const value = path.reduce<unknown>(
      (value, key) => (value as Record<string | number, unknown>)[key!],
      actual,
    );
    assert.equal(
      new URL(value as string, familyUrl).href,
      new URL(reference, styleUrl).href,
      path.join('.'),
    );
  }
  assert.deepEqual(actual.layers, before.layers);
  assert.deepEqual(actual.sources.inline, before.sources.inline);
  assert.deepEqual(actual.metadata?.application, before.metadata?.application);
  assert.deepEqual(style, before);
});
