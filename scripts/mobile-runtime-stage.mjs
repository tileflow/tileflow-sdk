import {createHash} from 'node:crypto';
import {cp, mkdir, readdir, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'packages/mobile-runtime/dist');
const receipt = JSON.parse(await readFile(resolve(output, 'receipt.json'), 'utf8'));
const expected = [
  'index.html',
  'runtime.js',
  'maplibre.css',
  'notices.txt',
  'dependencies.json',
].sort();
if (JSON.stringify(Object.keys(receipt.files).sort()) !== JSON.stringify(expected)) {
  throw new Error('Unexpected embedded resource inventory.');
}
for (const name of expected) {
  const bytes = await readFile(resolve(output, name));
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.files[name]) {
    throw new Error(`Embedded resource hash mismatch: ${name}.`);
  }
}
for (const destination of [
  'platforms/ios/Sources/Tileflow/EmbeddedRuntime',
  'platforms/android/tileflow/src/main/assets/tileflow',
]) {
  await mkdir(resolve(root, destination), {recursive: true});
  for (const name of await readdir(resolve(root, destination))) {
    if (![...expected, 'receipt.json'].includes(name)) {
      await rm(resolve(root, destination, name), {recursive: true});
    }
  }
  for (const name of [...expected, 'receipt.json']) {
    await cp(resolve(output, name), resolve(root, destination, name));
  }
}
console.log(`Staged identical embedded resources for Swift and Kotlin (${receipt.runtimeHash}).`);
