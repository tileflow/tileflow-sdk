import type {Server} from 'node:http';
import type {TestContext} from 'node:test';

const resources = new WeakMap<TestContext, Array<() => Promise<unknown>>>();

/** Dispose consumers before servers and fixture directories, even after a cleanup failure. */
export function fixtureResources(t: TestContext): Array<() => Promise<unknown>> {
  let owned = resources.get(t);
  if (!owned) {
    owned = [];
    resources.set(t, owned);
    t.after(async () => {
      const failures: unknown[] = [];
      for (const close of owned!.reverse()) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed');
    });
  }
  return owned;
}

export function closeFixtureServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
