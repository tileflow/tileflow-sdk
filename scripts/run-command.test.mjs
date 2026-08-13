import assert from 'node:assert/strict';
import test from 'node:test';
import {runCommand} from './run-command.mjs';

test('captures every stdout chunk before resolving a child process', async () => {
  const chunk = 'tileflow-output-'.repeat(4096);
  const repetitions = 64;
  const result = await runCommand(process.execPath, [
    '-e',
    `const chunk = ${JSON.stringify(chunk)}; for (let index = 0; index < ${repetitions}; index += 1) process.stdout.write(chunk);`,
  ]);
  assert.equal(result.stdout.length, chunk.length * repetitions);
  assert.equal(result.stderr, '');
});
