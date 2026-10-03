export type NativeReadinessEvidence = Readonly<{
  style: string;
  sequence: number;
  layout: number;
  kind: 'style' | 'render' | 'invalidate' | 'error';
}>;

/** Pure evidence join. Only the private view adapter can supply native receipts. */
export function createNativeReadiness(notify: (status: 'loading' | 'ready' | 'error') => void) {
  let style: string | undefined;
  let sequence = 0;
  let loaded = false;
  let committed: number | undefined;
  let failed = false;
  let disposed = false;
  let status: 'loading' | 'ready' | 'error' | undefined;
  const publish = (next: 'loading' | 'ready' | 'error') => {
    if (disposed || status === next) return;
    status = next;
    try {
      notify(next);
    } catch {
      /* Observers do not own readiness. */
    }
  };
  return Object.freeze({
    get ready() {
      return !disposed && !failed && status === 'ready';
    },
    begin(token: string): void {
      if (disposed) return;
      style = token;
      loaded = false;
      committed = undefined;
      failed = false;
      publish('loading');
    },
    commit(token: string, layout: number): void {
      if (disposed || failed || token !== style || !Number.isSafeInteger(layout) || layout < 1)
        return;
      committed = layout;
    },
    invalidate(): void {
      if (disposed || failed) return;
      committed = undefined;
      publish('loading');
    },
    fail(): void {
      if (disposed) return;
      failed = true;
      committed = undefined;
      publish('error');
    },
    native(event: NativeReadinessEvidence): void {
      if (
        disposed ||
        failed ||
        event.style !== style ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence <= sequence ||
        !Number.isSafeInteger(event.layout) ||
        event.layout < 1
      )
        return;
      sequence = event.sequence;
      if (event.kind === 'error') {
        failed = true;
        committed = undefined;
        publish('error');
      } else if (event.kind === 'invalidate') {
        committed = undefined;
        publish('loading');
      } else if (event.kind === 'style') {
        loaded = true;
      } else if (event.kind === 'render' && loaded && committed === event.layout) {
        publish('ready');
      }
    },
    dispose(): void {
      disposed = true;
      style = undefined;
      committed = undefined;
    },
  });
}
