import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import * as client from '../src/client';
import * as root from '../src/index';
import * as manifest from '../src/manifest';
import * as overlays from '../src/overlays';
import * as scene from '../src/scene';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const distRoot = join(packageRoot, 'dist');

const clientExports = [
  'createStaticMap',
  'createStaticMapIdempotencyKey',
  'precacheStaticMap',
  'prepareStaticMapRequest',
  'requestStaticMapUntilReady',
  'stableStringify',
  'staticMapProcessingResultSchema',
  'staticMapReadyResultSchema',
  'validateStaticMapIdempotencyKey',
];
const manifestExports = [
  'createRenderManifest',
  'hashRenderManifest',
  'hashStaticSceneRequest',
  'staticRenderManifestSchema',
  'staticRendererSchemaVersion',
  'validateStaticRenderManifest',
];
const overlayExports = [
  'circle',
  'compileStaticOverlays',
  'line',
  'marker',
  'polygon',
  'staticOverlaySchema',
];
const sceneExports = [
  'MAX_OVERLAY_LATITUDE',
  'StaticMapRequestError',
  'normalizeStaticScene',
  'staticMapRequestErrorResponseSchema',
  'staticSceneLimits',
  'staticSceneSchema',
  'staticSceneSchemaVersion',
  'validateStaticScene',
];

test('focused source entries preserve the exact public runtime surfaces', () => {
  assert.deepEqual(Object.keys(client).sort(), clientExports);
  assert.deepEqual(Object.keys(manifest).sort(), manifestExports);
  assert.deepEqual(Object.keys(overlays).sort(), overlayExports);
  assert.deepEqual(Object.keys(scene).sort(), sceneExports);
  assert.deepEqual(
    Object.keys(root).sort(),
    [...clientExports, ...manifestExports, ...overlayExports, ...sceneExports].sort(),
  );
});

test('source subpaths do not import the root and the internal graph is acyclic', async () => {
  const fileNames = (await readdir(sourceRoot)).filter((name) => name.endsWith('.ts'));
  const graph = new Map<string, string[]>();

  for (const fileName of fileNames) {
    const path = join(sourceRoot, fileName);
    const source = await readFile(path, 'utf8');
    if (fileName !== 'index.ts') assert.doesNotMatch(source, /from ['"]\.\/index['"]/u);
    const dependencies = [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.\/[^'"]+)['"]/gu)]
      .map((match) => resolve(dirname(path), `${match[1]}.ts`))
      .filter((dependency) => dependency.startsWith(sourceRoot));
    graph.set(path, dependencies);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visiting.has(path)) throw new Error(`Static package import cycle at ${path}`);
    if (visited.has(path)) return;
    visiting.add(path);
    for (const dependency of graph.get(path) ?? []) visit(dependency);
    visiting.delete(path);
    visited.add(path);
  };
  for (const path of graph.keys()) visit(path);

  const index = await readFile(join(sourceRoot, 'index.ts'), 'utf8');
  assert.equal(index.split('\n').filter((line) => line.trim()).length, 5);
});

test('built entry graphs exclude unrelated responsibilities and publish required types', async () => {
  const [sceneGraph, overlayGraph, manifestGraph, clientGraph] = await Promise.all([
    readStaticImportGraph(join(distRoot, 'scene.js')),
    readStaticImportGraph(join(distRoot, 'overlays.js')),
    readStaticImportGraph(join(distRoot, 'manifest.js')),
    readStaticImportGraph(join(distRoot, 'client.js')),
  ]);

  assert.doesNotMatch(
    sceneGraph,
    /compileStaticOverlays|createRenderManifest|requestStaticMapUntilReady/u,
  );
  assert.doesNotMatch(overlayGraph, /createRenderManifest|requestStaticMapUntilReady/u);
  assert.doesNotMatch(manifestGraph, /compileStaticOverlays|requestStaticMapUntilReady/u);
  assert.doesNotMatch(clientGraph, /compileStaticOverlays|createRenderManifest/u);

  const [clientTypes, sceneTypes] = await Promise.all([
    readFile(join(distRoot, 'client.d.ts'), 'utf8'),
    readFile(join(distRoot, 'scene.d.ts'), 'utf8'),
  ]);
  for (const name of [
    'PreparedStaticMapRequest',
    'StaticMapResult',
    'prepareStaticMapRequest',
    'requestStaticMapUntilReady',
    'stableStringify',
    'validateStaticMapIdempotencyKey',
  ]) {
    assert.match(clientTypes, new RegExp(`\\b${name}\\b`, 'u'));
  }
  assert.match(sceneTypes, /\bStaticSceneInput\b/u);
  assert.match(sceneTypes, /\bStaticMapRequestErrorResponse\b/u);
  assert.match(sceneTypes, /\bStaticMapRequestError\b/u);
});

test('prepared requests work across root and client built entries in both directions', async () => {
  const builtRoot = (await import('../dist/index.js')) as typeof root;
  const builtClient = (await import('../dist/client.js')) as typeof client;
  const staticScene = {
    camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
    map: 'main',
    size: {height: 480, width: 640},
    theme: 'light',
  };
  const fetcher = (async () =>
    Response.json({
      cached: false,
      hash: 'a'.repeat(43),
      imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
      operationId: 'smo_12345678901234567890',
      remainingUnits: 1,
      status: 'ready',
      unitCost: 15,
    })) as typeof fetch;

  const rootRequest = builtRoot.prepareStaticMapRequest(staticScene);
  const clientResult = await builtClient.requestStaticMapUntilReady(rootRequest, {
    createUrl: '/api/static-maps',
    fetch: fetcher,
    idempotencyKey: 'static_root_client',
  });
  const clientRequest = builtClient.prepareStaticMapRequest(staticScene);
  const rootResult = await builtRoot.requestStaticMapUntilReady(clientRequest, {
    createUrl: '/api/static-maps',
    fetch: fetcher,
    idempotencyKey: 'static_client_root',
  });

  assert.equal(clientResult.status, 'ready');
  assert.equal(rootResult.status, 'ready');
});

async function readStaticImportGraph(entry: string): Promise<string> {
  const pending = [entry];
  const seen = new Set<string>();
  const sources: string[] = [];

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = await readFile(path, 'utf8');
    sources.push(source);
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.\/[^'"]+)['"]/gu)) {
      pending.push(resolve(dirname(path), match[1]));
    }
  }

  return sources.join('\n');
}
