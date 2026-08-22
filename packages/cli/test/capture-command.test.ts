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
  type TileflowCapture,
  TileflowCaptureError,
} from '@tileflow/capture';
import {
  createExploratoryScene,
  createTileflowCaptureFailureJson,
  createTileflowCaptureJson,
  relativePathForPlatform,
  serializeTileflowCaptureFailureJson,
  serializeTileflowCaptureJson,
} from '../src/capture-command';
import {captureReceiptPath, writeAtomicFileSet, writeCapturePair} from '../src/capture-output';

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

test('normalizes promotable exploratory center and bounds definitions', () => {
  const center = createExploratoryScene({
    browserInstall: true,
    center: '-3.69201,40.40871',
    config: 'tileflow.config.ts',
    dpr: '2',
    height: '1200',
    map: 'madrid',
    width: '1200',
    zoom: '16.15',
  });
  const bounds = createExploratoryScene({
    bounds: '-3.8,40.3,-3.6,40.5',
    browserInstall: true,
    config: 'tileflow.config.ts',
    map: 'madrid',
  });

  assert.deepEqual(Object.keys(center), ['map', 'camera', 'viewport', 'target']);
  assert.deepEqual(center, {
    map: 'madrid',
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

test('init creates a default scene and only creates a missing ignore file', async (t) => {
  const fresh = await createDirectoryFixture(t, 'tileflow-capture-init-');
  const initialized = await runCli(fresh, ['init'], {});
  assert.equal(initialized.code, 0, initialized.stderr);
  assert.match(await readFile(join(fresh, 'tileflow.config.ts'), 'utf8'), /madrid-desktop/);
  assert.equal(
    await readFile(join(fresh, '.gitignore'), 'utf8'),
    '# Tileflow generated visual evidence\n.tileflow/captures/\n.tileflow/diffs/\n',
  );
  assert.deepEqual((await readdir(fresh)).sort(), ['.gitignore', 'tileflow.config.ts']);
  assert.doesNotMatch(
    await readFile(join(fresh, 'tileflow.config.ts'), 'utf8'),
    /archiveVersion|revision|world-lock|world update/i,
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
    ['capture', '--map', 'CON', '--center', '0,0', '--zoom', '1', '--json'],
    {},
  );
  assert.equal(reservedExploratoryName.code, 1);
  assert.equal(reservedExploratoryName.stdout, '');
  assert.match(
    parseFailureDocument(reservedExploratoryName.stderr).diagnostics[0]?.message ?? '',
    /portable|reserved/i,
  );

  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `if (process.env.TILEFLOW_API_KEY) throw new Error('ambient key reached config');
export default {maps: {proof: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}}}, scenes: {proof: {map: 'proof', camera: {type: 'center', center: [0, 0], zoom: 1}, viewport: {width: 32, height: 32}}}};
`,
  );
  const invalid = await runCli(directory, ['capture', 'proof', '--json'], {
    TILEFLOW_API_KEY: `tf_live_${'s'.repeat(40)}`,
  });
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, '');
  const invalidDocument = parseFailureDocument(invalid.stderr);
  assert.equal(invalidDocument.code, 'CONFIG_INVALID');
  assert.equal(invalidDocument.phase, 'config-validation');
  assert.match(invalidDocument.diagnostics[0]?.path ?? '', /viewport/);
  assert.doesNotMatch(invalid.stderr, /ambient key reached config/);
  assert.equal(invalid.stderr.includes(directory), false);
});

test('style-invalid JSON is phase-aware and preserves an existing output pair', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-capture-style-invalid-');
  const outputPath = join(directory, 'proof.png');
  const receiptPath = captureReceiptPath(outputPath);
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `export default {
  maps: {proof: {
    basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
    overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]
  }},
  scenes: {proof: {
    map: 'proof',
    camera: {type: 'center', center: [0, 0], zoom: 1},
    viewport: {width: 64, height: 64}
  }}
};\n`,
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
  assert.equal(document.code, 'STYLE_INVALID');
  assert.equal(document.phase, 'style-validation');
  assert.deepEqual(document.diagnostics[0], {
    code: 'STYLE_INVALID',
    message: 'color expected, number found',
    path: 'maps.proof.style.layers.streets-background.paint.background-color',
    phase: 'style-validation',
  });
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
      `export default {maps: {proof: {
  basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
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
    buildings: {type: 'buildings', enabled: false},
    labels: {type: 'labels', enabled: false},
    poi: {type: 'poi', enabled: false},
    roads: {type: 'roads', enabled: false}
  }
}}, scenes: {proof: {map: 'proof', camera: {type: 'center', center: [0, 0], zoom: 0}, viewport: {width: 256, height: 256}}}};
`,
    );
    const result = await runCli(directory, ['capture', 'proof', '--json', '--no-browser-install'], {
      ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
      ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
    });

    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(result.stdout) as {
      schemaVersion: number;
      captures: Array<{outputPath: string; receiptPath: string; sha256: string}>;
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
      `export default {
  maps: {
    proof: {
      basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
      glyphs: ${JSON.stringify(`${fixture.origin}/fonts/{fontstack}/{range}.pbf`)},
      sprite: ${JSON.stringify(`${fixture.origin}/sprites/streets/v1/sprite`)},
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
        buildings: {type: 'buildings', enabled: false},
        labels: {type: 'labels', enabled: false},
        poi: {type: 'poi', enabled: false},
        roads: {
          type: 'roads', detail: 'all', hierarchy: 'clear', outline: 'strong', weight: 'regular',
          extras: {paths: true}
        }
      }
    }
  },
  scenes: {proof: {
    map: 'proof', camera: {type: 'center', center: [0, 0], zoom: 1},
    viewport: {width: 256, height: 256}
  }}
};\n`,
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
      `export default {maps: {proof: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}}}, scenes: {application: {map: 'proof', camera: {type: 'center', center: [0, 0], zoom: 0}, viewport: {width: 320, height: 240}, target: {kind: 'application', path: '/proof?fixture=1', captureId: 'proof'}}}};\n`,
    );
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(
        '<!doctype html><style>html,body{margin:0}.map{width:211px;height:137px;background:#2468ac}</style><div class="map" data-tileflow-map="proof" data-tileflow-capture-id="proof" data-tileflow-state="idle"></div>',
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

function parseFailureDocument(stderr: string): FailureDocument {
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
  assert.equal(document.command, 'capture');
  assert.equal(document.status, 'failed');
  return document;
}

function createCapture(scene: string): TileflowCapture {
  const renderer = createTileflowCaptureRendererIdentity();
  const receipt = createTileflowCaptureReceipt({
    data: {
      generation: 'v1',
      kind: 'tileflow-world',
      schema: 'openmaptiles',
      schemaVersion: 1,
      sourceId: 'tileflow',
    },
    dpr: 1,
    height: 200,
    map: 'madrid',
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
