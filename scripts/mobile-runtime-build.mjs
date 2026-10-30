import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectRuntimeNotices} from './mobile-runtime-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = resolve(root, 'packages/mobile-runtime');
const require = createRequire(resolve(packageRoot, 'package.json'));
const {build} = require('esbuild');
const {minify} = require('terser');
const output = resolve(packageRoot, 'dist');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const maplibreRoot = dirname(require.resolve('maplibre-gl/package.json'));
const worker = await build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(maplibreRoot, 'dist/maplibre-gl-worker.mjs')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['safari16', 'chrome109'],
  minify: true,
  charset: 'utf8',
  write: false,
  metafile: true,
});
const hashPlaceholder = 'TILEFLOW_RUNTIME_CONTENT_HASH_PLACEHOLDER';
// Read workspace entries from source so shared modules are bundled once and unused modules drop out.
// Replace Core's bundled URL parser, which carries IDNA tables for engines without a conforming URL, with
// the WebView's own. Nothing else in Core changes.
const coreSource = resolve(root, 'packages/core/src');
const cameraWorker = await build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(coreSource, 'camera-tile-worker.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['safari16', 'chrome109'],
  minify: true,
  charset: 'utf8',
  write: false,
  metafile: true,
});
const platformUrl = resolve(packageRoot, 'src/platform-url.ts');
const substituted = new Set();
const coreSourceEntries = {
  name: 'tileflow-workspace-source-entries',
  setup(build) {
    build.onResolve({filter: /^@tileflow\/interactions(?:\/maplibre)?$/}, (args) => ({
      path: resolve(
        root,
        'packages/interactions/src',
        args.path.endsWith('/maplibre') ? 'maplibre-entry.ts' : 'index.ts',
      ),
    }));
    build.onResolve({filter: /^@tileflow\/core\/(?:native|browser|runtime)$/}, (args) => {
      const entry = args.path.slice('@tileflow/core/'.length);
      substituted.add(entry);
      return {path: resolve(coreSource, entry + '.ts')};
    });
    build.onResolve({filter: /^\.\/native-url-provider$/}, (args) => {
      if (!resolve(args.importer).startsWith(`${coreSource}${sep}`)) return undefined;
      substituted.add('parser');
      return {path: platformUrl};
    });
  },
};
await mkdir(output, {recursive: true});
const result = await build({
  absWorkingDir: packageRoot,
  entryPoints: ['src/entry.ts'],
  outfile: resolve(output, 'runtime.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['safari16', 'chrome109'],
  minify: true,
  charset: 'utf8',
  metafile: true,
  write: false,
  define: {
    TILEFLOW_RUNTIME_HASH: JSON.stringify(hashPlaceholder),
    TILEFLOW_MAPLIBRE_WORKER: JSON.stringify(worker.outputFiles[0].text),
    TILEFLOW_CAMERA_TILE_WORKER_SOURCE: JSON.stringify(cameraWorker.outputFiles[0].text),
  },
  plugins: [coreSourceEntries],
});
if (!['native', 'browser', 'runtime', 'parser'].every((entry) => substituted.has(entry)))
  throw new Error('The runtime no longer reads Core entries from source with the platform URL.');
const forbidden = Object.keys(result.metafile.inputs).filter((path) =>
  /\/(?:react|react-dom|react-native|packages\/(?:cli|dev|capture)|whatwg-url|tr46|punycode)\//u.test(
    path.replaceAll('\\', '/'),
  ),
);
if (forbidden.length)
  throw new Error(`Unexpected dependencies in mobile runtime: ${forbidden.join(', ')}`);
await cp(resolve(packageRoot, 'shell.html'), resolve(output, 'index.html'));
await cp(resolve(maplibreRoot, 'dist/maplibre-gl.css'), resolve(output, 'maplibre.css'));
const notices = await collectRuntimeNotices({
  inputs: [
    ...Object.keys(result.metafile.inputs),
    ...Object.keys(worker.metafile.inputs),
    ...Object.keys(cameraWorker.metafile.inputs),
  ],
  packageRoot,
  repositoryRoot: root,
});
await writeFile(resolve(output, 'notices.txt'), notices.text);
await writeFile(
  resolve(output, 'dependencies.json'),
  `${JSON.stringify(notices.inventory, null, 2)}\n`,
);
// Compress across the final bundle while retaining license comments and UTF-8 text.
const compressed = await minify(result.outputFiles[0].text, {
  ecma: 2022,
  compress: {passes: 2},
  mangle: true,
  format: {ascii_only: false, comments: 'some'},
});
const javascript = compressed.code;
if (!javascript) throw new Error('The embedded runtime minifier produced no JavaScript.');
if (javascript.split(hashPlaceholder).length !== 2)
  throw new Error('Runtime hash placeholder is not unique.');
// Hash the actual bundled dependency graph, worker, shell and stylesheet, including changes
// to Core. Normalize only the embedded identity itself to avoid a self-referential hash.
const hash = createHash('sha256').update(javascript);
for (const name of ['index.html', 'maplibre.css', 'notices.txt', 'dependencies.json'])
  hash.update(await readFile(resolve(output, name)));
hash.update(await readFile(resolve(packageRoot, 'protocol.json')));
const runtimeHash = hash.digest('hex');
await writeFile(resolve(output, 'runtime.js'), javascript.replace(hashPlaceholder, runtimeHash));
const files = {};
for (const name of [
  'index.html',
  'runtime.js',
  'maplibre.css',
  'notices.txt',
  'dependencies.json',
]) {
  files[name] = digest(await readFile(resolve(output, name)));
}
const protocol = JSON.parse(await readFile(resolve(packageRoot, 'protocol.json'), 'utf8'));
const maplibre = JSON.parse(await readFile(resolve(maplibreRoot, 'package.json'), 'utf8'));
const receipt = {
  version: 1,
  runtimeHash,
  protocolVersion: protocol.version,
  maplibre: maplibre.version,
  files,
};
await writeFile(resolve(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `Embedded runtime built: MapLibre ${maplibre.version}; ${Object.keys(files).length} resources.`,
);
