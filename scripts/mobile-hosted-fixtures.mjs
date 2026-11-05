import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// SwiftPM and Gradle package their own test resources. React Native uses the same session cases.
const root = fileURLToPath(new URL('../', import.meta.url));
const ios = 'platforms/ios/Tests/TileflowTests/Fixtures';
const android = 'platforms/android/tileflow/src/test/resources';
const files = {
  'native-session.json': [`${ios}/native-session.json`, `${android}/native-session.json`],
  'session-sequences.json': [`${ios}/session-sequences.json`, `${android}/session-sequences.json`],
};
const stale = [];

for (const [name, destinations] of Object.entries(files)) {
  const source = await readFile(resolve(root, 'test-support/mobile/hosted', name));
  for (const relative of destinations) {
    const path = resolve(root, relative);
    if (process.argv.includes('--check')) {
      const current = await readFile(path).catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!current?.equals(source)) stale.push(relative);
    } else {
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, source);
    }
  }
}
if (stale.length) {
  throw new Error(`Regenerate with node scripts/mobile-hosted-fixtures.mjs:\n${stale.join('\n')}`);
}
