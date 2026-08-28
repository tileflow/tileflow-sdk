import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import semver from 'semver';
import {runCommand} from './run-command.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageVersion = '0.1.0-alpha.16';
const typeScriptVersion = '6.0.3';
const nodeTypesVersion = '22.20.1';
const geoJsonTypesVersion = '7946.0.16';
const tileflowPackageNames = new Set([
  '@tileflow/core',
  '@tileflow/dev',
  '@tileflow/interactions',
  '@tileflow/next',
  '@tileflow/react',
  '@tileflow/static',
  '@tileflow/svelte',
  '@tileflow/vite',
  '@tileflow/vue',
  '@tileflow/webpack',
]);

const suites = {
  react: {
    build: ['core', 'interactions', 'static', 'react'],
    packages: ['core', 'interactions', 'static', 'react'],
    scenarios: [
      {
        dependencies: {
          '@types/react': '18.3.3',
          '@types/react-dom': '18.3.0',
          '@types/geojson': geoJsonTypesVersion,
          'maplibre-gl': '5.0.0',
          react: '18.0.0',
          'react-dom': '18.0.0',
          typescript: typeScriptVersion,
        },
        name: 'react-18-maplibre-5',
      },
      {
        dependencies: {
          '@types/react': '19.0.0',
          '@types/react-dom': '19.0.0',
          '@types/geojson': geoJsonTypesVersion,
          'maplibre-gl': '6.0.0',
          react: '19.0.0',
          'react-dom': '19.0.0',
          typescript: typeScriptVersion,
        },
        name: 'react-19-maplibre-6',
      },
    ],
    verify: verifyReact,
  },
  vue: {
    build: ['core', 'interactions', 'vue'],
    packages: ['core', 'interactions', 'vue'],
    scenarios: ['5.0.0', '6.0.0'].map((maplibreVersion) => ({
      dependencies: {
        '@types/geojson': geoJsonTypesVersion,
        '@vue/server-renderer': '3.3.0',
        'maplibre-gl': maplibreVersion,
        typescript: typeScriptVersion,
        vue: '3.3.0',
      },
      name: `vue-3.3-maplibre-${semver.major(maplibreVersion)}`,
    })),
    verify: verifyVue,
  },
  svelte: {
    build: ['core', 'interactions', 'svelte'],
    packages: ['core', 'interactions', 'svelte'],
    scenarios: ['5.0.0', '6.0.0'].map((maplibreVersion) => ({
      dependencies: {
        '@types/geojson': geoJsonTypesVersion,
        'maplibre-gl': maplibreVersion,
        svelte: '5.0.0',
        'svelte-preprocess': '6.0.5',
        typescript: typeScriptVersion,
      },
      name: `svelte-5-maplibre-${semver.major(maplibreVersion)}`,
    })),
    verify: verifySvelte,
  },
  vite: {
    build: ['core', 'dev', 'vite'],
    packages: ['core', 'dev', 'vite'],
    scenarios: ['5.0.0', '6.0.0', '7.0.0', '8.0.0'].map((viteVersion) => ({
      dependencies: {
        '@types/node': nodeTypesVersion,
        typescript: typeScriptVersion,
        vite: viteVersion,
      },
      name: `vite-${semver.major(viteVersion)}`,
    })),
    verify: verifyVite,
  },
  next: {
    build: ['core', 'dev', 'next'],
    packages: ['core', 'dev', 'next'],
    scenarios: [
      nextScenario('14.0.0', '18.2.0'),
      nextScenario('15.0.0', '18.2.0'),
      nextScenario('16.0.0', '19.0.0'),
    ],
    verify: verifyNext,
  },
  webpack: {
    build: ['core', 'dev', 'webpack'],
    packages: ['core', 'dev', 'webpack'],
    scenarios: [
      {
        dependencies: {webpack: '5.61.0'},
        name: 'webpack-5',
      },
    ],
    verify: verifyWebpack,
  },
};

const requestedSuite = argumentValue('--suite');
const validateOnly = process.argv.includes('--validate-only');
assert.ok(
  !requestedSuite || Object.hasOwn(suites, requestedSuite),
  `Unknown --suite ${requestedSuite}. Expected one of: ${Object.keys(suites).join(', ')}.`,
);
const selectedSuites = requestedSuite ? [requestedSuite] : Object.keys(suites);
const selectedBuildDirectories = orderedUnique(
  selectedSuites.flatMap((name) => suites[name].build),
);
const selectedPackageDirectories = orderedUnique(
  selectedSuites.flatMap((name) => suites[name].packages),
);

if (validateOnly) {
  const summaries = [];
  for (const suiteName of selectedSuites) {
    const manifest = JSON.parse(
      await readFile(join(repositoryRoot, 'packages', suiteName, 'package.json'), 'utf8'),
    );
    assertPeerCoverage(manifest, suites[suiteName].scenarios);
    summaries.push({name: suiteName, peers: manifest.peerDependencies});
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        buildDirectories: selectedBuildDirectories,
        ok: true,
        packageDirectories: selectedPackageDirectories,
        suites: summaries,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'tileflow-peer-compat-'));
const npmCacheDirectory = join(temporaryRoot, 'npm-cache');
const results = [];

try {
  for (const directory of selectedBuildDirectories) {
    await run(pnpmCommand(), ['--filter', `@tileflow/${directory}`, 'run', 'build'], {
      label: `build @tileflow/${directory}`,
    });
  }

  const tarballs = await packPackages(selectedPackageDirectories);

  for (const suiteName of selectedSuites) {
    const suite = suites[suiteName];
    const packageManifest = JSON.parse(
      await readFile(join(repositoryRoot, 'packages', suiteName, 'package.json'), 'utf8'),
    );
    assertPeerCoverage(packageManifest, suite.scenarios);

    for (const scenario of suite.scenarios) {
      const consumerDirectory = join(temporaryRoot, 'consumers', scenario.name);
      await mkdir(consumerDirectory, {recursive: true});
      const dependencies = {...scenario.dependencies};
      for (const directory of suite.packages) {
        const packageName = `@tileflow/${directory}`;
        const tarball = tarballs.get(packageName);
        assert.ok(tarball, `Missing packed dependency ${packageName}.`);
        dependencies[packageName] = localPackageSpec(consumerDirectory, tarball);
      }
      await writeJson(join(consumerDirectory, 'package.json'), {
        dependencies: sortObject(dependencies),
        name: `tileflow-peer-${scenario.name}`,
        private: true,
        type: 'module',
      });
      await run(
        npmCommand(),
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
        {
          cwd: consumerDirectory,
          env: {...process.env, npm_config_cache: npmCacheDirectory},
          label: `install ${scenario.name}`,
        },
      );
      await assertInstalledPeerVersions(consumerDirectory, packageManifest, scenario);
      await suite.verify(consumerDirectory);
      results.push({
        peers: pickPeers(packageManifest, scenario.dependencies),
        scenario: scenario.name,
      });
    }
  }

  process.stdout.write(`${JSON.stringify({ok: true, results}, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, {force: true, recursive: true});
}

function nextScenario(nextVersion, reactVersion) {
  return {
    dependencies: {
      next: nextVersion,
      react: reactVersion,
      'react-dom': reactVersion,
    },
    name: `next-${semver.major(nextVersion)}`,
  };
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith('--'), `${flag} requires a value.`);
  return value;
}

function assertPeerCoverage(manifest, scenarios) {
  const peers = manifest.peerDependencies ?? {};
  assert.ok(Object.keys(peers).length > 0, `${manifest.name} must declare peer dependencies.`);

  for (const [peer, range] of Object.entries(peers)) {
    assert.ok(semver.validRange(range), `${manifest.name} has an invalid ${peer} range: ${range}.`);
    const versions = [...new Set(scenarios.map(({dependencies}) => dependencies[peer]))];
    assert.ok(
      versions.every(Boolean),
      `${manifest.name} has no compatibility target for peer ${peer}.`,
    );
    for (const version of versions) {
      assert.ok(
        semver.satisfies(version, range),
        `${manifest.name} scenario version ${peer}@${version} is outside ${range}.`,
      );
    }

    const minimum = semver.minVersion(range);
    assert.ok(minimum, `${manifest.name} has no minimum for ${peer}@${range}.`);
    assert.ok(
      versions.includes(minimum.version),
      `${manifest.name} must test its exact ${peer} minimum ${minimum.version}.`,
    );
    assert.equal(
      semver.satisfies('999.0.0', range),
      false,
      `${manifest.name} must not claim unbounded future ${peer} majors.`,
    );

    const testedMajors = new Set(versions.map((version) => semver.major(version)));
    for (let major = minimum.major; major <= minimum.major + 20; major += 1) {
      const majorRange = `>=${major}.0.0 <${major + 1}.0.0`;
      if (!semver.intersects(range, majorRange)) continue;
      assert.ok(
        testedMajors.has(major),
        `${manifest.name} claims ${peer} major ${major} without a compatibility scenario.`,
      );
    }
  }
}

async function packPackages(directories) {
  const packDirectory = join(temporaryRoot, 'packs');
  const tarballs = new Map();
  await mkdir(packDirectory, {recursive: true});

  for (const directory of directories) {
    const sourceRoot = join(repositoryRoot, 'packages', directory);
    const stagingRoot = join(temporaryRoot, 'staging', directory);
    await cp(sourceRoot, stagingRoot, {recursive: true});
    const manifestPath = join(stagingRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = packageVersion;
    for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [dependency, range] of Object.entries(manifest[group] ?? {})) {
        if (!tileflowPackageNames.has(dependency) || !range.startsWith('workspace:')) continue;
        manifest[group][dependency] = range.slice('workspace:'.length);
      }
    }
    await writeJson(manifestPath, manifest);
    const result = await run(
      pnpmCommand(),
      ['pack', '--pack-destination', packDirectory, '--json'],
      {cwd: stagingRoot, label: `pack @tileflow/${directory}`},
    );
    const packed = JSON.parse(result.stdout);
    tarballs.set(packed.name, resolve(packed.filename));
  }

  return tarballs;
}

async function assertInstalledPeerVersions(consumerDirectory, manifest, scenario) {
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    const installedManifest = JSON.parse(
      await readFile(join(consumerDirectory, 'node_modules', ...peer.split('/'), 'package.json')),
    );
    assert.equal(
      installedManifest.version,
      scenario.dependencies[peer],
      `${scenario.name} installed an unexpected ${peer} version.`,
    );
  }
}

async function verifyReact(directory) {
  await writeTypeScriptConfig(directory, ['consumer.tsx'], ['geojson']);
  await writeFile(
    join(directory, 'consumer.tsx'),
    `import {Map} from '@tileflow/react';
import {StaticMap} from '@tileflow/react/static';

export const interactive = <Map source={{kind: 'maplibre', style: 'https://example.com/style.json'}} center={[0, 0]} zoom={2} />;
export const image = <Map source={{kind: 'maplibre', style: 'https://example.com/style.json'}} mode="image" imageUrl="https://example.com/map.png" />;
export const staticMap = <StaticMap map="main" theme="light" camera={{type: 'center', center: [0, 0], zoom: 2}} size={{width: 256, height: 256}} imageUrl="https://example.com/static.png" />;
`,
  );
  await runTypeScript(directory);
  await writeDenyMapLibreLoader(directory);
  await writeFile(
    join(directory, 'image-ssr.mjs'),
    `import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {Map} from '@tileflow/react';
import {StaticMap} from '@tileflow/react/static';

const image = renderToString(createElement(Map, {source: {kind: 'maplibre', style: 'https://example.com/style.json'}, mode: 'image', imageUrl: 'https://example.com/map.png'}));
const staticImage = renderToString(createElement(StaticMap, {map: 'main', theme: 'light', camera: {type: 'center', center: [0, 0], zoom: 2}, size: {width: 256, height: 256}, imageUrl: 'https://example.com/static.png'}));
if (!image.includes('<img') || !staticImage.includes('<img')) throw new Error('React image SSR did not render an image');
`,
  );
  await runDenyingMapLibre(directory, 'image-ssr.mjs');
}

async function verifyVue(directory) {
  await writeTypeScriptConfig(directory, ['consumer.ts'], ['geojson']);
  await writeFile(
    join(directory, 'consumer.ts'),
    `import {h} from 'vue';
import {TileflowMap, type TileflowMapProps} from '@tileflow/vue';

const props = {source: {kind: 'maplibre' as const, style: 'https://example.com/style.json'}, mode: 'image' as const, imageUrl: 'https://example.com/map.png'} satisfies TileflowMapProps;
export const image = h(TileflowMap, props);
`,
  );
  await runTypeScript(directory);
  await writeDenyMapLibreLoader(directory);
  await writeFile(
    join(directory, 'image-ssr.mjs'),
    `import {createSSRApp, h} from 'vue';
import {renderToString} from '@vue/server-renderer';
import {TileflowMap} from '@tileflow/vue';

const html = await renderToString(createSSRApp({render: () => h(TileflowMap, {source: {kind: 'maplibre', style: 'https://example.com/style.json'}, mode: 'image', imageUrl: 'https://example.com/map.png'})}));
if (!html.includes('<img')) throw new Error('Vue image SSR did not render an image');
`,
  );
  await runDenyingMapLibre(directory, 'image-ssr.mjs');
}

async function verifySvelte(directory) {
  await writeTypeScriptConfig(directory, ['consumer.ts'], ['geojson']);
  await writeFile(
    join(directory, 'consumer.ts'),
    `import TileflowMap, {type TileflowMapProps} from '@tileflow/svelte';

export const component = TileflowMap;
export const props = {source: {kind: 'maplibre' as const, style: 'https://example.com/style.json'}, mode: 'image' as const, imageUrl: 'https://example.com/map.png'} satisfies TileflowMapProps;
`,
  );
  await runTypeScript(directory);
  await writeFile(
    join(directory, 'compile-svelte.mjs'),
    `import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {compile, preprocess} from 'svelte/compiler';
import sveltePreprocess from 'svelte-preprocess';

const componentUrl = import.meta.resolve('@tileflow/svelte/TileflowMap.svelte');
const source = await readFile(fileURLToPath(componentUrl), 'utf8');
const processed = await preprocess(source, sveltePreprocess({typescript: {tsconfigFile: false}}), {filename: 'TileflowMap.svelte'});
const component = compile(processed.code, {filename: 'TileflowMap.svelte', generate: 'server'});
const consumer = compile(\`<script>import TileflowMap from '@tileflow/svelte';<\\/script><TileflowMap source={{kind: 'maplibre', style: 'https://example.com/style.json'}} mode="image" imageUrl="https://example.com/map.png" />\`, {filename: 'Consumer.svelte', generate: 'server'});
if (!component.js?.code || !consumer.js?.code) throw new Error('Svelte consumer compilation produced no JavaScript');
`,
  );
  await run(process.execPath, [join(directory, 'compile-svelte.mjs')], {
    cwd: directory,
    label: 'compile Svelte consumer',
  });
}

async function verifyVite(directory) {
  // Vite 5's FSWatcher declaration predates members in current @types/node. The source-level
  // Plugin assignment plus the real build still verify Tileflow without auditing Vite internals.
  await writeTypeScriptConfig(directory, ['consumer.ts'], ['node'], {skipLibCheck: true});
  await writeFile(
    join(directory, 'consumer.ts'),
    `import type {Plugin} from 'vite';
import {tileflow} from '@tileflow/vite';

export const plugin: Plugin = tileflow({emitBuildArtifacts: false});
`,
  );
  await runTypeScript(directory);
  await mkdir(join(directory, 'src'));
  await writeFile(
    join(directory, 'index.html'),
    '<main id="app"></main><script type="module" src="/src/main.js"></script>\n',
  );
  await writeFile(
    join(directory, 'src/main.js'),
    "document.querySelector('#app').textContent = 'tileflow';\n",
  );
  await writeFile(
    join(directory, 'vite.config.mjs'),
    `import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';
export default defineConfig({plugins: [tileflow({emitBuildArtifacts: false})]});
`,
  );
  await run(process.execPath, [join(directory, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: directory,
    label: 'build Vite consumer',
  });
}

async function verifyNext(directory) {
  await mkdir(join(directory, 'app'));
  await writeFile(
    join(directory, 'next.config.mjs'),
    `import {withTileflow} from '@tileflow/next';
export default withTileflow({experimental: {cpus: 1}}, {emitBuildArtifacts: false, routeBase: false});
`,
  );
  await writeFile(
    join(directory, 'app/layout.js'),
    'export default function Layout({children}) { return <html><body>{children}</body></html>; }\n',
  );
  await writeFile(
    join(directory, 'app/page.js'),
    'export default function Page() { return <main>Tileflow</main>; }\n',
  );
  await run(process.execPath, [join(directory, 'node_modules/next/dist/bin/next'), 'build'], {
    cwd: directory,
    env: {...process.env, NEXT_TELEMETRY_DISABLED: '1'},
    label: 'build Next.js consumer',
  });
}

async function verifyWebpack(directory) {
  await writeFile(join(directory, 'entry.js'), "document.body.textContent = 'tileflow';\n");
  await writeFile(
    join(directory, 'build-webpack.mjs'),
    `import webpack from 'webpack';
import {TileflowWebpackPlugin} from '@tileflow/webpack';
import {resolve} from 'node:path';

const compiler = webpack({
  context: process.cwd(),
  entry: './entry.js',
  mode: 'production',
  output: {filename: 'bundle.js', hashFunction: 'sha256', path: resolve('dist')},
  plugins: [new TileflowWebpackPlugin({emitBuildArtifacts: false})],
});
await new Promise((resolveBuild, rejectBuild) => compiler.run((error, stats) => {
  const buildError = error ?? (stats?.hasErrors() ? new Error(stats.toString({all: false, errors: true})) : null);
  compiler.close((closeError) => {
    if (buildError || closeError) rejectBuild(buildError ?? closeError);
    else resolveBuild();
  });
}));
`,
  );
  await run(process.execPath, [join(directory, 'build-webpack.mjs')], {
    cwd: directory,
    label: 'build Webpack consumer',
  });
}

async function writeTypeScriptConfig(directory, include, types, options = {}) {
  await writeJson(join(directory, 'tsconfig.json'), {
    compilerOptions: {
      allowSyntheticDefaultImports: true,
      jsx: 'react-jsx',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      noEmit: true,
      skipLibCheck: options.skipLibCheck ?? false,
      strict: true,
      target: 'ES2022',
      types,
      verbatimModuleSyntax: true,
    },
    include,
  });
}

async function runTypeScript(directory) {
  await run(process.execPath, [join(directory, 'node_modules/typescript/bin/tsc')], {
    cwd: directory,
    label: 'typecheck consumer',
  });
}

async function writeDenyMapLibreLoader(directory) {
  await writeFile(
    join(directory, 'deny-maplibre-loader.mjs'),
    `export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'maplibre-gl') throw new Error('image/SSR path attempted to load maplibre-gl');
  return nextResolve(specifier, context);
}
`,
  );
}

async function runDenyingMapLibre(directory, entry) {
  await run(
    process.execPath,
    ['--experimental-loader', join(directory, 'deny-maplibre-loader.mjs'), join(directory, entry)],
    {cwd: directory, label: `${entry} without MapLibre`},
  );
}

function pickPeers(manifest, dependencies) {
  return Object.fromEntries(
    Object.keys(manifest.peerDependencies ?? {}).map((peer) => [peer, dependencies[peer]]),
  );
}

function localPackageSpec(consumerDirectory, tarball) {
  const path = relative(consumerDirectory, tarball).replaceAll('\\', '/');
  return `file:${path.startsWith('.') ? path : `./${path}`}`;
}

function orderedUnique(values) {
  const order = [
    'core',
    'interactions',
    'static',
    'dev',
    'react',
    'vue',
    'svelte',
    'vite',
    'next',
    'webpack',
  ];
  const selected = new Set(values);
  const unknown = [...selected].filter((value) => !order.includes(value));
  assert.deepEqual(unknown, [], `Unknown peer-smoke package directories: ${unknown.join(', ')}.`);
  return order.filter((value) => selected.has(value));
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function writeJson(path, value) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  return runCommand(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    label: options.label,
  });
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}
