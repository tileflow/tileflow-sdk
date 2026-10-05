import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {z} from 'zod';
import {tileflowIconCompositionSchema} from '../src/icon-composition';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = resolve(packageRoot, 'src/icon-composition.ts');
const seedPath = resolve(packageRoot, 'src/declaration-seed.ts').replaceAll('\\', '/');

test('icon format declaration order does not depend on the first cached literal', () => {
  const first = emitFormat('tileflow-icon-composition-v1');
  const second = emitFormat('tileflow-icon-composition-v2');

  assert.equal(first, second);
  assert.doesNotMatch(first, /readonly/u);
});

test('stable icon format declarations preserve enum values and validation', () => {
  const format = tileflowIconCompositionSchema.shape.format;
  const baseline = z.enum(['tileflow-icon-composition-v1', 'tileflow-icon-composition-v2']);

  assert.deepEqual(format.enum, baseline.enum);
  assert.deepEqual(format.options, baseline.options);
  for (const value of [...baseline.options, 'tileflow-icon-composition-v3', null, 1]) {
    const actual = format.safeParse(value);
    const expected = baseline.safeParse(value);
    assert.equal(actual.success, expected.success);
    if (actual.success && expected.success) assert.equal(actual.data, expected.data);
    else if (!actual.success && !expected.success)
      assert.deepEqual(actual.error.issues, expected.error.issues);
  }
});

function emitFormat(literal: string): string {
  const configPath = resolve(packageRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
  const options = {
    ...parsed.options,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.replaceAll('\\', '/') === seedPath
      ? ts.createSourceFile(path, `export type Seed = ${JSON.stringify(literal)};`, languageVersion)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([seedPath, sourcePath], options, host);
  const seed = program.getSourceFile(seedPath)?.statements[0];
  assert.ok(seed && ts.isTypeAliasDeclaration(seed));
  program.getTypeChecker().getTypeFromTypeNode(seed.type);

  let output = '';
  const result = program.emit(undefined, (path, text) => {
    if (path.replaceAll('\\', '/').endsWith('/icon-composition.d.ts')) output = text;
  });
  assert.equal(result.emitSkipped, false);
  const format = output.match(/format: z\.ZodEnum<\{[\s\S]*?\}>/u)?.[0];
  assert.ok(format, 'Missing icon composition format declaration');
  return format;
}
