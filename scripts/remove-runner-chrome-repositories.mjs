import {readdir, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Playwright supplies Chromium; these unrelated runner indexes must not gate its OS libraries.
export async function removeRunnerChromeRepositories(directory = '/etc/apt/sources.list.d') {
  const files = (await readdir(directory))
    .filter((name) => /^google-chrome(?:-stable)?\.(?:list|sources)$/u.test(name))
    .sort();

  for (const file of files) await unlink(join(directory, file));
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const removed = await removeRunnerChromeRepositories();
  console.log(`Removed unused runner Chrome APT sources: ${removed.join(', ') || 'none'}`);
}
