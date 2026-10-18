import {Command} from 'commander';
import assert from 'node:assert/strict';
import test from 'node:test';
import {registerDescribeCommand} from '../src/describe-command';

test('describes the minimal theme contract without loading a config, including bounded queries', async () => {
  const run = async (args: string[]) => {
    const program = new Command().name('tileflow').exitOverride();
    registerDescribeCommand(program);
    const original = process.stdout.write;
    let output = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(['describe', 'themes', '--json', ...args], {from: 'user'});
      return JSON.parse(output);
    } finally {
      process.stdout.write = original;
    }
  };
  const complete = await run([]);
  assert.equal(complete.ok, true);
  assert.equal(complete.topic, 'themes');
  assert.equal(complete.data.requiredColorRoles.length, 12);
  assert.match(complete.data.timeOfDay, /optional/u);
  assert.match(complete.data.lightingReset, /reset/u);
  const projected = await run(['--path', '/requiredColorRoles', '--limit', '3']);
  assert.equal(projected.projection.truncated, true);
  assert.equal(projected.data.length, 3);
});
