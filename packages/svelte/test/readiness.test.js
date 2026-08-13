import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {compile} from 'svelte/compiler';
import {render} from 'svelte/server';

test('compiles and renders the bounded framework-neutral loading contract', async () => {
  const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-svelte-readiness-'));

  try {
    const source = await readFile(new URL('../src/TileflowMap.svelte', import.meta.url), 'utf8');
    const compiled = compile(source, {
      filename: 'TileflowMap.svelte',
      generate: 'server',
    });
    await symlink(join(packageRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
    const modulePath = join(directory, 'TileflowMap.mjs');
    await writeFile(modulePath, compiled.js.code, 'utf8');
    const component = (await import(`${pathToFileURL(modulePath).href}?test=1`)).default;
    const result = render(component, {
      props: {
        captureId: 'proof-map',
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        map: 'main',
        mode: 'image',
      },
    });

    assert.match(result.body, /data-tileflow-capture-id="proof-map"/);
    assert.match(result.body, /data-tileflow-map="main"/);
    assert.match(result.body, /data-tileflow-state="loading"/);
    assert.match(compiled.js.code, /captureState = 'idle'/);
    assert.match(compiled.js.code, /captureState = 'error'/);
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
});
