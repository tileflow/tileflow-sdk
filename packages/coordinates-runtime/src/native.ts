import {spawn} from 'node:child_process';

export class CoordinatesNativeError extends Error {
  constructor(readonly code: 'CANCELLED' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_RESPONSE') {
    super('Coordinates native execution failed.');
    this.name = 'CoordinatesNativeError';
  }
}

/** Each invocation owns a process/context; the semaphore bounds queued native work. */
export function createNativeRunner(
  binary: string,
  resources: string,
  cwd: string,
  proofPath?: string,
) {
  let active = 0;
  let closed = false;
  const shutdown = new AbortController();
  const waiting: Array<() => void> = [];

  async function run(request: unknown, signal?: AbortSignal): Promise<unknown> {
    if (closed) throw new CoordinatesNativeError('UNAVAILABLE');
    if (signal?.aborted) throw new CoordinatesNativeError('CANCELLED');
    if (waiting.length >= 16) throw new CoordinatesNativeError('UNAVAILABLE');
    const combined = signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal;
    if (active >= 2) {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          combined.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const index = waiting.indexOf(ready);
          if (index >= 0) waiting.splice(index, 1);
          reject(new CoordinatesNativeError('CANCELLED'));
        };
        waiting.push(ready);
        combined.addEventListener('abort', abort, {once: true});
        if (combined.aborted) abort();
      });
    }
    if (combined.aborted) throw new CoordinatesNativeError('CANCELLED');
    active++;
    try {
      return await invoke(binary, resources, cwd, request, combined, proofPath);
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  return {
    run,
    close() {
      closed = true;
      shutdown.abort();
    },
  };
}

function invoke(
  binary: string,
  resources: string,
  cwd: string,
  request: unknown,
  signal: AbortSignal,
  proofPath?: string,
): Promise<unknown> {
  const body = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(body) > 32 * 1024)
    return Promise.reject(new CoordinatesNativeError('UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [resources, ...(proofPath ? [proofPath] : [])], {
      cwd,
      env: {PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', PROJ_NETWORK: 'OFF'},
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let settled = false;
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: CoordinatesNativeError, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else resolve(result);
    };
    const abort = () => finish(new CoordinatesNativeError('CANCELLED'));
    const timer = setTimeout(() => finish(new CoordinatesNativeError('TIMEOUT')), 15_000);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
    child.once('error', () => finish(new CoordinatesNativeError('UNAVAILABLE')));
    child.stdin.on('error', () => finish(new CoordinatesNativeError('UNAVAILABLE')));
    child.stdout.on('error', () => finish(new CoordinatesNativeError('INVALID_RESPONSE')));
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) finish(new CoordinatesNativeError('INVALID_RESPONSE'));
      else if (!settled) chunks.push(chunk);
    });
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) return finish(new CoordinatesNativeError('UNAVAILABLE'));
      try {
        const content = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
        finish(undefined, JSON.parse(content));
      } catch {
        finish(new CoordinatesNativeError('INVALID_RESPONSE'));
      }
    });
    child.stdin.end(body);
  });
}
