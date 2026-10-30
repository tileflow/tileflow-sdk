import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

// The embedded runtime ships inside every Swift and Kotlin application. Growth beyond the recorded
// budget must be a reviewed change to size-budget.json, not a side effect of a dependency update.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = resolve(root, 'packages/mobile-runtime');
const budget = JSON.parse(await readFile(resolve(runtimeRoot, 'size-budget.json'), 'utf8'));
const failures = [];
for (const [name, limits] of Object.entries(budget.files)) {
  const bytes = await readFile(resolve(runtimeRoot, 'dist', name));
  const sizes = {bytes: bytes.byteLength, gzipBytes: gzipSync(bytes, {level: 9}).byteLength};
  for (const [measure, size] of Object.entries(sizes)) {
    const limit = limits[measure];
    const share = ((size / limit) * 100).toFixed(1);
    console.log(`${name} ${measure}: ${size} of ${limit} (${share}%)`);
    if (size > limit) failures.push(`${name} ${measure} ${size} exceeds ${limit}`);
  }
}
if (failures.length) {
  console.error(`Embedded runtime exceeds its size budget:\n${failures.join('\n')}`);
  process.exitCode = 1;
}
