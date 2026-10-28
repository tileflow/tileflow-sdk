import {z} from 'zod';
import {protocol} from './contract';
import {ProtocolError} from './errors';
import type {ResourcePlatform} from './resources';

/**
 * A payload the host registered on its data channel for one request. The host serves it through
 * the native transport, not as a message, and releases it once the request settles.
 */
export const dataReferenceSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/u),
  byteLength: z.number().int().min(1).max(protocol.limits.maximumDataBytes),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type DataReference = z.infer<typeof dataReferenceSchema>;

export function dataAddress(id: string, platform: ResourcePlatform): string {
  return platform === 'ios' ? `tileflow://data/${id}` : `https://tileflow.invalid/data/${id}`;
}

const integrity = () =>
  new ProtocolError('resourceFailed', 'Application data failed its integrity check.', {
    resource: 'data',
    reason: 'dataIntegrity',
  });

async function readBody(response: Response, byteLength: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== byteLength) throw integrity();
    return bytes;
  }
  // Read into the declared length so an overlong body fails before it is buffered.
  const bytes = new Uint8Array(byteLength);
  const reader = response.body.getReader();
  let offset = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (offset + value.byteLength > byteLength) {
      await reader.cancel().catch(() => undefined);
      throw integrity();
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== byteLength) throw integrity();
  return bytes;
}

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Reads registered data through the native transport, verifying its length and SHA-256. */
export function createDataReader(platform: ResourcePlatform, lifetime: AbortSignal) {
  return async function read(
    reference: DataReference,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const signals = [lifetime, signal];
    for (const source of signals) {
      if (source.aborted) abort.abort();
      else source.addEventListener('abort', cancel, {once: true});
    }
    const stopped = () =>
      lifetime.aborted
        ? new ProtocolError('disposed', 'The map is disposed.')
        : new ProtocolError('cancelled', 'The request was cancelled.');
    try {
      if (abort.signal.aborted) throw stopped();
      let response: Response;
      try {
        response = await fetch(dataAddress(reference.id, platform), {
          signal: abort.signal,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        });
      } catch {
        throw abort.signal.aborted
          ? stopped()
          : new ProtocolError('resourceFailed', 'Application data could not be read.', {
              resource: 'data',
              reason: 'dataUnavailable',
            });
      }
      if (!response.ok)
        throw new ProtocolError('resourceFailed', 'Application data is no longer available.', {
          resource: 'data',
          reason: 'dataUnavailable',
          status: response.status,
        });
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = await readBody(response, reference.byteLength);
      } catch (error) {
        if (abort.signal.aborted) throw stopped();
        throw error instanceof ProtocolError ? error : integrity();
      }
      const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
      if (digest !== reference.sha256) throw integrity();
      return bytes;
    } finally {
      for (const source of signals) source.removeEventListener('abort', cancel);
    }
  };
}
export type DataReader = ReturnType<typeof createDataReader>;
