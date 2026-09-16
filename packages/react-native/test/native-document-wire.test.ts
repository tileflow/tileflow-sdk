import assert from 'node:assert/strict';
import test from 'node:test';
import type {NativeDocumentModule} from '../src/native-document-contract';
import {createNativeDocumentTransport} from '../src/native-document-wire';

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

function fixture() {
  const opened = gate<void>();
  const identifier = gate<Readonly<{document: string}>>();
  const headers = gate<Readonly<{url: string; status: number}>>();
  const data = gate<Readonly<{bodyBase64: string; last: boolean}>>();
  const cancellations: string[] = [];
  const requests: unknown[][] = [];
  const chunks: number[] = [];
  const native: NativeDocumentModule = {
    openDocument(...args) {
      requests.push(args);
      opened.resolve();
      return identifier.promise;
    },
    documentResponse: () => headers.promise,
    documentChunk(_id, maximumBytes) {
      chunks.push(maximumBytes);
      return data.promise;
    },
    async cancelDocument(id) {
      cancellations.push(id);
      return {cancelled: true};
    },
  };
  return {
    opened,
    identifier,
    headers,
    data,
    requests,
    chunks,
    cancellations,
    transport: createNativeDocumentTransport(() => native),
  };
}
const url = 'https://maps.example.test/manifest.json';

test('an ordinary manifest read has no admission context and honors every requested chunk bound', async () => {
  const f = fixture();
  const operation = f.transport.acquire(url, {maximumBytes: 1024});
  await f.opened.promise;
  assert.deepEqual(f.requests, [[url, 1024, null, null]]);
  f.identifier.resolve({document: 'document-1'});
  f.headers.resolve({url, status: 200});
  const response = await operation.response;
  assert.equal(response.url, url);
  const pending = response.reader.read(2);
  f.data.resolve({bodyBase64: 'e30=', last: true});
  const chunk = await pending;
  assert.deepEqual(f.chunks, [2]);
  assert.deepEqual(chunk, {done: false, value: new Uint8Array([123, 125])});
  assert.deepEqual(await response.reader.read(2), {done: true});
  assert.equal(f.requests.length, 1);
});

test('a protected document preserves its context without carrying a grant through this bridge', async () => {
  const f = fixture();
  const operation = f.transport.acquire(
    url,
    {maximumBytes: 1024},
    {installation: 'installation', context: 'context-1'},
  );
  await f.opened.promise;
  assert.deepEqual(f.requests, [[url, 1024, 'installation', 'context-1']]);
  f.identifier.resolve({document: 'document-1'});
  const cancelled = operation.cancel();
  await assert.rejects(operation.response, {code: 'NATIVE_DOCUMENT_CANCELLED'});
  await cancelled;
  assert.deepEqual(f.cancellations, ['document-1']);
  f.headers.resolve({url, status: 200});
});

test('cancel before native allocation acknowledgement retires the late ticket and remains idempotent', async () => {
  const f = fixture();
  const operation = f.transport.acquire(url, {maximumBytes: 1024});
  await f.opened.promise;
  const first = operation.cancel();
  const second = operation.cancel();
  assert.equal(first, second);
  await assert.rejects(operation.response, {code: 'NATIVE_DOCUMENT_CANCELLED'});
  f.identifier.resolve({document: 'document-1'});
  await first;
  assert.deepEqual(f.cancellations, ['document-1']);
});

test('cancellation invalidates a reader and an already pending chunk', async () => {
  const f = fixture();
  const operation = f.transport.acquire(url, {maximumBytes: 1024});
  await f.opened.promise;
  f.identifier.resolve({document: 'document-1'});
  f.headers.resolve({url, status: 200});
  const response = await operation.response;
  const chunk = response.reader.read(10);
  await operation.cancel();
  await assert.rejects(chunk, {code: 'NATIVE_DOCUMENT_CANCELLED'});
  f.data.resolve({bodyBase64: 'e30=', last: true});
  await assert.rejects(response.reader.read(10), {code: 'NATIVE_DOCUMENT_CANCELLED'});
});

test('oversized malformed or foreign final document responses fail with fixed diagnostics', async () => {
  for (const reply of [
    {url: 'https://other.example.test/manifest.json', status: 200},
    {url, status: 0},
    {url, status: '200'},
    {url: `${url}?grant=tf_native_untrusted`, status: 200},
  ]) {
    const f = fixture();
    const operation = f.transport.acquire(url, {maximumBytes: 1024});
    await f.opened.promise;
    f.identifier.resolve({document: 'document-1'});
    f.headers.resolve(reply as never);
    await assert.rejects(operation.response, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Native document acquisition failed.');
      assert.equal(error.cause, undefined);
      return true;
    });
    await operation.cancel();
  }
  for (const reply of [
    {bodyBase64: 'e30=', last: true},
    {bodyBase64: 'e31=', last: true},
    {bodyBase64: '', last: false},
  ]) {
    const f = fixture();
    const operation = f.transport.acquire(url, {maximumBytes: 1024});
    await f.opened.promise;
    f.identifier.resolve({document: 'document-1'});
    f.headers.resolve({url, status: 200});
    const response = await operation.response;
    const chunk = response.reader.read(1);
    f.data.resolve(reply);
    await assert.rejects(chunk, {code: 'NATIVE_DOCUMENT_INVALID'});
    await operation.cancel();
  }
});

test('failed cancellation acknowledgements remain retryable without repeating successful cancellation', async () => {
  let calls = 0;
  const transport = createNativeDocumentTransport(() => ({
    async openDocument() {
      return {document: 'document-1'};
    },
    documentResponse: () => new Promise(() => undefined),
    documentChunk: () => new Promise(() => undefined),
    async cancelDocument() {
      if (++calls === 1) throw new Error('Native private details.');
      return {cancelled: true};
    },
  }));
  const operation = transport.acquire(url, {maximumBytes: 1024});
  const failure = assert.rejects(operation.response, {code: 'NATIVE_DOCUMENT_CANCELLED'});
  await assert.rejects(operation.cancel(), {code: 'NATIVE_DOCUMENT_UNAVAILABLE'});
  await operation.cancel();
  await operation.cancel();
  await failure;
  assert.equal(calls, 2);
});

test('module lookup remains lazy and each transport operation keeps separate cancellation', async () => {
  let lookups = 0;
  const transport = createNativeDocumentTransport(() => {
    lookups++;
    throw new Error('Unavailable');
  });
  assert.equal(lookups, 0);
  const operation = transport.acquire(url, {maximumBytes: 1024});
  await assert.rejects(operation.response, {code: 'NATIVE_DOCUMENT_UNAVAILABLE'});
  assert.equal(lookups, 1);
});
