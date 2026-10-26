import assert from 'node:assert/strict';
import test from 'node:test';
import {createDispatcher, type Output, parseRequest} from '../src/protocol';
import {resourceAddress} from '../src/resources';

const request = (id: string, generation = 1) =>
  JSON.stringify({
    protocolVersion: 1,
    instanceId: 'view-a',
    generation,
    requestId: id,
    command: {method: 'getCamera', payload: null},
  });

test('retiring a view cancels work and suppresses late results', async () => {
  const outputs: Output[] = [];
  let release!: () => void;
  let signal: AbortSignal | undefined;
  const dispatcher = createDispatcher({
    instanceId: 'view-a',
    generation: 1,
    send: (output) => outputs.push(output),
    execute: async (_command, receivedSignal) => {
      signal = receivedSignal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {longitude: 1};
    },
  });
  const pending = dispatcher.receive(request('1'));
  dispatcher.retire();
  assert.equal(signal?.aborted, true);
  release();
  await pending;
  assert.deepEqual(outputs, []);
});

test('stale generations and reused identities cannot perform an operation', async () => {
  const outputs: Output[] = [];
  let executions = 0;
  const dispatcher = createDispatcher({
    instanceId: 'view-a',
    generation: 1,
    send: (output) => outputs.push(output),
    execute: async () => {
      executions += 1;
      return null;
    },
  });
  await dispatcher.receive(request('1', 2));
  await dispatcher.receive(request('1'));
  await dispatcher.receive(request('1'));
  assert.equal(executions, 1);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[1].error?.code, 'invalidRequest');
});

test('malformed, oversized and executable-looking payloads never become commands', () => {
  assert.throws(() => parseRequest('x'.repeat(65_537)));
  assert.throws(() => parseRequest('{"bad":true}'));
  const data = JSON.parse(request('1'));
  data.command = {method: 'evaluateJavaScript', payload: 'alert(1)'};
  assert.throws(() => parseRequest(JSON.stringify(data)));
  data.command = {method: 'setCamera', payload: {camera: {longitude: 181, latitude: 0, zoom: 2}}};
  assert.throws(() => parseRequest(JSON.stringify(data)));
});

test('resource addressing rejects credential-bearing and executable URLs', () => {
  const url = 'https://maps.example.com/tiles/0/0/0.pbf';
  const token = resourceAddress(url, 'ios').split('/').at(-1)!;
  assert.equal(Buffer.from(token, 'base64url').toString(), url);
  assert.equal(resourceAddress(url, 'android'), `https://tileflow.invalid/resource/${token}`);
  for (const invalid of [
    'https://user:secret@maps.example.com/a',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => resourceAddress(invalid, 'ios'));
  }
});
