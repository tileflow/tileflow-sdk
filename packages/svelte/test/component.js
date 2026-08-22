import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {compile} from 'svelte/compiler';

export async function compileTileflowMap(testId) {
  const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const directory = await mkdtemp(join(tmpdir(), `tileflow-svelte-${testId}-`));
  const source = await readFile(new URL('../src/TileflowMap.svelte', import.meta.url), 'utf8');
  const compiled = compile(source, {
    filename: 'TileflowMap.svelte',
    generate: 'server',
  });

  await symlink(join(packageRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
  await symlink(
    fileURLToPath(new URL('../src/style-source.js', import.meta.url)),
    join(directory, 'style-source.js'),
    'file',
  );

  const modulePath = join(directory, 'TileflowMap.mjs');
  await writeFile(modulePath, compiled.js.code, 'utf8');

  return {
    cleanup: () => rm(directory, {force: true, recursive: true}),
    code: compiled.js.code,
    component: (await import(`${pathToFileURL(modulePath).href}?test=${testId}`)).default,
  };
}
