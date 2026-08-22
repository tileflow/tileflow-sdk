import type {TileflowWorldRequestBridge} from './fair-use-browser';
import {
  resolveTileflowAnalyticsRequestUrl,
  startTileflowSession,
  type TileflowAnalytics,
  type TileflowSessionController,
} from './runtime';

export * from './fair-use-browser';

export type TileflowMapReadinessState = 'error' | 'idle' | 'loading';

export type TileflowMapLifecycleEvent =
  | 'dataloading'
  | 'error'
  | 'idle'
  | 'load'
  | 'styledataloading';

export type TileflowFrameScheduler<TFrame> = {
  cancelFrame: (frame: TFrame) => void;
  requestFrame: (callback: () => void) => TFrame;
};

export type TileflowMapLifecycleSubscriber<TMap> = (
  map: TMap,
  event: TileflowMapLifecycleEvent,
  listener: () => void,
) => () => void;

export type TileflowSessionSender = (
  analytics: TileflowAnalytics | undefined,
  input: {
    mapId?: string;
    sessionId: string;
    source: string;
    styleId?: string;
  },
) => void;

export type TileflowSessionStarter = {
  clear: () => void;
  start: (analytics: TileflowAnalytics | undefined, styleId?: string) => boolean;
};

export type TileflowMapLifecycleAttachment = {
  dispose: () => void;
  invalidate: (state?: TileflowMapReadinessState) => void;
};

export type TileflowTransformRequestParameters = {
  url: string;
};

export type TileflowComposedRequest<TRequest extends TileflowTransformRequestParameters> = Pick<
  TRequest,
  'url'
> &
  Partial<Omit<TRequest, 'url'>>;

export type TileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters,
  TResourceType,
> = (
  url: string,
  resourceType?: TResourceType,
) => Promise<TileflowComposedRequest<TRequest>> | TileflowComposedRequest<TRequest> | undefined;

export type TileflowUserTransformRequest<
  TRequest extends TileflowTransformRequestParameters,
  TResourceType,
> = (url: string, resourceType?: TResourceType) => Promise<TRequest> | TRequest | undefined;

export type TileflowAsyncAnalyticsTiming = 'request' | 'resolution';

export type TileflowMarkerController<TMap, TDefinition, TMarker> = {
  clear: () => void;
  dispose: () => void;
  replace: (map: TMap, definitions: readonly TDefinition[]) => void;
};

export function createTileflowSessionStarter(options: {
  getSessionId?: () => string;
  sessionId: string;
  source: string;
  startSession?: TileflowSessionSender;
}): TileflowSessionStarter {
  const starts = new Set<string>();
  const send = options.startSession ?? startTileflowSession;

  return {
    clear() {
      starts.clear();
    },
    start(analytics, styleId) {
      const mapId = analytics?.mapId;
      const sessionId = options.getSessionId?.() ?? options.sessionId;

      if (!mapId) {
        return false;
      }

      const key = `${sessionId}:${mapId}:${styleId ?? ''}`;

      if (starts.has(key)) {
        return false;
      }

      starts.add(key);
      send(analytics, {
        mapId,
        sessionId,
        source: options.source,
        styleId,
      });
      return true;
    },
  };
}

export function attachTileflowMapLifecycle<TMap, TFrame>(options: {
  getSession?: () => {analytics: TileflowAnalytics | undefined; styleId?: string};
  map: TMap;
  onLoad?: (map: TMap) => void;
  scheduler: TileflowFrameScheduler<TFrame>;
  sessionStarter?: TileflowSessionStarter;
  setState: (state: TileflowMapReadinessState) => void;
  subscribe: TileflowMapLifecycleSubscriber<TMap>;
}): TileflowMapLifecycleAttachment {
  let disposed = false;
  let generation = 0;
  const frames = new Set<TFrame>();
  const unsubscribers: Array<() => void> = [];

  const cancelFrames = () => {
    for (const frame of frames) {
      options.scheduler.cancelFrame(frame);
    }
    frames.clear();
  };

  const invalidate = (state?: TileflowMapReadinessState) => {
    generation += 1;
    cancelFrames();

    if (state) {
      options.setState(state);
    }
  };

  const scheduleFrame = (callback: () => void) => {
    const frame = options.scheduler.requestFrame(() => {
      frames.delete(frame);
      callback();
    });
    frames.add(frame);
  };

  const handleLoad = () => {
    if (disposed) {
      return;
    }

    options.onLoad?.(options.map);
    const session = options.getSession?.();

    if (session) {
      options.sessionStarter?.start(session.analytics, session.styleId);
    }
  };

  const handleLoading = () => {
    if (!disposed) {
      invalidate('loading');
    }
  };

  const handleIdle = () => {
    if (disposed) {
      return;
    }

    generation += 1;
    cancelFrames();
    const run = generation;

    scheduleFrame(() => {
      if (disposed || generation !== run) {
        return;
      }

      scheduleFrame(() => {
        if (!disposed && generation === run) {
          options.setState('idle');
        }
      });
    });
  };

  const handleError = () => {
    if (!disposed) {
      invalidate('error');
    }
  };

  invalidate('loading');

  try {
    for (const [event, listener] of [
      ['load', handleLoad],
      ['dataloading', handleLoading],
      ['styledataloading', handleLoading],
      ['idle', handleIdle],
      ['error', handleError],
    ] satisfies Array<[TileflowMapLifecycleEvent, () => void]>) {
      unsubscribers.push(options.subscribe(options.map, event, listener));
    }
  } catch (error) {
    disposed = true;
    generation += 1;
    cancelFrames();
    try {
      disposeFunctions(unsubscribers);
    } catch {
      // Preserve the subscription error that caused the partial attachment rollback.
    }
    throw error;
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      generation += 1;
      cancelFrames();
      disposeFunctions(unsubscribers);
    },
    invalidate(state) {
      if (!disposed) {
        invalidate(state);
      }
    },
  };
}

export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  always: true;
  asyncAnalyticsTiming?: TileflowAsyncAnalyticsTiming;
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType>;
export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  always?: boolean;
  asyncAnalyticsTiming?: TileflowAsyncAnalyticsTiming;
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType> | undefined;
export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  always?: boolean;
  asyncAnalyticsTiming?: TileflowAsyncAnalyticsTiming;
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType> | undefined {
  if (!options.always && !options.transformRequest && !options.worldRequestBridge) {
    const analytics = options.getAnalytics();
    const requiresCommercialSession = Boolean(options.sessionController && analytics?.mapId);

    if (!requiresCommercialSession && (!analytics || analytics.enabled === false)) {
      return undefined;
    }
  }

  const asyncAnalyticsTiming = options.asyncAnalyticsTiming ?? 'request';

  return (url, resourceType) => {
    const request = options.transformRequest?.(url, resourceType);
    const analyticsAtRequest =
      asyncAnalyticsTiming === 'request' ? options.getAnalytics() : undefined;

    if (isPromiseLike(request)) {
      return request.then(
        (resolvedRequest) =>
          applyTileflowRequest(
            url,
            resolvedRequest,
            asyncAnalyticsTiming === 'resolution' ? options.getAnalytics() : analyticsAtRequest,
            options.sessionId,
            options.sessionController,
            options.worldRequestBridge,
          ) ?? resolvedRequest,
      );
    }

    return applyTileflowRequest(
      url,
      request,
      asyncAnalyticsTiming === 'resolution' ? options.getAnalytics() : analyticsAtRequest,
      options.sessionId,
      options.sessionController,
      options.worldRequestBridge,
    );
  };
}

export function createTileflowMarkerController<TMap, TDefinition, TMarker>(options: {
  attach: (marker: TMarker, map: TMap, definition: TDefinition) => void;
  create: (definition: TDefinition) => TMarker;
  remove: (marker: TMarker) => void;
}): TileflowMarkerController<TMap, TDefinition, TMarker> {
  let markers: TMarker[] = [];

  const clear = () => {
    const previousMarkers = markers;
    markers = [];
    removeMarkers(previousMarkers, options.remove);
  };

  return {
    clear,
    dispose: clear,
    replace(map, definitions) {
      clear();
      const nextMarkers: TMarker[] = [];

      try {
        for (const definition of definitions) {
          const marker = options.create(definition);
          nextMarkers.push(marker);
          options.attach(marker, map, definition);
        }
      } catch (error) {
        try {
          removeMarkers(nextMarkers, options.remove);
        } catch {
          // Preserve the construction/attachment error that caused the rollback.
        }
        throw error;
      }

      markers = nextMarkers;
    },
  };
}

function applyTileflowRequest<TRequest extends TileflowTransformRequestParameters>(
  url: string,
  request: TRequest | undefined,
  analytics: TileflowAnalytics | undefined,
  sessionId: string,
  sessionController: TileflowSessionController | undefined,
  worldRequestBridge: TileflowWorldRequestBridge | undefined,
): Promise<TileflowComposedRequest<TRequest>> | TileflowComposedRequest<TRequest> | undefined {
  const requestUrl = request?.url ?? url;

  if (sessionController) {
    return sessionController
      .resolveRequestUrl(requestUrl, analytics)
      .then(
        (nextUrl) =>
          applyWorldRequestBridge(
            composeTileflowRequest(url, request, nextUrl, true) ??
              ({url} as TileflowComposedRequest<TRequest>),
            worldRequestBridge,
          ) ?? ({url} as TileflowComposedRequest<TRequest>),
      );
  }

  return applyWorldRequestBridge(
    composeTileflowRequest(
      url,
      request,
      resolveTileflowAnalyticsRequestUrl(requestUrl, analytics, sessionId),
      Boolean(worldRequestBridge),
    ),
    worldRequestBridge,
  );
}

function applyWorldRequestBridge<TRequest extends TileflowTransformRequestParameters>(
  request: TileflowComposedRequest<TRequest> | undefined,
  bridge: TileflowWorldRequestBridge | undefined,
): TileflowComposedRequest<TRequest> | undefined {
  if (!request || !bridge) return request;
  const url = bridge.rewriteUrl(request.url);
  return url === request.url ? request : ({...request, url} as TileflowComposedRequest<TRequest>);
}

function composeTileflowRequest<TRequest extends TileflowTransformRequestParameters>(
  originalUrl: string,
  request: TRequest | undefined,
  nextUrl: string | undefined,
  ensureRequest: boolean,
): TileflowComposedRequest<TRequest> | undefined {
  if (!nextUrl) {
    return (
      request ??
      (ensureRequest ? ({url: originalUrl} as TileflowComposedRequest<TRequest>) : undefined)
    );
  }

  return (
    request ? {...request, url: nextUrl} : {url: nextUrl}
  ) as TileflowComposedRequest<TRequest>;
}

function disposeFunctions(disposers: Array<() => void>): void {
  let firstError: unknown;
  let failed = false;

  for (const dispose of disposers.splice(0).reverse()) {
    try {
      dispose();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }

  if (failed) {
    throw firstError;
  }
}

function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === 'function');
}

function removeMarkers<TMarker>(
  markers: readonly TMarker[],
  remove: (marker: TMarker) => void,
): void {
  let firstError: unknown;
  let failed = false;

  for (const marker of markers) {
    try {
      remove(marker);
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }

  if (failed) {
    throw firstError;
  }
}
