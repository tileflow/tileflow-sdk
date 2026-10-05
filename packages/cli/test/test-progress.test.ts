import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const observer = fileURLToPath(
  new URL('../../../test-support/cli-test-progress.cjs', import.meta.url),
);
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
      env: {...process.env, NODE_TEST_CONTEXT: '', TILEFLOW_CLI_TEST_PROGRESS: enabled},
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
      assert.deepEqual(JSON.parse(record.slice('[cli-test] '.length)), {
        phase: index % 2 === 0 ? 'start' : 'close',
        file: 'fixture.test.ts',
        pid: Math.floor(index / 2) + 1,
        ...(index % 2 === 0 ? {} : {code: 0}),
      });
    }
  }
});
