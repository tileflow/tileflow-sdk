import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

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
  for (const directory of await readdir(packages, {withFileTypes: true})) {
    if (!directory.isDirectory() || directory.name === 'react-native') continue;
    const root = join(packages, directory.name);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      for (const dependency of Object.keys(manifest[section] ?? {}))
        assert.equal(mobileImport.test(dependency), false, `${directory.name}: ${dependency}`);
    }
    for (const file of await sourceFiles(join(root, 'src'))) {
      for (const specifier of imports(await readFile(file, 'utf8')))
        assert.equal(mobileImport.test(specifier), false, `${file}: ${specifier}`);
    }
  }
});

test('public runtime is limited to the Map component while private responsibilities stay isolated', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const contract = await readFile(join(root, 'contract.ts'), 'utf8');
  const contractSyntax = ts.createSourceFile(
    'contract.ts',
    contract,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of contractSyntax.statements) {
    if (ts.isImportDeclaration(statement)) assert.equal(statement.importClause?.isTypeOnly, true);
    if (ts.isExportDeclaration(statement)) assert.equal(statement.isTypeOnly, true);
    assert.equal(ts.isExpressionStatement(statement), false);
    assert.equal(ts.isVariableStatement(statement), false);
    assert.equal(ts.isFunctionDeclaration(statement), false);
  }

  const index = await readFile(join(root, 'index.ts'), 'utf8');
  const indexSyntax = ts.createSourceFile('index.ts', index, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const valueExports = indexSyntax.statements.filter(
    (statement) => ts.isExportDeclaration(statement) && statement.isTypeOnly === false,
  );
  assert.equal(valueExports.length, 1);
  const exported = valueExports[0] as ts.ExportDeclaration;
  assert.equal(ts.isStringLiteral(exported.moduleSpecifier!), true);
  assert.equal((exported.moduleSpecifier as ts.StringLiteral).text, './map');
  assert.deepEqual(
    exported.exportClause && ts.isNamedExports(exported.exportClause)
      ? exported.exportClause.elements.map((element) => element.name.text)
      : [],
    ['Map'],
  );

  for (const file of await sourceFiles(root)) {
    const content = await readFile(file, 'utf8');
    for (const specifier of imports(content)) {
      assert.equal(specifier.startsWith('node:'), false, file);
      if (specifier.startsWith('@tileflow/')) assert.equal(specifier, '@tileflow/core/native', file);
    }
    const syntax = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of syntax.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier === '@maplibre/maplibre-react-native' && file !== join(root, 'map.tsx'))
        assert.equal(statement.importClause?.isTypeOnly, true, file);
      const privatePlatformEntry =
        file === join(root, 'map.tsx') ||
        file === join(root, 'native-appearance.ts') ||
        file === join(root, 'native-admission-bridge.ts') ||
        file === join(root, 'native-document-bridge.ts') ||
        file === join(root, 'native-configuration-bridge.ts') ||
        file === join(root, 'native-surface-bridge.ts');
      if (specifier === 'react-native' && !privatePlatformEntry)
        assert.equal(statement.importClause?.isTypeOnly, true, file);
    }
    assert.doesNotMatch(content, /import\s*\(\s*['"]@maplibre\/maplibre-react-native/u, file);
  }
});
