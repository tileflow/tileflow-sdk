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

test('official font identity includes the explicitly configured origin and exact cmap', async () => {
  const {officialFontFallback, officialFontFiles, isOfficialFontFile} =
    await import('../src/official-fonts');
  const origin = 'https://staging.tileflow.test';
  const file = officialFontFiles(officialFontFallback, origin)[0]!;
  assert.equal(isOfficialFontFile(file, origin), true);
  assert.equal(isOfficialFontFile(file), false);
  assert.equal(isOfficialFontFile({...file, 'unicode-range': ['U+0000-FFFF']}, origin), false);
  for (const url of [
    file.url.replace('staging.tileflow.test', 'other.test'),
    file.url + '?token=x',
    file.url + '#fragment',
    file.url.replace('https://', 'https://user:password@'),
  ])
    assert.equal(isOfficialFontFile({...file, url}, origin), false);
});
