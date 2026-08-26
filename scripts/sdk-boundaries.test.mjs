import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, extname, join, relative, resolve, sep} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const workspaceRoot = new URL('../', import.meta.url);
const workspaceRootPath = fileURLToPath(workspaceRoot);
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mjs', '.mts', '.svelte', '.ts', '.tsx']);
const runtimeDependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'];

const allowedTileflowDependencies = {
  capture: new Set(['core', 'dev']),
  cli: new Set(['capture', 'core', 'dev', 'maps']),
  core: new Set(),
  dev: new Set(['core']),
  interactions: new Set(),
  maps: new Set(['core']),
  next: new Set(['dev']),
  react: new Set(['core', 'interactions', 'static']),
  static: new Set(),
  svelte: new Set(['core', 'interactions']),
  vite: new Set(['dev']),
  vue: new Set(['core', 'interactions']),
  webpack: new Set(['dev']),
};

test('public package sources respect the SDK responsibility graph', async () => {
  const manifests = new Map();

  for (const packageName of Object.keys(allowedTileflowDependencies)) {
    manifests.set(packageName, await readPackageManifest(packageName));
  }

  for (const [packageName, allowedDependencies] of Object.entries(allowedTileflowDependencies)) {
    const sourceRoot = new URL(`../packages/${packageName}/src/`, import.meta.url);
    const sourceFiles = await listSourceFiles(sourceRoot);

    for (const sourceFile of sourceFiles) {
      const source = await readFile(sourceFile, 'utf8');
      const label = portableRelative(workspaceRootPath, fileURLToPath(sourceFile));

      for (const specifier of importedSpecifiers(source)) {
        if (specifier.startsWith('node:')) {
          assert.equal(
            ['core', 'interactions', 'maps', 'react', 'static', 'svelte', 'vue'].includes(
              packageName,
            ),
            false,
            `${label} crosses the browser/pure boundary with ${specifier}`,
          );
          continue;
        }

        const tileflowImport = /^@tileflow\/([^/]+)(\/.*)?$/u.exec(specifier);
        if (!tileflowImport) continue;
        const dependencyName = tileflowImport[1];
        const subpath = tileflowImport[2];

        assert.ok(
          allowedDependencies.has(dependencyName),
          `${label} imports ${specifier}, outside ${packageName}'s responsibility boundary`,
        );
        assert.ok(
          runtimeDependencySections.some(
            (section) =>
              manifests.get(packageName)?.[section]?.[`@tileflow/${dependencyName}`] !== undefined,
          ),
          `${label} imports undeclared workspace dependency @tileflow/${dependencyName}`,
        );

        if (subpath) {
          const dependencyManifest = manifests.get(dependencyName);
          assert.ok(
            dependencyManifest?.exports?.[`.${subpath}`],
            `${label} imports unexported public subpath ${specifier}`,
          );
        }

        if (
          dependencyName === 'dev' &&
          ['capture', 'cli', 'next', 'vite', 'webpack'].includes(packageName)
        ) {
          assert.ok(subpath, `${label} must select an explicit @tileflow/dev responsibility`);
        }
      }

      if (['react', 'svelte', 'vue'].includes(packageName)) {
        assertTypeOnlyRootImports(source, label, '@tileflow/core');
        assert.equal(
          importedSpecifiers(source).includes('@tileflow/static'),
          false,
          `${label} must select an explicit @tileflow/static responsibility`,
        );
        assertTypeOnlyStaticMapLibreImports(source, label);
        assertLazyMapLibreImportsStayIsolated(source, label);
      }
    }
  }
});

test('declared runtime Tileflow dependencies respect the SDK responsibility graph', async () => {
  const packageNames = new Set(Object.keys(allowedTileflowDependencies));

  for (const [packageName, allowedDependencies] of Object.entries(allowedTileflowDependencies)) {
    const manifest = await readPackageManifest(packageName);
    for (const dependency of declaredRuntimeTileflowDependencies(manifest)) {
      assert.ok(
        packageNames.has(dependency.name),
        `packages/${packageName}/package.json ${dependency.section} declares unknown workspace dependency @tileflow/${dependency.name}`,
      );
      assert.ok(
        allowedDependencies.has(dependency.name),
        `packages/${packageName}/package.json ${dependency.section} declares @tileflow/${dependency.name}, outside ${packageName}'s responsibility boundary`,
      );
    }
  }
});

test('declared Tileflow package dependencies remain acyclic', async () => {
  const graph = new Map();
  for (const packageName of Object.keys(allowedTileflowDependencies)) {
    const manifest = await readPackageManifest(packageName);
    graph.set(packageName, [
      ...new Set(declaredRuntimeTileflowDependencies(manifest).map(({name}) => name)),
    ]);
  }

  const complete = new Set();
  const active = [];
  const visit = (packageName) => {
    if (complete.has(packageName)) return;
    const cycleStart = active.indexOf(packageName);
    assert.equal(
      cycleStart,
      -1,
      `Tileflow package dependency cycle: ${[...active.slice(cycleStart), packageName].join(' -> ')}`,
    );
    active.push(packageName);
    for (const dependency of graph.get(packageName) ?? []) visit(dependency);
    active.pop();
    complete.add(packageName);
  };

  for (const packageName of graph.keys()) visit(packageName);
});

test('focused static entrypoints stay independent from the facade and relative cycles', async () => {
  const sourceRoot = new URL('../packages/static/src/', import.meta.url);
  const sourceRootPath = fileURLToPath(sourceRoot);
  const sourceFiles = await listSourceFiles(sourceRoot);
  const sourcePaths = new Set(sourceFiles.map(fileURLToPath));
  const graph = new Map();

  for (const sourceFile of sourceFiles) {
    const sourcePath = fileURLToPath(sourceFile);
    const source = await readFile(sourceFile, 'utf8');
    const dependencies = [];
    for (const specifier of importedSpecifiers(source).filter((value) => value.startsWith('.'))) {
      const resolvedDependency = resolveRelativeSource(sourcePath, specifier, sourcePaths);
      if (resolvedDependency) dependencies.push(resolvedDependency);
    }
    graph.set(sourcePath, [...new Set(dependencies)]);
  }

  const facadePath = resolve(sourceRootPath, 'index.ts');
  for (const entrypoint of ['scene.ts', 'overlays.ts', 'manifest.ts', 'client.ts']) {
    const entrypointPath = resolve(sourceRootPath, entrypoint);
    assert.ok(
      sourcePaths.has(entrypointPath),
      `Missing focused @tileflow/static entrypoint ${entrypoint}`,
    );
    assertRelativeGraphBoundary(entrypointPath, facadePath, graph, sourceRootPath);
  }
});

async function readPackageManifest(packageName) {
  return JSON.parse(
    await readFile(new URL(`../packages/${packageName}/package.json`, import.meta.url), 'utf8'),
  );
}

async function listSourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(url)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(url);
  }
  return files;
}

function declaredRuntimeTileflowDependencies(manifest) {
  return runtimeDependencySections.flatMap((section) =>
    Object.keys(manifest[section] ?? {})
      .filter((name) => name.startsWith('@tileflow/'))
      .map((name) => {
        const match = /^@tileflow\/([^/]+)$/u.exec(name);
        assert.ok(
          match,
          `${manifest.name} ${section} contains invalid Tileflow package name ${name}`,
        );
        return {name: match[1], section};
      }),
  );
}

function importedSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s+['"]([^'"]+)['"]\s*;?/gu)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveRelativeSource(sourcePath, specifier, sourcePaths) {
  const unresolved = resolve(dirname(sourcePath), specifier);
  const extension = extname(unresolved);
  if (extension && !sourceExtensions.has(extension)) {
    if (!['.js', '.jsx', '.mjs'].includes(extension)) return null;
  }

  const candidates = extension
    ? [
        unresolved,
        ...(['.js', '.jsx', '.mjs'].includes(extension)
          ? ['.ts', '.tsx', '.mts'].map((replacement) =>
              unresolved.slice(0, -extension.length).concat(replacement),
            )
          : []),
      ]
    : [
        ...[...sourceExtensions].map((candidateExtension) => unresolved + candidateExtension),
        ...[...sourceExtensions].map((candidateExtension) =>
          join(unresolved, `index${candidateExtension}`),
        ),
      ];
  const resolvedSource = candidates.find((candidate) => sourcePaths.has(candidate));
  assert.ok(
    resolvedSource,
    `${portableRelative(workspaceRootPath, sourcePath)} has unresolved relative source import ${specifier}`,
  );
  return resolvedSource;
}

function assertRelativeGraphBoundary(entrypointPath, facadePath, graph, sourceRootPath) {
  const complete = new Set();
  const active = [];
  const entrypointLabel = portableRelative(sourceRootPath, entrypointPath);

  const visit = (sourcePath) => {
    const cycleStart = active.indexOf(sourcePath);
    assert.equal(
      cycleStart,
      -1,
      `${entrypointLabel} reaches a relative module cycle: ${[
        ...active.slice(cycleStart),
        sourcePath,
      ]
        .map((path) => portableRelative(sourceRootPath, path))
        .join(' -> ')}`,
    );
    if (complete.has(sourcePath)) return;
    active.push(sourcePath);
    for (const dependency of graph.get(sourcePath) ?? []) {
      assert.notEqual(
        dependency,
        facadePath,
        `${entrypointLabel} must not import or re-export the compatibility facade ./index`,
      );
      visit(dependency);
    }
    active.pop();
    complete.add(sourcePath);
  };

  visit(entrypointPath);
}

function portableRelative(from, to) {
  return relative(from, to).split(sep).join('/');
}

function assertTypeOnlyStaticMapLibreImports(source, label) {
  for (const match of source.matchAll(
    /\bimport\s+(?!\()([^;]+?)\s+from\s+['"]maplibre-gl['"]\s*;?/gu,
  )) {
    assert.match(
      match[1].trim(),
      /^type\b/u,
      `${label} must not evaluate MapLibre through a static value import`,
    );
  }
}

function assertTypeOnlyRootImports(source, label, specifier) {
  const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(
    `\\bimport\\s+(?!\\()([^;]+?)\\s+from\\s+['"]${escapedSpecifier}['"]\\s*;?`,
    'gu',
  );
  for (const match of source.matchAll(pattern)) {
    const clause = match[1].trim();
    const namedTypesOnly =
      clause.startsWith('{') &&
      clause.endsWith('}') &&
      clause
        .slice(1, -1)
        .split(',')
        .every((entry) => /^type\s+/u.test(entry.trim()));
    assert.ok(
      /^type\b/u.test(clause) || namedTypesOnly,
      `${label} may use ${specifier} only for authoring types; choose a focused runtime subpath for values`,
    );
  }
}

function assertLazyMapLibreImportsStayIsolated(source, label) {
  if (!/\bimport\s*\(\s*['"]maplibre-gl['"]\s*\)/u.test(source)) return;
  assert.match(
    label,
    /\/maplibre\.(?:js|ts)$/u,
    `${label} must isolate the conditional MapLibre import in its loader`,
  );
}
