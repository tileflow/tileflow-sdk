import {
  parseTileflowBrandingPolicy,
  type TileflowBrandingPolicy,
  type TileflowBrandingSource,
} from './branding';

export type TileflowBrandingState = 'pending' | 'required' | 'none';
export type TileflowBrandingControllerOptions = {
  fetch?: typeof globalThis.fetch;
  /** Mobile metadata uses native delivery ownership rather than a browser Origin. */
  mobile?: boolean;
  onChange(state: TileflowBrandingState): void;
  onError?: (error: Error) => void;
};
type Lease = {policy: TileflowBrandingPolicy; expires: number};

/** One mounted composition owns its policies, renewal and cancellation. No account-global cache. */
export function createTileflowBrandingController(options: TileflowBrandingControllerOptions) {
  const leases = new Map<string, Lease>();
  const pending = new Map<string, AbortController>();
  let deliveries: readonly TileflowBrandingSource[] = [];
  let disposed = false;
  let classified = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAt = 0;
  const now = () => performance.now();
  const keyOf = (source: TileflowBrandingSource) => `${source.apiUrl}/${source.mapId ?? ''}`;

  function conceal() {
    options.onChange('pending');
  }
  function present(required: boolean) {
    options.onChange(required ? 'required' : 'none');
  }
  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(reconcile, Math.max(1, delay));
  }
  function request(source: TileflowBrandingSource) {
    const key = keyOf(source);
    if (pending.has(key)) return;
    const abort = new AbortController();
    pending.set(key, abort);
    const started = now();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    abort.signal.addEventListener('abort', () => clearTimeout(timeout), {once: true});
    void (options.fetch ?? globalThis.fetch)(
      `${source.apiUrl}/maps/${source.mapId}/${options.mobile ? 'mobile/' : ''}branding`,
      {
        cache: 'no-store',
        credentials: 'omit',
        signal: abort.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`Tileflow branding unavailable (${response.status}).`);
        const policy = parseTileflowBrandingPolicy(await response.json(), source.mapId!);
        if (
          disposed ||
          pending.get(key) !== abort ||
          !deliveries.some((item) => keyOf(item) === key)
        )
          return;
        const expires = started + policy.validForMs;
        if (expires <= now()) throw new Error('Tileflow branding policy expired in transit.');
        const previous = leases.get(key);
        if (previous && BigInt(policy.revision) < BigInt(previous.policy.revision))
          throw new Error('Tileflow branding policy revision moved backwards.');
        leases.set(key, {policy, expires});
        retryAt = 0;
      })
      .catch((error: unknown) => {
        if (disposed || pending.get(key) !== abort) return;
        retryAt = now() + 5_000;
        options.onError?.(
          error instanceof Error ? error : new Error('Tileflow branding unavailable.'),
        );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (pending.get(key) !== abort) return;
        pending.delete(key);
        if (!disposed) reconcile();
      });
  }
  function reconcile() {
    if (disposed) return;
    clearTimeout(timer);
    if (!classified) {
      conceal();
      return;
    }
    const time = now();
    let required = deliveries.some((source) => !source.mapId);
    let ready = true;
    let next = Infinity;
    for (const source of deliveries) {
      if (!source.mapId) continue;
      const lease = leases.get(keyOf(source));
      if (!lease || lease.expires <= time) ready = false;
      else {
        required ||= lease.policy.catalogLogoRequired;
        next = Math.min(next, lease.expires - time);
      }
      const refreshIn = lease
        ? lease.expires - time - Math.min(30_000, lease.policy.validForMs / 3)
        : 0;
      if (refreshIn <= 0 && time >= retryAt) request(source);
      else if (refreshIn > 0) next = Math.min(next, refreshIn);
    }
    if (ready) present(required);
    else conceal();
    if (retryAt > time) next = Math.min(next, retryAt - time);
    if (Number.isFinite(next)) schedule(next);
  }
  return {
    update(sources: readonly TileflowBrandingSource[] | undefined) {
      if (disposed) return;
      classified = sources !== undefined;
      if (!sources) {
        clearTimeout(timer);
        conceal();
        return;
      }
      deliveries = sources;
      for (const key of leases.keys())
        if (!sources.some((source) => keyOf(source) === key)) leases.delete(key);
      for (const [key, abort] of pending)
        if (!sources.some((source) => keyOf(source) === key)) {
          pending.delete(key);
          abort.abort();
        }
      reconcile();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const abort of pending.values()) abort.abort();
      pending.clear();
      leases.clear();
    },
  };
}
