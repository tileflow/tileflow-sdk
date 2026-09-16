import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const packageRoot = new URL('../', import.meta.url);

test('native admission does not publish the package or add a public subpath', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
});

test('the public runtime cannot install a transport or execute initialization', async () => {
  const text = await readFile(new URL('dist/index.js', packageRoot), 'utf8');
  const source = ts.createSourceFile(
    'index.js',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  for (const statement of source.statements) {
    assert.ok(
      ts.isEmptyStatement(statement) ||
        (ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier === undefined &&
          statement.exportClause !== undefined &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length === 0),
      'Public runtime must contain only an optional empty export',
    );
  }
  const runtime = await import(new URL('dist/index.js', packageRoot).href);
  assert.deepEqual(Object.keys(runtime), []);
});

test('native admission authority and transport contracts remain absent from public declarations', async () => {
  const declarations = await readFile(new URL('dist/index.d.ts', packageRoot), 'utf8');
  for (const forbidden of [
    'NativeAdmission',
    'NativeTransportOwner',
    'HostedNativeSessionAuthority',
    'X-Tileflow-Native-Grant',
  ]) {
    assert.equal(declarations.includes(forbidden), false, forbidden);
  }
});
