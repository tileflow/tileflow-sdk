import {z} from 'zod';
import {
  cameraForBoundsSchema,
  cornerSchema,
  gesturesSchema,
  insetsSchema,
  limitsSchema,
  maximumPitch,
  moveCameraSchema,
} from './camera-contract';
import {contentSchema} from './content-contract';
import {
  followRequestSchema,
  locationOptionsSchema,
  locationUpdateSchema,
} from './location-contract';
import {protocol} from './contract';
import {ProtocolError, type WireError} from './errors';
import {
  animationIdentifier,
  boundaryValuesRequestSchema,
  depthMarkersRequestSchema,
  emphasisRequestSchema,
  imagesRequestSchema,
  lineProgressAnimationSchema,
  shotRequestSchema,
  styleStateRequestSchema,
  sunRequestSchema,
  viewModeRequestSchema,
} from './scene-contract';

export {protocol};
export {
  type ErrorContext,
  type ErrorReason,
  ProtocolError,
  type ProtocolErrorCode,
  type ResourceKind,
  type WireError,
} from './errors';
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const finite = z.number().finite();
const requestId = z.string().regex(/^[1-9][0-9]{0,14}$/u);

type Events = typeof protocol.events;
export type EventName = keyof Events;
/** Events a host receives only while it subscribes to them. */
export type SubscribableEvent = {
  [K in EventName]: Events[K] extends {level: string} ? K : never;
}[EventName];
export type EventLevel = (typeof protocol.eventLevels)[number];
export type CameraReason = (typeof protocol.cameraReasons)[number];

const subscribable = Object.entries(protocol.events)
  .filter(([, event]) => 'level' in event)
  .map(([name]) => name) as [SubscribableEvent, ...SubscribableEvent[]];
export const subscribableEvents: readonly SubscribableEvent[] = subscribable;
export const subscriptionsSchema = z.partialRecord(
  z.enum(subscribable),
  z.strictObject({
    throttleMs: z.number().int().min(0).max(protocol.limits.maximumThrottleMs),
  }),
);
export type Subscriptions = z.infer<typeof subscriptionsSchema>;
/** The events a host receives before it chooses: the essential level, unthrottled. */
export const essentialSubscriptions: Subscriptions = Object.fromEntries(
  subscribable
    .filter((name) => (protocol.events[name] as {level: string}).level === 'essential')
    .map((name) => [name, {throttleMs: 0}]),
);

export const cameraSchema = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
  zoom: finite.min(0).max(24),
  bearing: finite.min(-360).max(360).default(0),
  pitch: finite.min(0).max(maximumPitch).default(0),
});
export type Camera = z.infer<typeof cameraSchema>;

const sourceSchema = z.strictObject({
  map: z.string().min(1).max(128),
  manifestUrl: z.url().max(6144),
  discoveryMapId: z
    .string()
    .regex(/^map_[A-Za-z0-9_-]{16}$/u)
    .optional(),
});
const themeSchema = z.string().min(1).max(128);
const duration = finite.min(0).max(5000).default(0);
// Points may lie outside the view, as a projected off-screen coordinate does.
const point = z.strictObject({
  x: finite.min(-32768).max(32768),
  y: finite.min(-32768).max(32768),
});
const coordinate = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
});
export const mapOptionsSchema = z.strictObject({
  viewMode: z.enum(['2d', '3d']).default('2d'),
  quality: z.enum(['low', 'balanced', 'high']).default('balanced'),
  gestures: gesturesSchema.prefault({}),
  limits: limitsSchema.prefault({}),
  /** The attribution is always shown; the host chooses its corner. */
  attribution: cornerSchema.default('bottom-right'),
  /** Shows or hides the map's 3D vegetation; null keeps what the map's design chooses. */
  vegetation: z.boolean().nullable().default(null),
  /** How the person's location is drawn. */
  location: locationOptionsSchema.prefault({}),
});
export type MapOptions = z.infer<typeof mapOptionsSchema>;
/** Options fixed for the renderer's lifetime: a change needs a new renderer. */
const rendererOptionsSchema = z.strictObject({
  /** Multisampling, which smooths the edges of 3D content; on by default, as on the web. */
  antialias: z.boolean().default(true),
  /** Validates styles as MapLibre loads them; off by default, as Tileflow validates them. */
  validateStyle: z.boolean().default(false),
});
export type RendererOptions = z.infer<typeof rendererOptionsSchema>;
const initializeSchema = z.strictObject({
  source: sourceSchema,
  theme: themeSchema.nullish(),
  camera: cameraSchema.optional(),
  interactive: z.boolean().default(true),
  colorScheme: z.enum(['light', 'dark']).default('light'),
  options: mapOptionsSchema.prefault({}),
  insets: insetsSchema.optional(),
  renderer: rendererOptionsSchema.prefault({}),
  events: subscriptionsSchema.default(essentialSubscriptions),
});
export type InitializeOptions = z.infer<typeof initializeSchema>;

const commandSchema = z.discriminatedUnion('method', [
  z.strictObject({method: z.literal('initialize'), payload: initializeSchema}),
  z.strictObject({method: z.literal('cancel'), payload: z.strictObject({requestId})}),
  z.strictObject({
    method: z.literal('setEvents'),
    payload: z.strictObject({events: subscriptionsSchema}),
  }),
  z.strictObject({method: z.literal('moveCamera'), payload: moveCameraSchema}),
  z.strictObject({method: z.literal('stopCamera'), payload: z.null()}),
  z.strictObject({method: z.literal('getCamera'), payload: z.null()}),
  z.strictObject({method: z.literal('cameraForBounds'), payload: cameraForBoundsSchema}),
  z.strictObject({method: z.literal('visibleBounds'), payload: z.null()}),
  z.strictObject({method: z.literal('setInsets'), payload: insetsSchema}),
  z.strictObject({
    method: z.literal('setTheme'),
    payload: z.strictObject({
      theme: themeSchema.nullish(),
      colorScheme: z.enum(['light', 'dark']).optional(),
      timeOfDay: z.enum(['day', 'dawn', 'dusk', 'night']).optional(),
      duration,
    }),
  }),
  z.strictObject({
    method: z.literal('setBlend'),
    payload: z
      .strictObject({
        themes: z.array(themeSchema).min(2).max(8),
        position: finite.min(0).max(7),
        hold: z.boolean().default(false),
        duration,
      })
      .refine(
        (value) =>
          value.position <= value.themes.length - 1 &&
          new Set(value.themes).size === value.themes.length,
      ),
  }),
  z.strictObject({method: z.literal('setOptions'), payload: mapOptionsSchema}),
  z.strictObject({method: z.literal('setContent'), payload: contentSchema}),
  z.strictObject({method: z.literal('project'), payload: coordinate}),
  z.strictObject({method: z.literal('unproject'), payload: point}),
  z.strictObject({
    method: z.literal('setVisibility'),
    payload: z.strictObject({visible: z.boolean()}),
  }),
  z.strictObject({
    method: z.literal('queryAtPoint'),
    payload: point,
  }),
  z.strictObject({method: z.literal('setViewMode'), payload: viewModeRequestSchema}),
  z.strictObject({method: z.literal('setSun'), payload: sunRequestSchema}),
  z.strictObject({method: z.literal('setEmphasis'), payload: emphasisRequestSchema}),
  z.strictObject({method: z.literal('setStyleState'), payload: styleStateRequestSchema}),
  z.strictObject({method: z.literal('getRouteInks'), payload: z.null()}),
  z.strictObject({method: z.literal('setBoundaryValues'), payload: boundaryValuesRequestSchema}),
  z.strictObject({method: z.literal('setImages'), payload: imagesRequestSchema}),
  z.strictObject({method: z.literal('setDepthMarkers'), payload: depthMarkersRequestSchema}),
  z.strictObject({method: z.literal('animateLineProgress'), payload: lineProgressAnimationSchema}),
  z.strictObject({method: z.literal('playShot'), payload: shotRequestSchema}),
  z.strictObject({
    method: z.literal('stopAnimation'),
    payload: z.strictObject({animation: animationIdentifier}),
  }),
  z.strictObject({method: z.literal('updateLocation'), payload: locationUpdateSchema}),
  z.strictObject({method: z.literal('setFollowMode'), payload: followRequestSchema}),
  z.strictObject({method: z.literal('dispose'), payload: z.null()}),
]);
export type Command = z.infer<typeof commandSchema>;
/** The host's supported protocol versions, injected before the document's first script. */
const hostVersionsSchema = z.strictObject({
  minimum: z.number().int().min(1),
  maximum: z.number().int().min(1),
});
const identitySchema = z.object({
  protocolVersion: z.number().int().min(1),
  instanceId: identifier,
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  requestId,
});
const envelopeSchema = z.strictObject({...identitySchema.shape, command: commandSchema});
export type Request = z.infer<typeof envelopeSchema>;
export type Output = Readonly<{
  protocolVersion: number;
  instanceId: string;
  generation: number;
  requestId?: string;
  event?: EventName;
  result?: unknown;
  error?: WireError;
}>;

/**
 * The highest version both sides support, or undefined. The runtime is embedded and versions
 * normally match; a mismatch still fails with a typed error instead of a silent timeout.
 */
export function negotiateVersion(host: unknown): number | undefined {
  const range = hostVersionsSchema.safeParse(host);
  if (!range.success) return undefined;
  const highest = Math.min(range.data.maximum, protocol.version);
  return highest >= Math.max(range.data.minimum, protocol.minimumVersion) ? highest : undefined;
}

function parseMessage(value: unknown): unknown {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).length > protocol.limits.maximumMessageBytes
  ) {
    throw new ProtocolError('invalidRequest', 'The request exceeds the protocol limits.');
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ProtocolError('invalidRequest', 'The request is not valid JSON.');
  }
}

export function parseRequest(value: unknown, version: number = protocol.version): Request {
  const result = envelopeSchema.safeParse(parseMessage(value));
  if (!result.success || result.data.protocolVersion !== version)
    throw new ProtocolError('invalidRequest', 'The request does not match the protocol.');
  return result.data;
}

/** The addressing of a request whose command is invalid, so its caller can be answered. */
export function readRequestIdentity(value: unknown): z.infer<typeof identitySchema> | undefined {
  try {
    const result = identitySchema.safeParse(parseMessage(value));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Request identities are single-use; retirement invalidates in-flight results before cleanup.
 * `version` is the negotiated protocol version, or undefined when negotiation failed: every
 * addressable request is then answered with `incompatibleRuntime`.
 */
export function createDispatcher(input: {
  instanceId: string;
  generation: number;
  version: number | undefined;
  execute: (command: Command, signal: AbortSignal) => Promise<unknown>;
  send: (output: Output) => void;
}) {
  const active = new Map<string, AbortController>();
  // Each native bridge emits monotonically increasing identifiers. Keeping a high-water mark
  // rejects replays without retaining every request throughout a long-lived map session.
  let lastRequest = 0;
  let retired = false;
  const envelope = {
    protocolVersion: input.version ?? protocol.version,
    instanceId: input.instanceId,
    generation: input.generation,
  };
  const fail = (requestId: string | undefined, error: WireError) =>
    input.send({...envelope, ...(requestId ? {requestId} : {}), error});
  const invalid = (message: string): WireError => ({code: 'invalidRequest', message});
  const ownsIdentity = (identity: {instanceId: string; generation: number}) =>
    identity.instanceId === input.instanceId && identity.generation === input.generation;

  return {
    async receive(value: unknown) {
      if (retired) return;
      if (input.version === undefined) {
        const identity = readRequestIdentity(value);
        if (identity && ownsIdentity(identity))
          fail(identity.requestId, {
            code: 'incompatibleRuntime',
            message: 'The SDK and the renderer share no protocol version.',
            context: {reason: 'protocolVersion'},
          });
        return;
      }
      let request: Request;
      try {
        request = parseRequest(value, input.version);
      } catch {
        // Answer an addressable request so its caller fails now rather than at its timeout.
        const identity = readRequestIdentity(value);
        if (!identity) {
          fail(undefined, invalid('The request does not match the protocol.'));
        } else if (ownsIdentity(identity)) {
          lastRequest = Math.max(lastRequest, Number(identity.requestId));
          fail(identity.requestId, invalid('The request does not match the protocol.'));
        }
        return;
      }
      if (!ownsIdentity(request)) {
        // An old view must never receive even an error response in the replacement view.
        return;
      }
      const sequence = Number(request.requestId);
      if (sequence <= lastRequest) {
        fail(request.requestId, invalid('Request identifiers cannot be reused.'));
        return;
      }
      lastRequest = sequence;
      if (request.command.method === 'cancel') {
        // Cancellation reaches the operation's signal; the operation answers `cancelled`.
        active.get(request.command.payload.requestId)?.abort();
        input.send({...envelope, requestId: request.requestId, result: null});
        return;
      }
      if (active.size >= protocol.limits.maximumPendingRequests) {
        fail(request.requestId, invalid('The request budget is exhausted.'));
        return;
      }
      const abort = new AbortController();
      active.set(request.requestId, abort);
      const timeout = setTimeout(() => {
        if (!active.delete(request.requestId) || retired) return;
        abort.abort();
        fail(request.requestId, {code: 'timeout', message: 'The request timed out.'});
      }, protocol.limits.requestTimeoutMs);
      try {
        const result = await input.execute(request.command, abort.signal);
        if (!retired && active.has(request.requestId)) {
          if (abort.signal.aborted)
            fail(request.requestId, {code: 'cancelled', message: 'The request was cancelled.'});
          else input.send({...envelope, requestId: request.requestId, result: result ?? null});
        }
      } catch (error) {
        if (!retired && active.has(request.requestId)) {
          fail(
            request.requestId,
            error instanceof ProtocolError
              ? error.toWire()
              : abort.signal.aborted
                ? {code: 'cancelled', message: 'The request was cancelled.'}
                : {code: 'rendererFailed', message: 'The map operation failed.'},
          );
        }
      } finally {
        clearTimeout(timeout);
        active.delete(request.requestId);
      }
    },
    retire() {
      retired = true;
      for (const abort of active.values()) abort.abort();
      active.clear();
    },
  };
}
