import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderMapApi} from './mobile-map-api.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const contract = JSON.parse(await read('platforms/map-api.json'));
const outputs = renderMapApi(contract);
const stale = [];
for (const [path, content] of Object.entries(outputs)) {
  if (process.argv.includes('--check')) {
    const current = await read(path).catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (current !== content) stale.push(path);
  } else {
    await mkdir(dirname(resolve(root, path)), {recursive: true});
    await writeFile(resolve(root, path), content);
  }
}
if (stale.length)
  throw new Error(`Regenerate with node scripts/mobile-map-api-generate.mjs:\n${stale.join('\n')}`);
