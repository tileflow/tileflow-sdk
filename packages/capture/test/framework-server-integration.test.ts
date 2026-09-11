import next from 'next';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer, type Server as NodeServer, Server} from 'node:http';
import {dirname, join, relative, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import webpack from 'webpack';
import {TileflowWebpackPlugin} from '@tileflow/webpack';
import {createTileflowCaptureSession} from '../src/index';

const execFileAsync = promisify(execFile);

test(
  'captures an interactive wrapper map through one Next application server and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async () => {
    const fixture = await createFrameworkFixture('next');
    await buildNextFixture(fixture.cwd, 'webpack');
    const port = await reservePort();
    const application = next({
      dev: false,
      dir: fixture.cwd,
      hostname: '127.0.0.1',
      port,
    });
    let server: NodeServer | undefined;

    try {
      await application.prepare();
      server = createServer(application.getRequestHandler());
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      const capture = await captureFromOnlyApplicationServer(
        fixture.cwd,
        `http://127.0.0.1:${port}`,
      );
      assert.equal(capture.target, 'application');
      assert.equal(capture.width, 222);
      assert.equal(capture.height, 240);
    } finally {
      await closeServer(server);
      await application.close();
      await rm(fixture.cwd, {force: true, recursive: true});
    }
  },
);

test(
  'captures an interactive wrapper map through a default Next application server and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async () => {
    const fixture = await createFrameworkFixture('next');
    await buildNextFixture(fixture.cwd, 'default');
    const port = await reservePort();
    const application = next({
      dev: false,
      dir: fixture.cwd,
      hostname: '127.0.0.1',
      port,
    });
    let server: NodeServer | undefined;

    try {
      await application.prepare();
      server = createServer(application.getRequestHandler());
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      const capture = await captureFromOnlyApplicationServer(
        fixture.cwd,
        `http://127.0.0.1:${port}`,
      );
      assert.equal(capture.target, 'application');
      assert.equal(capture.width, 222);
      assert.equal(capture.height, 240);
    } finally {
      await closeServer(server);
      await application.close();
      await rm(fixture.cwd, {force: true, recursive: true});
    }
  },
);

test(
  'captures an interactive wrapper map through a Next basePath and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async () => {
    const fixture = await createFrameworkFixture('next', {basePath: '/app'});
    await buildNextFixture(fixture.cwd, 'default');
    const port = await reservePort();
    const application = next({
      dev: false,
      dir: fixture.cwd,
      hostname: '127.0.0.1',
      port,
    });
    let server: NodeServer | undefined;

    try {
      await application.prepare();
      server = createServer(application.getRequestHandler());
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      const capture = await captureFromOnlyApplicationServer(
        fixture.cwd,
        `http://127.0.0.1:${port}`,
      );
      assert.equal(capture.target, 'application');
      assert.equal(capture.width, 222);
      assert.equal(capture.height, 240);
    } finally {
      await closeServer(server);
      await application.close();
      await rm(fixture.cwd, {force: true, recursive: true});
    }
  },
);

test(
  'captures an interactive wrapper map from a Webpack application through one server and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const fixture = await createFrameworkFixture('webpack');
    const outputDirectory = join(fixture.cwd, 'dist');
    await mkdir(outputDirectory);
    const compiler = webpack({
      context: fixture.cwd,
      devtool: false,
      entry: join(fixture.cwd, 'main.js'),
      mode: 'development',
      output: {filename: 'bundle.js', path: outputDirectory, publicPath: '/'},
      plugins: [new TileflowWebpackPlugin()],
      target: 'web',
    });
    await runWebpack(compiler);
    assert.equal(
      JSON.parse(await readFile(join(outputDirectory, 'tileflow/manifest.json'), 'utf8')).version,
      1,
    );
    const server = createWebpackApplicationServer(outputDirectory, '/');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    try {
      const capture = await captureFromOnlyApplicationServer(
        fixture.cwd,
        `http://127.0.0.1:${address.port}`,
      );
      assert.equal(capture.target, 'application');
      assert.equal(capture.width, 222);
      assert.equal(capture.height, 240);
    } finally {
      await closeServer(server);
      await new Promise<void>((resolveClose) => compiler.close(() => resolveClose()));
      await rm(fixture.cwd, {force: true, recursive: true});
    }
  },
);

test(
  'captures an interactive wrapper map from a Webpack publicPath through one server and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const fixture = await createFrameworkFixture('webpack', {basePath: '/app'});
    const outputDirectory = join(fixture.cwd, 'dist');
    await mkdir(outputDirectory);
    const compiler = webpack({
      context: fixture.cwd,
      devtool: false,
      entry: join(fixture.cwd, 'main.js'),
      mode: 'development',
      output: {filename: 'bundle.js', path: outputDirectory, publicPath: '/app/'},
      plugins: [new TileflowWebpackPlugin()],
      target: 'web',
    });
    await runWebpack(compiler);
    const server = createWebpackApplicationServer(outputDirectory, '/app/');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    try {
      const capture = await captureFromOnlyApplicationServer(
        fixture.cwd,
        `http://127.0.0.1:${address.port}`,
      );
      assert.equal(capture.target, 'application');
      assert.equal(capture.width, 222);
      assert.equal(capture.height, 240);
    } finally {
      await closeServer(server);
      await new Promise<void>((resolveClose) => compiler.close(() => resolveClose()));
      await rm(fixture.cwd, {force: true, recursive: true});
    }
  },
);

async function captureFromOnlyApplicationServer(cwd: string, appOrigin: string) {
  const originalListen = Server.prototype.listen;
  let additionalListeners = 0;
  Server.prototype.listen = function forbiddenAdditionalListener() {
    additionalListeners += 1;
    throw new Error('Application capture opened a second Node listener.');
  };
  const session = createTileflowCaptureSession({
    allowBrowserInstall: false,
    appOrigin,
    config: 'tileflow.config.ts',
    cwd,
  });

  try {
    const result = await session.capture(['proof']);
    assert.equal(additionalListeners, 0);
    assert.equal(result.captures.length, 1);
    return result.captures[0]!;
  } finally {
    Server.prototype.listen = originalListen;
    await session.close();
  }
}

async function createFrameworkFixture(kind: 'next' | 'webpack', options: {basePath?: string} = {}) {
  const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const cwd = await mkdtemp(join(packageRoot, `.tileflow-test-${kind}-capture-`));
  await symlink(
    join(packageRoot, 'node_modules'),
    join(cwd, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const applicationPath = options.basePath ? `${options.basePath}/` : '/';
  await writeFile(join(cwd, 'tileflow.config.ts'), createTileflowConfig(applicationPath), 'utf8');

  if (kind === 'next') {
    await mkdir(join(cwd, 'pages'));
    const maplibreDirectory = dirname(
      fileURLToPath(
        new URL('../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url),
      ),
    );
    const publicMaplibreDirectory = join(cwd, 'public', 'maplibre');
    await mkdir(publicMaplibreDirectory, {recursive: true});
    await Promise.all([
      copyFile(
        join(maplibreDirectory, 'maplibre-gl-shared.mjs'),
        join(publicMaplibreDirectory, 'maplibre-gl-shared.mjs'),
      ),
      copyFile(
        join(maplibreDirectory, 'maplibre-gl-worker.mjs'),
        join(publicMaplibreDirectory, 'maplibre-gl-worker.mjs'),
      ),
    ]);
    await writeFile(
      join(cwd, 'pages', 'index.js'),
      createNextApplicationSource(`${options.basePath ?? ''}/maplibre/maplibre-gl-worker.mjs`),
      'utf8',
    );
    await writeFile(
      join(cwd, 'next.config.mjs'),
      `import {withTileflow} from '@tileflow/next'; export default withTileflow({basePath: ${JSON.stringify(options.basePath ?? '')}});\n`,
      'utf8',
    );
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n', 'utf8');
  } else {
    await writeFile(join(cwd, 'main.js'), browserApplicationSource, 'utf8');
  }

  return {cwd};
}

function createNextApplicationSource(workerUrl: string): string {
  return `import React from 'react';
import {configureTileflowMapLibre, Map} from '@tileflow/react';

configureTileflowMapLibre({workerUrl: '${workerUrl}'});

const style = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}]};

export default function Page() {
  return React.createElement('div', {style: {width: 222}}, React.createElement(Map, {captureId: 'proof', height: 100, source: {kind: 'maplibre', style}}));
}
`;
}
const browserApplicationSource = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {configureTileflowMapLibre, Map} from '@tileflow/react';

const workerUrl = new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString();
configureTileflowMapLibre({workerUrl});

document.documentElement.style.margin = '0';
document.body.style.margin = '0';
const style = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}]};
const frame = React.createElement('div', {style: {width: 222}}, React.createElement(Map, {captureId: 'proof', height: 100, source: {kind: 'maplibre', style}}));
createRoot(document.getElementById('root')).render(frame);
`;
function createTileflowConfig(applicationPath: string): string {
  return `import {defineMap, openMapTiles, vectorTiles} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'main',
  version: 1,
  extends: streets,
  data: vectorTiles({
    attribution: '© Tileflow capture fixture',
    revision: 'capture-fixture-v1',
    schema: openMapTiles(),
    tiles: ['https://tiles.example.invalid/{z}/{x}/{y}.pbf']
  }),
  scenes: {
    proof: {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '${applicationPath}', selector: '[data-tileflow-capture-id="proof"]'}
    }
  },
  glyphs: {
    kind: 'url',
    url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  }
});
`;
}

function runWebpack(compiler: webpack.Compiler): Promise<void> {
  return new Promise((resolveBuild, rejectBuild) => {
    compiler.run((error, stats) => {
      if (error) {
        rejectBuild(error);
        return;
      }
      if (stats?.hasErrors()) {
        rejectBuild(new Error(stats.toString({all: false, errors: true})));
        return;
      }
      resolveBuild();
    });
  });
}

async function buildNextFixture(cwd: string, bundler: 'default' | 'webpack'): Promise<void> {
  const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
  const arguments_ = [nextCli, 'build', cwd];
  if (bundler === 'webpack') arguments_.push('--webpack');
  await execFileAsync(process.execPath, arguments_, {
    cwd,
    env: {...process.env, NEXT_TELEMETRY_DISABLED: '1'},
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(
    JSON.parse(await readFile(join(cwd, 'public/tileflow/manifest.json'), 'utf8')).version,
    1,
  );
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await closeServer(server);
  return port;
}

function closeServer(server: NodeServer | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function createWebpackApplicationServer(outputDirectory: string, publicPath: string): NodeServer {
  return createServer(async (request, response) => {
    const outputFile = resolveWebpackOutputFile(outputDirectory, request.url, publicPath);

    if (outputFile) {
      try {
        const output = await readFile(outputFile);
        response.writeHead(200, {'Content-Type': webpackContentType(outputFile)});
        response.end(output);
        return;
      } catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
    }

    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(
      `<!doctype html><html><body><div id="root"></div><script src="${publicPath}bundle.js"></script></body></html>`,
    );
  });
}

function resolveWebpackOutputFile(
  outputDirectory: string,
  requestUrl: string | undefined,
  publicPath: string,
): string | null {
  const pathname = new URL(requestUrl ?? '/', 'http://127.0.0.1').pathname;
  if (!pathname.startsWith(publicPath)) return null;

  const outputFile = resolve(outputDirectory, pathname.slice(publicPath.length));
  const outputRelativePath = relative(outputDirectory, outputFile);

  if (
    outputRelativePath.length === 0 ||
    outputRelativePath.startsWith('..') ||
    outputRelativePath.includes('/..')
  ) {
    return null;
  }

  return outputFile;
}

function webpackContentType(filePath: string): string {
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }

  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
