import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

test('publishes official maps and their assets as one package', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    files: string[];
    peerDependencies: Record<string, string>;
  };

  assert.deepEqual(manifest.files, [
    'assets',
    'dist',
    'THIRD_PARTY_NOTICES.md',
    'LICENSE',
    'NOTICE',
    'GENERATED_OUTPUT_LICENSE.md',
    'TRADEMARKS.md',
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
    cyberpunk: [
      'cyber-circuit.pattern.svg',
      'cyber-data-grid.pattern.svg',
      'cyber-target-brackets.svg',
    ],
    ferraris: [
      'ferraris-crop-hatch.pattern.svg',
      'ferraris-heath.pattern.svg',
      'ferraris-orchard.pattern.svg',
      'ferraris-paper-grain.pattern.svg',
      'ferraris-residential.pattern.svg',
      'ferraris-sand.pattern.svg',
      'ferraris-water-ripples.pattern.svg',
      'ferraris-wetland.pattern.svg',
      'ferraris-woodland.pattern.svg',
    ],
    harad: [
      'harad-arable.pattern.svg',
      'harad-conifer.pattern.svg',
      'harad-deciduous.pattern.svg',
      'harad-orchard.pattern.svg',
      'harad-paper-grain.pattern.svg',
      'harad-sand.pattern.svg',
      'harad-settlement.pattern.svg',
      'harad-water-lines.pattern.svg',
      'harad-wetland.pattern.svg',
    ],
    matrix: [
      'matrix-crt-scanlines.pattern.svg',
      'matrix-data-grid.pattern.svg',
      'matrix-poi-node.svg',
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
      'soundings-buoy-cardinal.svg',
      'soundings-buoy-port.svg',
      'soundings-buoy-starboard.svg',
      'soundings-harbor.svg',
      'soundings-light-flare.svg',
      'soundings-lighthouse.svg',
      'soundings-paper-grain.pattern.svg',
      'soundings-rock-awash.svg',
      'soundings-water-dots.pattern.svg',
      'soundings-wreck.svg',
    ],
    streets: [
      'coffee.svg',
      'crosswalk.svg',
      'culture.svg',
      'education.svg',
      'food.svg',
      'health.svg',
      'lodging.svg',
      'major-transit.svg',
      'oneway.svg',
      'parking.svg',
      'road-shield-circle-neutral.svg',
      'road-shield-rectangle-blue.svg',
      'road-shield-rectangle-green.svg',
      'road-shield-rectangle-neutral.svg',
      'road-shield-rectangle-orange.svg',
      'road-shield-rectangle-red.svg',
      'road-shield-rectangle-yellow.svg',
      'services.svg',
      'shopping.svg',
      'sidewalk-dot-dark.svg',
      'sidewalk-dot.svg',
    ],
    verdant: [
      'coffee.svg',
      'crosswalk.svg',
      'culture.svg',
      'education.svg',
      'food.svg',
      'health.svg',
      'lodging.svg',
      'major-transit.svg',
      'services.svg',
      'shopping.svg',
      'verdant-field-hatch.pattern.svg',
      'verdant-forest-canopy.pattern.svg',
      'verdant-heath-tufts.pattern.svg',
      'verdant-meadow-tufts.pattern.svg',
      'verdant-orchard.pattern.svg',
      'verdant-paper-fiber.pattern.svg',
      'verdant-residential-hatch.pattern.svg',
      'verdant-scree.pattern.svg',
      'verdant-water-lines.pattern.svg',
      'verdant-wetland-reeds.pattern.svg',
    ],
  } as const;

  for (const [mapId, fileNames] of Object.entries(expected)) {
    assert.deepEqual(
      (await readdir(new URL(`../assets/${mapId}/icons/`, import.meta.url))).sort(),
      fileNames,
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
  assert.match(lightSidewalkDot, /fill="#C1C5D7"/u);
  assert.match(darkSidewalkDot, /fill="#525664"/u);

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
  assert.deepEqual((await readdir(new URL('../assets/cyberpunk/fonts/', import.meta.url))).sort(), [
    'LICENSE.txt',
    'Oxanium-Medium.ttf',
    'Oxanium-SemiBold.ttf',
    'README.md',
  ]);
  for (const font of ['Oxanium-Medium.ttf', 'Oxanium-SemiBold.ttf']) {
    assert.ok(
      (await readFile(new URL(`../assets/cyberpunk/fonts/${font}`, import.meta.url))).byteLength >
        20_000,
    );
  }
  assert.deepEqual((await readdir(new URL('../assets/matrix/fonts/', import.meta.url))).sort(), [
    'LICENSE.txt',
    'Oxanium-Medium.ttf',
    'Oxanium-SemiBold.ttf',
    'README.md',
  ]);
  for (const font of ['Oxanium-Medium.ttf', 'Oxanium-SemiBold.ttf']) {
    assert.ok(
      (await readFile(new URL(`../assets/matrix/fonts/${font}`, import.meta.url))).byteLength >
        20_000,
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
});

test('keeps the Härad standalone source independent from Streets', async () => {
  const source = await readFile(new URL('../src/official/harad.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
});

test('keeps the Verdant standalone source independent from Streets', async () => {
  const source = await readFile(new URL('../src/official/verdant.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
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

test('keeps Cyberpunk and Matrix independent from other official maps', async () => {
  const officialMapIds = new Set([
    'cyberpunk',
    'ferraris',
    'harad',
    'matrix',
    'siegfried',
    'soundings',
    'streets',
    'verdant',
  ]);
  for (const id of ['cyberpunk', 'matrix']) {
    const source = await readFile(new URL(`../src/official/${id}.ts`, import.meta.url), 'utf8');
    assert.match(source, /\bdefineMap\s*\(/u);
    for (const match of source.matchAll(/\bfrom\s+['"]\.\/([^'"]+)['"]/gu)) {
      assert.equal(officialMapIds.has(match[1]!), false, `${id} imports ${match[1]}`);
    }
  }
});

test('imports and compiles all packaged official maps against public Core APIs', async () => {
  const script = `
    const core = await import('@tileflow/core');
    const maps = await import('@tileflow/maps');
    for (const [name, id] of [
      ['streets', 'streets'],
      ['cyberpunk', 'cyberpunk'],
      ['ferraris', 'ferraris'],
      ['harad', 'harad'],
      ['matrix', 'matrix'],
      ['siegfried', 'siegfried'],
      ['soundings', 'soundings'],
      ['verdant', 'verdant'],
    ]) {
      if (!maps[name] || typeof maps[name] !== 'object') process.exit(2);
      const style = core.createStyle(maps[name], {
        preparedAssets: {
          icons: {
            ids: [
              'coffee', 'crosswalk', 'culture', 'cyber-circuit', 'cyber-data-grid',
              'cyber-target-brackets', 'education', 'food', 'health', 'lodging',
              'ferraris-crop-hatch', 'ferraris-heath', 'ferraris-orchard',
              'ferraris-paper-grain', 'ferraris-residential', 'ferraris-sand',
              'ferraris-water-ripples', 'ferraris-wetland', 'ferraris-woodland',
              'harad-arable', 'harad-conifer', 'harad-deciduous', 'harad-orchard',
              'harad-paper-grain', 'harad-sand', 'harad-settlement',
              'harad-water-lines', 'harad-wetland',
              'matrix-crt-scanlines', 'matrix-data-grid', 'matrix-poi-node',
              'major-transit', 'oneway', 'parking', 'road-shield-circle-neutral',
              'road-shield-rectangle-blue', 'road-shield-rectangle-green',
              'road-shield-rectangle-neutral', 'road-shield-rectangle-orange',
              'road-shield-rectangle-red', 'road-shield-rectangle-yellow',
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
              'soundings-buoy-cardinal', 'soundings-buoy-port',
              'soundings-buoy-starboard', 'soundings-harbor', 'soundings-light-flare',
              'soundings-lighthouse', 'soundings-paper-grain', 'soundings-rock-awash',
              'soundings-water-dots', 'soundings-wreck',
              'verdant-field-hatch', 'verdant-forest-canopy', 'verdant-heath-tufts',
              'verdant-meadow-tufts', 'verdant-orchard', 'verdant-paper-fiber',
              'verdant-residential-hatch', 'verdant-scree', 'verdant-water-lines',
              'verdant-wetland-reeds',
            ],
            sprite: '/tileflow/test/official/sprite',
          },
        },
      });
      if (style.metadata['tileflow:map'] !== id) process.exit(3);
      if (!style.layers.length) process.exit(4);
    }
    if ('extends' in maps.cyberpunk || 'root' in maps.cyberpunk) process.exit(5);
    if ('extends' in maps.matrix || 'root' in maps.matrix) process.exit(27);
    if ('extends' in maps.verdant || 'root' in maps.verdant) process.exit(6);
    if (!maps.streetsThemes?.light || !maps.streetsThemes?.dark) process.exit(7);
    if (maps.streets.defaultTheme !== 'light') process.exit(11);
    if (!maps.siegfriedThemes?.light || !maps.siegfriedThemes?.dark) process.exit(12);
    if (
      maps.siegfried.defaultTheme !== 'light' ||
      maps.siegfried.systemThemes?.light !== 'light' ||
      maps.siegfried.systemThemes?.dark !== 'dark'
    ) process.exit(13);
    if ('extends' in maps.ferraris || 'root' in maps.ferraris) process.exit(8);
    if ('extends' in maps.harad || 'root' in maps.harad) process.exit(20);
    if ('extends' in maps.siegfried || 'root' in maps.siegfried) process.exit(25);
    if ('extends' in maps.soundings || 'root' in maps.soundings) process.exit(22);
    const resolvedFerraris = core.resolveMap(maps.ferraris);
    if (
      resolvedFerraris.icons?.length !== 1 ||
      resolvedFerraris.icons[0]?.kind !== 'package-directory' ||
      resolvedFerraris.icons[0]?.package !== '@tileflow/maps' ||
      resolvedFerraris.icons[0]?.path !== 'assets/ferraris/icons'
    ) process.exit(9);
    const resolvedHarad = core.resolveMap(maps.harad);
    if (
      resolvedHarad.icons?.length !== 1 ||
      resolvedHarad.icons[0]?.kind !== 'package-directory' ||
      resolvedHarad.icons[0]?.package !== '@tileflow/maps' ||
      resolvedHarad.icons[0]?.path !== 'assets/harad/icons'
    ) process.exit(21);
    const resolvedMatrix = core.resolveMap(maps.matrix);
    if (
      resolvedMatrix.icons?.length !== 1 ||
      resolvedMatrix.icons[0]?.kind !== 'package-directory' ||
      resolvedMatrix.icons[0]?.package !== '@tileflow/maps' ||
      resolvedMatrix.icons[0]?.path !== 'assets/matrix/icons' ||
      resolvedMatrix.fonts?.length !== 1 ||
      resolvedMatrix.fonts[0]?.path !== 'assets/matrix/fonts'
    ) process.exit(28);
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
    const resolvedVerdant = core.resolveMap(maps.verdant);
    if (
      resolvedVerdant.icons?.length !== 1 ||
      resolvedVerdant.icons[0]?.kind !== 'package-directory' ||
      resolvedVerdant.icons[0]?.package !== '@tileflow/maps' ||
      resolvedVerdant.icons[0]?.path !== 'assets/verdant/icons'
    ) process.exit(10);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
