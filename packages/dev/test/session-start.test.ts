import {FSWatcher} from 'chokidar';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createTileflowArtifactSessionWithBuilder} from '../src/session';

for (const outcome of ['ready', 'invalid'] as const) {
  test(`startup waits for a superseding watched build to become ${outcome}`, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-session-start-'));
    const config = join(cwd, 'tileflow.config.ts');
    await writeFile(config, 'export default {};');
    let watcher: FSWatcher | undefined;
    const emit = FSWatcher.prototype.emit;
    t.mock.method(
      FSWatcher.prototype,
      'emit',
      function (this: FSWatcher, event: string, ...args: unknown[]) {
        if (event === 'ready') watcher = this;
        if (event === 'all' || event === 'raw') return false;
        return Reflect.apply(emit, this, [event, ...args]) as boolean;
      },
    );
    let beganSecond!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      beganSecond = resolve;
    });
    let finishSecond!: () => void;
    const secondFinished = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    let builds = 0;
    let returned = false;
    const creation = createTileflowArtifactSessionWithBuilder(
      {cwd, watch: true, debounceMs: 0},
      async () => {
        const generation = ++builds;
        if (generation === 1) {
          assert.ok(watcher);
          Reflect.apply(emit, watcher, ['all', 'change', config]);
          await secondStarted;
        } else {
          beganSecond();
          await secondFinished;
          if (outcome === 'invalid') throw new Error('The newer configuration is invalid.');
        }
        return {
          assets: [],
          manifest: {version: 1, maps: {}},
          project: {maps: {}},
          styles: {},
          watchPaths: [],
        } as never;
      },
    );
    void creation.then(() => {
      returned = true;
    });
    t.after(async () => {
      finishSecond();
      await (await creation).close();
      await rm(cwd, {recursive: true, force: true});
    });
    await secondStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(returned, false, 'Startup must not expose an unfinished first generation.');
    finishSecond();
    const session = await creation;
    const state = session.getState();
    assert.equal(state.status, outcome);
    assert.equal(state.generation, 2);
    assert.equal(Boolean(session.getLastGoodArtifacts()), outcome === 'ready');
    if (state.status === 'invalid') {
      assert.match(state.diagnostics[0]?.message ?? '', /newer configuration is invalid/u);
    }
  });
}
