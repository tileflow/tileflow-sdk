import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeManifestOperation} from '@tileflow/core/native';
import {readNativeStyleDocument} from '../src/native-style-document';

function operation(bytes: Uint8Array, sizes = [65536]) {
  let offset = 0;
  let reads = 0;
  let cancels = 0;
  const handle: TileflowNativeManifestOperation = {
    response: Promise.resolve({
      url: 'https://maps.example.test/style.json',
      status: 200,
      reader: {
        async read(maximumBytes: number) {
          if (offset >= bytes.length) return {done: true as const};
          const length = Math.min(
            maximumBytes,
            sizes[reads++ % sizes.length],
            bytes.length - offset,
          );
          const value = bytes.slice(offset, offset + length);
          offset += length;
          return {done: false as const, value};
        },
        cancel() {
          cancels++;
        },
      },
    }),
    cancel() {
      cancels++;
    },
  };
  return {handle, cancels: () => cancels};
}

test('decodes fatal UTF-8 across bounded chunks without ambient URL or codec dependencies', async () => {
  const text = '\uFEFF{"name":"Madrid 🗺️","layers":[],"sources":{},"version":8}';
  const bytes = new TextEncoder().encode(text);
  const source = operation(bytes, [1, 2, 3]);
  const result = await readNativeStyleDocument(source.handle, 1024, () => true);
  assert.equal(result.value.name, 'Madrid 🗺️');
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.layers));
  assert.equal(source.cancels(), 0);
});

test('rejects malformed UTF-8, excessive depth, body overflow and non-record roots with fixed diagnostics', async () => {
  const encoder = new TextEncoder();
  for (const bytes of [
    new Uint8Array([0xf0, 0x80, 0x80, 0x80]),
    new Uint8Array([0xe2, 0x82]),
    encoder.encode('{"a":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}'),
    encoder.encode('[]'),
    encoder.encode('{"a":' + '1'.repeat(2048) + '}'),
    encoder.encode('{"__proto__":{"polluted":true}}'),
  ]) {
    const source = operation(bytes);
    await assert.rejects(
      readNativeStyleDocument(source.handle, 1024, () => true),
      {
        message: 'Native style preparation failed.',
      },
    );
    assert.ok(source.cancels() > 0);
  }
});

test('a retired operation cannot deliver parsed state even after a body arrives', async () => {
  const source = operation(new TextEncoder().encode('{"version":8}'));
  await assert.rejects(readNativeStyleDocument(source.handle, 1024, () => false));
  assert.ok(source.cancels() > 0);
});
