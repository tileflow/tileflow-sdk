import {type ChildProcessByStdio, spawn} from 'node:child_process';
import type {Readable} from 'node:stream';

/** Own the whole subprocess tree so a failed test cannot keep its worker alive. */
export function startFixtureProcess(
  args: string[],
  options: {cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; shutdownMs?: number} = {},
) {
  options.signal?.throwIfAborted();
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  }) as ChildProcessByStdio<null, Readable, Readable>;
  let stdout = '';
  let stderr = '';
  let closed = false;
  let stopping: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));

  const completion = new Promise<{code: number | null; stdout: string; stderr: string}>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        closed = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (options.signal?.aborted) reject(options.signal.reason);
        else resolve({code, stdout, stderr});
      });
    },
  );

  function forceStop() {
    if (closed || !child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5_000,
      });
      killer.once('error', () => child.kill('SIGKILL'));
      killer.once('close', () => {
        if (!closed) child.kill('SIGKILL');
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
      }
    }
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    stopping = completion.then(
      () => undefined,
      () => undefined,
    );
    if (closed) return stopping;

    timer = setTimeout(forceStop, options.shutdownMs ?? 2_000);
    if (child.connected) {
      child.send({type: 'tileflow:stop'}, (error) => {
        if (error && !closed) child.kill('SIGTERM');
      });
    } else {
      child.kill('SIGTERM');
    }
    return stopping;
  }

  function onAbort() {
    void stop();
  }

  options.signal?.addEventListener('abort', onAbort, {once: true});
  if (options.signal?.aborted) onAbort();
  return {child, completion, stop};
}
