import {mapError, retiredMap, TileflowMapError} from './map-error';
import type {MapCommandPayloads} from './native-map-contract';
import type {MapMethod, Spec} from './specs/NativeTileflowMapModule';

type Request = {start: () => void; reject: (error: Error) => void};

/** One React mount. Native animation calls stay concurrent. */
export class MapController {
  private tag: number | null = null;
  private previousTag: number | null = null;
  private ready = false;
  private disposed = false;
  private attachment = 0;
  private failure: TileflowMapError | null = null;
  private readonly pending = new Set<Request>();
  private readonly waiting = new Set<Request>();
  private readonly listeners = new Set<(type: string, payload: unknown) => void>();

  constructor(
    readonly instanceId: string,
    private readonly module: () => Spec,
    readonly report: (error: TileflowMapError) => void,
  ) {}

  attach(tag: number | null): void {
    const attachment = ++this.attachment;
    if (tag === null) {
      this.tag = null;
      // React replays refs and effects together in development.
      void Promise.resolve().then(() => {
        if (this.attachment === attachment && this.tag === null) this.dispose();
      });
      return;
    }
    if (this.disposed) return;
    if (this.previousTag !== null && this.previousTag !== tag) this.ready = false;
    this.tag = tag;
    this.previousTag = tag;
    this.flush();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  subscribe(listener: (type: string, payload: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(instanceId: string, type: string, payload: unknown): boolean {
    if (this.disposed || instanceId !== this.instanceId) return false;
    if (type === 'loading') {
      this.ready = false;
      this.failure = null;
    } else if (type === 'contentReady') {
      this.ready = true;
      this.failure = null;
      this.flush();
    } else if (type === 'failed') {
      this.failure = mapError(payload);
      this.rejectPending(this.failure);
    }
    for (const listener of this.listeners) listener(type, payload);
    return true;
  }

  call<M extends MapMethod>(method: M, payload: MapCommandPayloads[M]): Promise<unknown> {
    if (this.disposed) return Promise.reject(retiredMap());
    const immediate = method === 'reload' || method === 'requestLocationPermission';
    if (this.failure && !immediate) return Promise.reject(this.failure);
    let encoded: string;
    try {
      encoded = JSON.stringify(payload);
    } catch {
      return Promise.reject(
        new TileflowMapError({
          code: 'invalidRequest',
          message: 'Map arguments must contain JSON values.',
          recoverable: false,
        }),
      );
    }
    return new Promise((resolve, reject) => {
      const request: Request = {
        reject,
        start: () => {
          if (this.tag === null || (!this.ready && !immediate)) return;
          this.waiting.delete(request);
          const tag = this.tag;
          let native: Promise<string>;
          try {
            native = this.module().call(tag, this.instanceId, method, encoded);
          } catch (error) {
            this.pending.delete(request);
            reject(error);
            return;
          }
          void native
            .then((response) => {
              if (!this.pending.has(request)) return;
              if (this.disposed || this.tag !== tag) throw retiredMap();
              try {
                resolve(JSON.parse(response) as unknown);
              } catch {
                reject(
                  new TileflowMapError({
                    code: 'rendererFailed',
                    message: 'The native map returned an invalid response.',
                    recoverable: true,
                  }),
                );
              }
            })
            .catch((error: unknown) => reject(mapError(error)))
            .finally(() => this.pending.delete(request));
        },
      };
      this.pending.add(request);
      this.waiting.add(request);
      request.start();
    });
  }

  private flush(): void {
    for (const request of [...this.waiting]) request.start();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending) request.reject(error);
    this.pending.clear();
    this.waiting.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tag = null;
    this.rejectPending(retiredMap());
    this.listeners.clear();
  }
}
