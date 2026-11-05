import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNativeStylePins} from './mobile-native-style.mjs';
import {renderStyle} from './mobile-style.mjs';

// Generate the native style types from the same specification as the map compiler.
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = createRequire(resolve(root, 'packages/dev/package.json'));
const specification = compiler.resolve('@maplibre/maplibre-gl-style-spec/package.json');
const {version} = JSON.parse(await readFile(specification, 'utf8'));
const spec = JSON.parse(
  await readFile(resolve(dirname(specification), 'dist/latest.json'), 'utf8'),
);
const stale = [];
for (const [path, content] of Object.entries(
  renderStyle(spec, version, await readNativeStylePins(root)),
)) {
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
