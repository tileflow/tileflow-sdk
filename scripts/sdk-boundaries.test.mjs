import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, extname, join, relative, resolve, sep} from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {packageDirectories} from './release-config.mjs';

const workspaceRoot = new URL('../', import.meta.url);
const workspaceRootPath = fileURLToPath(workspaceRoot);
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mjs', '.mts', '.svelte', '.ts', '.tsx']);
const runtimeDependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'];

const allowedTileflowDependencies = {
  capture: new Set(['core', 'dev']),
  cli: new Set(['capture', 'coordinates', 'coordinates-runtime', 'core', 'dev', 'maps']),
  coordinates: new Set(),
  'coordinates-runtime': new Set(['coordinates']),
  core: new Set(),
  dev: new Set(['core']),
  elevation: new Set(),
  geoip: new Set(),
  interactions: new Set(),
  maps: new Set(['core']),
  next: new Set(['dev']),
  react: new Set(['core', 'interactions', 'static']),
  'react-native': new Set(['core', 'interactions']),
  routing: new Set(),
  search: new Set(),
  static: new Set(),
  svelte: new Set(['core', 'interactions']),
  vite: new Set(['dev']),
  vue: new Set(['core', 'interactions']),
  webpack: new Set(['dev']),
};

test('every public package has an SDK responsibility boundary', () => {
  assert.deepEqual(Object.keys(allowedTileflowDependencies).sort(), [...packageDirectories].sort());
});

test('Core and Static Maps share one semantic overlay placement vocabulary', async () => {
  const core = await readSourceStringTuple(
    new URL('../packages/core/src/overlays.ts', import.meta.url),
    'tileflowOverlayPlacements',
  );
  const staticMaps = await readSourceStringTuple(
    new URL('../packages/static/src/scene-contract.ts', import.meta.url),
    'staticOverlayPlacements',
  );

  assert.deepEqual(staticMaps, core);
});

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
            [
              'coordinates',
              'core',
              'elevation',
              'geoip',
              'interactions',
              'maps',
              'react',
              'react-native',
              'routing',
              'search',
              'static',
              'svelte',
              'vue',
            ].includes(packageName),
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

        assert.ok(
          manifests.get(dependencyName)?.exports?.[subpath ? `.${subpath}` : '.'],
          `${label} imports unexported public entry point ${specifier}`,
        );
      }

      if (['react', 'svelte', 'vue'].includes(packageName)) {
        assertTypeOnlyRootImports(source, label, '@tileflow/core');
        assertTypeOnlyStaticMapLibreImports(source, label);
        assertLazyMapLibreImportsStayIsolated(source, label);
      }
    }
  }
});

test('native sources and targets have no browser rendering dependency', async () => {
  assert.deepEqual(await nativeBrowserDependencies(workspaceRoot), []);
});

test('native browser guard detects source imports and target linkage', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-native-boundary-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const root = pathToFileURL(directory + sep);
  const files = [
    ['platforms/ios/Sources/Imported.swift', '@preconcurrency import WebKit'],
    ['platforms/ios/Sources/ImportedClass.swift', 'import class WebKit.WKWebView'],
    ['platforms/ios/Sources/Bridge.m', '@import WebKit;'],
    ['platforms/ios/Sources/Bridge.h', '# include <WebKit/WKWebView.h>'],
    ['platforms/ios/Sources/Bridge.mm', '#import "WebKit/WebKit.h"'],
    ['platforms/ios/Sources/module.modulemap', 'module Bridge { link framework "WebKit" }'],
    ['platforms/ios/Sources/module.map', 'module Bridge { link framework "WebKit" }'],
    ['platforms/ios/Sources/Bridge.cxx', '#include <WebKit/WKWebView.h>'],
    ['platforms/ios/Package.swift', 'let settings: [LinkerSetting] = [.linkedFramework("WebKit")]'],
    ['platforms/ios/Package@swift-6.0.swift', '.target(name: "Bridge", dependencies: ["WebKit"])'],
    [
      'platforms/ios/App.xcodeproj/project.pbxproj',
      'path = System/Library/Frameworks/WebKit.framework;',
    ],
    [
      'platforms/ios/project.yml',
      'targets:\n  Tileflow:\n    dependencies:\n      - sdk: WebKit.framework',
    ],
    ['platforms/ios/Link.xcconfig', 'OTHER_LDFLAGS = $(inherited) -weak_framework WebKit'],
    ['packages/react-native/Tileflow.podspec', "spec.frameworks = 'WebKit'"],
    ['test-support/host/Host.swift', 'import WebKit'],
    ['platforms/android/tileflow/src/main/Browser.kt', 'val view: android.webkit.WebView? = null'],
    ['platforms/android/tileflow-search/src/main/Browser.java', 'import android.webkit.WebView;'],
    ['packages/react-native/android/build.gradle', 'implementation "androidx.webkit:webkit:1.0.0"'],
    [
      'platforms/android/gradle/libs.versions.toml',
      'browser = { module = "androidx.webkit:webkit", version = "1.0.0" }',
    ],
  ];
  for (const [path, text] of files) {
    const file = new URL(path, root);
    await mkdir(new URL('./', file), {recursive: true});
    await writeFile(file, text);
    await t.test(path, async () => {
      try {
        assert.deepEqual(await nativeBrowserDependencies(root), [path]);
      } finally {
        await rm(file);
      }
    });
  }
});

test('native browser guard excludes dependency artifacts and comments', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-native-boundary-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const root = pathToFileURL(directory + sep);
  const files = [
    ['platforms/ios/Sources/Map.swift', 'import MapLibre\n// import WebKit\n/* @import WebKit; */'],
    [
      'platforms/ios/Package.swift',
      '.product(name: "MapLibre", package: "maplibre-gl-native-distribution")',
    ],
    ['platforms/ios/project.yml', 'dependencies:\n  - sdk: MapLibre.framework # formerly WebKit'],
    ['platforms/ios/.build/checkouts/Vendor/Package.swift', '.linkedFramework("WebKit")'],
    ['platforms/ios/Pods/Vendor/Bridge.m', '@import WebKit;'],
    ['platforms/ios/MapLibre.xcframework/Headers/Bridge.h', '#import <WebKit/WebKit.h>'],
    ['platforms/ios/vendor/Bridge.swift', 'import WebKit'],
    ['platforms/android/tileflow/build/generated/Bridge.kt', 'import android.webkit.WebView'],
    ['platforms/android/.gradle/caches/Bridge.kt', 'import android.webkit.WebView'],
    ['packages/react-native/node_modules/vendor/Bridge.mm', '@import WebKit;'],
  ];
  for (const [path, text] of files) {
    const file = new URL(path, root);
    await mkdir(new URL('./', file), {recursive: true});
    await writeFile(file, text);
  }
  assert.deepEqual(await nativeBrowserDependencies(root), []);
});

async function nativeBrowserDependencies(root) {
  const sources = new Set([
    '.c',
    '.cc',
    '.cpp',
    '.cxx',
    '.h',
    '.hh',
    '.hpp',
    '.hxx',
    '.inc',
    '.java',
    '.kt',
    '.m',
    '.mm',
    '.swift',
  ]);
  const targets = new Set([
    '.cmake',
    '.def',
    '.gradle',
    '.kts',
    '.modulemap',
    '.pbxproj',
    '.podspec',
    '.toml',
    '.xcconfig',
    '.yaml',
    '.yml',
  ]);
  const targetNames = /^(?:Package(?:@swift-[\d.]+)?\.swift|CMakeLists\.txt|module\.map)$/u;
  const excluded = new Set([
    '.git',
    '.build',
    '.cache',
    '.cxx',
    '.gradle',
    '.kotlin',
    '.swiftpm',
    '.turbo',
    'build',
    'dist',
    'node_modules',
    'Pods',
    'Carthage',
    'DerivedData',
    'vendor',
    'third_party',
  ]);
  const sourceImport =
    /\bimport\s+(?:(?:class|enum|func|let|protocol|struct|typealias|var)\s+)?(?:WebKit|android(?:x)?\.webkit)\b|#\s*(?:import|include)\s*[<"]WebKit[/.]|\bandroid(?:x)?\.webkit[.:]/u;
  const targetDependency = /\b(?:WebKit|android(?:x)?\.webkit)\b/u;
  const dependencies = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (excluded.has(entry.name) || /\.(?:xcframework|framework)$/u.test(entry.name)) continue;
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = extname(entry.name).toLowerCase();
      const target = targets.has(extension) || targetNames.test(entry.name);
      if (!target && !sources.has(extension)) continue;

      const hashComments =
        ['.podspec', '.toml', '.yaml', '.yml', '.cmake'].includes(extension) ||
        entry.name === 'CMakeLists.txt';
      const text = (await readFile(file, 'utf8')).replace(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/gu,
        (part) =>
          part.startsWith('//') || part.startsWith('/*') || (hashComments && part.startsWith('#'))
            ? ' '
            : part,
      );
      if ((target ? targetDependency : sourceImport).test(text))
        dependencies.push(portableRelative(fileURLToPath(root), fileURLToPath(file)));
    }
  }

  await visit(root);
  return dependencies.sort();
}

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

test('focused static entrypoints have no relative module cycles', async () => {
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

  for (const entrypoint of ['scene.ts', 'overlays.ts', 'manifest.ts', 'client.ts']) {
    const entrypointPath = resolve(sourceRootPath, entrypoint);
    assert.ok(
      sourcePaths.has(entrypointPath),
      `Missing focused @tileflow/static entrypoint ${entrypoint}`,
    );
    assertRelativeGraphBoundary(entrypointPath, graph, sourceRootPath);
  }
});

async function readPackageManifest(packageName) {
  return JSON.parse(
    await readFile(new URL(`../packages/${packageName}/package.json`, import.meta.url), 'utf8'),
  );
}

async function listSourceFiles(root, extensions = sourceExtensions) {
  const files = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(url, extensions)));
    else if (extensions.has(extname(entry.name))) files.push(url);
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

function assertRelativeGraphBoundary(entrypointPath, graph, sourceRootPath) {
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
    for (const dependency of graph.get(sourcePath) ?? []) visit(dependency);
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

async function readSourceStringTuple(sourceUrl, exportName) {
  const source = await readFile(sourceUrl, 'utf8');
  const declaration = new RegExp(
    `export const ${exportName} = \\[([\\s\\S]*?)\\] as const;`,
    'u',
  ).exec(source);
  assert.ok(declaration, `Expected exported tuple ${exportName}`);
  return [...declaration[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}
