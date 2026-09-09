import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export const digest = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

export async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path, {signal});
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest('hex');
}
