import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkText,
  createDispatcher,
  negotiateVersion,
  type Output,
  parseRequest,
  protocol,
} from '../src/protocol';
import {resourceAddress, resourceOrigin} from '../src/resources';

const version = protocol.version;
const request = (
  id: string,
  generation = 1,
  command: unknown = {method: 'getCamera', payload: null},
) =>
  JSON.stringify({
    protocolVersion: version,
    instanceId: 'view-a',
    generation,
    requestId: id,
    command,
  });

function dispatcher(
  execute: (signal: AbortSignal) => Promise<unknown> = async () => null,
  negotiated: {version: number | undefined} = {version},
) {
  const outputs: Output[] = [];
  let executions = 0;
  const instance = createDispatcher({
    instanceId: 'view-a',
    generation: 1,
    version: negotiated.version,
    send: (output) => outputs.push(output),
    execute: (_command, signal) => {
      executions += 1;
      return execute(signal);
    },
  });
  return {instance, outputs, executions: () => executions};
}

test('retiring a view cancels work and suppresses late results', async () => {
  let release!: () => void;
  let signal: AbortSignal | undefined;
  const {instance, outputs} = dispatcher(async (received) => {
    signal = received;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {longitude: 1};
  });
  const pending = instance.receive(request('1'));
  instance.retire();
  assert.equal(signal?.aborted, true);
  release();
  await pending;
  assert.deepEqual(outputs, []);
});

test('stale generations and reused identities cannot perform an operation', async () => {
  const {instance, outputs, executions} = dispatcher();
  await instance.receive(request('1', 2));
  await instance.receive(request('1'));
  await instance.receive(request('1'));
  assert.equal(executions(), 1);
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
  // A message of another protocol version is not a request of this one.
  assert.throws(() => parseRequest(request('1'), version + 1));
});

test('resource addressing rejects credential-bearing and executable URLs', () => {
  const url = 'https://maps.example.com/tiles/0/0/0.pbf?key=secret';
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

test('diagnostics name only the origin behind a transport address', () => {
  const url = 'https://maps.example.com:8443/private/path/{z}/{x}/{y}.pbf?signature=secret';
  for (const platform of ['ios', 'android'] as const) {
    const address = `${resourceAddress(url, platform)}/3/2/1`;
    assert.equal(resourceOrigin(address), 'https://maps.example.com:8443');
  }
  assert.equal(resourceOrigin('tileflow-pmtiles://archive'), undefined);
  assert.equal(resourceOrigin('tileflow://resource/!!'), undefined);
});

test('an invalid but addressable request is answered at once, never after a timeout', async () => {
  const {instance, outputs, executions} = dispatcher();
  const invalid = JSON.parse(request('7'));
  invalid.command = {
    method: 'setCamera',
    payload: {camera: {longitude: 181, latitude: 0, zoom: 2}},
  };
  await instance.receive(JSON.stringify(invalid));
  assert.deepEqual(outputs.at(-1)?.requestId, '7');
  assert.equal(outputs.at(-1)?.error?.code, 'invalidRequest');
  // The identifier is consumed like any other request identifier.
  await instance.receive(request('7'));
  assert.equal(outputs.at(-1)?.error?.code, 'invalidRequest');
  // Another view's or generation's request is never answered here.
  await instance.receive(JSON.stringify({...invalid, requestId: '8', generation: 2}));
  await instance.receive(JSON.stringify({...invalid, requestId: '9', instanceId: 'view-b'}));
  assert.equal(outputs.length, 2);
  await instance.receive('not json');
  assert.equal(outputs.at(-1)?.requestId, undefined);
  assert.equal(executions(), 0);
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

test('the handshake selects the highest shared version and reports none as a mismatch', () => {
  assert.equal(negotiateVersion({minimum: 1, maximum: version}), version);
  assert.equal(negotiateVersion({minimum: version, maximum: version + 5}), version);
  assert.equal(negotiateVersion({minimum: version + 1, maximum: version + 2}), undefined);
  assert.equal(negotiateVersion({minimum: 1, maximum: protocol.minimumVersion - 1}), undefined);
  // A host that states no range, or an invalid one, shares no version.
  assert.equal(negotiateVersion(undefined), undefined);
  assert.equal(negotiateVersion({minimum: '2', maximum: 2}), undefined);
});

test('without a shared version every request fails with a typed incompatibility', async () => {
  const {instance, outputs, executions} = dispatcher(undefined, {version: undefined});
  await instance.receive(request('1'));
  await instance.receive(request('2', 2));
  assert.equal(executions(), 0);
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0].error, {
    code: 'incompatibleRuntime',
    message: 'The SDK and the renderer share no protocol version.',
    context: {reason: 'protocolVersion'},
  });
});

test('cancellation reaches the operation and its caller is answered as cancelled', async () => {
  let signal: AbortSignal | undefined;
  const {instance, outputs} = dispatcher(
    (received) =>
      new Promise((_resolve, reject) => {
        signal = received;
        received.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const pending = instance.receive(request('1'));
  await instance.receive(request('2', 1, {method: 'cancel', payload: {requestId: '1'}}));
  await pending;
  assert.equal(signal?.aborted, true);
  assert.deepEqual(
    outputs.map((output) => [output.requestId, output.error?.code ?? output.result]),
    [
      ['2', null],
      ['1', 'cancelled'],
    ],
  );
  // Cancelling an operation that already finished is harmless.
  await instance.receive(request('3', 1, {method: 'cancel', payload: {requestId: '1'}}));
  assert.equal(outputs.at(-1)?.result, null);
});

test('event subscriptions accept only subscribable events within the throttle bound', () => {
  const setEvents = (events: unknown) =>
    parseRequest(request('1', 1, {method: 'setEvents', payload: {events}}));
  assert.doesNotThrow(() => setEvents({cameraMoved: {throttleMs: 100}, tap: {throttleMs: 0}}));
  assert.doesNotThrow(() => setEvents({}));
  for (const events of [
    {hello: {throttleMs: 0}},
    {error: {throttleMs: 0}},
    {unknownEvent: {throttleMs: 0}},
    {cameraMoved: {throttleMs: protocol.limits.maximumThrottleMs + 1}},
    {cameraMoved: {throttleMs: -1}},
    {cameraMoved: {}},
  ])
    assert.throws(() => setEvents(events), JSON.stringify(events));
});

test('payloads past a control message arrive on the data channel and are checked', async () => {
  const outputs: Output[] = [];
  const executed: unknown[] = [];
  const payloads: Record<string, unknown> = {
    ['a'.repeat(22)]: {id: 'points'},
    ['b'.repeat(22)]: {id: 'points', extra: true},
  };
  const instance = createDispatcher({
    instanceId: 'view-a',
    generation: 1,
    version,
    send: (output) => outputs.push(output),
    execute: async (command) => (executed.push(command), null),
    readPayload: async (reference) => payloads[reference.id],
  });
  const deferred = (id: string, data: string) =>
    request(id, 1, {
      method: 'removeSource',
      payloadData: {id: data.repeat(22), byteLength: 20, sha256: '0'.repeat(64)},
    });
  await instance.receive(deferred('1', 'a'));
  assert.deepEqual(executed, [{method: 'removeSource', payload: {id: 'points'}}]);
  assert.equal(outputs.at(-1)?.result, null);
  // The payload is checked against the command once it is read.
  await instance.receive(deferred('2', 'b'));
  assert.equal(outputs.at(-1)?.error?.code, 'invalidRequest');
  assert.equal(executed.length, 1);
});

test('results past a control message are read in parts', async () => {
  const outputs: Output[] = [];
  const big = Array.from({length: 4000}, (_, index) => ({id: index, name: `é feature ${index}`}));
  const instance = createDispatcher({
    instanceId: 'view-a',
    generation: 1,
    version,
    send: (output) => outputs.push(output),
    execute: async () => big,
  });
  await instance.receive(request('1'));
  const answer = outputs.at(-1)!;
  assert.equal(answer.requestId, '1');
  assert.ok(answer.chunks! > 1);
  let text = '';
  for (let index = 0; index < answer.chunks!; index += 1) {
    await instance.receive(
      request(String(index + 2), 1, {method: 'readResult', payload: {requestId: '1', index}}),
    );
    const part = outputs.at(-1)!;
    assert.ok(
      new TextEncoder().encode(JSON.stringify(part)).byteLength <=
        protocol.limits.maximumMessageBytes,
    );
    text += part.result as string;
  }
  assert.deepEqual(JSON.parse(text), big);
  // The last part releases the result.
  await instance.receive(
    request('99', 1, {method: 'readResult', payload: {requestId: '1', index: 0}}),
  );
  assert.equal(outputs.at(-1)?.error?.code, 'invalidRequest');
});

test('result parts never divide a character', () => {
  const text = `${'a'.repeat(9)}😀${'b'.repeat(5)}`;
  const parts = chunkText(text, 10);
  assert.deepEqual(parts, ['a'.repeat(9), `😀${'b'.repeat(5)}`]);
  assert.equal(parts.join(''), text);
});
