import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {withTileflow} from '../src/index';
import {createTileflowRouteHandlers} from '../src/server';

test('emits production artifacts without adding a webpack config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-'));
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    await writeFile(
      join(cwd, 'tileflow.config.ts'),
      "export default { maps: { main: { basemap: {type: 'streets', basemapVersion: 2, variant: 'light'} } } };\n",
      'utf8',
    );
    process.env.NODE_ENV = 'production';

    const config = withTileflow({}, {cwd});
    assert.equal(config.webpack, undefined);
    assert.equal(typeof config.rewrites, 'function');

    const rewrites = await config.rewrites!();
    assert.deepEqual(rewrites, []);

    const manifest = JSON.parse(
      await readFile(join(cwd, 'public/tileflow/manifest.json'), 'utf8'),
    ) as {styles?: Record<string, string>};
    assert.equal(manifest.styles?.main, '/tileflow/styles/main.json');
    assert.match(
      await readFile(join(cwd, 'public/tileflow/styles/main.json'), 'utf8'),
      /"version": 8/,
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    await rm(cwd, {force: true, recursive: true});
  }
});

test('prepends Tileflow development rewrites without replacing user rewrites', async () => {
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'development';
    const config = withTileflow({
      async rewrites() {
        return [{destination: '/existing', source: '/original'}];
      },
    });

    assert.deepEqual(await config.rewrites!(), [
      {destination: '/api/tileflow', source: '/tileflow'},
      {destination: '/api/tileflow/:path*', source: '/tileflow/:path*'},
      {destination: '/existing', source: '/original'},
    ]);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('refreshes direct style requests after a config edit without requiring a manifest request', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-server-'));
  const configPath = join(cwd, 'tileflow.config.ts');
  try {
    await writeFile(configPath, configWithBackground('#112233'));
    const handlers = createTileflowRouteHandlers({cwd});
    const request = new Request('http://localhost/tileflow/styles/main.json');
    const first = await handlers.GET(request);
    assert.equal(backgroundColor(await first.json()), '#112233');

    await writeFile(configPath, configWithBackground('#445566'));
    const second = await handlers.GET(request);
    assert.equal(backgroundColor(await second.json()), '#445566');
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

function configWithBackground(background: string): string {
  return `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, theme: {colors: {background: '${background}'}}}}};\n`;
}

function backgroundColor(style: unknown): unknown {
  const layers = (style as {layers?: Array<{id?: string; paint?: Record<string, unknown>}>}).layers;
  return layers?.find((layer) => layer.id === 'streets-background')?.paint?.['background-color'];
}
