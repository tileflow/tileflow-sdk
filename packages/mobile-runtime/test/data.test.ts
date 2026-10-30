import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createDataReader, dataAddress, type DataReference} from '../src/data';
import {ProtocolError} from '../src/protocol';

const bytes = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}');
const reference = (body: Uint8Array, id = 'AAAAAAAAAAAAAAAAAAAAAA'): DataReference => ({
  id,
  byteLength: body.byteLength,
  sha256: createHash('sha256').update(body).digest('hex'),
});

/** Serves one body from the data channel address and records each request. */
function serve(
  t: test.TestContext,
  body: Uint8Array | ((signal: AbortSignal) => Promise<Response>),
  status = 200,
) {
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(String(input));
    if (typeof body === 'function') return body(init!.signal!);
    return new Response(body, {status});
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return requests;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ProtocolError, String(error));
    return {code: error.code, ...error.context};
  }
  assert.fail('The read succeeded.');
}

test('data is read from the platform transport and verified', async (t) => {
  const requests = serve(t, bytes);
  const read = createDataReader('ios', new AbortController().signal);
  const received = await read(reference(bytes), new AbortController().signal);
  assert.deepEqual(received, bytes);
  assert.deepEqual(requests, [dataAddress('AAAAAAAAAAAAAAAAAAAAAA', 'ios')]);
  assert.equal(dataAddress('id', 'android'), 'https://tileflow.invalid/data/id');
});

test('a body of another length or digest fails its integrity check', async (t) => {
  serve(t, bytes);
  const read = createDataReader('android', new AbortController().signal);
  const signal = new AbortController().signal;
  for (const declared of [
    {...reference(bytes), byteLength: bytes.byteLength - 1},
    {...reference(bytes), byteLength: bytes.byteLength + 1},
    {...reference(bytes), sha256: '0'.repeat(64)},
  ]) {
    assert.deepEqual(await rejection(read(declared, signal)), {
      code: 'resourceFailed',
      resource: 'data',
      reason: 'dataIntegrity',
    });
  }
});

test('released data reports that it is unavailable', async (t) => {
  serve(t, new Uint8Array(), 404);
  const read = createDataReader('ios', new AbortController().signal);
  assert.deepEqual(await rejection(read(reference(bytes), new AbortController().signal)), {
    code: 'resourceFailed',
    resource: 'data',
    reason: 'dataUnavailable',
    status: 404,
  });
});

test('cancellation and disposal stop a read in flight', async (t) => {
  serve(
    t,
    (signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      ),
  );
  const lifetime = new AbortController();
  const read = createDataReader('ios', lifetime.signal);
  const request = new AbortController();
  const cancelled = read(reference(bytes), request.signal);
  request.abort();
  assert.deepEqual(await rejection(cancelled), {code: 'cancelled'});
  const disposed = read(reference(bytes), new AbortController().signal);
  lifetime.abort();
  assert.deepEqual(await rejection(disposed), {code: 'disposed'});
});
