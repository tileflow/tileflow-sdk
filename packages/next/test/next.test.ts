import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {TileflowBuildArtifactsOptions} from '@tileflow/dev';
import {withTileflow} from '../src/index';
import {createTileflowRouteHandlers} from '../src/server';

test('emits production artifacts without adding a webpack config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-'));
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    await writeFile(
      join(cwd, 'tileflow.config.ts'),
      "export default { maps: { main: { basemap: {type: 'streets', basemapVersion: 3, variant: 'light'} } } };\n",
      'utf8',
    );
    process.env.NODE_ENV = 'production';

    const config = withTileflow({}, {cwd, worldGeneration});
    assert.equal(config.webpack, undefined);
    assert.equal(typeof config.rewrites, 'function');

    const rewrites = await config.rewrites!();
    assert.deepEqual(rewrites, []);

    const manifest = JSON.parse(
      await readFile(join(cwd, 'public/tileflow/manifest.json'), 'utf8'),
    ) as {styles?: Record<string, string>};
    assert.equal(manifest.styles?.main, '/tileflow/styles/main.json');
    const style = JSON.parse(
      await readFile(join(cwd, 'public/tileflow/styles/main.json'), 'utf8'),
    ) as {
      glyphs?: string;
      sources?: {tileflow?: {tiles?: string[]}};
      sprite?: string;
      version?: number;
    };
    assert.equal(style.version, 8);
    assert.deepEqual(style.sources?.tileflow?.tiles, [worldGeneration.tileUrl]);
    assert.equal(style.glyphs, worldGeneration.assetSet.glyphs);
    assert.equal(style.sprite, worldGeneration.assetSet.spriteBase);
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
    const handlers = createTileflowRouteHandlers({cwd, worldGeneration});
    const request = new Request('http://localhost/tileflow/styles/main.json');
    const first = await handlers.GET(request);
    const firstStyle = await first.json();
    assert.equal(backgroundColor(firstStyle), '#112233');
    assert.deepEqual(vectorTiles(firstStyle), [worldGeneration.tileUrl]);

    await writeFile(configPath, configWithBackground('#445566'));
    const second = await handlers.GET(request);
    assert.equal(backgroundColor(await second.json()), '#445566');
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

function configWithBackground(background: string): string {
  return `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, theme: {colors: {background: '${background}'}}}}};\n`;
}

function backgroundColor(style: unknown): unknown {
  const layers = (style as {layers?: Array<{id?: string; paint?: Record<string, unknown>}>}).layers;
  return layers?.find((layer) => layer.id === 'streets-background')?.paint?.['background-color'];
}

function vectorTiles(style: unknown): unknown {
  return (style as {sources?: {tileflow?: {tiles?: unknown}}}).sources?.tileflow?.tiles;
}

const worldGeneration: NonNullable<TileflowBuildArtifactsOptions['worldGeneration']> = {
  generation: 'v1',
  tileUrl: 'https://world.tileflow.dev/world/v1/{z}/{x}/{y}.pbf',
  schemaVersion: 1,
  vectorSchema: {id: 'openmaptiles-v1', sha256: 'a'.repeat(64)},
  tileEncoding: {format: 'mvt', compression: 'gzip', scheme: 'xyz', extent: 4096},
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85, 180, 85],
  attribution: 'Fixture data',
  assetSet: {
    id: 'a1-0123456789abcdef',
    glyphs: 'https://assets.tileflow.dev/base/a1-0123456789abcdef/glyphs/{fontstack}/{range}.pbf',
    spriteBase: 'https://assets.tileflow.dev/base/a1-0123456789abcdef/sprites/base',
  },
};
