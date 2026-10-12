import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import * as client from '../src/client';
import * as manifest from '../src/manifest';
import * as overlays from '../src/overlays';
import * as scene from '../src/scene';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const distRoot = join(packageRoot, 'dist');

const clientExports = [
  'STATIC_MAP_RESULT_MEDIA_TYPE',
  'StaticMapError',
  'createStaticMap',
  'createStaticMapIdempotencyKey',
  'precacheStaticMap',
  'prepareStaticMapRequest',
  'requestStaticMapUntilReady',
  'stableStringify',
  'staticMapAttributionEntrySchema',
  'staticMapAttributionResultSchema',
  'staticMapErrorResponseSchema',
  'staticMapHostedResultSchema',
  'staticMapProcessingResultSchema',
  'validateStaticMapIdempotencyKey',
];
const manifestExports = [
  'createRenderManifest',
  'hashRenderManifest',
  'hashStaticSceneRequest',
  'staticAttributionEntrySchema',
  'staticAttributionLimits',
  'staticAttributionPlanSchema',
  'staticAttributionPlanSchemaVersion',
  'staticAttributionProvenanceSchema',
  'staticAttributionSegmentSchema',
  'staticRenderCompositionSchema',
  'staticRenderCompositionSchemaVersion',
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
  'symbol',
];
const sceneExports = [
  'MAX_OVERLAY_LATITUDE',
  'StaticMapRequestError',
  'isSupportedStaticSymbolCodePoint',
  'normalizeStaticScene',
  'staticAttributionPositionSchema',
  'staticAttributionRequestSchema',
  'staticMapRequestErrorResponseSchema',
  'staticOverlayPlacements',
  'staticSceneLimits',
  'staticSceneSchema',
  'staticSceneSchemaVersion',
  'staticSymbolAnchors',
  'staticSymbolCollisions',
  'staticSymbolLabelAppearances',
  'staticSymbolLabelPositions',
  'staticSymbolLanguages',
  'validateStaticScene',
];

test('focused source entries preserve the exact public runtime surfaces', () => {
  assert.deepEqual(Object.keys(client).sort(), clientExports);
  assert.deepEqual(Object.keys(manifest).sort(), manifestExports);
  assert.deepEqual(Object.keys(overlays).sort(), overlayExports);
  assert.deepEqual(Object.keys(scene).sort(), sceneExports);
});

test('the package has no root entry and its internal graph is acyclic', async () => {
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
    main?: string;
    types?: string;
  };
  assert.deepEqual(Object.keys(packageJson.exports).sort(), [
    './client',
    './manifest',
    './overlays',
    './scene',
  ]);
  assert.equal(packageJson.main, undefined);
  assert.equal(packageJson.types, undefined);

  const fileNames = (await readdir(sourceRoot)).filter((name) => name.endsWith('.ts'));
  const graph = new Map<string, string[]>();

  for (const fileName of fileNames) {
    const path = join(sourceRoot, fileName);
    const source = await readFile(path, 'utf8');
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
    'StaticMapError',
    'StaticMapErrorResponse',
    'StaticMapHostedResult',
    'StaticMapResult',
    'prepareStaticMapRequest',
    'requestStaticMapUntilReady',
    'stableStringify',
    'validateStaticMapIdempotencyKey',
  ]) {
    assert.match(clientTypes, new RegExp(`\\b${name}\\b`, 'u'));
  }
  assert.match(sceneTypes, /\bStaticSceneInput\b/u);
  assert.match(sceneTypes, /\bStaticMapFormat\b/u);
  assert.match(sceneTypes, /\bStaticMapRequestErrorResponse\b/u);
  assert.match(sceneTypes, /\bStaticMapRequestError\b/u);
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
