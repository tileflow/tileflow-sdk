import {z} from 'zod';
import {contentSchema} from './content-contract';
import {protocol} from './contract';

export {protocol};
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const finite = z.number().finite();

export const cameraSchema = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
  zoom: finite.min(0).max(24),
  bearing: finite.min(-360).max(360).default(0),
  pitch: finite.min(0).max(85).default(0),
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
const point = z.strictObject({x: finite.min(0).max(32768), y: finite.min(0).max(32768)});
const coordinate = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
});
export const mapOptionsSchema = z.strictObject({
  viewMode: z.enum(['2d', '3d']).default('2d'),
  quality: z.enum(['low', 'balanced', 'high']).default('balanced'),
  gestures: z
    .strictObject({
      pan: z.boolean().default(true),
      zoom: z.boolean().default(true),
      rotate: z.boolean().default(true),
      pitch: z.boolean().default(true),
    })
    .default({pan: true, zoom: true, rotate: true, pitch: true}),
  controls: z.boolean().default(true),
});
export type MapOptions = z.infer<typeof mapOptionsSchema>;
const initializeSchema = z.strictObject({
  source: sourceSchema,
  theme: themeSchema.nullish(),
  camera: cameraSchema.optional(),
  interactive: z.boolean().default(true),
  colorScheme: z.enum(['light', 'dark']).default('light'),
  options: mapOptionsSchema.default({
    viewMode: '2d',
    quality: 'balanced',
    gestures: {pan: true, zoom: true, rotate: true, pitch: true},
    controls: true,
  }),
});
export type InitializeOptions = z.infer<typeof initializeSchema>;

const commandSchema = z.discriminatedUnion('method', [
  z.strictObject({method: z.literal('initialize'), payload: initializeSchema}),
  z.strictObject({
    method: z.literal('setCamera'),
    payload: z.strictObject({
      camera: cameraSchema,
      duration: finite.min(0).max(60_000).default(0),
    }),
  }),
  z.strictObject({method: z.literal('getCamera'), payload: z.null()}),
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
  z.strictObject({
    method: z.literal('fitBounds'),
    payload: z
      .strictObject({
        west: finite.min(-180).max(180),
        south: finite.min(-90).max(90),
        east: finite.min(-180).max(180),
        north: finite.min(-90).max(90),
        padding: finite.min(0).max(1000).default(0),
        duration,
        maxZoom: finite.min(0).max(24).default(20),
      })
      .refine((value) => value.south <= value.north),
  }),
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
  z.strictObject({method: z.literal('dispose'), payload: z.null()}),
]);
export type Command = z.infer<typeof commandSchema>;
const envelopeSchema = z.strictObject({
  protocolVersion: z.literal(protocol.version),
  instanceId: identifier,
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  requestId: z.string().regex(/^[1-9][0-9]{0,14}$/u),
  command: commandSchema,
});
export type Request = z.infer<typeof envelopeSchema>;
export type ProtocolErrorCode = (typeof protocol.errors)[number];
export type EventName = (typeof protocol.events)[number];
export type Output = Readonly<{
  protocolVersion: number;
  instanceId: string;
  generation: number;
  requestId?: string;
  event?: EventName;
  result?: unknown;
  error?: {code: ProtocolErrorCode; message: string};
}>;

export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function parseRequest(value: unknown): Request {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).length > protocol.maximumMessageBytes
  ) {
    throw new ProtocolError('invalidRequest', 'The request exceeds the protocol limits.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ProtocolError('invalidRequest', 'The request is not valid JSON.');
  }
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success)
    throw new ProtocolError('invalidRequest', 'The request does not match the protocol.');
  return result.data;
}

/** Request identities are single-use; retirement invalidates in-flight results before cleanup. */
export function createDispatcher(input: {
  instanceId: string;
  generation: number;
  execute: (command: Command, signal: AbortSignal) => Promise<unknown>;
  send: (output: Output) => void;
}) {
  const active = new Map<string, AbortController>();
  // Each native bridge emits monotonically increasing identifiers. Keeping a high-water mark
  // rejects replays without retaining every request throughout a long-lived map session.
  let lastRequest = 0;
  let retired = false;
  const envelope = {
    protocolVersion: protocol.version,
    instanceId: input.instanceId,
    generation: input.generation,
  };
  const fail = (requestId: string | undefined, code: ProtocolErrorCode, message: string) =>
    input.send({...envelope, ...(requestId ? {requestId} : {}), error: {code, message}});

  return {
    async receive(value: unknown) {
      if (retired) return;
      let request: Request;
      try {
        request = parseRequest(value);
      } catch {
        fail(undefined, 'invalidRequest', 'The request does not match the protocol.');
        return;
      }
      if (request.instanceId !== input.instanceId || request.generation !== input.generation) {
        // An old view must never receive even an error response in the replacement view.
        return;
      }
      const sequence = Number(request.requestId);
      if (sequence <= lastRequest) {
        fail(request.requestId, 'invalidRequest', 'Request identifiers cannot be reused.');
        return;
      }
      lastRequest = sequence;
      if (active.size >= protocol.maximumPendingRequests) {
        fail(request.requestId, 'invalidRequest', 'The request budget is exhausted.');
        return;
      }
      const abort = new AbortController();
      active.set(request.requestId, abort);
      const timeout = setTimeout(() => {
        if (!active.delete(request.requestId) || retired) return;
        abort.abort();
        fail(request.requestId, 'timeout', 'The request timed out.');
      }, protocol.requestTimeoutMs);
      try {
        const result = await input.execute(request.command, abort.signal);
        if (!retired && active.has(request.requestId)) {
          input.send({...envelope, requestId: request.requestId, result: result ?? null});
        }
      } catch (error) {
        if (!retired && active.has(request.requestId)) {
          fail(
            request.requestId,
            error instanceof ProtocolError ? error.code : 'rendererFailed',
            error instanceof ProtocolError ? error.message : 'The map operation failed.',
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
