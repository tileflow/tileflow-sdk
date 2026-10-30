import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderStyle} from './mobile-style.mjs';

// Writes the typed runtime style of the Swift and Kotlin SDKs from the MapLibre style specification
// that the embedded renderer's MapLibre GL JS depends on. `--check` fails instead when a generated
// file differs, so the native style types always match the renderer's specification.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = createRequire(resolve(root, 'packages/mobile-runtime/package.json'));
const maplibre = createRequire(runtime.resolve('maplibre-gl/package.json'));
const specification = maplibre.resolve('@maplibre/maplibre-gl-style-spec/package.json');
const {version} = JSON.parse(await readFile(specification, 'utf8'));
const spec = JSON.parse(
  await readFile(resolve(dirname(specification), 'dist/latest.json'), 'utf8'),
);
const stale = [];
for (const [path, content] of Object.entries(renderStyle(spec, version))) {
  if (process.argv.includes('--check')) {
    const current = await readFile(resolve(root, path), 'utf8').catch(() => undefined);
    if (current !== content) stale.push(path);
  } else {
    await mkdir(dirname(resolve(root, path)), {recursive: true});
    await writeFile(resolve(root, path), content);
  }
}
if (stale.length)
  throw new Error(`Regenerate with node scripts/mobile-style-generate.mjs:\n${stale.join('\n')}`);
