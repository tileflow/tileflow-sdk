import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import ts from 'typescript';

const execFileAsync = promisify(execFile);
const packageRoot = new URL('../', import.meta.url);

test('publishes a build-only profile entry without widening the root or native URL entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.deepEqual(manifest.exports['./native-profile'], {
    types: './dist/native-profile.d.ts',
    import: './dist/native-profile.js',
    default: './dist/native-profile.js',
  });
  assert.equal(manifest.dependencies['@maplibre/maplibre-gl-style-spec'], '24.8.5');
  assert.deepEqual(manifest.files, ['dist', 'docs', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
  const declarations = await readFile(new URL('dist/native-profile.d.ts', packageRoot), 'utf8');
  for (const name of [
    'tileflowNativeProfileSchema',
    'validateTileflowNativeStyle',
    'tileflowNativeBuildRecordSchema',
  ]) {
    assert.match(declarations, new RegExp(name, 'u'));
  }

  const built = await readFile(new URL('dist/native-profile.js', packageRoot), 'utf8');
  const specifiers = runtimeSpecifiers(built);
  assert.equal(
    specifiers.some((specifier) => specifier.startsWith('node:')),
    false,
  );
  assert.equal(specifiers.includes('@maplibre/maplibre-gl-style-spec/dist/latest.json'), false);
  const build = await readFile(new URL('dist/build.js', packageRoot), 'utf8');
  assert.equal(
    runtimeSpecifiers(build).includes('@maplibre/maplibre-gl-style-spec/dist/latest.json'),
    false,
  );

  const script = `
    for (const name of ['window', 'document', 'navigator', 'fetch', 'FontFace']) {
      Object.defineProperty(globalThis, name, {configurable:true, get() { throw new Error('Unexpected browser access.'); }});
    }
    const profile = await import('@tileflow/core/native-profile');
    const native = await import('@tileflow/core/native');
    if ('validateTileflowNativeStyle' in native) process.exit(2);
    const issues = profile.validateTileflowNativeStyle({version:8,sources:{},layers:[]});
    if (issues.length) throw new Error(JSON.stringify(issues));
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(packageRoot),
    timeout: 10_000,
  });
  await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const build = await import('@tileflow/core/build'); if (typeof build.parseTileflowRendererDeploymentArtifact !== 'function') process.exit(3);",
    ],
    {cwd: fileURLToPath(packageRoot), timeout: 10_000},
  );

  const root = await import('@tileflow/core');
  assert.equal('validateTileflowNativeStyle' in root, false);
});

/** Inspect syntax, not source-map comments or strings inside bundled specification metadata. */
function runtimeSpecifiers(source: string): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
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
    ) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) result.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(
    ts.createSourceFile(
      'native-profile.js',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
  );
  return result;
}

test('distinguishes runtime imports from bundled JSON path comments', () => {
  const name = '@maplibre/maplibre-gl-style-spec/dist/latest.json';
  assert.deepEqual(runtimeSpecifiers(`// ${name}\nconst data = {doc: '${name}'};`), []);
  assert.deepEqual(runtimeSpecifiers(`import data from '${name}';`), [name]);
  assert.deepEqual(runtimeSpecifiers(`const data = import('${name}');`), [name]);
  assert.deepEqual(runtimeSpecifiers(`export {default} from '${name}';`), [name]);
  assert.deepEqual(runtimeSpecifiers(`const data = require('node:module');`), ['node:module']);
  assert.deepEqual(runtimeSpecifiers(`const data = __require('${name}');`), [name]);
});
