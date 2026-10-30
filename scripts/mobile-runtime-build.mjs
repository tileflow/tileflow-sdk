import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectRuntimeNotices} from './mobile-runtime-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = resolve(root, 'packages/mobile-runtime');
const require = createRequire(resolve(packageRoot, 'package.json'));
const {build} = require('esbuild');
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
  write: false,
  metafile: true,
});
const hashPlaceholder = 'TILEFLOW_RUNTIME_CONTENT_HASH_PLACEHOLDER';
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
  metafile: true,
  write: false,
  define: {
    TILEFLOW_RUNTIME_HASH: JSON.stringify(hashPlaceholder),
    TILEFLOW_MAPLIBRE_WORKER: JSON.stringify(worker.outputFiles[0].text),
  },
});
const forbidden = Object.keys(result.metafile.inputs).filter((path) =>
  /\/(?:react|react-dom|react-native|packages\/(?:cli|dev|capture))\//u.test(path),
);
if (forbidden.length)
  throw new Error(`Unexpected dependencies in mobile runtime: ${forbidden.join(', ')}`);
await cp(resolve(packageRoot, 'shell.html'), resolve(output, 'index.html'));
await cp(resolve(maplibreRoot, 'dist/maplibre-gl.css'), resolve(output, 'maplibre.css'));
const notices = await collectRuntimeNotices({
  inputs: [...Object.keys(result.metafile.inputs), ...Object.keys(worker.metafile.inputs)],
  packageRoot,
  repositoryRoot: root,
});
await writeFile(resolve(output, 'notices.txt'), notices.text);
await writeFile(
  resolve(output, 'dependencies.json'),
  `${JSON.stringify(notices.inventory, null, 2)}\n`,
);
const javascript = result.outputFiles[0].text;
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
