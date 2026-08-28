import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {homedir, tmpdir} from 'node:os';
import {basename, delimiter, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import semver from 'semver';
import {assertSelectedRuntimeDependencies, validateReleasePlan} from './reconcile-release.mjs';
import {
  internalRuntimeRange,
  packageLegalFileNames,
  publicLicenseIdentifier,
  publicPackageNames,
  publicPackageNameSet,
  runtimeDependencyGroups,
  runtimeDependencySnapshot,
  validatePublishedInternalRuntimeRange,
} from './release-config.mjs';
import {runCommand} from './run-command.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const suppliedPackDirectory = argumentValue('--pack-dir');
const suppliedReleasePlan = argumentValue('--release-plan');
assert.ok(
  !suppliedReleasePlan || suppliedPackDirectory,
  '--release-plan requires final tarballs supplied through --pack-dir.',
);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'tileflow-public-capture-smoke-'));
const packDirectory = suppliedPackDirectory
  ? resolve(suppliedPackDirectory)
  : join(temporaryRoot, 'packs');
const consumerDirectory = join(temporaryRoot, 'consumer');
const auditDirectory = join(temporaryRoot, 'audit');
const npmCacheDirectory = join(temporaryRoot, 'npm-cache');
const expectedRepository = 'git+https://github.com/tileflow/tileflow-sdk.git';
const expectedBugs = 'https://github.com/tileflow/tileflow-sdk/issues';
const canonicalLegalFiles = new Map(
  await Promise.all(
    packageLegalFileNames.map(async (name) => [
      name,
      await readFile(join(repositoryRoot, name), 'utf8'),
    ]),
  ),
);
let server;

try {
  const releasePlan = suppliedReleasePlan
    ? validateReleasePlan(JSON.parse(await readFile(resolve(suppliedReleasePlan), 'utf8')))
    : null;
  await Promise.all([
    mkdir(packDirectory, {recursive: true}),
    mkdir(consumerDirectory, {recursive: true}),
    mkdir(auditDirectory, {recursive: true}),
  ]);

  const tarballs = suppliedPackDirectory
    ? await discoverTarballs(packDirectory)
    : await packRequiredPackages(packDirectory);
  const expectedNames = publicPackageNames;
  const requiredNames = expectedNames;
  assert.equal(tarballs.size, expectedNames.length, 'Unexpected number of packed packages.');
  for (const name of expectedNames) {
    assert.ok(tarballs.has(name), `Packed smoke is missing ${name}.`);
  }
  const packedVersions = new Map(
    await Promise.all(
      expectedNames.map(async (name) => {
        const manifest = JSON.parse(
          await readTarballFile(tarballs.get(name), 'package/package.json'),
        );
        return [name, manifest.version];
      }),
    ),
  );
  const releaseContext = releasePlan
    ? {
        baselines: new Map(releasePlan.baselines.map((baseline) => [baseline.name, baseline])),
        releases: new Map(releasePlan.packages.map((release) => [release.name, release])),
        versions: new Map(releasePlan.baselines.map(({name, version}) => [name, version])),
      }
    : null;
  if (releaseContext) {
    for (const release of releasePlan.packages) {
      releaseContext.versions.set(release.name, release.to);
    }
    for (const name of expectedNames) {
      assert.equal(
        packedVersions.get(name),
        releaseContext.versions.get(name),
        `${name} packed smoke version differs from its release plan.`,
      );
    }
  }

  const audit = [];
  for (const name of expectedNames) {
    audit.push(await auditPublicTarball(name, tarballs.get(name), packedVersions, releaseContext));
  }

  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({name: 'tileflow-public-capture-smoke', private: true, type: 'module'}, null, 2)}\n`,
  );
  await run(
    npmCommand(),
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      ...requiredNames.map((name) => tarballs.get(name)),
    ],
    {
      cwd: consumerDirectory,
      env: {...process.env, npm_config_cache: npmCacheDirectory},
      label: 'clean packed-package install',
    },
  );

  const coreBrowserImport = join(consumerDirectory, 'import-core-browser.mjs');
  await writeFile(
    coreBrowserImport,
    `for (const name of ['window', 'document', 'navigator', 'requestAnimationFrame', 'ResizeObserver']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { throw new Error('browser global read during import: ' + name); },
  });
}
const entry = await import('@tileflow/core/browser');
if (typeof entry.attachTileflowMapLifecycle !== 'function') process.exit(2);
`,
  );
  await run(process.execPath, [coreBrowserImport], {
    cwd: consumerDirectory,
    label: 'packed core browser import without DOM',
  });

  const publicImports = join(consumerDirectory, 'import-public-packages.mjs');
  await writeFile(
    publicImports,
    `const expectations = ${JSON.stringify({
      '@tileflow/capture': [
        'createTileflowCaptureSession',
        'compareTileflowCapturesForReview',
        'createTileflowVisualReviewDocument',
        'tileflowVisualReviewLimits',
        'TileflowVisualReviewError',
      ],
      '@tileflow/capture/receipt': ['parseTileflowCaptureReceipt'],
      '@tileflow/dev': ['createTileflowBuildArtifacts'],
      '@tileflow/interactions': ['validateTileflowAnnotations'],
      '@tileflow/interactions/maplibre': ['createTileflowAnnotationRegistry'],
      '@tileflow/maps': ['streets'],
      '@tileflow/next': ['withTileflow'],
      '@tileflow/next/server': ['createTileflowRouteHandlers'],
      '@tileflow/react': ['Map'],
      '@tileflow/react/static': ['StaticMap'],
      '@tileflow/static': ['normalizeStaticScene'],
      '@tileflow/static/client': ['createStaticMap'],
      '@tileflow/static/manifest': ['createRenderManifest'],
      '@tileflow/static/overlays': ['compileStaticOverlays'],
      '@tileflow/static/scene': ['validateStaticScene'],
      '@tileflow/vite': ['tileflow'],
      '@tileflow/vue': ['TileflowMap'],
      '@tileflow/webpack': ['TileflowWebpackPlugin'],
    })};
for (const [name, symbols] of Object.entries(expectations)) {
  const entry = await import(name);
  for (const symbol of symbols) {
    if (typeof entry[symbol] !== 'function' && typeof entry[symbol] !== 'object') {
      throw new Error(name + ' does not export ' + symbol + ' from its packed entry point');
    }
  }
}
const capture = await import('@tileflow/capture');
if (capture.tileflowVisualReviewSchemaVersion !== 1) {
  throw new Error('@tileflow/capture does not export the visual review schema version');
}
if (capture.tileflowVisualReviewLimits.maximumAggregatePngBytes !== 256 * 1024 * 1024) {
  throw new Error('@tileflow/capture does not export the visual review aggregate PNG limit');
}
if (new capture.TileflowVisualReviewError('packed proof').code !== 'VISUAL_REVIEW_INVALID') {
  throw new Error('@tileflow/capture does not export the stable visual review error code');
}
`,
  );
  await run(process.execPath, [publicImports], {
    cwd: consumerDirectory,
    label: 'packed public package entry imports',
  });

  const captureReviewTypes = join(consumerDirectory, 'consume-capture-review-types.ts');
  await writeFile(
    captureReviewTypes,
    `import {
  compareTileflowCapturesForReview,
  createTileflowVisualReviewDocument,
  tileflowVisualReviewLimits,
  tileflowVisualReviewSchemaVersion,
  TileflowVisualReviewError,
  type TileflowVisualReviewCapture,
  type TileflowVisualReviewComparison,
  type TileflowVisualReviewDefinition,
  type TileflowVisualReviewDocument,
  type TileflowVisualReviewFrameIdentity,
  type TileflowVisualReviewOptions,
  type TileflowVisualReviewSide,
  type TileflowVisualReviewStatus,
} from '@tileflow/capture';

async function consumePackedReview(
  left: TileflowVisualReviewCapture,
  right: TileflowVisualReviewCapture,
): Promise<TileflowVisualReviewDocument> {
  const options: TileflowVisualReviewOptions = {includeDiff: true};
  const comparison: TileflowVisualReviewComparison =
    await compareTileflowCapturesForReview(left, right, options);
  const definition: TileflowVisualReviewDefinition = left.definition;
  const frame: TileflowVisualReviewFrameIdentity = comparison.left.frame;
  const side: TileflowVisualReviewSide = comparison.right;
  const status: TileflowVisualReviewStatus = comparison.status;
  void definition;
  void frame;
  void side;
  void status;
  return createTileflowVisualReviewDocument(comparison);
}

const schemaVersion: 1 = tileflowVisualReviewSchemaVersion;
const aggregateLimit: number = tileflowVisualReviewLimits.maximumAggregatePngBytes;
const reviewError: TileflowVisualReviewError = new TileflowVisualReviewError('type proof');
void schemaVersion;
void aggregateLimit;
void reviewError;
void consumePackedReview;
`,
  );
  await run(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve('typescript/bin/tsc')),
      '--noEmit',
      '--strict',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--types',
      'node',
      '--typeRoots',
      join(repositoryRoot, 'node_modules/@types'),
      captureReviewTypes,
    ],
    {
      cwd: consumerDirectory,
      label: 'packed capture visual-review TypeScript consumer',
    },
  );

  const svelteCompile = join(consumerDirectory, 'compile-public-svelte.mjs');
  await writeFile(
    svelteCompile,
    `import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {compile} from 'svelte/compiler';

const componentUrl = import.meta.resolve('@tileflow/svelte/TileflowMap.svelte');
const source = await readFile(fileURLToPath(componentUrl), 'utf8');
const result = compile(source, {filename: 'TileflowMap.svelte', generate: 'server'});
if (!result.js?.code.includes('TileflowMap')) {
  throw new Error('@tileflow/svelte did not compile to a server component');
}
`,
  );
  await run(process.execPath, [svelteCompile], {
    cwd: consumerDirectory,
    label: 'packed Svelte component compilation',
  });

  const packedCli = JSON.parse(
    await readTarballFile(tarballs.get('@tileflow/cli'), 'package/package.json'),
  );
  const installedCli = JSON.parse(
    await readFile(join(consumerDirectory, 'node_modules/@tileflow/cli/package.json'), 'utf8'),
  );
  assert.equal(installedCli.version, packedCli.version);

  const systemBrowserSentinel = join(temporaryRoot, 'system-browser-was-used');
  const trapDirectory = join(temporaryRoot, 'browser-traps');
  await mkdir(trapDirectory);
  for (const command of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const trapPath = join(trapDirectory, command);
    await writeFile(
      trapPath,
      `#!/bin/sh\nprintf used > ${shellQuote(systemBrowserSentinel)}\nexit 91\n`,
    );
    await chmod(trapPath, 0o755);
  }
  const isolatedEnvironment = {
    ...process.env,
    PATH: `${trapDirectory}${delimiter}${process.env.PATH ?? ''}`,
    TILEFLOW_API_KEY: '',
  };
  const cliEntry = join(consumerDirectory, 'node_modules/@tileflow/cli/dist/index.js');
  assert.ok(existsSync(cliEntry), 'The packed CLI entry point was not installed locally.');

  server = createServer((request, response) => {
    const path = request.url?.split('?')[0] ?? '/';
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (path.endsWith('.pbf')) {
      response.writeHead(200, {'content-type': 'application/x-protobuf'});
      response.end(Buffer.alloc(0));
      return;
    }
    if (path !== '/') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(
      '<!doctype html><style>html,body{margin:0}.proof{width:192px;height:128px;background:#2468ac}</style><div class="proof" data-tileflow-map="proof" data-tileflow-theme="light" data-tileflow-capture-id="proof" data-tileflow-state="idle"></div>',
    );
  });
  const origin = await listenLoopback(server);
  await writeFile(
    join(consumerDirectory, 'tileflow.config.ts'),
    `import {
  buildings,
  labels,
  openMapTiles,
  poi,
  roads,
  vectorTiles,
  defineRootMap,
} from '@tileflow/core';
import {streetsThemes} from '@tileflow/maps';

export default defineRootMap({
      id: 'proof',
      version: 1,
      root: {compiler: 'streets', compilerVersion: 1},
      defaultTheme: 'light',
      themes: {light: streetsThemes.light},
      data: vectorTiles({
        attribution: '© OpenStreetMap contributors',
        bounds: [-180, -85, 180, 85],
        maxzoom: 14,
        minzoom: 0,
        revision: 'packed-fixture-1',
        schema: openMapTiles(),
        tiles: [${JSON.stringify(`${origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
      }),
      glyphs: {
        kind: 'url',
        url: ${JSON.stringify(`${origin}/fonts/{fontstack}/{range}.pbf`)},
        fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
      },
      modules: {
        buildings: buildings({enabled: false}),
        labels: labels({places: 'none', roads: 'none', water: 'none'}),
        poi: poi({enabled: false}),
        roads: roads({
          detail: 'all', hierarchy: 'clear', outline: 'strong', weight: 'regular',
          extras: {paths: true},
        }),
      },
      scenes: {
        generated: {
          theme: 'light',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 192, height: 128, dpr: 1},
        },
        application: {
          theme: 'light',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 192, height: 128, dpr: 1},
          target: {kind: 'application', path: '/', captureId: 'proof'},
        },
      },
});
`,
  );
  await writeFile(
    join(consumerDirectory, 'tileflow.workspace.ts'),
    `import proof from './tileflow.config';

export default {
  maps: {proof},
};
`,
  );

  const standaloneCapture = await run(
    process.execPath,
    [cliEntry, 'capture', 'generated', '--config', 'tileflow.workspace.ts', '--json'],
    {
      cwd: consumerDirectory,
      env: isolatedEnvironment,
      label: 'packed CLI standalone generated capture before setup',
    },
  );
  const standaloneDocument = JSON.parse(standaloneCapture.stdout);
  assert.equal(standaloneDocument.schemaVersion, 1);
  assert.equal(standaloneDocument.command, 'capture');
  assert.equal(standaloneDocument.captures?.length, 1);
  const standaloneEntry = standaloneDocument.captures[0];
  assert.deepEqual(
    {
      dpr: standaloneEntry.dpr,
      height: standaloneEntry.height,
      map: standaloneEntry.map,
      networkDependent: standaloneEntry.networkDependent,
      scene: standaloneEntry.scene,
      status: standaloneEntry.status,
      target: standaloneEntry.target,
      theme: standaloneEntry.theme,
      width: standaloneEntry.width,
      warnings: standaloneEntry.warnings,
    },
    {
      dpr: 1,
      height: 128,
      map: 'proof',
      networkDependent: false,
      scene: 'generated',
      status: 'captured',
      target: 'map',
      theme: 'light',
      width: 192,
      warnings: [],
    },
  );
  const standalonePng = await readFile(join(consumerDirectory, standaloneEntry.outputPath));
  assert.deepEqual([...standalonePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const standaloneSha256 = createHash('sha256').update(standalonePng).digest('hex');
  assert.equal(standaloneEntry.sha256, standaloneSha256);
  const standaloneReceipt = JSON.parse(
    await readFile(join(consumerDirectory, standaloneEntry.receiptPath), 'utf8'),
  );
  assert.equal(standaloneReceipt.image.sha256, standaloneSha256);
  assert.equal(standaloneReceipt.image.physicalWidth, 192);
  assert.equal(standaloneReceipt.image.physicalHeight, 128);
  assert.equal(standaloneReceipt.networkDependent, false);
  assert.equal(standaloneReceipt.schemaVersion, 4);
  assert.equal(standaloneReceipt.scene.theme, 'light');
  assert.equal(standaloneReceipt.data.kind, 'vector-tiles');
  assert.equal(standaloneReceipt.data.schema, 'openmaptiles');
  assert.equal(standaloneReceipt.data.schemaVersion, 1);
  assert.equal(standaloneReceipt.data.sourceId, 'tileflow');
  assert.equal(standaloneReceipt.data.source?.kind, 'loopback');
  assert.match(standaloneReceipt.data.source?.sha256 ?? '', /^[a-f0-9]{64}$/u);
  assert.equal('url' in standaloneReceipt.data, false);
  assert.deepEqual(standaloneReceipt.verification, {data: 'rendered', style: 'rendered'});
  assert.equal(standaloneReceipt.renderer.playwright, '1.62.1');
  assert.equal(standaloneReceipt.renderer.chromiumRevision, '1234');

  const setup = await run(
    process.execPath,
    [cliEntry, 'setup', 'capture', '--json', '--no-browser-install'],
    {
      cwd: consumerDirectory,
      env: isolatedEnvironment,
      label: 'packed CLI prepared-browser verification after capture',
    },
  );
  const setupDocument = JSON.parse(setup.stdout);
  assert.deepEqual(
    {
      command: setupDocument.command,
      chromiumRevision: setupDocument.renderer?.chromiumRevision,
      playwright: setupDocument.renderer?.playwright,
      schemaVersion: setupDocument.schemaVersion,
      status: setupDocument.status,
    },
    {
      command: 'setup.capture',
      chromiumRevision: '1234',
      playwright: '1.62.1',
      schemaVersion: 1,
      status: 'ready',
    },
  );

  const applicationCapture = await run(
    process.execPath,
    [
      cliEntry,
      'capture',
      'application',
      '--config',
      'tileflow.workspace.ts',
      '--app-origin',
      origin,
      '--json',
      '--no-browser-install',
    ],
    {
      cwd: consumerDirectory,
      env: isolatedEnvironment,
      label: 'packed CLI application capture',
    },
  );
  const captureDocument = JSON.parse(applicationCapture.stdout);
  assert.equal(captureDocument.schemaVersion, 1);
  assert.equal(captureDocument.command, 'capture');
  assert.equal(captureDocument.captures?.length, 1);
  const entry = captureDocument.captures[0];
  assert.deepEqual(
    {
      dpr: entry.dpr,
      height: entry.height,
      map: entry.map,
      networkDependent: entry.networkDependent,
      scene: entry.scene,
      status: entry.status,
      target: entry.target,
      theme: entry.theme,
      width: entry.width,
    },
    {
      dpr: 1,
      height: 128,
      map: 'proof',
      networkDependent: false,
      scene: 'application',
      status: 'captured',
      target: 'application',
      theme: 'light',
      width: 192,
    },
  );
  assert.match(entry.outputPath, /^\.tileflow\/captures\/application\.png$/u);
  assert.match(entry.receiptPath, /^\.tileflow\/captures\/application\.receipt\.json$/u);

  const png = await readFile(join(consumerDirectory, entry.outputPath));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const sha256 = createHash('sha256').update(png).digest('hex');
  assert.equal(entry.sha256, sha256);
  const receipt = JSON.parse(await readFile(join(consumerDirectory, entry.receiptPath), 'utf8'));
  assert.equal(receipt.schemaVersion, 4);
  assert.equal(receipt.scene.theme, 'light');
  assert.equal(receipt.image.sha256, sha256);
  assert.equal(receipt.image.physicalWidth, 192);
  assert.equal(receipt.image.physicalHeight, 128);
  assert.equal(receipt.networkDependent, false);
  assert.equal(receipt.data.kind, 'vector-tiles');
  assert.equal(receipt.data.schema, 'openmaptiles');
  assert.equal(receipt.data.schemaVersion, 1);
  assert.equal(receipt.data.sourceId, 'tileflow');
  assert.equal(receipt.data.source?.kind, 'loopback');
  assert.match(receipt.data.source?.sha256 ?? '', /^[a-f0-9]{64}$/u);
  assert.equal('url' in receipt.data, false);
  assert.deepEqual(receipt.verification, {
    data: 'expected-unverified',
    style: 'expected-unverified',
  });
  assert.equal(receipt.renderer.playwright, '1.62.1');
  assert.equal(receipt.renderer.chromiumRevision, '1234');

  const packedReviewInput = join(consumerDirectory, 'packed-review-input.json');
  await writeFile(
    packedReviewInput,
    `${JSON.stringify({application: entry, standalone: standaloneEntry}, null, 2)}\n`,
  );
  const packedReviewRuntime = join(consumerDirectory, 'run-packed-capture-review.mjs');
  await writeFile(
    packedReviewRuntime,
    `import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  compareTileflowCapturesForReview,
  createTileflowVisualReviewDocument,
  parseTileflowCaptureReceipt,
} from '@tileflow/capture';
import {normalizeTileflowCaptureScene} from '@tileflow/core';

const input = JSON.parse(await readFile(new URL('./packed-review-input.json', import.meta.url), 'utf8'));

async function loadCapture(entry) {
  const [png, receiptSource] = await Promise.all([
    readFile(join(process.cwd(), entry.outputPath)),
    readFile(join(process.cwd(), entry.receiptPath), 'utf8'),
  ]);
  const receipt = parseTileflowCaptureReceipt(receiptSource);
  assert.equal(receipt.schemaVersion, 4);
  return {
    scene: entry.scene,
    map: entry.map,
    theme: entry.theme,
    target: entry.target,
    png,
    sha256: entry.sha256,
    sceneSha256: receipt.scene.sha256,
    styleSha256: receipt.style.sha256,
    width: entry.width,
    height: entry.height,
    dpr: entry.dpr,
    networkDependent: entry.networkDependent,
    renderer: entry.renderer,
    receipt,
    warnings: entry.warnings,
  };
}

const standalone = await loadCapture(input.standalone);
const application = await loadCapture(input.application);
const standaloneDefinition = normalizeTileflowCaptureScene({
  map: 'proof',
  theme: 'light',
  camera: {type: 'center', center: [0, 0], zoom: 1},
  viewport: {width: 192, height: 128, dpr: 1},
  target: {kind: 'map'},
});
const applicationDefinition = normalizeTileflowCaptureScene({
  map: 'proof',
  theme: 'light',
  camera: {type: 'center', center: [0, 0], zoom: 1},
  viewport: {width: 192, height: 128, dpr: 1},
  target: {kind: 'application', path: '/', captureId: 'proof'},
});

const comparable = await compareTileflowCapturesForReview(
  {capture: standalone, definition: standaloneDefinition},
  {capture: standalone, definition: standaloneDefinition},
  {includeDiff: true},
);
assert.equal(comparable.schemaVersion, 1);
assert.equal(comparable.kind, 'style-review');
assert.equal(comparable.status, 'comparable');
assert.equal(comparable.exact?.changedPixels, 0);
assert.equal(comparable.perceptual?.changedPixels, 0);
assert.equal(comparable.meanAbsoluteChannelDifference, 0);
assert.ok(comparable.diffPng instanceof Uint8Array);
const document = createTileflowVisualReviewDocument(comparable);
assert.equal(Object.hasOwn(document, 'diffPng'), false);

const frameMismatch = await compareTileflowCapturesForReview(
  {capture: standalone, definition: standaloneDefinition},
  {capture: application, definition: applicationDefinition},
  {includeDiff: true},
);
assert.equal(frameMismatch.status, 'frame-mismatch');
assert.equal(frameMismatch.exact, null);
assert.equal(Object.hasOwn(frameMismatch, 'diffPng'), false);

process.stdout.write(JSON.stringify({
  schemaVersion: comparable.schemaVersion,
  status: comparable.status,
  incompatibleStatus: frameMismatch.status,
}) + '\\n');
`,
  );
  const packedReview = await run(process.execPath, [packedReviewRuntime], {
    cwd: consumerDirectory,
    env: isolatedEnvironment,
    label: 'packed capture visual-review execution',
  });
  const packedReviewDocument = JSON.parse(packedReview.stdout);
  assert.deepEqual(packedReviewDocument, {
    schemaVersion: 1,
    status: 'comparable',
    incompatibleStatus: 'frame-mismatch',
  });
  assert.equal(
    existsSync(systemBrowserSentinel),
    false,
    'Capture invoked a system browser command.',
  );

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        command: 'capture.public-smoke',
        status: 'passed',
        installedCli: `${installedCli.name}@${installedCli.version}`,
        renderer: setupDocument.renderer,
        capture: {
          scene: standaloneEntry.scene,
          sha256: standaloneSha256,
          width: standaloneEntry.width,
          height: standaloneEntry.height,
          networkDependent: standaloneEntry.networkDependent,
        },
        review: packedReviewDocument,
        tarballs: audit,
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await closeServer(server);
  await rm(temporaryRoot, {force: true, recursive: true});
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith('--'), `${flag} requires a path.`);
  return value;
}

async function packRequiredPackages(directory) {
  const packages = publicPackageNames.map((name) => name.replace('@tileflow/', ''));
  const tarballs = new Map();
  for (const packageDirectory of packages) {
    const sourceRoot = join(repositoryRoot, 'packages', packageDirectory);
    const stagingRoot = join(temporaryRoot, 'staging', packageDirectory);
    await cp(sourceRoot, stagingRoot, {recursive: true});
    const manifestPath = join(stagingRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = '0.1.0-alpha.16';
    for (const dependencyGroup of [...runtimeDependencyGroups, 'devDependencies']) {
      for (const [dependency, range] of Object.entries(manifest[dependencyGroup] ?? {})) {
        if (!publicPackageNameSet.has(dependency) || !range.startsWith('workspace:')) continue;
        manifest[dependencyGroup][dependency] =
          dependencyGroup === 'devDependencies'
            ? '0.1.0-alpha.16'
            : range.slice('workspace:'.length);
      }
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await run(pnpmCommand(), ['pack', '--pack-destination', directory, '--json'], {
      cwd: stagingRoot,
      label: `pack @tileflow/${packageDirectory}`,
    });
    const packed = JSON.parse(result.stdout);
    tarballs.set(packed.name, resolve(packed.filename));
  }
  return tarballs;
}

async function discoverTarballs(directory) {
  const tarballs = new Map();
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.tgz')) continue;
    const path = join(directory, name);
    const manifest = JSON.parse(await readTarballFile(path, 'package/package.json'));
    tarballs.set(manifest.name, path);
  }
  return tarballs;
}

async function auditPublicTarball(packageName, tarball, packedVersions, releaseContext) {
  assert.ok(tarball, `Missing tarball for ${packageName}.`);
  const listing = await run('tar', ['-tzf', tarball], {label: `list ${packageName} tarball`});
  const entries = listing.stdout.trim().split('\n').filter(Boolean);
  const manifest = JSON.parse(await readTarballFile(tarball, 'package/package.json'));
  const forbiddenPath =
    /(?:^|\/)(?:test|tests|fixtures?|captures?|\.tileflow|ms-playwright|chromium)(?:\/|$)|\.png$|\.receipt\.json$|\.map$/iu;
  const forbiddenNativeDependency =
    /(?:^|\/)node_modules(?:\/|$)|\.(?:node|dylib|dll)$|\.so(?:\.\d+)*$/iu;
  for (const entry of entries) {
    assert.equal(forbiddenPath.test(entry), false, `Unexpected packed path: ${entry}`);
    assert.equal(
      forbiddenNativeDependency.test(entry),
      false,
      `Tileflow tarball must not contain an installed native dependency: ${entry}`,
    );
  }
  const entryPoints = manifestEntryPoints(manifest);
  assert.ok(entryPoints.size > 0, `${packageName} does not declare a public entry point.`);
  for (const entryPoint of entryPoints) {
    assert.ok(
      entries.includes(`package/${entryPoint.slice(2)}`),
      `${packageName} tarball is missing declared entry point ${entryPoint}.`,
    );
  }
  assert.ok(entries.includes('package/README.md'));
  assert.equal(manifest.license, publicLicenseIdentifier);
  for (const fileName of packageLegalFileNames) {
    assert.ok(entries.includes(`package/${fileName}`), `${packageName} is missing ${fileName}.`);
    assert.equal(
      await readTarballFile(tarball, `package/${fileName}`),
      canonicalLegalFiles.get(fileName),
      `${packageName} ${fileName} differs from the repository copy.`,
    );
  }
  if (packageName === '@tileflow/capture') {
    assert.ok(
      entries.includes('package/THIRD_PARTY_NOTICES.md'),
      'Capture tarball is missing third-party notices.',
    );
  }
  if (packageName === '@tileflow/core') {
    assert.ok(
      entries.includes('package/THIRD_PARTY_NOTICES.md'),
      'Core tarball is missing embedded browser dependency notices.',
    );
  }
  if (packageName === '@tileflow/maps') {
    assert.ok(
      entries.includes('package/THIRD_PARTY_NOTICES.md'),
      'Maps tarball is missing official-map notices.',
    );
    const sourceAssetRoot = join(repositoryRoot, 'packages', 'maps', 'assets');
    const expectedAssetEntries = (await listFiles(sourceAssetRoot))
      .map((path) => `package/assets/${relative(sourceAssetRoot, path).replaceAll('\\', '/')}`)
      .sort();
    const packedAssetEntries = entries
      .filter((entry) => entry.startsWith('package/assets/') && !entry.endsWith('/'))
      .sort();
    assert.deepEqual(
      packedAssetEntries,
      expectedAssetEntries,
      'Maps tarball assets differ from the complete official source inventory.',
    );
  }
  if (packageName === '@tileflow/dev') {
    assert.ok(
      entries.includes('package/THIRD_PARTY_NOTICES.md'),
      'Dev tarball is missing sharp/libvips notices.',
    );
    assert.equal(manifest.optionalDependencies?.sharp, '0.35.3');
  }

  assert.equal(manifest.name, packageName);
  assert.equal(manifest.publishConfig?.access, 'public');
  assert.equal(manifest.publishConfig?.registry, undefined);
  assert.equal(manifest.repository?.url, expectedRepository);
  assert.equal(manifest.bugs?.url, expectedBugs);
  assert.equal(JSON.stringify(manifest).includes('workspace:'), false);
  const runtimeDependencies = runtimeDependencySnapshot(manifest);
  if (releaseContext?.releases.has(packageName)) {
    assert.deepEqual(
      runtimeDependencies,
      releaseContext.releases.get(packageName).runtimeDependencies,
      `${packageName} packed smoke topology differs from its release plan.`,
    );
    assertSelectedRuntimeDependencies(packageName, runtimeDependencies, releaseContext.versions);
  } else if (releaseContext) {
    assert.deepEqual(
      runtimeDependencies,
      releaseContext.baselines.get(packageName).runtimeDependencies,
      `${packageName} unselected packed smoke ranges differ from npm baseline.`,
    );
  }
  for (const dependencyGroup of runtimeDependencyGroups) {
    for (const [dependency, range] of Object.entries(manifest[dependencyGroup] ?? {})) {
      if (publicPackageNameSet.has(dependency)) {
        const rangeKind = validatePublishedInternalRuntimeRange(range);
        if (rangeKind === 'automatic-range') {
          assert.equal(
            semver.satisfies(packedVersions.get(dependency), range, {includePrerelease: true}),
            true,
            `${packageName} must accept packed ${dependency}@${packedVersions.get(dependency)}.`,
          );
        }
      }
    }
  }
  for (const [dependency, range] of Object.entries(manifest.devDependencies ?? {})) {
    if (!publicPackageNameSet.has(dependency)) continue;
    assert.ok(
      range === packedVersions.get(dependency) || range === internalRuntimeRange,
      `${packageName} has an unexpected development-only range for ${dependency}: ${range}.`,
    );
  }

  const target = join(auditDirectory, packageName.replace('@tileflow/', ''));
  await mkdir(target, {recursive: true});
  await run('tar', ['-xzf', tarball, '-C', target], {label: `extract ${packageName} tarball`});
  const paths = await listFiles(target);
  let unpackedBytes = 0;
  for (const path of paths) {
    const metadata = await stat(path);
    unpackedBytes += metadata.size;
    if (!/\.(?:js|ts|json|md|txt)$/iu.test(path)) continue;
    const text = await readFile(path, 'utf8');
    assert.equal(
      text.includes(repositoryRoot),
      false,
      `Packed file contains repository path: ${path}`,
    );
    assert.equal(text.includes(homedir()), false, `Packed file contains home path: ${path}`);
    assert.equal(
      /tf_(?:live|test)_[A-Za-z0-9_-]{8,}/u.test(text),
      false,
      `Packed file contains a credential-shaped value: ${path}`,
    );
  }
  return {
    package: packageName,
    file: basename(tarball),
    compressedBytes: (await stat(tarball)).size,
    unpackedBytes,
    fileCount: paths.length,
  };
}

function manifestEntryPoints(manifest) {
  const entryPoints = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./') && !value.includes('*')) entryPoints.add(value);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) visit(child);
  };
  visit(manifest.bin);
  visit(manifest.exports);
  visit(manifest.main);
  visit(manifest.module);
  visit(manifest.types);
  return entryPoints;
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
    else assert.fail(`Packed tarball contains a non-regular entry: ${path}`);
  }
  return files;
}

async function readTarballFile(tarball, path) {
  return (await run('tar', ['-xOf', tarball, path], {label: `read ${path}`})).stdout;
}

function run(command, args, options = {}) {
  return runCommand(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    label: options.label,
  });
}

function listenLoopback(httpServer) {
  return new Promise((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.removeListener('error', rejectListen);
      const address = httpServer.address();
      assert.ok(address && typeof address === 'object');
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(httpServer) {
  return new Promise((resolveClose, rejectClose) => {
    httpServer.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}
