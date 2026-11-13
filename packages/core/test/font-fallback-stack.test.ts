import assert from 'node:assert/strict';
import test from 'node:test';
import {assertTileflowFontFallbackWebSupport} from '../src/font-fallback';

test('the new web capability has a minimum, while old maps and newer renderers remain accepted', () => {
  const style = {metadata: {'tileflow:fontFallback': 1}};
  assert.doesNotThrow(() => assertTileflowFontFallbackWebSupport({}, '6.4.1'));
  assert.throws(() => assertTileflowFontFallbackWebSupport(style, '6.4.1'), /6.16.0/);
  for (const version of ['6.16.0', '6.20.1', '7.0.0'])
    assert.doesNotThrow(() => assertTileflowFontFallbackWebSupport(style, version));
});
