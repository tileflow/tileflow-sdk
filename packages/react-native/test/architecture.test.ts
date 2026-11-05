import assert from 'node:assert/strict';
import {glob, readdir, readFile} from 'node:fs/promises';
import {dirname, extname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

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

test('React Native delegates rendering and delivery to its native SDKs', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  for (const file of await sourceFiles(root)) {
    for (const specifier of imports(await readFile(file, 'utf8'))) {
      assert.doesNotMatch(specifier, /^(?:node:|@tileflow\/|@maplibre\/|maplibre-gl)/u, file);
    }
  }
});
