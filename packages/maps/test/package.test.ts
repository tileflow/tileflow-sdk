import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
import {streetsPoiDiscColors, streetsPoiPictograms} from '../src/official/streets-poi';
import {streetsPreparedModels, streetsTreeIconIds} from './streets-assets';
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

  assert.deepEqual(manifest.files, ['assets', 'docs', 'dist', 'THIRD_PARTY_NOTICES.md', 'LICENSE']);
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
    baedeker: [
      'baedeker-hachures.pattern.svg',
      'baedeker-orchard.pattern.svg',
      'baedeker-paper-grain.pattern.svg',
      'baedeker-park-stipple.pattern.svg',
      'baedeker-residential.pattern.svg',
      'baedeker-sand.pattern.svg',
      'baedeker-water-lines.pattern.svg',
      'baedeker-wetland.pattern.svg',
    ],
    civica: [
      'civica-industrial-hatch.pattern.svg',
      'civica-orchard.pattern.svg',
      'civica-paper-grain.pattern.svg',
      'civica-park-groves.pattern.svg',
      'civica-poi-airport.svg',
      'civica-poi-civic-star.svg',
      'civica-poi-dot.svg',
      'civica-poi-food.svg',
      'civica-poi-garden.svg',
      'civica-poi-hospital.svg',
      'civica-poi-lodging.svg',
      'civica-poi-monument.svg',
      'civica-poi-museum.svg',
      'civica-poi-shopping.svg',
      'civica-poi-transit.svg',
      'civica-water-lines.pattern.svg',
    ],

    'map-1777': ['', 'dawn-', 'dusk-', 'night-'].flatMap((moment) => [
      ...[
        'crop-cross',
        'crop-hatch',
        'crop-lines',
        'heath',
        'orchard',
        'paper-grain',
        'residential',
        'sand',
        'water-ripples',
        'wetland',
        'woodland',
      ].map((plate) => `map-1777-${moment}${plate}.pattern.svg`),
    ]),

    blueprint: [
      'blueprint-grid.pattern.svg',
      'blueprint-building-hatch.pattern.svg',
      'blueprint-landscape-hatch.pattern.svg',
      'blueprint-poi-node.svg',
      'blueprint-water-hatch.pattern.svg',
    ],
    siegfried: [
      'siegfried-dark-forest.pattern.svg',
      'siegfried-dark-glacier.pattern.svg',
      'siegfried-dark-gravel.pattern.svg',
      'siegfried-dark-orchard.pattern.svg',
      'siegfried-dark-paper-grain.pattern.svg',
      'siegfried-dark-rock.pattern.svg',
      'siegfried-dark-scree.pattern.svg',
      'siegfried-dark-water-lines.pattern.svg',
      'siegfried-dark-wetland.pattern.svg',
      'siegfried-forest.pattern.svg',
      'siegfried-glacier.pattern.svg',
      'siegfried-gravel.pattern.svg',
      'siegfried-orchard.pattern.svg',
      'siegfried-paper-grain.pattern.svg',
      'siegfried-rock.pattern.svg',
      'siegfried-scree.pattern.svg',
      'siegfried-water-lines.pattern.svg',
      'siegfried-wetland.pattern.svg',
    ],
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
  assert.deepEqual((await readdir(new URL('../assets/civica/fonts/', import.meta.url))).sort(), [
    'BarlowSemiCondensed-Regular.ttf',
    'BarlowSemiCondensed-SemiBold.ttf',
    'DMSerifText-Italic.ttf',
    'DMSerifText-Regular.ttf',
    'LICENSE-BarlowSemiCondensed.txt',
    'LICENSE-NotoSans.txt',
    'LICENSE.txt',
    'NotoSans-Regular.ttf',
    'OFL.txt',
    'README.md',
  ]);
  for (const font of [
    'BarlowSemiCondensed-Regular.ttf',
    'BarlowSemiCondensed-SemiBold.ttf',
    'DMSerifText-Italic.ttf',
    'DMSerifText-Regular.ttf',
    'NotoSans-Regular.ttf',
  ]) {
    assert.ok(
      (await readFile(new URL(`../assets/civica/fonts/${font}`, import.meta.url))).byteLength >
        10_000,
    );
  }
  assert.deepEqual((await readdir(new URL('../assets/siegfried/fonts/', import.meta.url))).sort(), [
    'CormorantGaramond-Italic.ttf',
    'CormorantGaramond-Regular.ttf',
    'CormorantGaramond-SemiBold.ttf',
    'LICENSE.txt',
  ]);
  for (const font of [
    'CormorantGaramond-Italic.ttf',
    'CormorantGaramond-Regular.ttf',
    'CormorantGaramond-SemiBold.ttf',
  ]) {
    assert.ok(
      (await readFile(new URL(`../assets/siegfried/fonts/${font}`, import.meta.url))).byteLength >
        400_000,
    );
  }
  assert.deepEqual((await readdir(new URL('../assets/baedeker/fonts/', import.meta.url))).sort(), [
    'CormorantGaramond-Italic.ttf',
    'CormorantGaramond-Regular.ttf',
    'CormorantGaramond-SemiBold.ttf',
    'LICENSE.txt',
  ]);
  for (const font of [
    'CormorantGaramond-Italic.ttf',
    'CormorantGaramond-Regular.ttf',
    'CormorantGaramond-SemiBold.ttf',
  ]) {
    assert.ok(
      (await readFile(new URL(`../assets/baedeker/fonts/${font}`, import.meta.url))).byteLength >
        400_000,
    );
  }
  assert.deepEqual((await readdir(new URL('../assets/map-1777/fonts/', import.meta.url))).sort(), [
    'CormorantGaramond-Italic.ttf',
    'CormorantGaramond-Regular.ttf',
    'CormorantGaramond-SemiBold.ttf',
    'LICENSE.txt',
  ]);
  for (const font of [
    'CormorantGaramond-Italic.ttf',
    'CormorantGaramond-Regular.ttf',
    'CormorantGaramond-SemiBold.ttf',
  ]) {
    assert.ok(
      (await readFile(new URL(`../assets/map-1777/fonts/${font}`, import.meta.url))).byteLength >
        400_000,
    );
  }
});

test('keeps the Baedeker standalone source independent from other official maps', async () => {
  const source = await readFile(new URL('../src/official/baedeker.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]\.\/(?:blueprint|cyberpunk|map-1777|matrix|siegfried|soundings|streets)['"]/u,
  );
  assert.doesNotMatch(source, /\bextends\s*:/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
});

test('keeps the Soundings standalone source independent from Streets', async () => {
  const source = await readFile(new URL('../src/official/soundings.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
});

test('keeps the Siegfried standalone source independent from Streets', async () => {
  const source = await readFile(new URL('../src/official/siegfried.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets-themes['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
});

test('keeps the Blueprint standalone source independent from other official maps', async () => {
  const source = await readFile(new URL('../src/official/blueprint.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]\.\/(?:baedeker|cyberpunk|map-1777|matrix|siegfried|soundings|streets)['"]/u,
  );
  assert.doesNotMatch(source, /\bextends\s*:/u);
});

test('imports and compiles all packaged official maps against public Core APIs', async () => {
  const script = `
    const core = await import('@tileflow/core');
    const maps = await import('@tileflow/maps');
    const mapExports = Object.entries(maps)
      .filter(([, value]) => value && typeof value === 'object' && typeof value.id === 'string')
      .map(([name]) => name).sort();
    if (JSON.stringify(mapExports) !== JSON.stringify(['baedeker', 'blueprint', 'civica', 'map1777', 'siegfried', 'soundings', 'streets'])) {
      throw new Error('Official map exports do not match the supported catalog: ' + mapExports.join(', '));
    }
    for (const name of ['cyberpunk', 'matrix', 'superTileWorld', 'cyberpunkFonts', 'matrixIcons', 'superTileWorldIcons', 'sanFrancisto', 'sanFrancistoIcons']) {
      if (name in maps) throw new Error('Retired export remains in SDK Maps: ' + name);
    }
    for (const [name, id] of [
      ['baedeker', 'baedeker'],
      ['civica', 'civica'],
      ['streets', 'streets'],
      ['map1777', 'map-1777'],
      ['blueprint', 'blueprint'],
      ['siegfried', 'siegfried'],
      ['soundings', 'soundings'],
    ]) {
      if (!maps[name] || typeof maps[name] !== 'object') process.exit(2);
      const style = core.createStyle(maps[name], {
        preparedAssets: {
          models: ${JSON.stringify(streetsPreparedModels)},
          icons: {
            ids: [
              ...${JSON.stringify(streetsTreeIconIds)},
              'baedeker-hachures', 'baedeker-orchard', 'baedeker-paper-grain',
              'baedeker-park-stipple', 'baedeker-residential', 'baedeker-sand',
              'baedeker-water-lines', 'baedeker-wetland',
              'civica-industrial-hatch', 'civica-orchard', 'civica-paper-grain',
              'civica-park-groves', 'civica-water-lines', 'civica-poi-airport',
              'civica-poi-civic-star', 'civica-poi-dot', 'civica-poi-food',
              'civica-poi-garden', 'civica-poi-hospital', 'civica-poi-lodging',
              'civica-poi-monument', 'civica-poi-museum', 'civica-poi-shopping',
              'civica-poi-transit',
              'coffee', 'nature', 'sport', 'worship', 'coffee-dark', 'culture-dark', 'education-dark', 'food-dark', 'health-dark', 'lodging-dark', 'major-transit-dark', 'parking-dark', 'services-dark', 'shopping-dark', 'nature-dark', 'worship-dark', 'sport-dark', 'crosswalk', 'culture', 'education', 'food', 'health', 'lodging',
              'map-1777-crop-cross', 'map-1777-crop-hatch', 'map-1777-crop-lines', 'map-1777-heath', 'map-1777-orchard',
              'map-1777-paper-grain', 'map-1777-residential', 'map-1777-sand',
              'map-1777-water-ripples', 'map-1777-wetland', 'map-1777-woodland',
              'major-transit', 'oneway', 'parking', 'road-shield-circle-neutral',
              'road-shield-rectangle-blue', 'road-shield-rectangle-green',
              'road-shield-rectangle-neutral', 'road-shield-rectangle-orange',
              'road-shield-rectangle-red', 'road-shield-rectangle-yellow',
              'blueprint-grid', 'blueprint-building-hatch',
              'blueprint-landscape-hatch', 'blueprint-poi-node',
              'blueprint-water-hatch',
              'services', 'shopping', 'sidewalk-dot',
              'sidewalk-dot-dark',
              'siegfried-dark-forest', 'siegfried-dark-glacier',
              'siegfried-dark-gravel', 'siegfried-dark-orchard',
              'siegfried-dark-paper-grain', 'siegfried-dark-rock',
              'siegfried-dark-scree', 'siegfried-dark-water-lines',
              'siegfried-dark-wetland',
              'siegfried-forest', 'siegfried-glacier', 'siegfried-gravel',
              'siegfried-orchard', 'siegfried-paper-grain', 'siegfried-rock',
              'siegfried-scree', 'siegfried-water-lines', 'siegfried-wetland',
              'soundings-boat-hoist', 'soundings-boatyard',
              'soundings-buoy-cardinal', 'soundings-buoy-pillar', 'soundings-buoy-port',
              'soundings-buoy-starboard', 'soundings-distance-mark', 'soundings-facility',
              'soundings-fuel-station', 'soundings-harbor', 'soundings-light-flare',
              'soundings-lighthouse', 'soundings-marina', 'soundings-notice',
              'soundings-notice-information', 'soundings-notice-prohibition',
              'soundings-notice-recommendation', 'soundings-notice-regulation',
              'soundings-notice-restriction', 'soundings-paper-grain', 'soundings-pump-out',
              'soundings-rock-awash', 'soundings-slipway', 'soundings-visitor-berth',
              'soundings-water-dots', 'soundings-water-tap', 'soundings-wreck',
              ...${JSON.stringify(streetsPoiImageIds)},
              ],
            sprite: '/tileflow/test/official/sprite',
          },
        },
      });
      if (style.metadata['tileflow:map'] !== id) process.exit(3);
      if (!style.layers.length) process.exit(4);
    }
    if ('extends' in maps.civica || 'root' in maps.civica) process.exit(33);
    if ('extends' in maps.baedeker || 'root' in maps.baedeker) process.exit(29);
    if ('extends' in maps.blueprint || 'root' in maps.blueprint) process.exit(31);
    if (!maps.streetsThemes?.light || !maps.streetsThemes?.dark) process.exit(7);
    if (maps.streets.defaultTheme !== 'light') process.exit(11);
    if (!maps.siegfriedThemes?.light || !maps.siegfriedThemes?.dark) process.exit(12);
    if (
      maps.siegfried.defaultTheme !== 'light' ||
      maps.siegfried.systemThemes?.light !== 'light' ||
      maps.siegfried.systemThemes?.dark !== 'dark'
    ) process.exit(13);
    if ('extends' in maps.map1777 || 'root' in maps.map1777) process.exit(8);
    if ('extends' in maps.siegfried || 'root' in maps.siegfried) process.exit(25);
    if ('extends' in maps.soundings || 'root' in maps.soundings) process.exit(22);
    const resolvedBaedeker = core.resolveMap(maps.baedeker);
    if (
      resolvedBaedeker.icons?.length !== 1 ||
      resolvedBaedeker.icons[0]?.kind !== 'package-directory' ||
      resolvedBaedeker.icons[0]?.package !== '@tileflow/maps' ||
      resolvedBaedeker.icons[0]?.path !== 'assets/baedeker/icons' ||
      resolvedBaedeker.fonts?.length !== 1 ||
      resolvedBaedeker.fonts[0]?.kind !== 'package-directory' ||
      resolvedBaedeker.fonts[0]?.package !== '@tileflow/maps' ||
      resolvedBaedeker.fonts[0]?.path !== 'assets/baedeker/fonts' ||
      maps.baedekerIcons?.kind !== 'package-directory' ||
      maps.baedekerIcons?.package !== '@tileflow/maps' ||
      maps.baedekerIcons?.path !== 'assets/baedeker/icons' ||
      maps.baedekerFonts?.kind !== 'package-directory' ||
      maps.baedekerFonts?.package !== '@tileflow/maps' ||
      maps.baedekerFonts?.path !== 'assets/baedeker/fonts'
    ) process.exit(30);
    const resolvedCivica = core.resolveMap(maps.civica);
    if (
      resolvedCivica.icons?.length !== 1 ||
      resolvedCivica.icons[0]?.kind !== 'package-directory' ||
      resolvedCivica.icons[0]?.package !== '@tileflow/maps' ||
      resolvedCivica.icons[0]?.path !== 'assets/civica/icons' ||
      resolvedCivica.fonts?.length !== 1 ||
      resolvedCivica.fonts[0]?.kind !== 'package-directory' ||
      resolvedCivica.fonts[0]?.package !== '@tileflow/maps' ||
      resolvedCivica.fonts[0]?.path !== 'assets/civica/fonts' ||
      maps.civicaIcons?.path !== 'assets/civica/icons' ||
      maps.civicaFonts?.path !== 'assets/civica/fonts'
    ) process.exit(34);
    const resolved1777 = core.resolveMap(maps.map1777);
    if (
      resolved1777.icons?.length !== 1 ||
      resolved1777.icons[0]?.kind !== 'package-directory' ||
      resolved1777.icons[0]?.package !== '@tileflow/maps' ||
      resolved1777.icons[0]?.path !== 'assets/map-1777/icons' ||
      resolved1777.fonts?.[0]?.path !== 'assets/map-1777/fonts' ||
      maps.map1777Fonts?.path !== 'assets/map-1777/fonts'
    ) process.exit(9);
    const resolvedSoundings = core.resolveMap(maps.soundings);
    if (
      resolvedSoundings.icons?.length !== 1 ||
      resolvedSoundings.icons[0]?.kind !== 'package-directory' ||
      resolvedSoundings.icons[0]?.package !== '@tileflow/maps' ||
      resolvedSoundings.icons[0]?.path !== 'assets/soundings/icons'
    ) process.exit(23);
    if (
      maps.soundingsIcons?.kind !== 'package-directory' ||
      maps.soundingsIcons?.package !== '@tileflow/maps' ||
      maps.soundingsIcons?.path !== 'assets/soundings/icons'
    ) process.exit(24);
    const resolvedBlueprint = core.resolveMap(maps.blueprint);
    if (
      resolvedBlueprint.icons?.length !== 1 ||
      resolvedBlueprint.icons[0]?.kind !== 'package-directory' ||
      resolvedBlueprint.icons[0]?.package !== '@tileflow/maps' ||
      resolvedBlueprint.icons[0]?.path !== 'assets/blueprint/icons' ||
      maps.blueprintIcons?.kind !== 'package-directory' ||
      maps.blueprintIcons?.package !== '@tileflow/maps' ||
      maps.blueprintIcons?.path !== 'assets/blueprint/icons'
    ) process.exit(32);
    const resolvedSiegfried = core.resolveMap(maps.siegfried);
    if (
      resolvedSiegfried.icons?.length !== 1 ||
      resolvedSiegfried.icons[0]?.kind !== 'package-directory' ||
      resolvedSiegfried.icons[0]?.package !== '@tileflow/maps' ||
      resolvedSiegfried.icons[0]?.path !== 'assets/siegfried/icons' ||
      resolvedSiegfried.fonts?.length !== 1 ||
      resolvedSiegfried.fonts[0]?.kind !== 'package-directory' ||
      resolvedSiegfried.fonts[0]?.package !== '@tileflow/maps' ||
      resolvedSiegfried.fonts[0]?.path !== 'assets/siegfried/fonts'
    ) process.exit(26);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
