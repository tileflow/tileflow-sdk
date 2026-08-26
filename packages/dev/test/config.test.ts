import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadValidTileflowConfig, TileflowValidationError} from '../src/config';

test('loads exact singular identity, leaf delivery, and map-owned scene ids', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'main',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  delivery: {hosted: {allowedOrigins: ['https://maps.example.test']}},
  scenes: {
    mobile: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 390, height: 844}
    }
  }
});
`,
  );

  const project = await loadValidTileflowConfig(undefined, {cwd});
  assert.deepEqual(Object.keys(project.maps), ['main']);
  assert.equal(project.maps.main?.name, 'main');
  assert.deepEqual(project.maps.main?.delivery, {
    hosted: {allowedOrigins: ['https://maps.example.test']},
  });
  assert.deepEqual(Object.keys(project.scenes ?? {}), ['mobile']);
  assert.equal(project.scenes?.mobile?.map, 'main');
  assert.deepEqual(project.mapMetadata?.main?.lineage, [{id: 'main', mapVersion: 1}]);
});

test('rejects scene map repetition and removed hosting/workspace wrappers', async (t) => {
  const cwd = await fixture(t);
  const configPath = join(cwd, 'tileflow.config.ts');

  await writeFile(
    configPath,
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'main', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  scenes: {proof: {
    map: 'main',
    camera: {type: 'center', center: [0, 0], zoom: 1},
    viewport: {width: 320, height: 200}
  }}
});
`,
  );
  await assert.rejects(
    () => loadValidTileflowConfig(undefined, {cwd, fresh: true}),
    (error: unknown) => hasValidationMessage(error, /scenes.*map/u),
  );

  await writeFile(
    configPath,
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'main', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  allowedOrigins: ['https://maps.example.test']
});
`,
  );
  await assert.rejects(
    () => loadValidTileflowConfig(undefined, {cwd, fresh: true}),
    (error: unknown) => hasValidationMessage(error, /unrecognized key "allowedOrigins"/u),
  );

  await writeFile(
    join(cwd, 'tileflow.workspace.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default {
  maps: {main: defineRootMap({id: 'main', version: 1, root: {compiler: 'streets', compilerVersion: 1}})},
  scenes: {}
};
`,
  );
  await assert.rejects(
    () => loadValidTileflowConfig('tileflow.workspace.ts', {cwd, fresh: true}),
    (error: unknown) => hasValidationMessage(error, /unrecognized key "scenes"/u),
  );

  await writeFile(
    join(cwd, 'tileflow.workspace.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default {
  maps: {main: defineRootMap({id: 'main', version: 1, root: {compiler: 'streets', compilerVersion: 1}})},
  icons: {}
};
`,
  );
  await assert.rejects(
    () => loadValidTileflowConfig('tileflow.workspace.ts', {cwd, fresh: true}),
    (error: unknown) => hasValidationMessage(error, /unrecognized key "icons"/u),
  );

  await writeFile(
    join(cwd, 'tileflow.workspace.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default {
  maps: {main: defineRootMap({id: 'main', version: 1, root: {compiler: 'streets', compilerVersion: 1}})},
  themes: {dark: {mode: 'dark'}}
};
`,
  );
  await assert.rejects(
    () => loadValidTileflowConfig('tileflow.workspace.ts', {cwd, fresh: true}),
    (error: unknown) => hasValidationMessage(error, /unrecognized key "themes"/u),
  );
});

test('reports editable schema paths for singular maps and prefixes only workspaces', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'main', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  view: {pitch: 99}
});
`,
  );

  await assert.rejects(
    () => loadValidTileflowConfig(undefined, {cwd, fresh: true}),
    (error: unknown) =>
      error instanceof TileflowValidationError && error.messages[0]?.path === 'view.pitch',
  );

  await writeFile(
    join(cwd, 'tileflow.workspace.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default {maps: {main: defineRootMap({
  id: 'main', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  view: {pitch: 99}
})}};
`,
  );

  await assert.rejects(
    () => loadValidTileflowConfig('tileflow.workspace.ts', {cwd, fresh: true}),
    (error: unknown) =>
      error instanceof TileflowValidationError &&
      error.messages[0]?.path === 'maps.main.view.pitch',
  );
});

function hasValidationMessage(error: unknown, pattern: RegExp): boolean {
  return (
    error instanceof TileflowValidationError &&
    error.messages.some(({message}) => pattern.test(message))
  );
}

async function fixture(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-dev-config-'));
  t.after(async () => rm(cwd, {force: true, recursive: true}));
  return cwd;
}
