import assert from 'node:assert/strict';
import test from 'node:test';
import {createManifest, createStyle, createStyleFromProject, streets} from '../src';

const project = {maps: {main: {basemap: streets()}}};

test('compiles Streets maps through the canonical project API', () => {
  assert.equal(createStyle(project.maps.main).metadata?.['tileflow:basemap'], 'streets');
  assert.deepEqual(createStyleFromProject(project, 'main'), createStyle(project.maps.main));
  assert.throws(() => createStyleFromProject(project, 'constructor' as never), /Unknown/);
});

test('creates manifest schema 2 without tile data plumbing', () => {
  assert.deepEqual(createManifest(project, {styleBaseUrl: 'https://styles.example/'}), {
    version: 2,
    maps: {main: 'https://styles.example/styles/main.json'},
    styles: {main: 'https://styles.example/styles/main.json'},
  });
});
