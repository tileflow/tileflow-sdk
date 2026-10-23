import type {TestContext} from 'node:test';
import {startFixtureProcess} from './fixture-process';
import {fixtureResources} from './fixture-resources';

export function startJsonFixtureProcess(
  t: TestContext,
  args: string[],
  options: Parameters<typeof startFixtureProcess>[1] = {},
) {
  const running = startFixtureProcess(args, {...options, signal: t.signal});
  fixtureResources(t).push(running.stop);
  const events: Array<Record<string, unknown>> = [];
  const waiters = new Set<{
    predicate: (event: Record<string, unknown>) => boolean;
    reject: (error: unknown) => void;
    resolve: (event: Record<string, unknown>) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let buffer = '';
  let stderr = '';
  let ended: unknown;
  let settled = false;

  function rejectWaiters(error: unknown) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waiters.clear();
  }

  running.child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  running.child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        ended = new Error('Fixture emitted invalid JSON');
        settled = true;
        rejectWaiters(ended);
        void running.stop();
        return;
      }
      events.push(event);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(event)) continue;
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  });
  void running.completion.then(
    ({code}) => {
      settled = true;
      const recentEvents = events.slice(-8).map(({event, side, generation, sourceGeneration}) => ({
        event,
        side,
        generation,
        sourceGeneration,
      }));
      ended ??= new Error(
        `CLI exited before the expected event (${code}): ${stderr}\n${JSON.stringify({
          forceStopped: running.forceStopped,
          events: recentEvents,
        })}`,
      );
      rejectWaiters(ended);
    },
    (error) => {
      settled = true;
      ended = error;
      rejectWaiters(error);
    },
  );

  return {
    child: running.child,
    completion: running.completion,
    events,
    requestStop: running.requestStop,
    stop: running.stop,
    waitFor(predicate: (event: Record<string, unknown>) => boolean, timeoutMs = 10_000) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      if (settled) return Promise.reject(ended);

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const waiter = {
          predicate,
          reject,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(`Timed out waiting for CLI event: ${JSON.stringify(events)} ${stderr}`),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}
