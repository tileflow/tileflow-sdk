import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
import {streetsPoiDiscColors, streetsPoiPictograms} from '../src/official/streets-poi';
import {streetsPreparedModels, streetsTreeForms, streetsTreeIconIds} from './streets-assets';
import {streetsPoiImageIds} from './streets-poi-fixture';

const execFileAsync = promisify(execFile);

test('publishes official maps and their assets as one package', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    files: string[];
    peerDependencies: Record<string, string>;
  };

  // Shared climate and prepared tree models come from Tileflow's servers.
  assert.deepEqual(manifest.files, [
    'assets',
    '!assets/streets/climate/streets-climate-v1.png',
    ...streetsTreeForms
      .flatMap((form) =>
        ['far', 'near'].map(
          (level) => `!assets/streets/tree-models/models/streets-tree-${form}-${level}`,
        ),
      )
      .sort(),
    'dist',
    'THIRD_PARTY_NOTICES.md',
    'LICENSE',
    'REFERENCE.md',
  ]);
  assert.equal(manifest.peerDependencies['@tileflow/core'].startsWith('workspace:'), true);
  assert.deepEqual(manifest.exports['.'], {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  });
  assert.equal(manifest.exports['./package.json'], './package.json');
});

test('publishes every official icon and font directory with provenance', async () => {
  const expected = {
    outdoors: ['outdoors-peak.svg', 'outdoors-peak-dark.svg'],
    soundings: [
      'soundings-boat-hoist.svg',
      'soundings-boatyard.svg',
      'soundings-buoy-cardinal.svg',
      'soundings-buoy-pillar.svg',
      'soundings-buoy-port.svg',
      'soundings-buoy-starboard.svg',
      'soundings-distance-mark.svg',
      'soundings-facility.svg',
      'soundings-fuel-station.svg',
      'soundings-harbor.svg',
      'soundings-light-flare.svg',
      'soundings-lighthouse.svg',
      'soundings-marina.svg',
      'soundings-notice-information.svg',
      'soundings-notice-prohibition.svg',
      'soundings-notice-recommendation.svg',
      'soundings-notice-regulation.svg',
      'soundings-notice-restriction.svg',
      'soundings-notice.svg',
      'soundings-paper-grain.pattern.svg',
      'soundings-pump-out.svg',
      'soundings-rock-awash.svg',
      'soundings-slipway.svg',
      'soundings-visitor-berth.svg',
      'soundings-water-dots.pattern.svg',
      'soundings-water-tap.svg',
      'soundings-wreck.svg',
      'tileflow.icons.json',
    ],

    streets: [
      ...streetsPoiImageIds.map((id) => `${id}.svg`),
      ...streetsTreeIconIds.map((id) => `${id}.pattern.svg`),
      'crosswalk.svg',
      'oneway.svg',
      'road-shield-circle-neutral.svg',
      'road-shield-rectangle-blue.svg',
      'road-shield-rectangle-green.svg',
      'road-shield-rectangle-neutral.svg',
      'road-shield-rectangle-orange.svg',
      'road-shield-rectangle-red.svg',
      'road-shield-rectangle-yellow.svg',
      'sidewalk-dot-dark.svg',
      'sidewalk-dot.svg',
      'LICENSE-CC-BY-SA-3.0.txt',
      'LICENSE-CC-BY-SA-4.0.txt',
      'tileflow.icons.json',
    ],
  } as const;

  assert.deepEqual(
    (await readdir(new URL('../assets/', import.meta.url), {withFileTypes: true}))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    Object.keys(expected).sort(),
  );
  for (const [mapId, fileNames] of Object.entries(expected)) {
    assert.deepEqual(
      (await readdir(new URL(`../assets/${mapId}/icons/`, import.meta.url))).sort(),
      [...fileNames].sort(),
    );
  }

  const lightSidewalkDot = await readFile(
    new URL('../assets/streets/icons/sidewalk-dot.svg', import.meta.url),
    'utf8',
  );
  const darkSidewalkDot = await readFile(
    new URL('../assets/streets/icons/sidewalk-dot-dark.svg', import.meta.url),
    'utf8',
  );
  assert.notEqual(darkSidewalkDot, lightSidewalkDot);
  assert.match(lightSidewalkDot, /fill="#000000" fill-opacity="0.2"/u);
  assert.match(darkSidewalkDot, /fill="#FFFFFF" fill-opacity="0.2"/u);

  // Each POI disc takes its palette color; its pictogram and provenance are Maki's.
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  for (const [id, pictogram] of Object.entries(streetsPoiPictograms)) {
    const role = 'disc' in pictogram ? pictogram.disc : pictogram.category;
    for (const [theme, file] of [
      ['light', `${id}.svg`],
      ['dark', `${id}-dark.svg`],
    ] as const) {
      const svg = await readFile(
        new URL(`../assets/streets/icons/${file}`, import.meta.url),
        'utf8',
      );
      assert.match(
        svg,
        new RegExp(`r="8.5" fill="${streetsPoiDiscColors[theme][role]}"`, 'u'),
        file,
      );
      assert.match(svg, new RegExp(`Maki ${pictogram.maki} pictogram, CC0-1.0`, 'u'), file);
    }
    assert.match(notices, new RegExp(`\`${pictogram.maki}\``, 'u'), pictogram.maki);
  }

  const neutralShield = await readFile(
    new URL('../assets/streets/icons/road-shield-rectangle-neutral.svg', import.meta.url),
    'utf8',
  );
  const blueShield = await readFile(
    new URL('../assets/streets/icons/road-shield-rectangle-blue.svg', import.meta.url),
    'utf8',
  );
  for (const shield of [neutralShield, blueShield]) {
    assert.match(shield, /width="20" height="13" viewBox="0 0 20 13"/u);
    assert.match(shield, /<rect width="20" height="13"/u);
    assert.match(shield, /x="1" y="1" width="18" height="11"/u);
  }
  assert.match(neutralShield, /fill="#1B1D27"/u);
  assert.match(neutralShield, /fill="#FFFFFF"/u);
  assert.match(blueShield, /fill="#475DCD"/u);
  assert.match(blueShield, /fill="#FFFFFF"/u);

  assert.match(
    await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
    /original Tileflow artwork/u,
  );
});

test('keeps the Soundings standalone source independent from Streets', async () => {
  const source = await readFile(new URL('../src/official/nautical.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
});
test('imports and compiles the three packaged official maps against public Core APIs', async () => {
  const ids = (await readdir(new URL('../assets/', import.meta.url), {recursive: true}))
    .filter((file) => file.endsWith('.svg'))
    .map((file) =>
      file
        .split('/')
        .pop()!
        .replace(/(?:\.pattern)?\.svg$/u, ''),
    );
  const script = `const assert = (await import('node:assert/strict')).default;
    const core = await import('@tileflow/core'); const maps = await import('@tileflow/maps');
    const names = Object.entries(maps).filter(([,v])=>v && typeof v === 'object' && typeof v.id === 'string').map(([k])=>k).sort();
    assert.deepEqual(names, ['nautical', 'outdoors', 'soundings', 'streets']);
    assert.equal(maps.soundings, maps.nautical);
    for (const name of ['baedeker','blueprint','civica','map1777','siegfried','baedekerFonts','blueprintIcons','civicaFonts','map1777Fonts','siegfriedThemes']) assert.equal(name in maps, false);
    for (const name of names) {
      assert.equal(maps[name].extends, undefined);
      assert.equal(Object.isFrozen(maps[name]), true);
      const style = core.createStyle(maps[name], {preparedAssets:{models: ${JSON.stringify(streetsPreparedModels)},icons:{ids:${JSON.stringify(ids)},sprite:'/test/sprite'}}});
      assert.equal(style.metadata['tileflow:map'], name === 'soundings' ? 'nautical' : name);
      assert.ok(style.layers.length > 50);
    }
    for (const name of ['streets','outdoors']) {
      assert.equal(maps[name].defaultTheme,'light');
      assert.equal(maps[name].systemThemes.dark,'dark');
      assert.deepEqual(core.resolveMap(maps[name]).glyphs, maps.streetsGlyphs);
    }
  `;
  const {stdout, stderr} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
