import assert from 'node:assert/strict';
import test from 'node:test';
import {createMacOSQuarantine} from '../src/macos';

test('offline DMG copies use the setup budget and abort the injected command', async () => {
  const controller = new AbortController();
  let command:
    | Readonly<{args: readonly string[]; file: string; signal: AbortSignal; timeoutMs: number}>
    | undefined;
  const quarantine = createMacOSQuarantine(async (input) => {
    command = input;
    return await new Promise<void>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
    });
  });

  const pending = quarantine.copyOfflineDmg('/input.dmg', '/cache.asset', controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.deepEqual(command?.args, ['--rsrc', '--extattr', '--qtn', '/input.dmg', '/cache.asset']);
  assert.equal(command?.file, '/usr/bin/ditto');
  assert.equal(command?.timeoutMs, 15 * 60 * 1000);
});

test('Foundation quarantine control remains on the short command budget', async () => {
  let command: Readonly<{timeoutMs: number}> | undefined;
  const quarantine = createMacOSQuarantine(async (input) => {
    command = input;
  });

  await quarantine.ensureRemoteDmgQuarantine('/cache.asset', new AbortController().signal);
  assert.equal(command?.timeoutMs, 15_000);
});
