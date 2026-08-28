import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  assertTileflowVisualRegionFits,
  parseTileflowVisualCompareZooms,
  parseTileflowVisualRegion,
  type TileflowVisualCompareJsonV1,
} from '../src/visual-compare-command';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

test('visual compare zoom matrix is explicit, bounded, unique, and deterministic', () => {
  assert.deepEqual(parseTileflowVisualCompareZooms('6.5', undefined), [6.5]);
  assert.deepEqual(parseTileflowVisualCompareZooms(undefined, '12, 3.5,8'), [3.5, 8, 12]);
  assert.throws(() => parseTileflowVisualCompareZooms(undefined, undefined), /exactly one/u);
  assert.throws(() => parseTileflowVisualCompareZooms('2', '3'), /exactly one/u);
  assert.throws(() => parseTileflowVisualCompareZooms(undefined, '2,2'), /unique/u);
  assert.throws(() => parseTileflowVisualCompareZooms(undefined, '2,'), /finite number/u);
  assert.throws(() => parseTileflowVisualCompareZooms('-1', undefined), /between 0 and 24/u);
  assert.throws(() => parseTileflowVisualCompareZooms('25', undefined), /between 0 and 24/u);
  assert.throws(
    () =>
      parseTileflowVisualCompareZooms(
        undefined,
        Array.from({length: 17}, (_, value) => String(value)).join(','),
      ),
    /between 1 and 16 zooms/u,
  );
});

test('visual analysis regions use bounded physical-pixel rectangles', () => {
  const region = parseTileflowVisualRegion(' 4, 8, 20, 10 ');
  assert.deepEqual(region, {x: 4, y: 8, width: 20, height: 10});
  assert.doesNotThrow(() =>
    assertTileflowVisualRegionFits(region, {width: 24, height: 18}, 'test image'),
  );
  assert.throws(() => parseTileflowVisualRegion('0,0,1'), /four comma-separated integers/u);
  assert.throws(() => parseTileflowVisualRegion('0,0,1.5,1'), /four comma-separated integers/u);
  assert.throws(() => parseTileflowVisualRegion('-1,0,1,1'), /non-negative x\/y/u);
  assert.throws(() => parseTileflowVisualRegion('0,0,0,1'), /positive width\/height/u);
  assert.throws(
    () => assertTileflowVisualRegionFits(region, {width: 23, height: 18}, 'test image'),
    /fit within the test image physical dimensions \(23x18\)/u,
  );
});

test('visual compare help and preflight fail before config or browser work', async (t) => {
  const cwd = await createFixture(t, 'tileflow-visual-compare-preflight-');
  const help = await runCli(cwd, ['visual', 'compare', '--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /--against-config <path>/u);
  assert.match(help.stdout, /--against-theme <name>/u);
  assert.match(help.stdout, /--zooms <numbers>/u);
  assert.match(help.stdout, /--region <x,y,width,height>/u);
  assert.match(help.stdout, /--allow-data-mismatch/u);
  assert.match(help.stdout, /--watch/u);
  assert.match(help.stdout, /--open/u);

  const common = [
    'visual',
    'compare',
    '--config',
    'missing-left.ts',
    '--against-config',
    'missing-right.ts',
    '--center',
    '0,0',
    '--no-browser-install',
  ];
  const noZoom = await runCli(cwd, common);
  assert.equal(noZoom.code, 1);
  assert.match(noZoom.stderr, /exactly one of --zoom or --zooms/u);
  assert.doesNotMatch(noZoom.stderr, /browser|chromium/u);

  const jsonFailure = await runCli(cwd, [...common, '--json']);
  assert.equal(jsonFailure.code, 1);
  assert.equal(jsonFailure.stdout, '');
  assert.deepEqual(JSON.parse(jsonFailure.stderr), {
    schemaVersion: 1,
    command: 'visual.compare',
    status: 'failed',
    code: 'INVALID_ARGUMENT',
    phase: 'input-validation',
    diagnostics: [
      {
        message: 'Choose exactly one of --zoom or --zooms.',
        path: '',
      },
    ],
  });

  const aggregate = await runCli(cwd, [
    ...common,
    '--zooms',
    '1,2,3',
    '--width',
    '4096',
    '--height',
    '4096',
  ]);
  assert.equal(aggregate.code, 1);
  assert.match(aggregate.stderr, /aggregate physical-pixel limit/u);
  assert.doesNotMatch(aggregate.stderr, /missing-left|browser|chromium/u);

  const invalidRegion = await runCli(cwd, [...common, '--zoom', '2', '--region', '0,0,10.5,10']);
  assert.equal(invalidRegion.code, 1);
  assert.match(invalidRegion.stderr, /--region expects.*integers/u);
  assert.doesNotMatch(invalidRegion.stderr, /missing-left|browser|chromium/u);

  const outsideViewport = await runCli(cwd, [
    ...common,
    '--zoom',
    '2',
    '--width',
    '64',
    '--height',
    '64',
    '--dpr',
    '2',
    '--region',
    '120,120,9,8',
  ]);
  assert.equal(outsideViewport.code, 1);
  assert.match(outsideViewport.stderr, /physical dimensions \(128x128\)/u);
  assert.doesNotMatch(outsideViewport.stderr, /missing-left|browser|chromium/u);

  await mkdir(join(cwd, 'evidence'));
  await writeFile(join(cwd, 'evidence/review.html'), 'preserve me');
  const existing = await runCli(cwd, [
    ...common,
    '--zoom',
    '2',
    '--report',
    'evidence/review.html',
  ]);
  assert.equal(existing.code, 1);
  assert.match(existing.stderr, /already exists.*--force/u);
  assert.equal(await readFile(join(cwd, 'evidence/review.html'), 'utf8'), 'preserve me');
  assert.doesNotMatch(existing.stderr, /missing-left|browser|chromium/u);

  await mkdir(join(cwd, 'real-output'));
  await symlink(join(cwd, 'real-output'), join(cwd, 'linked-output'));
  const linked = await runCli(cwd, [
    ...common,
    '--zoom',
    '2',
    '--report',
    'linked-output/review.html',
  ]);
  assert.equal(linked.code, 1);
  assert.match(linked.stderr, /symbolic link/u);
  assert.doesNotMatch(linked.stderr, /missing-left|browser|chromium/u);

  const unsafeWatch = await runCli(cwd, [
    ...common,
    '--zoom',
    '2',
    '--report',
    'evidence/watch.html',
    '--watch',
  ]);
  assert.equal(unsafeWatch.code, 1);
  assert.match(unsafeWatch.stderr, /--watch requires --force/u);
});

test('visual compare rejects canonical input clobber and asset-directory overlap with --force', async (t) => {
  const cwd = await createFixture(t, 'tileflow-visual-compare-clobber-');
  await mkdir(join(cwd, 'evidence'));
  const source = '{"marker":"preserve"}\n';
  await writeFile(join(cwd, 'evidence/review.json'), source);
  await symlink(join(cwd, 'evidence/review.json'), join(cwd, 'comparison-input.json'));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    tileflowMapFixture({
      data: 'fixture',
      id: 'main',
      imports: `import comparisonInput from './comparison-input.json';`,
      setup: `if (comparisonInput.marker !== 'preserve') throw new Error('fixture input changed');`,
    }),
  );

  const common = [
    'visual',
    'compare',
    '--config',
    'tileflow.config.ts',
    '--against-config',
    'tileflow.config.ts',
    '--center',
    '0,0',
    '--zoom',
    '1',
    '--force',
    '--json',
    '--no-browser-install',
  ];
  const clobber = await runCli(cwd, [...common, '--report', 'evidence/review.html']);
  assert.equal(clobber.code, 1);
  assert.equal(clobber.stdout, '');
  assert.match(clobber.stderr, /output overlaps a config input/u);
  assert.equal(await readFile(join(cwd, 'evidence/review.json'), 'utf8'), source);

  const assetDirectory = join(cwd, 'evidence/asset-overlap.assets');
  await mkdir(assetDirectory);
  const nestedConfig = tileflowMapFixture({data: 'fixture', id: 'nested'});
  await writeFile(join(assetDirectory, 'tileflow.config.ts'), nestedConfig);
  const overlap = await runCli(cwd, [
    ...common.slice(0, 2),
    '--config',
    'evidence/asset-overlap.assets/tileflow.config.ts',
    '--against-config',
    'evidence/asset-overlap.assets/tileflow.config.ts',
    '--center',
    '0,0',
    ...common.slice(8),
    '--report',
    'evidence/asset-overlap.html',
  ]);
  assert.equal(overlap.code, 1);
  assert.equal(overlap.stdout, '');
  assert.match(overlap.stderr, /output overlaps a config input/u);
  assert.equal(await readFile(join(assetDirectory, 'tileflow.config.ts'), 'utf8'), nestedConfig);
});

test('visual compare watch reports initially invalid configs without launching a browser', async (t) => {
  const cwd = await createFixture(t, 'tileflow-visual-compare-initial-invalid-');
  await writeFile(join(cwd, 'left.config.ts'), 'export default {broken: true};\n');
  await writeFile(join(cwd, 'right.config.ts'), 'export default {alsoBroken: true};\n');
  const running = startCli(cwd, [
    'visual',
    'compare',
    '--config',
    'left.config.ts',
    '--against-config',
    'right.config.ts',
    '--center',
    '0,0',
    '--zoom',
    '1',
    '--theme',
    'light',
    '--against-theme',
    'dark',
    '--report',
    'evidence/watch.html',
    '--force',
    '--watch',
    '--json',
    '--no-browser-install',
  ]);
  t.after(() => running.stop());

  const watching = await running.waitFor((event) => event.event === 'watching', 15_000);
  assert.match(String(watching.left), /singular map \/ light/u);
  assert.match(String(watching.right), /singular map \/ dark/u);
  const invalid = await running.waitFor((event) => event.event === 'invalid', 15_000);
  assert.match(String(invalid.side), /left|right/u);
  assert.equal(JSON.stringify(running.events).includes(cwd), false);
  running.requestStop();
  await running.waitFor((event) => event.event === 'stopped', 15_000);
  const completion = await running.completion;
  assert.equal(completion.code, 1, completion.stderr);
  assert.doesNotMatch(completion.stderr, /browser|chromium/u);
});

test(
  'visual compare captures a synchronized matrix into one offline review transaction',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async (t) => {
    const cwd = await createFixture(t, 'tileflow-visual-compare-');
    const tiles = await createVectorFixtureServer(t);
    await writeFile(join(cwd, 'left.config.ts'), compareConfig('left', '#f1ead7', tiles.origin));
    await writeFile(join(cwd, 'right.config.ts'), compareConfig('right', '#263b35', tiles.origin));

    const result = await runCli(cwd, [
      'visual',
      'compare',
      '--config',
      'left.config.ts',
      '--map',
      'left',
      '--theme',
      'light',
      '--against-config',
      'right.config.ts',
      '--against-map',
      'right',
      '--against-theme',
      'light',
      '--center',
      '0,0',
      '--zooms',
      '2,0',
      '--width',
      '64',
      '--height',
      '64',
      '--region',
      '0,0,32,32',
      '--diff',
      '--report',
      'evidence/review.html',
      '--json',
      '--no-browser-install',
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout) as TileflowVisualCompareJsonV1;
    assert.equal(document.schemaVersion, 1);
    assert.equal(document.command, 'visual.compare');
    assert.deepEqual(
      document.rows.map(({zoom}) => zoom),
      [0, 2],
    );
    assert.equal(document.left.map, 'left');
    assert.equal(document.left.theme, 'light');
    assert.equal(document.right.map, 'right');
    assert.equal(document.right.theme, 'light');
    assert.equal(
      document.rows.every(({review}) => review.status === 'comparable'),
      true,
    );
    assert.equal(
      document.rows.every(({review}) => review.frameMatch && review.dataMatch),
      true,
    );
    assert.equal(
      document.rows.every(({review}) => (review.exact?.changedPixels ?? 0) > 0),
      true,
    );
    assert.equal(
      document.rows.every(
        ({review}) =>
          review.appearance?.region.x === 0 &&
          review.appearance.region.y === 0 &&
          review.appearance.region.width === 32 &&
          review.appearance.region.height === 32 &&
          review.appearance.rightMinusLeft.linearLuminance.mean < 0,
      ),
      true,
    );
    assert.equal(
      document.rows.every(({artifacts}) => artifacts.diffPath !== null),
      true,
    );
    assert.equal(result.stdout.includes(cwd), false);
    assert.equal(await readFile(join(cwd, document.artifacts.documentPath), 'utf8'), result.stdout);

    for (const row of document.rows) {
      for (const path of [
        row.artifacts.leftPath,
        row.artifacts.rightPath,
        row.artifacts.diffPath!,
      ]) {
        assert.deepEqual(
          [...(await readFile(join(cwd, path))).subarray(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
        );
      }
      for (const path of [row.artifacts.leftReceiptPath, row.artifacts.rightReceiptPath]) {
        const receipt = JSON.parse(await readFile(join(cwd, path), 'utf8')) as {
          schemaVersion: number;
          scene: {theme: string};
        };
        assert.equal(receipt.schemaVersion, 4);
        assert.equal(receipt.scene.theme, 'light');
      }
    }

    const html = await readFile(join(cwd, document.artifacts.reportPath), 'utf8');
    assert.match(html, /Content-Security-Policy/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /data:image\/png;base64,/u);
    assert.match(html, /data-mode="wipe"/u);
    assert.match(html, /data-mode="overlay"/u);
    assert.match(html, /data-mode="blink"/u);

    const assetDirectory = join(cwd, 'evidence/review.assets');
    await writeFile(join(assetDirectory, 'foreign.txt'), 'preserve foreign asset\n');
    const narrowed = await runCli(cwd, [
      'visual',
      'compare',
      '--config',
      'left.config.ts',
      '--against-config',
      'right.config.ts',
      '--center',
      '0,0',
      '--zoom',
      '0',
      '--width',
      '64',
      '--height',
      '64',
      '--report',
      'evidence/review.html',
      '--force',
      '--json',
      '--no-browser-install',
    ]);
    assert.equal(narrowed.code, 0, narrowed.stderr);
    assert.deepEqual((await readdir(assetDirectory)).sort(), [
      '.tileflow-visual-compare.json',
      '01-z0.left.png',
      '01-z0.left.receipt.json',
      '01-z0.right.png',
      '01-z0.right.receipt.json',
      'foreign.txt',
    ]);
    assert.equal(
      await readFile(join(assetDirectory, 'foreign.txt'), 'utf8'),
      'preserve foreign asset\n',
    );
    const inventory = JSON.parse(
      await readFile(join(assetDirectory, '.tileflow-visual-compare.json'), 'utf8'),
    ) as {assets: Array<{path: string}>; kind: string; schemaVersion: number};
    assert.equal(inventory.schemaVersion, 1);
    assert.equal(inventory.kind, 'tileflow-visual-compare-assets');
    assert.deepEqual(
      inventory.assets.map(({path}) => path),
      ['01-z0.left.png', '01-z0.left.receipt.json', '01-z0.right.png', '01-z0.right.receipt.json'],
    );
    const modifiedAssetPath = join(assetDirectory, '01-z0.left.png');
    const modifiedAsset = Buffer.from('foreign modification');
    await writeFile(modifiedAssetPath, modifiedAsset);
    const rejectedModifiedInventory = await runCli(cwd, [
      'visual',
      'compare',
      '--config',
      'left.config.ts',
      '--against-config',
      'right.config.ts',
      '--center',
      '0,0',
      '--zoom',
      '2',
      '--report',
      'evidence/review.html',
      '--force',
      '--json',
      '--no-browser-install',
    ]);
    assert.equal(rejectedModifiedInventory.code, 1);
    assert.equal(rejectedModifiedInventory.stdout, '');
    assert.match(rejectedModifiedInventory.stderr, /previously managed.*modified/u);
    assert.deepEqual(await readFile(modifiedAssetPath), modifiedAsset);
    assert.equal(
      await readFile(join(assetDirectory, 'foreign.txt'), 'utf8'),
      'preserve foreign asset\n',
    );

    await writeFile(
      join(cwd, 'right.config.ts'),
      compareConfig('right', '#263b35', tiles.origin, 'cli-fixture-v2'),
    );
    const mismatchArguments = [
      'visual',
      'compare',
      '--config',
      'left.config.ts',
      '--against-config',
      'right.config.ts',
      '--center',
      '0,0',
      '--zoom',
      '1',
      '--width',
      '64',
      '--height',
      '64',
      '--report',
      'mismatch/review.html',
      '--json',
      '--no-browser-install',
    ];
    const rejectedMismatch = await runCli(cwd, mismatchArguments);
    assert.equal(rejectedMismatch.code, 1, rejectedMismatch.stderr);
    const mismatchDocument = JSON.parse(rejectedMismatch.stdout) as TileflowVisualCompareJsonV1;
    assert.equal(mismatchDocument.rows[0]?.review.status, 'data-mismatch');
    assert.equal(mismatchDocument.rows[0]?.review.exact, null);
    assert.equal(mismatchDocument.rows[0]?.artifacts.diffPath, null);
    assert.equal(
      (await readFile(join(cwd, mismatchDocument.artifacts.reportPath), 'utf8')).length > 0,
      true,
    );

    const allowedMismatch = await runCli(cwd, [
      ...mismatchArguments,
      '--allow-data-mismatch',
      '--force',
    ]);
    assert.equal(allowedMismatch.code, 0, allowedMismatch.stderr);
    assert.equal(
      (JSON.parse(allowedMismatch.stdout) as TileflowVisualCompareJsonV1).rows[0]?.review.status,
      'data-mismatch',
    );
  },
);

test(
  'visual compare watch preserves last-good output through invalid edits and recovers',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
  async (t) => {
    const cwd = await createFixture(t, 'tileflow-visual-compare-watch-');
    const tiles = await createVectorFixtureServer(t);
    await mkdir(join(cwd, 'evidence'));
    const leftPath = join(cwd, 'left.config.ts');
    // A config may deliberately live beside the report. Only the exact managed outputs are
    // ignored; ignoring the complete report directory would make this side silently stop.
    const rightPath = join(cwd, 'evidence/right.config.ts');
    await writeFile(leftPath, compareConfig('left', '#f1ead7', tiles.origin));
    await writeFile(rightPath, compareConfig('right', '#263b35', tiles.origin));
    const running = startCli(cwd, [
      'visual',
      'compare',
      '--config',
      'left.config.ts',
      '--against-config',
      'evidence/right.config.ts',
      '--center',
      '0,0',
      '--zoom',
      '1',
      '--width',
      '64',
      '--height',
      '64',
      '--diff',
      '--allow-data-mismatch',
      '--report',
      'evidence/watch.html',
      '--force',
      '--watch',
      '--json',
      '--no-browser-install',
    ]);
    t.after(() => running.stop());

    await running.waitFor((event) => event.event === 'watching', 30_000);
    const first = await running.waitFor((event) => event.event === 'generation-complete', 45_000);
    const reportPath = join(cwd, String(first.reportPath));
    const firstReport = await readFile(reportPath);
    const diffPath = join(cwd, 'evidence/watch.assets/01-z1.diff.png');
    assert.equal((await readFile(diffPath)).byteLength > 0, true);

    await writeFile(rightPath, 'export default {broken: true};\n');
    const invalid = await running.waitFor((event) => event.event === 'invalid', 30_000);
    assert.equal(invalid.side, 'right');
    assert.deepEqual(await readFile(reportPath), firstReport);

    await writeFile(rightPath, compareConfig('right', '#4b2638', tiles.origin));
    await running.waitFor((event) => event.event === 'recovered', 30_000);
    const second = await running.waitFor(
      (event) =>
        event.event === 'generation-complete' &&
        Number(event.generation) > Number(first.generation),
      45_000,
    );
    assert.equal(second.reportPath, first.reportPath);
    assert.equal(JSON.stringify(running.events).includes(cwd), false);

    await writeFile(rightPath, compareConfig('right', '#4b2638', tiles.origin, 'cli-fixture-v2'));
    await running.waitFor(
      (event) =>
        event.event === 'generation-complete' &&
        Number(event.generation) > Number(second.generation),
      45_000,
    );
    await assert.rejects(readFile(diffPath), {code: 'ENOENT'});
    const inventory = JSON.parse(
      await readFile(join(cwd, 'evidence/watch.assets/.tileflow-visual-compare.json'), 'utf8'),
    ) as {assets: Array<{path: string}>};
    assert.equal(
      inventory.assets.some(({path}) => path.endsWith('.diff.png')),
      false,
    );

    running.requestStop();
    await running.waitFor((event) => event.event === 'stopped', 30_000);
    const completion = await running.completion;
    assert.equal(completion.code, 0, completion.stderr);
  },
);

test(
  'visual compare same-config watch clears both invalid sides without phantom recovery',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
  async (t) => {
    const cwd = await createFixture(t, 'tileflow-visual-compare-same-watch-');
    const tiles = await createVectorFixtureServer(t);
    const configPath = join(cwd, 'shared.config.ts');
    await writeFile(configPath, compareConfig('shared', '#24384a', tiles.origin));
    const running = startCli(cwd, [
      'visual',
      'compare',
      '--config',
      'shared.config.ts',
      '--against-config',
      'shared.config.ts',
      '--center',
      '0,0',
      '--zoom',
      '1',
      '--width',
      '64',
      '--height',
      '64',
      '--report',
      'evidence/same-watch.html',
      '--force',
      '--watch',
      '--json',
      '--no-browser-install',
    ]);
    t.after(() => running.stop());

    const first = await running.waitFor((event) => event.event === 'generation-complete', 45_000);
    await writeFile(configPath, 'export default {broken: true};\n');
    const invalid = await running.waitFor(
      (event) => event.event === 'invalid' && event.side === 'both',
      30_000,
    );
    await writeFile(configPath, compareConfig('shared', '#4a2438', tiles.origin));
    const recovered = await running.waitFor(
      (event) =>
        event.event === 'recovered' &&
        event.side === 'both' &&
        Number(event.sourceGeneration) > Number(invalid.sourceGeneration),
      30_000,
    );
    const second = await running.waitFor(
      (event) =>
        event.event === 'generation-complete' &&
        Number(event.generation) > Number(first.generation),
      45_000,
    );
    assert.ok(Number(recovered.sourceGeneration) > Number(invalid.sourceGeneration));

    const nextEventIndex = running.events.length;
    await writeFile(configPath, compareConfig('shared', '#385124', tiles.origin));
    await running.waitFor(
      (event) =>
        event.event === 'generation-complete' &&
        Number(event.generation) > Number(second.generation),
      45_000,
    );
    assert.equal(
      running.events
        .slice(nextEventIndex)
        .some((event) => event.event === 'recovered' && event.side === 'both'),
      false,
    );

    running.requestStop();
    await running.waitFor((event) => event.event === 'stopped', 30_000);
    const completion = await running.completion;
    assert.equal(completion.code, 0, completion.stderr);
  },
);

function compareConfig(
  id: string,
  background: string,
  origin: string,
  revision = 'cli-fixture-v1',
): string {
  return tileflowMapFixture({
    data: 'fixture',
    id,
    imports: `import {defineTheme} from '@tileflow/core';
import {streetsThemes} from '@tileflow/maps';`,
    fields: `modules: {
  addresses: disable(),
  aeroways: disable(),
  boundaries: disable(),
  buildings: disable(),
  labels: disable(),
  land: {type: 'land'},
  landforms: disable(),
  poi: disable(),
  roads: disable(),
  transit: disable(),
  vegetation: disable(),
  water: disable()
},
defaultTheme: 'light',
themes: {light: defineTheme(streetsThemes.light, {
  id: ${JSON.stringify(`${id}-light`)},
  version: 1,
  colorScheme: 'light',
  tokens: {color: {'surface.background': ${JSON.stringify(background)}, 'surface.land': ${JSON.stringify(background)}}}
})}`,
  })
    .replace('https://tiles.example.invalid', origin)
    .replace('cli-fixture-v1', revision);
}

async function createFixture(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(directory);
  t.after(() => rm(directory, {force: true, maxRetries: 5, recursive: true}));
  return directory;
}

async function createVectorFixtureServer(t: TestContext): Promise<{origin: string}> {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if ((request.url?.split('?')[0] ?? '/').endsWith('.pbf')) {
      response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
      response.end(Buffer.alloc(0));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  return {origin: `http://127.0.0.1:${address.port}`};
}

function runCli(
  cwd: string,
  arguments_: string[],
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const child = spawnCli(cwd, arguments_, false);
  let stderr = '';
  let stdout = '';
  child.stderr!.setEncoding('utf8');
  child.stdout!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
  });
  return new Promise((resolveResult, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolveResult({code, stderr, stdout}));
  });
}

function startCli(cwd: string, arguments_: string[]) {
  const child = spawnCli(cwd, arguments_, true);
  const events: Array<Record<string, unknown>> = [];
  const waiters = new Set<{
    predicate: (event: Record<string, unknown>) => boolean;
    reject: (error: Error) => void;
    resolve: (event: Record<string, unknown>) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let stdoutBuffer = '';
  let stderr = '';
  child.stderr!.setEncoding('utf8');
  child.stdout!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout!.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line) as Record<string, unknown>;
      events.push(event);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(event)) continue;
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  });
  const completion = new Promise<{code: number | null; stderr: string}>((resolveCompletion) => {
    child.on('close', (code) => resolveCompletion({code, stderr}));
  });
  const requestStop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) {
      try {
        child.send({type: 'tileflow:stop'}, (error) => {
          if (error && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
          }
        });
        return;
      } catch {
        child.kill('SIGTERM');
        return;
      }
    }
    child.kill('SIGTERM');
  };
  return {
    completion,
    events,
    requestStop,
    stop: async () => {
      requestStop();
      await completion;
    },
    waitFor: (
      predicate: (event: Record<string, unknown>) => boolean,
      timeoutMs: number,
    ): Promise<Record<string, unknown>> => {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveEvent, reject) => {
        const waiter = {
          predicate,
          reject,
          resolve: resolveEvent,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(
                `Timed out waiting for visual compare event: ${JSON.stringify(events)} ${stderr}`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

function spawnCli(cwd: string, arguments_: string[], ipc: boolean): ChildProcess {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY']) {
    delete environment[variable];
  }
  Object.assign(environment, {
    HOME: process.env.HOME ?? cwd,
    NO_COLOR: '1',
    USERPROFILE: process.env.USERPROFILE ?? cwd,
  });
  return spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
    cwd,
    env: environment,
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
}
