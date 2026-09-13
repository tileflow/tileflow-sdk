import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTileflowNativeResourceUrl} from '../src/native.js';

test('keeps percent-decoded hostnames outside placeholder restoration', () => {
  assert.equal(
    resolveTileflowNativeResourceUrl('https://__tileflow_native_tem%70late_0__.example.test/{z}', {
      documentUrl: 'https://maps.example.test/manifest.json',
      template: 'tile',
    }),
    'https://__tileflow_native_template_0__.example.test/{z}',
  );
});
