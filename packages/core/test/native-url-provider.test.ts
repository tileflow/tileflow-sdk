import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {URL as NodeURL} from 'node:url';
import {promisify} from 'node:util';
import ts from 'typescript';
import {
  resolveTileflowNativeManifestUrl,
  resolveTileflowNativeResourceUrl,
  TileflowNativeUrlError,
} from '@tileflow/core/native';

const exec = promisify(execFile);
const packageRoot = new URL('../', import.meta.url);
const manifests = [
  'https://bücher.example.test/a.json',
  'https://ＭＡＰＳ.example.test:443/a.json',
  'https://faß.example.test/a',
  'https://e\u0301.example.test/a',
  'https://مثال.إختبار/a',
  'https://%E3%80%82example.test/a',
  'https://maps.example.test/a\ud800b/\udc00?x=\ud800',
  'https://maps.example.test/\ufeff/😀?x=\ufeff💩',
  'https://127.1:443/a',
  'https://0x7f000001/a',
  'https://[0:0:0:0:0:0:0:1]:443/a',
  'https://m%61ps.example.test/a/%2e%2E/b?',
];

test('preserves WHATWG authority, IDNA, surrogate and BOM behavior', () => {
  for (const value of manifests) {
    assert.equal(resolveTileflowNativeManifestUrl(value), new NodeURL(value).href, value);
  }
  const documentUrl = 'https://maps.example.test/generations/a/styles/streets/light.json?old=1';
  for (const value of [
    '../../icons/streets/sprite',
    '%2e%2e/%2E./glyphs/a.pbf',
    '?',
    '?v=😀',
    '/a\ud800?b=\udc00',
    './\ufeff.json',
    '../a%EF%BB%BF.json',
  ]) {
    assert.equal(
      resolveTileflowNativeResourceUrl(value, {documentUrl}),
      new NodeURL(value, documentUrl).href,
    );
  }
});

test('rejects invalid UTF-8 hosts and encoded authority delimiters without exposing input', () => {
  for (const host of [
    '%C0%AF',
    '%E0%80%AF',
    '%ED%A0%80',
    '%F4%90%80%80',
    '%E1%80%2F',
    '%C2%40',
    '%00',
    '%EF%BF%BD',
    '\ud800',
    '[::1%25eth0]',
  ]) {
    const value = `https://${host}.example.test/private?secret=hidden`;
    assert.throws(() => new NodeURL(value));
    assert.throws(
      () => resolveTileflowNativeManifestUrl(value),
      (error: unknown) => {
        assert.ok(error instanceof TileflowNativeUrlError);
        assert.equal(error.field, 'manifestUrl');
        assert.equal(error.code, 'NATIVE_URL_INVALID');
        assert.equal(error.cause, undefined);
        assert.equal(error.message.includes('hidden'), false);
        return true;
      },
    );
  }
});

test('uses bounded collision-free placeholder sentinels without changing output', () => {
  const prefix = '__tileflow_native_template_';
  const documentUrl = `https://maps.example.test/${prefix}${'_'.repeat(1800)}/style.json`;
  const value = '/{z}/{x}/{y}/{ratio}';
  assert.equal(
    resolveTileflowNativeResourceUrl(value, {documentUrl, template: 'tile'}),
    'https://maps.example.test/{z}/{x}/{y}/{ratio}',
  );
  for (const path of [`/${prefix}0_/{z}`, `/${prefix}/${prefix}0_/${prefix}1_/{x}`]) {
    assert.equal(
      resolveTileflowNativeResourceUrl(path, {documentUrl, template: 'tile'}),
      'https://maps.example.test' + path,
    );
  }
});

test('runs the standalone published native file with no installed dependencies or ambient codecs', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-provider-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await copyFile(new URL('dist/native.js', packageRoot), join(cwd, 'native.mjs'));
  await copyFile(
    new URL('test/fixtures/native-url-contract.mjs', packageRoot),
    join(cwd, 'contract.mjs'),
  );
  const script = `
    import assert from 'node:assert/strict';
    import {checkNativeUrlContract} from './contract.mjs';
    const names = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'window', 'document',
      'navigator', 'fetch', 'FontFace'];
    for (const name of names) Object.defineProperty(globalThis, name, {configurable: true, get() {
      throw new Error('Unexpected ambient access: ' + name);
    }});
    const before = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const native = await import('./native.mjs');
    assert.deepEqual(Object.keys(native).sort(), [
      'TileflowNativeSourceError',
      'TileflowNativeUrlError',
      'createTileflowNativeSourceController',
      'loadTileflowNativeManifest',
      'resolveTileflowNativeInitialView',
      'resolveTileflowNativeManifestUrl',
      'resolveTileflowNativeResourceUrl',
      'tileflowNativeManifestLimits',
      'tileflowNativeUrlLimits',
    ]);
    for (const origin of ['http://127.0.0.1:8765', 'http://10.0.2.2:8765']) {
      const results = checkNativeUrlContract(native, origin);
      assert.equal(results.length, 22);
      assert.deepEqual(results.filter((item) => !item.passed), []);
    }
    for (const name of names) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, name), before[name]);
  `;
  const result = await exec(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    timeout: 15_000,
  });
  assert.equal(result.stderr, '');
});

test('bundles the provider only in native and keeps its declarations private', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.equal(manifest.devDependencies['whatwg-url'], '15.1.0');
  assert.equal(manifest.dependencies['whatwg-url'], undefined);
  const native = await readFile(new URL('dist/native.js', packageRoot), 'utf8');
  const runtimeImports: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      runtimeImports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          ['require', '__require'].includes(node.expression.text)))
    ) {
      runtimeImports.push(node.getText());
    }
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile('native.js', native, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  assert.deepEqual(runtimeImports, []);
  for (const name of [
    'index',
    'browser',
    'build',
    'runtime',
    'manifest',
    'capture',
    'native-profile',
  ]) {
    const code = await readFile(new URL(`dist/${name}.js`, packageRoot), 'utf8');
    assert.doesNotMatch(
      code,
      /whatwg-url|native-url-provider|native-url-utf8|tr46\/|punycode\.js/u,
      name,
    );
  }
  const declarations = await readFile(new URL('dist/native.d.ts', packageRoot), 'utf8');
  assert.doesNotMatch(
    declarations,
    /whatwg-url|URLRecord|parseNativeUrl|utf8Encode|nativeUrlCodecMaximumLength/u,
  );
  const notices = await readFile(new URL('THIRD_PARTY_NOTICES.md', packageRoot), 'utf8');
  for (const name of ['whatwg-url 15.1.0', 'tr46 6.0.0', 'Punycode.js 2.3.1'])
    assert.ok(notices.includes(name));
});
