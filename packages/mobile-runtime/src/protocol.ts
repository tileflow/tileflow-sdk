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
import {protocol} from './contract';
import {creditSchema} from './credits';
import {type DataReference, dataReferenceSchema} from './data';
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
import {
  addLayerSchema,
  addSourceSchema,
  getFeatureStateSchema,
  moveLayerSchema,
  queryClusterSchema,
  queryRenderedFeaturesSchema,
  querySourceFeaturesSchema,
  removeFeatureStateSchema,
  removeLayerSchema,
  removeSourceSchema,
  setFeatureStateSchema,
  setGeoJSONSourceDataSchema,
  updateGeoJSONSourceSchema,
  updateLayerSchema,
} from './style-contract';

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
  /** Regional credits of the downloaded regions a Hosted map opened from. */
  credits: z.array(creditSchema).max(64).default([]),
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
  z.strictObject({method: z.literal('addSource'), payload: addSourceSchema}),
  z.strictObject({method: z.literal('removeSource'), payload: removeSourceSchema}),
  z.strictObject({method: z.literal('setGeoJSONSourceData'), payload: setGeoJSONSourceDataSchema}),
  z.strictObject({method: z.literal('updateGeoJSONSource'), payload: updateGeoJSONSourceSchema}),
  z.strictObject({method: z.literal('addLayer'), payload: addLayerSchema}),
  z.strictObject({method: z.literal('updateLayer'), payload: updateLayerSchema}),
  z.strictObject({method: z.literal('moveLayer'), payload: moveLayerSchema}),
  z.strictObject({method: z.literal('removeLayer'), payload: removeLayerSchema}),
  z.strictObject({method: z.literal('setFeatureState'), payload: setFeatureStateSchema}),
  z.strictObject({method: z.literal('getFeatureState'), payload: getFeatureStateSchema}),
  z.strictObject({method: z.literal('removeFeatureState'), payload: removeFeatureStateSchema}),
  z.strictObject({
    method: z.literal('queryRenderedFeatures'),
    payload: queryRenderedFeaturesSchema,
  }),
  z.strictObject({method: z.literal('querySourceFeatures'), payload: querySourceFeaturesSchema}),
  z.strictObject({method: z.literal('queryCluster'), payload: queryClusterSchema}),
  z.strictObject({
    method: z.literal('readResult'),
    payload: z.strictObject({requestId, index: z.number().int().min(0).max(4096)}),
  }),
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
/**
 * A request whose payload exceeds a control message: the host registers the payload's JSON on the
 * data channel and the renderer reads it before it checks the command.
 */
const deferredEnvelopeSchema = z.strictObject({
  ...identitySchema.shape,
  command: z.strictObject({
    method: z.enum(protocol.methods),
    payloadData: dataReferenceSchema,
  }),
});
export type Output = Readonly<{
  protocolVersion: number;
  instanceId: string;
  generation: number;
  requestId?: string;
  event?: EventName;
  result?: unknown;
  /** A result larger than a control message, which the host reads in this many `readResult` parts. */
  chunks?: number;
  error?: WireError;
}>;

/** UTF-16 code units per result part: escaped as JSON, a part stays under a control message. */
export const resultChunkUnits = 16_384;

/** Splits JSON text into parts that never divide a surrogate pair. */
export function chunkText(text: string, units = resultChunkUnits): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + units);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

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
  /** Reads and parses a payload the host sent on the data channel. */
  readPayload?: (reference: DataReference, signal: AbortSignal) => Promise<unknown>;
}) {
  const active = new Map<string, AbortController>();
  // Results larger than a control message, by request, until the host reads their last part.
  const results = new Map<string, {chunks: string[]; expiry: ReturnType<typeof setTimeout>}>();
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
  const bytes = (text: string) =>
    text.length * 3 <= protocol.limits.maximumMessageBytes
      ? text.length
      : new TextEncoder().encode(text).byteLength;

  /** Answers a request; a result larger than a control message waits to be read in parts. */
  function deliver(requestId: string, result: unknown) {
    const output = {...envelope, requestId, result};
    const text = JSON.stringify(output);
    if (bytes(text) <= protocol.limits.maximumMessageBytes) {
      input.send(output);
      return;
    }
    const body = JSON.stringify(result);
    if (bytes(body) > protocol.limits.maximumDataBytes) {
      fail(requestId, {
        code: 'invalidRequest',
        message: 'The result exceeds its size limit; ask for fewer features.',
        context: {reason: 'dataTooLarge', limit: protocol.limits.maximumDataBytes},
      });
      return;
    }
    const chunks = chunkText(body);
    const expiry = setTimeout(() => results.delete(requestId), protocol.limits.requestTimeoutMs);
    results.set(requestId, {chunks, expiry});
    input.send({...envelope, requestId, chunks: chunks.length});
  }

  function readResult(requestId: string, payload: {requestId: string; index: number}) {
    const held = results.get(payload.requestId);
    const chunk = held?.chunks[payload.index];
    if (!held || chunk === undefined) {
      fail(requestId, invalid('The result is no longer available.'));
      return;
    }
    input.send({...envelope, requestId, result: chunk});
    if (payload.index === held.chunks.length - 1) {
      clearTimeout(held.expiry);
      results.delete(payload.requestId);
    }
  }

  /** The command of a request whose payload travelled on the data channel. */
  async function readCommand(
    deferred: z.infer<typeof deferredEnvelopeSchema>['command'],
    signal: AbortSignal,
  ): Promise<Command> {
    if (!input.readPayload) throw new ProtocolError('invalidRequest', 'Payload data is not read.');
    const payload = await input.readPayload(deferred.payloadData, signal);
    const command = commandSchema.safeParse({method: deferred.method, payload});
    if (!command.success)
      throw new ProtocolError('invalidRequest', 'The request does not match the protocol.');
    return command.data;
  }

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
      let request: Request | z.infer<typeof deferredEnvelopeSchema>;
      try {
        request = parseRequest(value, input.version);
      } catch {
        const deferred = deferredEnvelopeSchema.safeParse(
          (() => {
            try {
              return parseMessage(value);
            } catch {
              return undefined;
            }
          })(),
        );
        if (deferred.success && deferred.data.protocolVersion === input.version) {
          request = deferred.data;
        } else {
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
      const command = request.command;
      if ('payload' in command && command.method === 'cancel') {
        // Cancellation reaches the operation's signal; the operation answers `cancelled`.
        active.get(command.payload.requestId)?.abort();
        input.send({...envelope, requestId: request.requestId, result: null});
        return;
      }
      if ('payload' in command && command.method === 'readResult') {
        readResult(request.requestId, command.payload);
        return;
      }
      if (active.size >= protocol.limits.maximumPendingRequests) {
        fail(request.requestId, invalid('The request budget is exhausted.'));
        return;
      }
      const requestId = request.requestId;
      const abort = new AbortController();
      active.set(requestId, abort);
      const timeout = setTimeout(() => {
        if (!active.delete(requestId) || retired) return;
        abort.abort();
        fail(requestId, {code: 'timeout', message: 'The request timed out.'});
      }, protocol.limits.requestTimeoutMs);
      try {
        const resolved = 'payload' in command ? command : await readCommand(command, abort.signal);
        const result = await input.execute(resolved, abort.signal);
        if (!retired && active.has(requestId)) {
          if (abort.signal.aborted)
            fail(requestId, {code: 'cancelled', message: 'The request was cancelled.'});
          else deliver(requestId, result ?? null);
        }
      } catch (error) {
        if (!retired && active.has(requestId)) {
          fail(
            requestId,
            error instanceof ProtocolError
              ? error.toWire()
              : abort.signal.aborted
                ? {code: 'cancelled', message: 'The request was cancelled.'}
                : {code: 'rendererFailed', message: 'The map operation failed.'},
          );
        }
      } finally {
        clearTimeout(timeout);
        active.delete(requestId);
      }
    },
    retire() {
      retired = true;
      for (const abort of active.values()) abort.abort();
      active.clear();
      for (const held of results.values()) clearTimeout(held.expiry);
      results.clear();
    },
  };
}
