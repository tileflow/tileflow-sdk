import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, win32} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  createTileflowCaptureReceipt,
  createTileflowCaptureRendererIdentity,
  createTileflowShotReceipt,
  parseTileflowShotReceipt,
  type TileflowCapture,
  TileflowCaptureError,
  type TileflowShotCapture,
} from '@tileflow/capture';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createExploratoryScene,
  createTileflowCaptureFailureJson,
  createTileflowCaptureJson,
  createTileflowShotCaptureJson,
  relativePathForPlatform,
  serializeTileflowCaptureFailureJson,
  serializeTileflowCaptureJson,
  serializeTileflowShotCaptureJson,
  shotReceiptPath,
} from '../src/capture-command';
import {
  captureReceiptPath,
  commitShotFrameDirectory,
  shotFrameFileName,
  stageShotFrameDirectory,
  writeAtomicFile,
  writeAtomicFileSet,
  writeCapturePair,
} from '../src/capture-output';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

test('projects deterministic relative-only capture JSON', () => {
  const cwd = '/workspace/project';
  const capture = createCapture('desktop');
  const document = createTileflowCaptureJson(
    [
      {
        capture,
        outputPath: '/workspace/project/.tileflow/captures/desktop.png',
        receiptPath: '/workspace/project/.tileflow/captures/desktop.receipt.json',
      },
    ],
    cwd,
  );
  const serialized = serializeTileflowCaptureJson(document);

  assert.deepEqual(Object.keys(document), ['schemaVersion', 'command', 'captures']);
  assert.deepEqual(Object.keys(document.captures[0] ?? {}), [
    'scene',
    'map',
    'theme',
    'target',
    'status',
    'outputPath',
    'receiptPath',
    'sha256',
    'width',
    'height',
    'dpr',
    'renderer',
    'networkDependent',
    'warnings',
  ]);
  assert.equal(document.captures[0]?.outputPath, '.tileflow/captures/desktop.png');
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(serialized.includes(cwd), false);
  assert.equal(serialized.includes('\u001b['), false);
});

test('projects deterministic sanitized resource failure JSON', () => {
  const error = new TileflowCaptureError(
    'RESOURCE_FAILED',
    'Glyph resource returned HTTP 404 from https://fonts.example.test.',
    {
      details: {
        phase: 'resource-load',
        resources: [
          {
            context: 'fontStack: Noto Sans',
            kind: 'glyph',
            origin: 'https://user:secret@fonts.example.test/private?token=hidden',
            status: 404,
          },
        ],
      },
    },
  );
  const document = createTileflowCaptureFailureJson(error, '/workspace/project');
  const serialized = serializeTileflowCaptureFailureJson(document);

  assert.deepEqual(Object.keys(document), [
    'schemaVersion',
    'command',
    'status',
    'code',
    'phase',
    'diagnostics',
    'resources',
  ]);
  assert.equal(document.code, 'RESOURCE_FAILED');
  assert.equal(document.phase, 'resource-load');
  assert.deepEqual(document.resources, [
    {
      context: 'fontStack: Noto Sans',
      kind: 'glyph',
      origin: 'https://fonts.example.test',
      status: 404,
    },
  ]);
  assert.equal(serialized, `${JSON.stringify(document, null, 2)}\n`);
  assert.doesNotMatch(serialized, /user:secret|token=hidden|private/);
});

test('projects deterministic relative-only shot JSON', () => {
  const cwd = '/workspace/project';
  const document = createTileflowShotCaptureJson(
    [
      {
        capture: createShotCapture('fly-in'),
        outputPath: '/workspace/project/.tileflow/captures/shots/fly-in.webm',
        receiptPath: '/workspace/project/.tileflow/captures/shots/fly-in.receipt.json',
      },
    ],
    cwd,
  );
  const serialized = serializeTileflowShotCaptureJson(document);

  assert.deepEqual(Object.keys(document), ['schemaVersion', 'command', 'shots']);
  assert.equal(document.command, 'capture.shot');
  assert.deepEqual(Object.keys(document.shots[0] ?? {}), [
    'shot',
    'map',
    'theme',
    'status',
    'format',
    'codec',
    'outputPath',
    'receiptPath',
    'sha256',
    'framesSha256',
    'frameCount',
    'fps',
    'durationMs',
    'width',
    'height',
    'dpr',
    'renderer',
    'networkDependent',
    'warnings',
  ]);
  assert.equal(document.shots[0]?.outputPath, '.tileflow/captures/shots/fly-in.webm');
  assert.equal(document.shots[0]?.receiptPath, '.tileflow/captures/shots/fly-in.receipt.json');
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(serialized.includes(cwd), false);
  assert.equal(shotReceiptPath('/out/fly-in.webm'), '/out/fly-in.receipt.json');
  assert.equal(shotReceiptPath('/out/fly-in'), '/out/fly-in.receipt.json');
});

test('normalizes promotable exploratory center and bounds definitions', () => {
  const center = createExploratoryScene({
    browserInstall: true,
    center: '-3.69201,40.40871',
    config: 'tileflow.config.ts',
    dpr: '2',
    height: '1200',
    map: 'madrid',
    theme: 'light',
    width: '1200',
    zoom: '16.15',
  });
  const bounds = createExploratoryScene({
    bounds: '-3.8,40.3,-3.6,40.5',
    browserInstall: true,
    config: 'tileflow.config.ts',
    map: 'madrid',
    theme: 'light',
  });

  assert.deepEqual(Object.keys(center), ['map', 'theme', 'camera', 'viewport', 'target']);
  assert.deepEqual(center, {
    map: 'madrid',
    theme: 'light',
    camera: {
      type: 'center',
      center: [-3.69201, 40.40871],
      zoom: 16.15,
      bearing: 0,
      pitch: 0,
    },
    viewport: {width: 1200, height: 1200, dpr: 2},
    target: {kind: 'map'},
  });
  assert.deepEqual(bounds, {
    map: 'madrid',
    theme: 'light',
    camera: {
      type: 'bounds',
      bounds: [-3.8, 40.3, -3.6, 40.5],
      padding: 0,
      bearing: 0,
      pitch: 0,
    },
    viewport: {width: 1200, height: 800, dpr: 1},
    target: {kind: 'map'},
  });
  assert.throws(
    () =>
      createExploratoryScene({
        browserInstall: true,
        center: '0,0',
        config: 'tileflow.config.ts',
        dpr: '3',
        map: 'madrid',
        theme: 'light',
        zoom: '1',
      }),
    /Invalid exploratory capture.*dpr/,
  );

  const capture = createCapture('madrid');
  const document = createTileflowCaptureJson(
    [
      {
        capture,
        definition: center,
        outputPath: '/workspace/project/.tileflow/captures/madrid.png',
        receiptPath: '/workspace/project/.tileflow/captures/madrid.receipt.json',
      },
    ],
    '/workspace/project',
  );
  assert.deepEqual(Object.keys(document.captures[0] ?? {}), [
    'scene',
    'map',
    'theme',
    'target',
    'status',
    'definition',
    'outputPath',
    'receiptPath',
    'sha256',
    'width',
    'height',
    'dpr',
    'renderer',
    'networkDependent',
    'warnings',
  ]);
  assert.deepEqual(document.captures[0]?.definition, center);
});

test('capture and setup help explain automatic, prepared, and no-system-browser behavior', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-help-');
  const captureHelp = await runCli(directory, ['capture', '--help'], {});
  const setupHelp = await runCli(directory, ['setup', 'capture', '--help'], {});

  assert.equal(captureHelp.code, 0, captureHelp.stderr);
  assert.match(captureHelp.stdout, /installs the exact pinned Chromium.*automatically/is);
  assert.match(captureHelp.stdout, /recapture after each valid\s+local edit/i);
  assert.match(captureHelp.stdout, /setup capture.*preinstall/is);
  assert.match(captureHelp.stdout, /never falls back to system Chrome/i);
  assert.equal(setupHelp.code, 0, setupHelp.stderr);
  assert.match(setupHelp.stdout, /capture installs.*automatically/is);
  assert.match(setupHelp.stdout, /prepared\/offline CI/i);
  assert.match(setupHelp.stdout, /never falls back to system Chrome/i);
});

test('rejects paths on another Windows volume instead of projecting an absolute JSON path', () => {
  assert.throws(
    () =>
      relativePathForPlatform('C:\\repo', 'D:\\evidence\\proof.png', {
        isAbsolute: win32.isAbsolute,
        relative: win32.relative,
        sep: win32.sep,
      }),
    /volume|relative/i,
  );
});

test('writes capture pairs atomically and enforces explicit overwrite policy', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-output-');
  const outputPath = join(directory, 'proof.png');
  const receiptPath = captureReceiptPath(outputPath);
  const first = new Uint8Array([137, 80, 78, 71, 1]);
  const second = new Uint8Array([137, 80, 78, 71, 2]);

  assert.equal(
    await writeCapturePair({
      force: false,
      managed: false,
      outputPath,
      png: first,
      receipt: '{"version":1}\n',
      receiptPath,
    }),
    true,
  );
  assert.equal(
    await writeCapturePair({
      force: false,
      managed: false,
      outputPath,
      png: first,
      receipt: '{"version":1}\n',
      receiptPath,
    }),
    false,
  );
  await assert.rejects(
    () =>
      writeCapturePair({
        boundaryPath: directory,
        force: false,
        managed: false,
        outputPath,
        png: second,
        receipt: '{"version":2}\n',
        receiptPath,
      }),
    /--force/,
  );
  assert.deepEqual(new Uint8Array(await readFile(outputPath)), first);
  assert.equal(await readFile(receiptPath, 'utf8'), '{"version":1}\n');

  await writeCapturePair({
    force: true,
    managed: false,
    outputPath,
    png: second,
    receipt: '{"version":2}\n',
    receiptPath,
  });
  assert.deepEqual(new Uint8Array(await readFile(outputPath)), second);
  assert.equal(await readFile(receiptPath, 'utf8'), '{"version":2}\n');
});

test('refuses symlinked capture output components', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-symlink-');
  const realDirectory = join(directory, 'real');
  const linkedDirectory = join(directory, 'linked');
  await mkdir(realDirectory);
  await symlink(realDirectory, linkedDirectory, 'dir');

  await assert.rejects(
    () =>
      writeCapturePair({
        force: true,
        managed: false,
        outputPath: join(linkedDirectory, 'proof.png'),
        png: new Uint8Array([1]),
        receipt: '{}\n',
        receiptPath: join(linkedDirectory, 'proof.receipt.json'),
      }),
    /symbolic links/,
  );

  const missingBoundaryBelowLink = join(linkedDirectory, 'not-created-yet');
  await assert.rejects(
    () =>
      writeCapturePair({
        boundaryPath: missingBoundaryBelowLink,
        force: true,
        managed: false,
        outputPath: join(missingBoundaryBelowLink, 'proof.png'),
        png: new Uint8Array([1]),
        receipt: '{}\n',
        receiptPath: join(missingBoundaryBelowLink, 'proof.receipt.json'),
      }),
    /symbolic links/,
  );
});

test('writes and removes a visual artifact set as one idempotent transaction', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-visual-output-');
  const actualPath = join(directory, 'proof.actual.png');
  const diffPath = join(directory, 'proof.diff.png');
  const reportPath = join(directory, 'proof.visual.json');
  await writeFile(diffPath, 'stale');

  assert.equal(
    await writeAtomicFileSet({
      boundaryPath: directory,
      files: [
        {path: actualPath, source: new Uint8Array([1, 2, 3])},
        {path: reportPath, source: '{"status":"missing-baseline"}\n'},
      ],
      force: true,
      label: 'Visual diff output',
      managed: true,
      removePaths: [diffPath],
    }),
    true,
  );
  await assert.rejects(() => readFile(diffPath), /ENOENT/);
  assert.deepEqual(new Uint8Array(await readFile(actualPath)), new Uint8Array([1, 2, 3]));
  assert.equal(await readFile(reportPath, 'utf8'), '{"status":"missing-baseline"}\n');
  assert.equal(
    await writeAtomicFileSet({
      boundaryPath: directory,
      files: [
        {path: actualPath, source: new Uint8Array([1, 2, 3])},
        {path: reportPath, source: '{"status":"missing-baseline"}\n'},
      ],
      force: true,
      label: 'Visual diff output',
      managed: true,
      removePaths: [diffPath],
    }),
    false,
  );

  const blockingPath = join(directory, 'not-a-file');
  await mkdir(blockingPath);
  await assert.rejects(
    () =>
      writeAtomicFileSet({
        boundaryPath: directory,
        files: [
          {path: actualPath, source: new Uint8Array([9, 9, 9])},
          {path: blockingPath, source: 'cannot replace a directory'},
        ],
        force: true,
        label: 'Visual baseline',
        managed: true,
      }),
    /regular file/,
  );
  assert.deepEqual(new Uint8Array(await readFile(actualPath)), new Uint8Array([1, 2, 3]));
});

test('atomically replaces one managed manifest without a target-to-backup gap', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-single-atomic-output-');
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, '{"version":1}\n');

  assert.equal(
    await writeAtomicFile({
      boundaryPath: directory,
      force: true,
      label: 'Deploy manifest',
      managed: true,
      path: manifestPath,
      source: '{"version":2}\n',
    }),
    true,
  );
  assert.equal(await readFile(manifestPath, 'utf8'), '{"version":2}\n');
  assert.deepEqual(await readdir(directory), ['manifest.json', 'node_modules']);
  assert.equal(
    await writeAtomicFile({
      boundaryPath: directory,
      force: false,
      label: 'Deploy manifest',
      managed: false,
      path: manifestPath,
      source: '{"version":2}\n',
    }),
    false,
  );
  await assert.rejects(
    () =>
      writeAtomicFile({
        boundaryPath: directory,
        force: false,
        label: 'Deploy manifest',
        managed: false,
        path: manifestPath,
        source: '{"version":3}\n',
      }),
    /Use --force/u,
  );
});

test('stages shot frames beside their directory and replaces it as one transaction', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-shot-frames-');
  const frames = join(directory, 'fly-in');
  const receiptPath = shotReceiptPath(frames);
  const stage = async (count: number, seed: number) => {
    const staged = await stageShotFrameDirectory({boundaryPath: directory, directory: frames});
    for (let index = 0; index < count; index += 1) {
      await staged.write(index, new Uint8Array([137, 80, 78, 71, seed, index]));
    }
    return staged;
  };
  const listing = async () => (await readdir(directory)).sort();

  const first = await stage(3, 1);
  assert.equal(
    await commitShotFrameDirectory({
      force: false,
      managed: false,
      receipt: '{"version":1}\n',
      receiptPath,
      stage: first,
    }),
    true,
  );
  assert.deepEqual(await listing(), ['fly-in', 'fly-in.receipt.json', 'node_modules']);
  assert.deepEqual((await readdir(frames)).sort(), [0, 1, 2].map(shotFrameFileName));
  assert.equal(shotFrameFileName(12), 'frame-0012.png');

  const unchanged = await stage(3, 1);
  assert.equal(
    await commitShotFrameDirectory({
      force: false,
      managed: false,
      receipt: '{"version":1}\n',
      receiptPath,
      stage: unchanged,
    }),
    false,
  );
  assert.deepEqual(await listing(), ['fly-in', 'fly-in.receipt.json', 'node_modules']);

  const shorter = await stage(2, 2);
  await assert.rejects(
    () =>
      commitShotFrameDirectory({
        force: false,
        managed: false,
        receipt: '{"version":2}\n',
        receiptPath,
        stage: shorter,
      }),
    /--force/,
  );
  assert.deepEqual((await readdir(frames)).sort(), [0, 1, 2].map(shotFrameFileName));
  await commitShotFrameDirectory({
    force: true,
    managed: false,
    receipt: '{"version":2}\n',
    receiptPath,
    stage: shorter,
  });
  assert.deepEqual((await readdir(frames)).sort(), [0, 1].map(shotFrameFileName));
  assert.deepEqual([...(await readFile(join(frames, 'frame-0000.png')))], [137, 80, 78, 71, 2, 0]);
  assert.equal(await readFile(receiptPath, 'utf8'), '{"version":2}\n');
  assert.deepEqual(await listing(), ['fly-in', 'fly-in.receipt.json', 'node_modules']);

  await writeFile(join(frames, 'notes.txt'), 'keep');
  await assert.rejects(
    () => stageShotFrameDirectory({boundaryPath: directory, directory: frames}),
    /not Tileflow frames/,
  );
  await symlink(
    frames,
    join(directory, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    () => stageShotFrameDirectory({boundaryPath: directory, directory: join(directory, 'linked')}),
    /symbolic link/,
  );
});

test('validates shot selection before loading config', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-shot-selection-');
  const cases: Array<[string[], RegExp, string]> = [
    [['--shot', 'fly-in', '--all-shots'], /either --shot or --all-shots/u, 'capture.shot'],
    [['proof', '--shot', 'fly-in'], /take no scenes/u, 'capture.shot'],
    [['--shot', 'fly-in', '--watch'], /does not render shots/u, 'capture.shot'],
    [['--shot', 'fly-in', '--theme', 'light'], /apply to scenes/u, 'capture.shot'],
    [['--shot', 'CON'], /portable Tileflow shot name/u, 'capture.shot'],
    [['--shot', 'fly-in', '--format', 'gif'], /--format expects webm or frames/u, 'capture.shot'],
    [
      ['--shot', 'a', '--shot', 'b', '--out', 'a.webm'],
      /only when rendering one shot/u,
      'capture.shot',
    ],
    [['--all-shots', '--out', 'a.webm'], /only when rendering one shot/u, 'capture.shot'],
    [['--shot', 'fly-in', '--out', 'fly-in.mp4'], /must name a \.webm file/u, 'capture.shot'],
    [
      ['--shot', 'fly-in', '--format', 'frames', '--out', 'fly-in.webm'],
      /directory for --format frames/u,
      'capture.shot',
    ],
    [['proof', '--format', 'frames'], /--format applies to --shot/u, 'capture'],
  ];

  for (const [arguments_, message, command] of cases) {
    const result = await runCli(directory, ['capture', ...arguments_, '--json'], {});
    assert.equal(result.code, 1, arguments_.join(' '));
    assert.equal(result.stdout, '');
    const document = parseFailureDocument(result.stderr, command);
    assert.equal(document.code, 'INVALID_ARGUMENT');
    assert.equal(document.phase, 'input-validation');
    assert.match(document.diagnostics[0]?.message ?? '', message);
  }

  await writeFile(
    join(directory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'proof',
      fields: `shots: {'fly-in': {theme: 'light', viewport: {width: 64, height: 64}, keyframes: [
    {at: 0, camera: {type: 'center', center: [0, 0], zoom: 1}},
    {at: 100, camera: {type: 'center', center: [1, 1], zoom: 2}}
  ]}}`,
    }),
  );
  const unknown = await runCli(directory, ['capture', '--shot', 'orbit', '--json'], {});
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  const unknownDocument = parseFailureDocument(unknown.stderr, 'capture.shot');
  assert.equal(unknownDocument.code, 'SHOT_NOT_FOUND');
  assert.equal(unknownDocument.phase, 'shot-resolution');
  assert.match(unknownDocument.diagnostics[0]?.message ?? '', /Available shots: fly-in\./u);
});

test('init creates a singular map and only creates a missing ignore file', async (t) => {
  const fresh = await createDirectoryFixture(t, 'tileflow-capture-init-');
  const initialized = await runCli(fresh, ['init'], {});
  assert.equal(initialized.code, 0, initialized.stderr);
  const config = await readFile(join(fresh, 'tileflow.config.ts'), 'utf8');
  assert.match(config, /defineMap/);
  assert.match(config, /defineTheme/);
  assert.match(config, /id: "madrid"/);
  assert.match(config, /extends: streets/);
  assert.match(config, /themes: \{ light: streetsThemes\.light, dark: madridDark \}/);
  assert.match(config, /defaultTheme: "light"/);
  assert.match(config, /systemThemes: \{ light: "light", dark: "dark" \}/);
  assert.doesNotMatch(config, /\bglyphs\s*:/);
  assert.doesNotMatch(config, /\bmaps\s*:|\bbasemap(?:Version)?\s*:/);
  assert.equal(
    await readFile(join(fresh, '.gitignore'), 'utf8'),
    '# Tileflow generated visual evidence\n.tileflow/captures/\n.tileflow/diffs/\n',
  );
  assert.deepEqual((await readdir(fresh)).sort(), [
    '.gitignore',
    'node_modules',
    'tileflow.config.ts',
  ]);
  assert.doesNotMatch(
    await readFile(join(fresh, 'tileflow.config.ts'), 'utf8'),
    /archiveVersion|revision|world-lock|world update/i,
  );

  const validation = await runCli(fresh, ['validate', '--json'], {});
  assert.equal(validation.code, 0, validation.stderr);
  assert.equal(validation.stderr, '');
  const validationDocument = JSON.parse(validation.stdout) as {maps?: string[]; ok?: boolean};
  assert.equal(validationDocument.ok, true);
  assert.deepEqual(validationDocument.maps, ['madrid']);

  const built = await runCli(fresh, ['build', '--out', 'dist/tileflow'], {});
  assert.equal(built.code, 0, `${built.stdout}\n${built.stderr}`);
  const style = JSON.parse(
    await readFile(join(fresh, 'dist/tileflow/styles/madrid/light.json'), 'utf8'),
  ) as {glyphs?: string};
  assert.equal(
    style.glyphs,
    'https://api.tileflow.dev/base/33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3/glyphs/{fontstack}/{range}.pbf',
  );

  const existing = await createDirectoryFixture(t, 'tileflow-capture-init-existing-ignore-');
  await writeFile(join(existing, '.gitignore'), 'owned-by-user\n');
  const withExistingIgnore = await runCli(existing, ['init'], {});
  assert.equal(withExistingIgnore.code, 0, withExistingIgnore.stderr);
  assert.equal(await readFile(join(existing, '.gitignore'), 'utf8'), 'owned-by-user\n');
});

test('keeps selection and config failures on stderr with empty JSON stdout', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-errors-');
  const missingSelection = await runCli(directory, ['capture', '--json'], {});
  assert.equal(missingSelection.code, 1);
  assert.equal(missingSelection.stdout, '');
  const missingDocument = parseFailureDocument(missingSelection.stderr);
  assert.equal(missingDocument.code, 'INVALID_ARGUMENT');
  assert.equal(missingDocument.phase, 'input-validation');
  assert.match(missingDocument.diagnostics[0]?.message ?? '', /Select at least one scene/);

  const conflictingApplicationLocation = await runCli(
    directory,
    [
      'capture',
      'proof',
      '--url',
      'http://localhost:3000/proof',
      '--app-origin',
      'http://localhost:3000',
      '--json',
    ],
    {},
  );
  assert.equal(conflictingApplicationLocation.code, 1);
  assert.equal(conflictingApplicationLocation.stdout, '');
  assert.match(
    parseFailureDocument(conflictingApplicationLocation.stderr).diagnostics[0]?.message ?? '',
    /either --url or --app-origin/,
  );

  const invalidFrame = await runCli(
    directory,
    ['capture', 'proof', '--frame', 'element', '--json'],
    {},
  );
  assert.equal(invalidFrame.code, 1);
  assert.equal(invalidFrame.stdout, '');
  assert.match(
    parseFailureDocument(invalidFrame.stderr).diagnostics[0]?.message ?? '',
    /--frame expects map or viewport/,
  );

  const reservedExploratoryName = await runCli(
    directory,
    ['capture', '--map', 'CON', '--theme', 'light', '--center', '0,0', '--zoom', '1', '--json'],
    {},
  );
  assert.equal(reservedExploratoryName.code, 1);
  assert.equal(reservedExploratoryName.stdout, '');
  assert.match(
    parseFailureDocument(reservedExploratoryName.stderr).diagnostics[0]?.message ?? '',
    /portable|reserved/i,
  );

  const missingExploratoryTheme = await runCli(
    directory,
    ['capture', '--map', 'proof', '--center', '0,0', '--zoom', '1', '--json'],
    {},
  );
  assert.equal(missingExploratoryTheme.code, 1);
  assert.equal(missingExploratoryTheme.stdout, '');
  assert.match(
    parseFailureDocument(missingExploratoryTheme.stderr).diagnostics[0]?.message ?? '',
    /requires one concrete --theme/u,
  );

  await writeFile(
    join(directory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'proof',
      setup: `if (process.env.TILEFLOW_API_KEY) throw new Error('ambient key reached config');`,
      fields: `modules: {poi: {type: 'poi', unsupported: true}},
  scenes: {proof: {theme: 'light', camera: {type: 'center', center: [0, 0], zoom: 1}, viewport: {width: 64, height: 64}}}`,
    }),
  );
  const invalid = await runCli(directory, ['capture', 'proof', '--json'], {
    TILEFLOW_API_KEY: `tf_live_${'s'.repeat(40)}`,
  });
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, '');
  const invalidDocument = parseFailureDocument(invalid.stderr);
  assert.equal(invalidDocument.code, 'CONFIG_INVALID');
  assert.equal(invalidDocument.phase, 'config-validation');
  assert.equal(invalidDocument.diagnostics[0]?.path, 'modules.poi.unsupported');
  assert.doesNotMatch(invalid.stderr, /ambient key reached config/);
  assert.equal(invalid.stderr.includes(directory), false);
});

test('removed raw style overrides fail at the config boundary and preserve output', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-style-invalid-');
  const outputPath = join(directory, 'proof.png');
  const receiptPath = captureReceiptPath(outputPath);
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'proof',
      fields: `overrides: [{kind: 'patch', id: 'tileflow-background', patch: {paint: {'background-color': 42}}}],
  scenes: {proof: {
    theme: 'light',
    camera: {type: 'center', center: [0, 0], zoom: 1},
    viewport: {width: 64, height: 64}
  }}`,
    }),
  );
  await writeFile(outputPath, 'preserved-png');
  await writeFile(receiptPath, 'preserved-receipt');

  const result = await runCli(
    directory,
    ['capture', 'proof', '--out', 'proof.png', '--force', '--json', '--no-browser-install'],
    {},
  );
  const document = parseFailureDocument(result.stderr);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(document.code, 'CONFIG_INVALID');
  assert.equal(document.phase, 'config-validation');
  assert.equal(document.diagnostics[0]?.code, 'CONFIG_INVALID');
  assert.match(document.diagnostics[0]?.message ?? '', /unrecognized key "overrides"/u);
  assert.equal(document.diagnostics[0]?.path, 'map');
  assert.equal(document.diagnostics[0]?.phase, 'config-validation');
  assert.equal(await readFile(outputPath, 'utf8'), 'preserved-png');
  assert.equal(await readFile(receiptPath, 'utf8'), 'preserved-receipt');
  assert.equal(result.stderr.includes(directory), false);
});

test('one-shot JSON redacts credentials thrown by executable config', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-secret-error-');
  const tileflowKey = `tf_live_${'a'.repeat(32)}`;
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `throw new Error(${JSON.stringify(`Bearer bearer-secret ${tileflowKey} sk_live_private`)});\n`,
  );

  const result = await runCli(
    directory,
    ['capture', 'proof', '--json', '--no-browser-install'],
    {},
  );
  const document = parseFailureDocument(result.stderr);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(document.diagnostics[0]?.message ?? '', /\[redacted]/);
  assert.doesNotMatch(result.stderr, /bearer-secret|tf_live_|sk_live_private/);
  assert.equal(result.stderr.includes(directory), false);
});

test(
  'captures a real scene through the CLI with deterministic JSON and paired outputs',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async (t) => {
    const directory = await createDirectoryFixture(t, 'tileflow-capture-real-');
    const fixture = await createVectorFixtureServer(t);
    await writeFile(
      join(directory, 'tileflow.config.ts'),
      tileflowMapFixture({
        id: 'proof',
        fields: `data: {
    type: 'vector-tiles',
    tiles: [${JSON.stringify(`${fixture.origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
    minzoom: 0,
    maxzoom: 14,
    bounds: [-180, -85, 180, 85],
    revision: 'fixture_1',
    attribution: 'Fixture data',
    schema: {type: 'openmaptiles', contractVersion: 1}
  },
  scenes: {proof: {theme: 'light', camera: {type: 'center', center: [0, 0], zoom: 0}, viewport: {width: 256, height: 256}}}`,
      }),
    );
    const result = await runCli(directory, ['capture', 'proof', '--json', '--no-browser-install'], {
      ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
      ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
    });

    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(result.stdout) as {
      schemaVersion: number;
      captures: Array<{captureId: string; outputPath: string; receiptPath: string; sha256: string}>;
    };
    assert.equal(document.schemaVersion, 1);
    assert.match(document.captures[0]?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.deepEqual(
      [...(await readFile(join(directory, document.captures[0]!.outputPath))).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(
      JSON.parse(await readFile(join(directory, document.captures[0]!.receiptPath), 'utf8')).image
        .sha256,
      document.captures[0]?.sha256,
    );
    assert.equal(result.stdout.includes(directory), false);
    assert.match(document.captures[0]!.captureId, /^[a-f0-9]{64}$/);
    await rm(join(directory, 'tileflow.config.ts'));
    const reused = await runCli(
      directory,
      [
        'compare',
        '--before',
        document.captures[0]!.captureId,
        '--after',
        document.captures[0]!.captureId,
        '--json',
      ],
      {},
    );
    assert.equal(reused.code, 0, reused.stderr);
    assert.equal(JSON.parse(reused.stdout).review.exact.ratio, 0);
  },
);

test(
  'renders a committed shot through the CLI to WebM and to frames with receipts',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async (t) => {
    const directory = await createDirectoryFixture(t, 'tileflow-capture-shot-');
    const fixture = await createVectorFixtureServer(t);
    await writeFile(
      join(directory, 'tileflow.config.ts'),
      tileflowMapFixture({
        id: 'proof',
        fields: `data: {
    type: 'vector-tiles',
    tiles: [${JSON.stringify(`${fixture.origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
    minzoom: 0,
    maxzoom: 14,
    bounds: [-180, -85, 180, 85],
    revision: 'fixture_1',
    attribution: 'Fixture data',
    schema: {type: 'openmaptiles', contractVersion: 1}
  },
  shots: {'fly-in': {theme: 'light', viewport: {width: 64, height: 64}, keyframes: [
    {at: 0, camera: {type: 'center', center: [0, 0], zoom: 0}},
    {at: 200, camera: {type: 'center', center: [20, 10], zoom: 2}}
  ]}}`,
      }),
    );
    const environment = {
      ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
      ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
    };
    type ShotDocument = {
      command: string;
      shots: Array<{
        format: string;
        frameCount: number;
        framesSha256: string;
        outputPath: string;
        receiptPath: string;
        sha256: string;
      }>;
    };

    const video = await runCli(
      directory,
      ['capture', '--shot', 'fly-in', '--json', '--no-browser-install'],
      environment,
    );
    assert.equal(video.code, 0, video.stderr);
    const videoDocument = JSON.parse(video.stdout) as ShotDocument;
    const videoEntry = videoDocument.shots[0]!;
    assert.equal(videoDocument.command, 'capture.shot');
    assert.equal(videoEntry.format, 'webm');
    assert.equal(videoEntry.frameCount, 7);
    assert.equal(videoEntry.outputPath, '.tileflow/captures/shots/fly-in.webm');
    assert.deepEqual(
      [...(await readFile(join(directory, videoEntry.outputPath))).subarray(0, 4)],
      [0x1a, 0x45, 0xdf, 0xa3],
    );
    const videoReceipt = parseTileflowShotReceipt(
      await readFile(join(directory, videoEntry.receiptPath)),
    );
    assert.equal(videoReceipt.output.sha256, videoEntry.sha256);
    assert.equal(video.stdout.includes(directory), false);

    const frames = await runCli(
      directory,
      [
        'capture',
        '--shot',
        'fly-in',
        '--format',
        'frames',
        '--out-dir',
        'evidence',
        '--json',
        '--no-browser-install',
      ],
      environment,
    );
    assert.equal(frames.code, 0, frames.stderr);
    const framesEntry = (JSON.parse(frames.stdout) as ShotDocument).shots[0]!;
    assert.equal(framesEntry.outputPath, 'evidence/fly-in');
    assert.equal(framesEntry.receiptPath, 'evidence/fly-in.receipt.json');
    assert.equal(framesEntry.sha256, framesEntry.framesSha256);
    assert.equal(framesEntry.framesSha256, videoEntry.framesSha256);
    assert.deepEqual(
      (await readdir(join(directory, 'evidence', 'fly-in'))).sort(),
      Array.from({length: 7}, (_, index) => `frame-000${index}.png`),
    );
    assert.deepEqual((await readdir(join(directory, 'evidence'))).sort(), [
      'fly-in',
      'fly-in.receipt.json',
    ]);
  },
);

test(
  'captures Streets roads and emits a real promotable exploratory definition without setup',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 45_000},
  async (t) => {
    const directory = await createDirectoryFixture(t, 'tileflow-capture-generated-road-');
    const fixture = await createVectorFixtureServer(t);
    await writeFile(
      join(directory, 'tileflow.config.ts'),
      tileflowMapFixture({
        id: 'proof',
        icons: 'official',
        fields: `glyphs: {kind: 'url', url: ${JSON.stringify(`${fixture.origin}/fonts/{fontstack}/{range}.pbf`)}, fontStacks: ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']},
      data: {
        type: 'vector-tiles',
        tiles: [${JSON.stringify(`${fixture.origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
        minzoom: 0,
        maxzoom: 14,
        bounds: [-180, -85, 180, 85],
        revision: 'fixture_1',
        attribution: 'Fixture data',
        schema: {type: 'openmaptiles', contractVersion: 1}
      },
      modules: {
        roads: {
          type: 'roads', detail: 'all', hierarchy: 'clear', outline: 'strong', weight: 'regular',
          extras: {paths: true}
        }
      },
  scenes: {proof: {
    theme: 'light',
    camera: {type: 'center', center: [0, 0], zoom: 1},
    viewport: {width: 256, height: 256}
  }}`,
      }),
    );
    const environment = {
      ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
      ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
    };
    const result = await runCli(
      directory,
      ['capture', 'proof', '--json', '--no-browser-install'],
      environment,
    );

    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(result.stdout) as {
      captures: Array<{
        networkDependent: boolean;
        outputPath: string;
        receiptPath: string;
        sha256: string;
        warnings: string[];
      }>;
    };
    const entry = document.captures[0]!;
    assert.equal(entry.networkDependent, false);
    assert.deepEqual(entry.warnings, []);
    assert.deepEqual(
      [...(await readFile(join(directory, entry.outputPath))).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    const receipt = JSON.parse(await readFile(join(directory, entry.receiptPath), 'utf8')) as {
      image: {sha256: string};
      networkDependent: boolean;
    };
    assert.equal(receipt.image.sha256, entry.sha256);
    assert.equal(receipt.networkDependent, false);

    const exploratory = await runCli(
      directory,
      [
        'capture',
        '--map',
        'proof',
        '--theme=light',
        '--center=0,0',
        '--zoom=1',
        '--width=128',
        '--height=128',
        '--json',
        '--no-browser-install',
      ],
      environment,
    );
    assert.equal(exploratory.code, 0, exploratory.stderr);
    const exploratoryEntry = (
      JSON.parse(exploratory.stdout) as {
        captures: Array<{definition?: unknown}>;
      }
    ).captures[0];
    assert.deepEqual(exploratoryEntry?.definition, {
      map: 'proof',
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
      viewport: {width: 128, height: 128, dpr: 1},
      target: {kind: 'map'},
    });
    assert.equal(fixture.requests.has('/tiles/world/tiles.json'), false);
    assert.equal(
      [...fixture.requests].some((path) => path.endsWith('.pbf')),
      true,
    );
  },
);

test(
  'captures a committed application scene through one existing loopback server',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async (t) => {
    const directory = await createDirectoryFixture(t, 'tileflow-capture-application-');
    await writeFile(
      join(directory, 'tileflow.config.ts'),
      tileflowMapFixture({
        data: 'fixture',
        id: 'proof',
        fields: `scenes: {application: {theme: 'light', camera: {type: 'center', center: [0, 0], zoom: 0}, viewport: {width: 320, height: 240}, target: {kind: 'application', path: '/proof?fixture=1', captureId: 'proof'}}}`,
      }),
    );
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(
        '<!doctype html><style>html,body{margin:0}.map{width:211px;height:137px;background:#2468ac}</style><div class="map" data-tileflow-map="proof" data-tileflow-theme="light" data-tileflow-capture-id="proof" data-tileflow-state="idle"></div>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const result = await runCli(
      directory,
      [
        'capture',
        'application',
        '--app-origin',
        `http://127.0.0.1:${address.port}`,
        '--json',
        '--no-browser-install',
      ],
      {
        ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
        ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
      },
    );

    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(result.stdout) as {
      captures: Array<{height: number; target: string; width: number}>;
    };
    assert.equal(document.captures[0]?.height, 137);
    assert.equal(document.captures[0]?.target, 'application');
    assert.equal(document.captures[0]?.width, 211);
    assert.ok(requests >= 1);
    assert.equal(result.stdout.includes(directory), false);

    const oneOff = await runCli(
      directory,
      [
        'capture',
        'application',
        '--url',
        `http://127.0.0.1:${address.port}/one-off?private=redacted`,
        '--selector',
        '.map',
        '--frame',
        'viewport',
        '--out',
        'one-off.png',
        '--json',
        '--no-browser-install',
      ],
      {
        ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
        ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
      },
    );
    assert.equal(oneOff.code, 0, oneOff.stderr);
    const oneOffDocument = JSON.parse(oneOff.stdout) as {
      captures: Array<{height: number; width: number}>;
    };
    assert.equal(oneOffDocument.captures[0]?.height, 240);
    assert.equal(oneOffDocument.captures[0]?.width, 320);
    assert.doesNotMatch(`${oneOff.stdout}\n${oneOff.stderr}`, /private=redacted/);
  },
);

type FailureDocument = {
  code: string;
  command: string;
  diagnostics: Array<{code?: string; message: string; path: string; phase?: string}>;
  phase: string;
  schemaVersion: number;
  status: string;
};

function parseFailureDocument(stderr: string, command = 'capture'): FailureDocument {
  const document = JSON.parse(stderr) as FailureDocument;
  assert.equal(stderr, `${JSON.stringify(document, null, 2)}\n`);
  assert.deepEqual(Object.keys(document), [
    'schemaVersion',
    'command',
    'status',
    'code',
    'phase',
    'diagnostics',
  ]);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.command, command);
  assert.equal(document.status, 'failed');
  return document;
}

function createShotCapture(shot: string): TileflowShotCapture {
  const renderer = createTileflowCaptureRendererIdentity();
  const receipt = createTileflowShotReceipt({
    data: {
      bindings: {fields: {class: 'class'}, layers: {road: 'transportation'}},
      capabilities: {
        businessCorridor: false,
        bathymetry: false,
        canopy: false,
        globalLandcover: false,
        tree: false,
      },
      kind: 'vector-tiles',
      schema: 'openmaptiles',
      schemaVersion: 1,
      semantics: {parkLayer: 'mixed'},
      sourceId: 'tileflow',
      url: 'https://fixtures.tileflow.test/tiles.json',
    },
    dpr: 1,
    durationMs: 1_000,
    fps: 30,
    frameCount: 31,
    framesSha256: 'b'.repeat(64),
    height: 64,
    map: 'proof',
    networkDependent: false,
    output: {codec: 'vp9', kind: 'webm', sha256: 'a'.repeat(64)},
    renderer,
    shot,
    shotSha256: 'c'.repeat(64),
    styleSha256: 'd'.repeat(64),
    theme: 'light',
    width: 64,
  });
  return {
    shot,
    map: 'proof',
    theme: 'light',
    format: 'webm',
    video: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    codec: 'vp9',
    sha256: 'a'.repeat(64),
    framesSha256: 'b'.repeat(64),
    frameSha256s: [],
    shotSha256: 'c'.repeat(64),
    styleSha256: 'd'.repeat(64),
    fps: 30,
    frameCount: 31,
    durationMs: 1_000,
    width: 64,
    height: 64,
    dpr: 1,
    networkDependent: false,
    renderer,
    receipt,
    warnings: [],
  };
}

function createCapture(scene: string): TileflowCapture {
  const renderer = createTileflowCaptureRendererIdentity();
  const receipt = createTileflowCaptureReceipt({
    data: {
      archiveSha256: 'd'.repeat(64),
      contractSha256: 'e'.repeat(64),
      dataContractSha256: 'f'.repeat(64),
      descriptorSha256: 'c'.repeat(64),
      kind: 'tileflow-world',
      product: 'world-v1',
      releaseId: 'world-v1-cli-fixture',
      schema: 'openmaptiles',
      schemaVersion: 1,
      semantics: {parkLayer: 'protected-only'},
      sourceId: 'tileflow',
    },
    dpr: 1,
    height: 200,
    map: 'madrid',
    theme: 'light',
    networkDependent: false,
    pngSha256: 'a'.repeat(64),
    renderer,
    scene,
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map',
    width: 320,
  });
  return {
    scene,
    map: 'madrid',
    theme: 'light',
    target: 'map',
    png: new Uint8Array([137, 80, 78, 71]),
    sha256: 'a'.repeat(64),
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    width: 320,
    height: 200,
    dpr: 1,
    networkDependent: false,
    renderer,
    receipt,
    warnings: [],
  };
}

async function createDirectoryFixture(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(directory);
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

async function createVectorFixtureServer(
  t: TestContext,
): Promise<{origin: string; requests: Set<string>}> {
  let origin = '';
  const requests = new Set<string>();
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0] ?? '/';
    requests.add(path);
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (path.endsWith('.pbf')) {
      response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
      response.end(Buffer.alloc(0));
      return;
    }
    if (path.endsWith('/sprite.json') || path.endsWith('/sprite@2x.json')) {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end('{}');
      return;
    }
    if (path.endsWith('/sprite.png') || path.endsWith('/sprite@2x.png')) {
      response.writeHead(200, {'Content-Type': 'image/png'});
      response.end(transparentPng);
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  return {origin, requests};
}

function runCli(
  cwd: string,
  arguments_: string[],
  overrides: Record<string, string>,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};

  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY']) {
    delete environment[variable];
  }

  Object.assign(
    environment,
    {
      HOME: cwd,
      NO_COLOR: '1',
      USERPROFILE: cwd,
    },
    overrides,
  );

  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({code, stderr, stdout}));
  });
}

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=',
  'base64',
);
