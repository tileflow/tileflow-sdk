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
      'services.svg',
      'shopping.svg',
      'sidewalk-dot.svg',
    ],
    'streets-dark': ['sidewalk-dot.svg'],
    verdant: [
      'crosswalk.svg',
      'culture.svg',
      'education.svg',
      'health.svg',
      'major-transit.svg',
      'verdant-crop-rows.pattern.svg',
      'verdant-sidewalk.pattern.svg',
      'verdant-wetland-ripples.pattern.svg',
      'verdant-wood-stipple.pattern.svg',
      'verdant-xylem.pattern.svg',
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
    new URL('../assets/streets-dark/icons/sidewalk-dot.svg', import.meta.url),
    'utf8',
  );
  assert.notEqual(darkSidewalkDot, lightSidewalkDot);
  assert.match(darkSidewalkDot, /fill="#536177"/u);

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
});

test('imports and compiles all packaged official maps against public Core APIs', async () => {
  const script = `
    const core = await import('@tileflow/core');
    const maps = await import('@tileflow/maps');
    for (const [name, id] of [
      ['streets', 'streets'],
      ['streetsDark', 'streets-dark'],
      ['cyberpunk', 'cyberpunk'],
      ['ferraris', 'ferraris'],
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
              'major-transit', 'oneway', 'services', 'shopping', 'sidewalk-dot',
              'verdant-crop-rows', 'verdant-sidewalk', 'verdant-wetland-ripples',
              'verdant-wood-stipple', 'verdant-xylem',
            ],
            sprite: '/tileflow/test/official/sprite',
          },
        },
      });
      if (style.metadata['tileflow:map'] !== id) process.exit(3);
      if (!style.layers.length) process.exit(4);
    }
    if (maps.cyberpunk.extends !== maps.streets) process.exit(5);
    if (maps.verdant.extends !== maps.streets) process.exit(6);
    if (maps.streetsDark.extends !== maps.streets) process.exit(7);
    if ('extends' in maps.ferraris || maps.ferraris.root?.compiler !== 'streets') process.exit(8);
    const resolvedFerraris = core.resolveMap(maps.ferraris);
    if (
      resolvedFerraris.icons?.length !== 1 ||
      resolvedFerraris.icons[0]?.kind !== 'package-directory' ||
      resolvedFerraris.icons[0]?.package !== '@tileflow/maps' ||
      resolvedFerraris.icons[0]?.path !== 'assets/ferraris/icons'
    ) process.exit(9);
    if (
      maps.streetsDarkIcons?.kind !== 'package-directory' ||
      maps.streetsDarkIcons?.package !== '@tileflow/maps' ||
      maps.streetsDarkIcons?.path !== 'assets/streets-dark/icons'
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
