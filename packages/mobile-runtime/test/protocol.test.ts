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

test('an invalid but addressable request is answered at once, never after a timeout', async () => {
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
  const invalid = JSON.parse(request('7'));
  invalid.command = {
    method: 'setCamera',
    payload: {camera: {longitude: 181, latitude: 0, zoom: 2}},
  };
  await dispatcher.receive(JSON.stringify(invalid));
  assert.deepEqual(outputs.at(-1)?.requestId, '7');
  assert.equal(outputs.at(-1)?.error?.code, 'invalidRequest');
  // The identifier is consumed like any other request identifier.
  await dispatcher.receive(request('7'));
  assert.equal(outputs.at(-1)?.error?.code, 'invalidRequest');
  // Another view's or generation's request is never answered here.
  await dispatcher.receive(JSON.stringify({...invalid, requestId: '8', generation: 2}));
  await dispatcher.receive(JSON.stringify({...invalid, requestId: '9', instanceId: 'view-b'}));
  assert.equal(outputs.length, 2);
  await dispatcher.receive('not json');
  assert.equal(outputs.at(-1)?.requestId, undefined);
  assert.equal(executions, 0);
});

test('points outside the view are valid for unproject and queries', () => {
  for (const method of ['unproject', 'queryAtPoint']) {
    const data = JSON.parse(request('1'));
    data.command = {method, payload: {x: -40, y: 1200}};
    assert.deepEqual(parseRequest(JSON.stringify(data)).command.payload, {x: -40, y: 1200});
    data.command = {method, payload: {x: -40_000, y: 0}};
    assert.throws(() => parseRequest(JSON.stringify(data)));
  }
});
