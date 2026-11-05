import assert from 'node:assert/strict';
import {glob, readdir, readFile} from 'node:fs/promises';
import {dirname, extname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {publicRuntimeExports} from './public-runtime';

const packages = fileURLToPath(new URL('../../', import.meta.url));
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.svelte']);
const mobileImport =
  /^(?:react-native(?:\/|$)|@maplibre\/maplibre-react-native(?:\/|$)|@tileflow\/react-native(?:\/|$))/u;

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(path)));
    else if (extensions.has(extname(path))) result.push(path);
  }
  return result;
}

function imports(source: string): string[] {
  const result: string[] = [];
  for (const pattern of [
    /\bfrom\s+['"]([^'"]+)['"]/gu,
    /\bimport\s+['"]([^'"]+)['"]/gu,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/gu,
  ]) {
    for (const match of source.matchAll(pattern)) result.push(match[1]!);
  }
  return result;
}

test('existing workspace packages have no mobile dependencies or source imports', async () => {
  for await (const path of glob('*/package.json', {cwd: packages})) {
    const directory = dirname(path);
    if (directory === 'react-native') continue;
    const root = join(packages, directory);
    const manifest = JSON.parse(await readFile(join(packages, path), 'utf8'));
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      for (const dependency of Object.keys(manifest[section] ?? {}))
        assert.equal(mobileImport.test(dependency), false, `${directory}: ${dependency}`);
    }
    for (const file of await sourceFiles(join(root, 'src'))) {
      for (const specifier of imports(await readFile(file, 'utf8')))
        assert.equal(mobileImport.test(specifier), false, `${file}: ${specifier}`);
    }
  }
});

test('public runtime is the Map, offline store and service clients while portable types and platform responsibilities stay isolated', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  for (const name of ['contract.ts', 'interaction-contract.ts']) {
    const contract = await readFile(join(root, name), 'utf8');
    const syntax = ts.createSourceFile(
      name,
      contract,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const statement of syntax.statements) {
      if (ts.isImportDeclaration(statement)) assert.equal(statement.importClause?.isTypeOnly, true);
      if (ts.isExportDeclaration(statement)) assert.equal(statement.isTypeOnly, true);
      assert.equal(ts.isExpressionStatement(statement), false);
      assert.equal(ts.isVariableStatement(statement), false);
      assert.equal(ts.isFunctionDeclaration(statement), false);
    }
  }
  const index = await readFile(join(root, 'index.ts'), 'utf8');
  const indexSyntax = ts.createSourceFile(
    'index.ts',
    index,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const valueExports = indexSyntax.statements.filter(
    (statement): statement is ts.ExportDeclaration =>
      ts.isExportDeclaration(statement) && statement.isTypeOnly === false,
  );
  assert.deepEqual(
    Object.fromEntries(
      valueExports.map((exported) => [
        (exported.moduleSpecifier as ts.StringLiteral).text,
        exported.exportClause && ts.isNamedExports(exported.exportClause)
          ? exported.exportClause.elements
              .filter((element) => !element.isTypeOnly)
              .map((element) => element.name.text)
          : [],
      ]),
    ),
    publicRuntimeExports,
  );

  const interactionOwners = new Set([
    join(root, 'native-interaction-input.ts'),
    join(root, 'native-interaction-poi.ts'),
    join(root, 'native-interaction-owner.ts'),
  ]);
  const rendererEntries = new Set([
    join(root, 'map.tsx'),
    join(root, 'native-marker.tsx'),
    join(root, 'native-boundary-feature-state.tsx'),
  ]);
  for (const file of await sourceFiles(root)) {
    const content = await readFile(file, 'utf8');
    for (const specifier of imports(content)) {
      assert.equal(specifier.startsWith('node:'), false, file);
      if (specifier.startsWith('@tileflow/'))
        assert.ok(
          specifier === '@tileflow/core/native' || specifier === '@tileflow/interactions',
          `${file}: ${specifier}`,
        );
      assert.doesNotMatch(specifier, /^(?:maplibre-gl|@tileflow\/interactions\/)/u, file);
    }
    const syntax = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of syntax.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier === '@tileflow/interactions' && !interactionOwners.has(file))
        assert.equal(statement.importClause?.isTypeOnly, true, file);
      if (specifier === '@maplibre/maplibre-react-native' && !rendererEntries.has(file))
        assert.equal(statement.importClause?.isTypeOnly, true, file);
      const privatePlatformEntry =
        rendererEntries.has(file) ||
        file === join(root, 'native-appearance.ts') ||
        file === join(root, 'native-admission-bridge.ts') ||
        file === join(root, 'native-document-bridge.ts') ||
        file === join(root, 'native-configuration-bridge.ts') ||
        file === join(root, 'native-surface-bridge.ts') ||
        // The TurboModule specs look their native modules up.
        file === join(root, 'specs/NativeTileflowServices.ts') ||
        file === join(root, 'specs/NativeTileflowOffline.ts');
      if (specifier === 'react-native' && !privatePlatformEntry)
        assert.equal(statement.importClause?.isTypeOnly, true, file);
    }
    assert.doesNotMatch(content, /import\s*\(\s*['"]@maplibre\/maplibre-react-native/u, file);
  }
});
