import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {renderProtocol} from './mobile-protocol.mjs';

// Writes the protocol for the embedded runtime, Swift and Kotlin from protocol.json. `--check`
// fails instead when a generated file differs, so hosts and runtime cannot drift.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const contract = JSON.parse(await read('packages/mobile-runtime/protocol.json'));
const outputs = await renderProtocol(contract, {
  typescript: async (source) =>
    format(source, {
      ...(await resolveConfig(resolve(root, 'packages/mobile-runtime/src/contract.ts'))),
      parser: 'typescript',
    }),
  sessionFixture: await read('packages/mobile-runtime/test/fixtures/native-session.json'),
  sequenceFixture: await read('packages/mobile-runtime/test/fixtures/session-sequences.json'),
});
const stale = [];
for (const [path, content] of Object.entries(outputs)) {
  if (process.argv.includes('--check')) {
    const current = await read(path).catch(() => undefined);
    if (current !== content) stale.push(path);
  } else {
    await mkdir(dirname(resolve(root, path)), {recursive: true});
    await writeFile(resolve(root, path), content);
  }
}
if (stale.length)
  throw new Error(
    `Regenerate with node scripts/mobile-protocol-generate.mjs:\n${stale.join('\n')}`,
  );
