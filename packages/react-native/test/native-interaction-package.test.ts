import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';

const root = new URL('../', import.meta.url);
const modules = ['native-interaction-input', 'native-interaction-poi', 'native-interaction-owner'];
const imports = (text: string) =>
  [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/gu)].map(
    (match) => match[1]!,
  );

test('the interaction foundation imports only portable root contracts and its private neutral modules', async () => {
  for (const name of modules) {
    const source = await readFile(new URL(`src/${name}.ts`, root), 'utf8');
    for (const specifier of imports(source)) {
      assert.ok(
        specifier === '@tileflow/interactions' ||
          modules.some((value) => specifier === `./${value}`),
        specifier,
      );
    }
    assert.doesNotMatch(
      source,
      /\b(?:window|document|navigator)\s*(?:\.|\[)|\b(?:HTMLElement|requestAnimationFrame|setTimeout|setInterval)\b/u,
    );
    assert.doesNotMatch(source, /maplibre-gl|@tileflow\/interactions\//u);
  }
  const visited = new Set<string>();
  const visitRoot = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(new URL(`../interactions/src/${file}.ts`, root), 'utf8');
    for (const specifier of imports(source)) {
      assert.doesNotMatch(specifier, /maplibre|react|node:|browser|dom/iu);
      if (specifier.startsWith('./')) await visitRoot(specifier.slice(2));
      else assert.equal(specifier, 'zod/mini');
    }
  };
  await visitRoot('index');
  const owner = createNativeInteractionOwner();
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  owner.dispose();
});

test('the workspace edge and private build entry do not broaden the public component contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(
    manifest.dependencies['@tileflow/interactions'],
    'workspace:>=0.1.0-alpha.16 <0.1.0-beta.0',
  );
  assert.equal(manifest.dependencies['maplibre-gl'], undefined);
  assert.equal(manifest.peerDependencies['maplibre-gl'], undefined);
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
  const lock = await readFile(new URL('../../pnpm-lock.yaml', root), 'utf8');
  const importer = lock.split('  packages/react-native:\n')[1]?.split('\n  packages/')[0];
  assert.ok(importer);
  assert.match(
    importer,
    /'@tileflow\/interactions':\n\s+specifier: workspace:>=0\.1\.0-alpha\.16 <0\.1\.0-beta\.0\n\s+version: link:\.\.\/interactions/u,
  );
  assert.doesNotMatch(importer, /maplibre-gl/u);
  const build = await readFile(new URL('tsup.config.ts', root), 'utf8');
  assert.match(build, /'internal\/interactions': 'src\/native-interaction-owner\.ts'/u);
  const output = await readFile(new URL('dist/internal/interactions.js', root), 'utf8');
  for (const specifier of imports(output)) assert.equal(specifier, '@tileflow/interactions');
  assert.doesNotMatch(
    output,
    /react-native|maplibre-gl|@tileflow\/interactions\/maplibre|\bwindow\.|\bdocument\./u,
  );
  const exported = await import(new URL('dist/internal/interactions.js', root).href);
  const owner = exported.createNativeInteractionOwner();
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  owner.dispose();
  const declarations = await readFile(new URL('dist/index.d.ts', root), 'utf8');
  assert.doesNotMatch(
    declarations,
    /NativeInteraction|NativePoi|onInteractionStateChange|defaultInteractionState|annotations\??:/u,
  );
  const index = await readFile(new URL('src/index.ts', root), 'utf8');
  assert.doesNotMatch(index, /interaction|Poi/u);
});
