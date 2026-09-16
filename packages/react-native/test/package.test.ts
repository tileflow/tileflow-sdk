import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import ts from 'typescript';
import {nativePackageFiles} from './native-admission-pack-files';

const root = new URL('../', import.meta.url);
const exec = promisify(execFile);

function runtimeImports(text: string): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          ['require', '__require'].includes(node.expression.text)))
    )
      result.push(node.getText());
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('output.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  return result;
}

test('remains private with exact native peers and the ordinary package/license boundaries', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.name, '@tileflow/react-native');
  assert.equal(manifest.private, true);
  assert.equal(manifest.version, '0.0.0-development');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.publishConfig, undefined);
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(manifest.peerDependencies, {
    '@maplibre/maplibre-react-native': '11.3.10',
    react: '19.2.0',
    'react-native': '0.83.10',
  });
  for (const [name, version] of Object.entries(manifest.peerDependencies))
    assert.equal(manifest.devDependencies[name], version);
  assert.deepEqual(manifest.dependencies, {
    '@tileflow/core': 'workspace:>=0.1.0-alpha.16 <0.1.0-beta.0',
  });
  assert.deepEqual(manifest.exports, {
    '.': {types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js'},
  });
  assert.deepEqual(manifest.files, nativePackageFiles);
  assert.equal(manifest.scripts.prepack, 'node ../../scripts/package-license.mjs --prepare');
  assert.equal(manifest.scripts.postpack, 'node ../../scripts/package-license.mjs --clean');
  const release = await import('../../../scripts/release-config.mjs');
  assert.equal(release.publicPackageNames.includes(manifest.name), false);
  const readme = await readFile(new URL('README.md', root), 'utf8');
  assert.match(readme, /^# @tileflow\/react-native\n/u);
  assert.match(readme, /private workspace/u);
  assert.match(readme, /does not export a `Map` component/u);
  // A type-only ESM entry can be empty. Internal artifacts must still exist.
  await readFile(new URL('dist/index.js', root), 'utf8');
  for (const path of [
    'dist/index.d.ts',
    'dist/internal/native-appearance.js',
    'dist/internal/native-appearance.d.ts',
    'dist/internal/initial-view.js',
    'dist/internal/source-state.js',
    'dist/internal/session.js',
    'dist/internal/session.d.ts',
    'dist/internal/native-admission.js',
    'dist/internal/native-admission.d.ts',
    'dist/internal/native-admission-bridge.js',
    'dist/internal/native-admission-bridge.d.ts',
  ])
    assert.ok((await readFile(new URL(path, root), 'utf8')).length > 0, path);
});

test('the contract imports standalone with no peers, globals or renderer evaluation', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-contract-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await copyFile(new URL('dist/index.js', root), join(cwd, 'contract.mjs'));
  const {stdout, stderr} = await exec(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
		import assert from 'node:assert/strict';
		for (const name of ['window', 'document', 'navigator', 'fetch', 'URL', 'URLSearchParams',
			'TextEncoder', 'TextDecoder', 'crypto', 'FontFace', 'Appearance', 'ReactNative', 'MapLibre']) {
			Object.defineProperty(globalThis, name, {configurable: true, get() {
				throw new Error('Unexpected global: ' + name);
			}});
		}
		const contract = await import('./contract.mjs');
		assert.deepEqual(Object.keys(contract), []);
	`,
    ],
    {cwd, timeout: 10000},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
  assert.deepEqual(runtimeImports(await readFile(new URL('dist/index.js', root), 'utf8')), []);
});

test('only explicit private platform adapters evaluate React Native and no output evaluates MapLibre', async () => {
  for (const entry of [
    'index',
    'internal/native-appearance',
    'internal/initial-view',
    'internal/source-state',
    'internal/session',
    'internal/native-admission',
    'internal/native-admission-bridge',
  ]) {
    const imports = runtimeImports(await readFile(new URL(`dist/${entry}.js`, root), 'utf8'));
    assert.equal(
      imports.some((name) => name.includes('maplibre')),
      false,
      entry,
    );
    if (entry === 'internal/native-appearance') assert.deepEqual(imports, ['react-native']);
    else if (entry === 'internal/native-admission-bridge')
      assert.equal(imports.includes('react-native'), true, entry);
    else assert.equal(imports.includes('react-native'), false, entry);
  }
  const declarations = await readFile(new URL('dist/index.d.ts', root), 'utf8');
  for (const name of [
    'MapBaseProps',
    'MapOptions',
    'MapRef',
    'MapSourceState',
    'MapInitialViewInputs',
  ])
    assert.ok(declarations.includes(name), name);
  assert.doesNotMatch(declarations, /declare (?:const|function|class) Map\b/u);
  assert.doesNotMatch(
    declarations,
    /HostedNativeSession|NativeSessionAuthority|NativeAdmission|NativeBootstrap/u,
  );
});
