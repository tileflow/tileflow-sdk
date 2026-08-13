import next from 'next';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer, type Server as NodeServer, Server} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import webpack from 'webpack';
import {createTileflowCaptureSession} from '../src/index';

const execFileAsync = promisify(execFile);

test(
  'captures a wrapper map through one Next application server and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async () => {
    const fixture = await createFrameworkFixture('next');
    await buildNextFixture(fixture.cwd);
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
  'captures a wrapper map from a Webpack application through one server and no Tileflow listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const fixture = await createFrameworkFixture('webpack');
    const outputDirectory = join(fixture.cwd, 'dist');
    await mkdir(outputDirectory);
    const compiler = webpack({
      devtool: false,
      entry: join(fixture.cwd, 'main.js'),
      mode: 'development',
      output: {filename: 'bundle.js', path: outputDirectory},
      target: 'web',
    });
    await runWebpack(compiler);
    const server = createServer(async (request, response) => {
      if (request.url === '/bundle.js') {
        response.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8'});
        response.end(await readFile(join(outputDirectory, 'bundle.js')));
        return;
      }
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(
        '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
      );
    });
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

async function createFrameworkFixture(kind: 'next' | 'webpack') {
  const cwd = await mkdtemp(join(tmpdir(), `tileflow-${kind}-capture-`));
  const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  await symlink(join(packageRoot, 'node_modules'), join(cwd, 'node_modules'), 'dir');
  await writeFile(join(cwd, 'tileflow.config.ts'), tileflowConfig, 'utf8');

  if (kind === 'next') {
    await mkdir(join(cwd, 'pages'));
    await writeFile(join(cwd, 'pages', 'index.js'), applicationSource, 'utf8');
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n', 'utf8');
  } else {
    await writeFile(join(cwd, 'main.js'), browserApplicationSource, 'utf8');
  }

  return {cwd};
}

const imageUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=';
const applicationSource = `import React from 'react';
import {Map} from '@tileflow/react';
export default function Page() {
  return React.createElement('div', {style: {width: 222}}, React.createElement(Map, {captureId: 'proof', height: 100, imageUrl: '${imageUrl}', map: 'main', mode: 'image'}));
}
`;
const browserApplicationSource = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {Map} from '@tileflow/react';
document.documentElement.style.margin = '0';
document.body.style.margin = '0';
const frame = React.createElement('div', {style: {width: 222}}, React.createElement(Map, {captureId: 'proof', height: 100, imageUrl: '${imageUrl}', map: 'main', mode: 'image'}));
createRoot(document.getElementById('root')).render(frame);
`;
const tileflowConfig = `export default {
  maps: {main: {}},
  scenes: {proof: {map: 'main', camera: {type: 'center', center: [0, 0], zoom: 1}, viewport: {width: 320, height: 480}, target: {kind: 'application', path: '/', captureId: 'proof'}}}
};
`;

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

async function buildNextFixture(cwd: string): Promise<void> {
  const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
  await execFileAsync(process.execPath, [nextCli, 'build', cwd, '--webpack'], {
    cwd,
    env: {...process.env, NEXT_TELEMETRY_DISABLED: '1'},
    maxBuffer: 10 * 1024 * 1024,
  });
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
