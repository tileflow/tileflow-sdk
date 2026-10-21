import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {startFixtureProcess} from '../../../test-support/fixture-process';

const observer = fileURLToPath(new URL('../../../test-support/test-progress.cjs', import.meta.url));
const probe = `
  const {channel} = require('node:diagnostics_channel');
  const {EventEmitter} = require('node:events');
  for (const spawnargs of [['node', '--test', 'fixture.test.ts'], ['node', 'one.test.ts', 'two.test.ts']]) {
    const child = new EventEmitter();
    child.spawnargs = spawnargs;
    channel('child_process').publish({process: child});
    child.emit('spawn');
    child.emit('close', 0);
  }
  for (let index = 0; index < 70; index++) {
    const child = new EventEmitter();
    child.pid = index + 1;
    child.spawnargs = ['node', 'C:\\\\private\\\\fixture.test.ts'];
    channel('child_process').publish({process: child});
    child.emit('spawn');
    child.emit('close', 0);
  }
`;

test('CLI progress is opt-in, bounded and excludes parent paths', () => {
  for (const enabled of ['', '1']) {
    const result = spawnSync(process.execPath, ['--require', observer, '--eval', probe], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: '',
        TILEFLOW_TEST_PROGRESS: '',
        TILEFLOW_CLI_TEST_PROGRESS: enabled,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    if (!enabled) {
      assert.equal(result.stderr, '');
      continue;
    }

    const records = result.stderr.trim().split('\n');
    assert.equal(records.length, 128);
    for (const [index, record] of records.entries()) {
      assert.deepEqual(JSON.parse(record.slice('[sdk-test] '.length)), {
        phase: index % 2 === 0 ? 'start' : 'close',
        file: 'fixture.test.ts',
        pid: Math.floor(index / 2) + 1,
        ...(index % 2 === 0 ? {} : {code: 0}),
      });
    }
  }
});

test('Windows CI preload preserves path separators', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const template = workflow.match(/format\('([^']*--require[^']+)', github\.workspace\)/u)?.[1];
  assert.ok(template);
  const workspace = 'C:\\tileflow-progress-fixture';
  const requested = `${workspace}/test-support/test-progress.cjs`;
  const result = spawnSync(process.execPath, ['--eval', ''], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: template.replace('{0}', workspace),
      NODE_TEST_CONTEXT: '',
      TILEFLOW_CLI_TEST_PROGRESS: '',
      TILEFLOW_TEST_PROGRESS: '',
    },
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /MODULE_NOT_FOUND/u);
  assert.equal(result.stderr.match(/Cannot find module '([^']+)'/u)?.[1], requested);
});

test('progress identifies waiting files without retaining timers or child arguments', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      observer,
      '--eval',
      `
        const {channel} = require('node:diagnostics_channel');
        const {EventEmitter} = require('node:events');
        let tick;
        let unreferenced = false;
        global.setInterval = (callback) => {
          tick = callback;
          return {unref() { unreferenced = true; }};
        };
        const child = new EventEmitter();
        child.pid = 123;
        child.spawnargs = ['node', '/private/fixture.test.ts', '--secret=hidden'];
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        channel('child_process').publish({process: child});
        child.emit('spawn');
        if (tick) tick();
        child.emit('close', 1);
        if (tick) tick();
        process.stdout.write(JSON.stringify({unreferenced}));
      `,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: '',
        TILEFLOW_TEST_PROGRESS: '',
        TILEFLOW_CLI_TEST_PROGRESS: '1',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {unreferenced: true});
  assert.doesNotMatch(result.stderr, /private|secret|hidden/u);
  const records = result.stderr
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line.slice(line.indexOf('{'))));
  const waiting = records.find(({phase}) => phase === 'waiting');
  assert.ok(waiting, result.stderr);
  assert.equal(waiting.active[0].file, 'fixture.test.ts');
  assert.equal(waiting.active[0].pid, 123);
  assert.ok(waiting.active[0].elapsedMs >= 0);
  assert.ok(waiting.active[0].silentMs >= 0);
  assert.equal(records.at(-1).phase, 'close');
});

test('worker progress exposes resource counts without changing stdout', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--eval',
      `
    process.argv.push('/private/fixture.test.mjs');
    let tick;
    let unreferenced = false;
    global.setInterval = (callback) => {
      tick = callback;
      return {unref() { unreferenced = true; }};
    };
    require(${JSON.stringify(observer)});
    tick();
    process.stdout.write(JSON.stringify({unreferenced}));
  `,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NODE_TEST_CONTEXT: 'child-v8',
        TILEFLOW_TEST_PROGRESS: '1',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {unreferenced: true});
  assert.doesNotMatch(result.stderr, /private/u);
  const record = JSON.parse(result.stderr.slice(result.stderr.indexOf('{')));
  assert.equal(record.phase, 'resources');
  assert.equal(record.file, 'fixture.test.mjs');
  assert.ok(record.cpuMs >= 0);
  assert.ok(record.rssMiB > 0);
  assert.ok(record.freeMiB >= 0);
  assert.equal(typeof record.resources, 'object');
});

test('CI reports a failed test before its waiting worker exits', {timeout: 5_000}, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-test-progress-'));
  const fixture = join(cwd, 'reporter.test.mjs');
  await writeFile(
    fixture,
    `
    import assert from 'node:assert/strict';
    import test from 'node:test';
    setInterval(() => {}, 1000);
    test('failure before cleanup', () => assert.fail('immediate-fixture-error'));
  `,
  );
  const environment = {
    ...process.env,
    NODE_OPTIONS: `--test-reporter=tap --require="${observer.replaceAll('\\', '/')}"`,
    TILEFLOW_TEST_PROGRESS: '1',
  };
  delete environment.NODE_TEST_CONTEXT;
  const running = startFixtureProcess(['--test', fixture], {
    env: environment,
    shutdownMs: 100,
    signal: t.signal,
  });
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, recursive: true});
  });
  let closed = false;
  void running.completion.then(
    () => {
      closed = true;
    },
    () => {
      closed = true;
    },
  );

  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    running.child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('immediate-fixture-error')) resolve();
    });
    t.signal.addEventListener('abort', () => reject(t.signal.reason), {once: true});
    void running.completion.then(
      ({code, stderr}) =>
        reject(new Error(`Worker closed before reporting failure (${code}): ${stderr}`)),
      reject,
    );
  });
  assert.equal(closed, false);
});
