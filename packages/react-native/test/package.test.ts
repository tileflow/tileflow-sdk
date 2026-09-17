import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {nativePackageFiles} from './native-admission-pack-files';

const root = new URL('../', import.meta.url);

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

test('remains private with exact native peers and one ordinary public root', async () => {
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
    '@tileflow/interactions': 'workspace:>=0.1.0-alpha.16 <0.1.0-beta.0',
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
  assert.match(readme, /exports a mounted `Map`/u);
  for (const path of [
    'dist/index.js',
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
    'dist/internal/interactions.js',
    'dist/internal/interactions.d.ts',
  ])
    assert.ok((await readFile(new URL(path, root), 'utf8')).length > 0, path);
});

test('the native importer locks its portable interaction workspace dependency', async () => {
	const lockfile = await readFile(new URL('../../pnpm-lock.yaml', root), 'utf8');
	const importer = lockfile.split('\n  packages/react-native:\n')[1]?.split('\n  packages/')[0];
	assert.ok(importer);
	const dependencies = importer.match(/^    dependencies:\n((?: {6,}.+\n)+)/mu)?.[1];
	assert.ok(dependencies);
	assert.match(dependencies, /^      '@tileflow\/interactions':\n        specifier: workspace:>=0\.1\.0-alpha\.16 <0\.1\.0-beta\.0\n        version: link:\.\.\/interactions\n/mu);
});

test('the public root has only the deliberate React Native renderer dependency boundary', async () => {
  const output = await readFile(new URL('dist/index.js', root), 'utf8');
  const imports = runtimeImports(output);
  for (const name of imports) {
    assert.ok(
      name === 'react' ||
        name === 'react/jsx-runtime' ||
        name === 'react-native' ||
        name === '@maplibre/maplibre-react-native' ||
        name === '@tileflow/core/native',
      name,
    );
  }
  assert.equal(imports.includes('@maplibre/maplibre-react-native'), true);
  assert.equal(imports.includes('react-native'), true);
});

test('private transport and renderer-control contracts remain absent from public declarations', async () => {
  const declarations = await readFile(new URL('dist/index.d.ts', root), 'utf8');
  for (const name of [
    'MapBaseProps',
    'MapOptions',
    'MapRef',
    'MapSourceState',
    'MapInitialViewInputs',
    'MapProps',
  ])
    assert.ok(declarations.includes(name), name);
  assert.match(declarations, /(?:declare\s+)?function Map\b|declare const Map\b/u);
  assert.doesNotMatch(
    declarations,
    /HostedNativeSession|NativeSessionAuthority|NativeAdmission|NativeBootstrap|NativeSurface|NativeRenderer|MobileConfiguration|NativeInteraction|NativePoi/u,
  );
});
