/** Owns the resources acquired while a browser map is starting or mounted. */
export function createTileflowMapLifetime(options: {
  signal?: AbortSignal;
  onCleanupError: (error: unknown) => void;
}) {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let disposed = false;

  const report = (errors: unknown[]) => {
    if (errors.length > 0) {
      options.onCleanupError(
        errors.length === 1
          ? errors[0]
          : new AggregateError(errors, 'Tileflow map cleanup failed.'),
      );
    }
  };

  function dispose(
    reason: unknown = new DOMException('The Tileflow map was disposed.', 'AbortError'),
  ) {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener('abort', abort);
    controller.abort(reason);
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    report(errors);
  }

  function abort() {
    dispose(options.signal?.reason);
  }

  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, {once: true});

  return {
    signal: controller.signal,
    dispose,
    /** Register immediately after acquisition, including during partial initialization. */
    defer(cleanup: () => void) {
      if (!disposed) {
        cleanups.push(cleanup);
        return;
      }
      try {
        cleanup();
      } catch (error) {
        report([error]);
      }
    },
    /** Reject promptly on cancellation even when a loader ignores its abort signal. */
    wait<T>(pending: Promise<T>): Promise<T> {
      const signal = controller.signal;
      if (signal.aborted) {
        void pending.catch(() => {});
        return Promise.reject(signal.reason);
      }
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, {once: true});
        pending.then(
          (value) => {
            signal.removeEventListener('abort', onAbort);
            if (signal.aborted) reject(signal.reason);
            else resolve(value);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
          },
        );
      });
    },
  };
}
