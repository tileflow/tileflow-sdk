import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

test('the packaged native entry resolves manifest sources and views without ambient services', async () => {
  const script = `
    import assert from 'node:assert/strict';
    const manifest = {version: 1, maps: {main: {defaultTheme: 'day', themes: {
      day: {colorScheme: 'light', styleUrl: './style.json'},
    }}}};
    const bytes = Uint8Array.from(JSON.stringify(manifest), (character) => character.charCodeAt(0));
    const names = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'fetch', 'window',
      'document', 'navigator', 'FontFace', 'Appearance', 'crypto', 'AbortController', 'AbortSignal'];
    let reads = 0;
    for (const name of names) Object.defineProperty(globalThis, name, {configurable: true, get() {
      reads++; throw new Error('Unexpected ambient access: ' + name);
    }});
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const native = await import('@tileflow/core/native');
    let acquisitions = 0;
    const controller = native.createTileflowNativeSourceController({acquire(url) {
      acquisitions++;
      let offset = 0;
      return {cancel() {}, response: Promise.resolve({url, status: 200, reader: {
        async read(maximumBytes) {
          if (offset === bytes.length) return {done: true};
          const value = bytes.slice(offset, offset + maximumBytes); offset += value.length;
          return {done: false, value};
        }, cancel() {},
      }})};
    }});
    await controller.replace({map: 'main', manifestUrl: 'https://bücher.example.test/a/../manifest.json'});
    assert.equal(controller.state.status, 'ready');
    assert.equal(Object.hasOwn(controller.state, 'kind'), false);
    assert.equal(controller.state.theme.styleUrl, 'https://xn--bcher-kva.example.test/style.json');
    assert.equal(controller.state.map.name, 'main');
    const before = controller.state;
    const view = native.resolveTileflowNativeInitialView({manifestView: {zoom: 3},
      mapOptionsView: {zoom: 4, pitch: 30}, view: {center: [-3.7, 40.4]}});
    assert.deepEqual(view, {center: [-3.7, 40.4], zoom: 4, bearing: 0, pitch: 30});
    assert.ok(Object.isFrozen(view.center));
    assert.equal(controller.state, before);
    assert.throws(() => native.resolveTileflowNativeInitialView({view: {pitch: 86}}),
      {code: 'NATIVE_SOURCE_INVALID', field: 'view'});
    assert.equal(acquisitions, 1);
    assert.equal(reads, 0);
    for (let i = 0; i < names.length; i++) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, names[i]), descriptors[i]);
    controller.dispose(); controller.dispose();
  `;
  const {stdout, stderr} = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: root, timeout: 15_000},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('Tileflow ready state and view inputs narrow against the built public declarations', () => {
  const path = fileURLToPath(new URL('fixtures/native-source-view-types.ts', import.meta.url));
  const program = ts.createProgram([path], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')),
    [],
  );
});

test('native source and initial-view implementation stays isolated from web artifacts', async () => {
  for (const name of [
    'index',
    'browser',
    'build',
    'runtime',
    'manifest',
    'capture',
    'native-profile',
  ]) {
    const code = await readFile(new URL(`../dist/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      code,
      /\bresolveTileflowNativeInitialView\b|\bsnapshotNativeDirectStyle\b|native-direct-style|native-initial-view/u,
      name,
    );
  }
  const declarations = await readFile(new URL('../dist/native.d.ts', import.meta.url), 'utf8');
  assert.match(declarations, /resolveTileflowNativeInitialView/u);
  assert.match(declarations, /TileflowNativeInitialViewOptions/u);
  assert.doesNotMatch(declarations, /snapshotNativeDirectStyle|createTileflowRuntimeViewSchema/u);
  const code = await readFile(new URL('../dist/native.js', import.meta.url), 'utf8');
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      imports.push(node.moduleSpecifier.getText());
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          ['require', '__require'].includes(node.expression.text)))
    )
      imports.push(node.getText());
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile('native.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  assert.deepEqual(imports, []);
  assert.doesNotMatch(code, /zod\/v4\/classic\//u);
});
