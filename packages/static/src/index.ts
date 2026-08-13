import {z} from 'zod';

export const staticSceneSchemaVersion = 1;
export const staticRendererSchemaVersion = 1;
export const staticSceneLimits = {
  maxDimension: 1280,
  maxGeoJsonBytes: 96_000,
  maxOverlays: 24,
  maxPathCoordinates: 2000,
  maxPhysicalPixels: 1280 * 1280,
  minDimension: 64,
} as const;

const coordinateSchema = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
    message: 'Expected [lng, lat] within world bounds',
  });

const colorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'Expected a hex color like #C6A15B',
});

const sizeSchema = z
  .object({
    dpr: z.literal(1).optional(),
    height: z
      .number()
      .int()
      .min(staticSceneLimits.minDimension)
      .max(staticSceneLimits.maxDimension),
    width: z.number().int().min(staticSceneLimits.minDimension).max(staticSceneLimits.maxDimension),
  })
  .refine(
    (size) => size.width * size.height * (size.dpr ?? 1) <= staticSceneLimits.maxPhysicalPixels,
    {
      message: 'Static map exceeds the maximum render pixel budget',
    },
  );

const centerCameraSchema = z.object({
  bearing: z.number().finite().min(-180).max(180).optional(),
  center: coordinateSchema,
  type: z.literal('center'),
  zoom: z.number().finite().min(0).max(22),
});

const boundsCameraSchema = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    bounds: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .refine(
        ([west, south, east, north]) =>
          west >= -180 &&
          west <= 180 &&
          east >= -180 &&
          east <= 180 &&
          south >= -90 &&
          south <= 90 &&
          north >= -90 &&
          north <= 90 &&
          west !== east &&
          south !== north,
        {message: 'Expected bounds as [west, south, east, north]'},
      ),
    padding: z.number().int().min(0).max(256).optional(),
    type: z.literal('bounds'),
  })
  .refine((camera) => camera.bounds[3] > camera.bounds[1], {
    message: 'Bounds north must be greater than south',
  });

const lineOverlaySchema = z.object({
  color: colorSchema.default('#C6A15B'),
  coordinates: z.array(coordinateSchema).min(2).max(staticSceneLimits.maxPathCoordinates),
  id: z.string().trim().min(1).max(64).optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  type: z.literal('line'),
  width: z.number().finite().min(0.5).max(32).default(4),
});

const circleOverlaySchema = z.object({
  color: colorSchema.default('#C6A15B'),
  coordinate: coordinateSchema,
  id: z.string().trim().min(1).max(64).optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  radius: z.number().finite().min(1).max(64).default(6),
  strokeColor: colorSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(16).default(0),
  type: z.literal('circle'),
});

const markerOverlaySchema = z.object({
  color: colorSchema.default('#C6A15B'),
  coordinate: coordinateSchema,
  id: z.string().trim().min(1).max(64).optional(),
  radius: z.number().finite().min(2).max(64).default(8),
  strokeColor: colorSchema.default('#ffffff'),
  strokeWidth: z.number().finite().min(0).max(16).default(2),
  type: z.literal('marker'),
});

const polygonRingSchema = z
  .array(coordinateSchema)
  .min(4)
  .max(staticSceneLimits.maxPathCoordinates)
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
    },
    {message: 'Polygon rings must end at their starting coordinate'},
  );

const polygonOverlaySchema = z.object({
  coordinates: z.array(polygonRingSchema).min(1).max(16),
  fill: colorSchema.default('#C6A15B'),
  id: z.string().trim().min(1).max(64).optional(),
  opacity: z.number().finite().min(0).max(1).default(0.28),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(16).default(0),
  type: z.literal('polygon'),
});

export const staticOverlaySchema = z.discriminatedUnion('type', [
  lineOverlaySchema,
  circleOverlaySchema,
  markerOverlaySchema,
  polygonOverlaySchema,
]);

export const staticSceneSchema = z.object({
  camera: z.discriminatedUnion('type', [centerCameraSchema, boundsCameraSchema]),
  map: z.string().trim().min(1).max(128),
  overlays: z.array(staticOverlaySchema).max(staticSceneLimits.maxOverlays).default([]),
  size: sizeSchema,
});

export const staticRenderManifestSchema = z.object({
  mapId: z.string().trim().min(1).max(128),
  rendererVersion: z.string().trim().min(1).max(64),
  schemaVersion: z.literal(staticRendererSchemaVersion),
  scene: staticSceneSchema,
  styleId: z.string().trim().min(1).max(128).optional(),
  styleRevision: z.string().trim().min(1).max(128),
  styleUrl: z
    .string()
    .trim()
    .url()
    .max(512)
    .refine((value) => /^https?:\/\//.test(value), {
      message: 'Expected an http(s) style URL',
    }),
});

export type StaticCoordinate = z.infer<typeof coordinateSchema>;
export type StaticSceneInput = z.input<typeof staticSceneSchema>;
export type StaticScene = z.infer<typeof staticSceneSchema>;
export type StaticOverlayInput = z.input<typeof staticOverlaySchema>;
export type StaticOverlay = z.infer<typeof staticOverlaySchema>;
export type StaticRenderManifest = z.infer<typeof staticRenderManifestSchema>;

export type StaticMapResult = {
  cached: boolean;
  hash: string;
  imageUrl: string;
  status: 'ready';
};

export type StaticMapCreateOptions = {
  apiKey?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
};

export function line(input: Omit<z.input<typeof lineOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeOverlay({...input, type: 'line'});
}

export function circle(input: Omit<z.input<typeof circleOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeOverlay({...input, type: 'circle'});
}

export function marker(input: Omit<z.input<typeof markerOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeOverlay({...input, type: 'marker'});
}

export function polygon(input: Omit<z.input<typeof polygonOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeOverlay({...input, type: 'polygon'});
}

export function validateStaticScene(
  input: unknown,
): {ok: true; scene: StaticScene} | {error: string; ok: false} {
  const parsed = staticSceneSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'scene'}: ${issue.message}`)
        .join('; '),
      ok: false,
    };
  }

  if (jsonByteLength(parsed.data.overlays) > staticSceneLimits.maxGeoJsonBytes) {
    return {
      error: `overlays exceed ${staticSceneLimits.maxGeoJsonBytes} bytes`,
      ok: false,
    };
  }

  return {ok: true, scene: normalizeStaticScene(parsed.data)};
}

export function validateStaticRenderManifest(
  input: unknown,
): {manifest: StaticRenderManifest; ok: true} | {error: string; ok: false} {
  const parsed = staticRenderManifestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
        .join('; '),
      ok: false,
    };
  }

  const sceneValidation = validateStaticScene(parsed.data.scene);

  if (!sceneValidation.ok) {
    return sceneValidation;
  }

  return {
    manifest: {
      ...parsed.data,
      scene: sceneValidation.scene,
    },
    ok: true,
  };
}

export function normalizeStaticScene(scene: StaticSceneInput): StaticScene {
  const parsed = staticSceneSchema.parse(scene);

  return stripUndefined({
    camera:
      parsed.camera.type === 'center'
        ? {
            bearing: roundNumber(parsed.camera.bearing ?? 0),
            center: normalizeCoordinate(parsed.camera.center),
            type: 'center',
            zoom: roundNumber(parsed.camera.zoom),
          }
        : {
            bearing: roundNumber(parsed.camera.bearing ?? 0),
            bounds: parsed.camera.bounds.map(roundNumber) as [number, number, number, number],
            padding: parsed.camera.padding ?? 32,
            type: 'bounds',
          },
    map: parsed.map,
    overlays: parsed.overlays.map((overlay, index) =>
      normalizeOverlay({
        ...overlay,
        id: overlay.id ?? `overlay-${index + 1}`,
      }),
    ),
    size: {
      dpr: parsed.size.dpr ?? 1,
      height: parsed.size.height,
      width: parsed.size.width,
    },
  }) as StaticScene;
}

export function createRenderManifest(input: {
  mapId: string;
  rendererVersion: string;
  scene: StaticSceneInput;
  styleId?: string;
  styleRevision: string;
  styleUrl: string;
}): StaticRenderManifest {
  return staticRenderManifestSchema.parse(
    stripUndefined({
      mapId: input.mapId,
      rendererVersion: input.rendererVersion,
      schemaVersion: staticRendererSchemaVersion,
      scene: normalizeStaticScene({
        ...input.scene,
        map: input.mapId,
      }),
      styleId: input.styleId,
      styleRevision: input.styleRevision,
      styleUrl: input.styleUrl,
    }),
  );
}

export async function hashRenderManifest(manifest: StaticRenderManifest) {
  const normalized = staticRenderManifestSchema.parse({
    ...manifest,
    scene: normalizeStaticScene(manifest.scene),
  });
  const bytes = new TextEncoder().encode(stableStringify(normalized));
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return base64Url(new Uint8Array(digest));
}

export function compileStaticOverlays(overlays: StaticOverlay[]) {
  const sources: Record<string, Record<string, unknown>> = {};
  const layers: Array<Record<string, unknown>> = [];

  for (const [index, overlay] of overlays.entries()) {
    const id = safeLayerId(`overlay-${index + 1}-${overlay.id ?? overlay.type}`);
    const sourceId = `${id}-source`;

    if (overlay.type === 'line') {
      sources[sourceId] = {
        data: feature('LineString', overlay.coordinates),
        type: 'geojson',
      };
      layers.push({
        id,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {
          'line-color': overlay.color,
          'line-opacity': overlay.opacity,
          'line-width': overlay.width,
        },
        source: sourceId,
        type: 'line',
      });
      continue;
    }

    if (overlay.type === 'polygon') {
      sources[sourceId] = {
        data: feature('Polygon', overlay.coordinates),
        type: 'geojson',
      };
      layers.push({
        id,
        paint: {
          'fill-color': overlay.fill,
          'fill-opacity': overlay.opacity,
        },
        source: sourceId,
        type: 'fill',
      });

      if (overlay.stroke && overlay.strokeWidth > 0) {
        layers.push({
          id: `${id}-stroke`,
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': overlay.stroke,
            'line-width': overlay.strokeWidth,
          },
          source: sourceId,
          type: 'line',
        });
      }
      continue;
    }

    sources[sourceId] = {
      data: feature('Point', overlay.coordinate),
      type: 'geojson',
    };
    layers.push({
      id,
      paint: {
        'circle-color': overlay.color,
        'circle-opacity': overlay.type === 'circle' ? overlay.opacity : 1,
        'circle-radius': overlay.radius,
        'circle-stroke-color': overlay.strokeColor ?? overlay.color,
        'circle-stroke-width': overlay.strokeWidth,
      },
      source: sourceId,
      type: 'circle',
    });
  }

  return {layers, sources};
}

export async function createStaticMap(
  scene: StaticSceneInput,
  options: StaticMapCreateOptions = {},
): Promise<StaticMapResult> {
  return requestStaticMap(scene, options, '/v1/static/maps');
}

export async function precacheStaticMap(
  scene: StaticSceneInput,
  options: StaticMapCreateOptions = {},
): Promise<StaticMapResult> {
  return requestStaticMap(scene, options, '/v1/static/maps/precache');
}

async function requestStaticMap(
  scene: StaticSceneInput,
  options: StaticMapCreateOptions,
  path: '/v1/static/maps' | '/v1/static/maps/precache',
): Promise<StaticMapResult> {
  const validation = validateStaticScene(scene);

  if (!validation.ok) {
    throw new Error(`Invalid Tileflow static scene: ${validation.error}`);
  }

  const fetcher = options.fetch ?? fetch;
  const apiUrl = normalizeUrl(options.apiUrl ?? 'https://api.tileflow.dev');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const response = await fetcher(`${apiUrl}${path}`, {
    body: JSON.stringify(validation.scene),
    headers,
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tileflow static map failed: ${response.status} ${error}`);
  }

  return (await response.json()) as StaticMapResult;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function normalizeOverlay(overlay: StaticOverlayInput): StaticOverlay {
  const parsed = staticOverlaySchema.parse(overlay);
  const normalized = stripUndefined({...parsed}) as Record<string, unknown>;

  if ('coordinate' in normalized) {
    normalized.coordinate = normalizeCoordinate(normalized.coordinate as StaticCoordinate);
  }

  if ('coordinates' in normalized) {
    normalized.coordinates = normalizeCoordinates(normalized.coordinates);
  }

  return normalized as StaticOverlay;
}

function normalizeCoordinates(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return normalizeCoordinate(value as StaticCoordinate);
  }

  return value.map(normalizeCoordinates);
}

function normalizeCoordinate(coordinate: StaticCoordinate): StaticCoordinate {
  return [roundNumber(coordinate[0]), roundNumber(coordinate[1])];
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}

function stripUndefined<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}

function feature(type: string, coordinates: unknown) {
  return {
    geometry: {coordinates, type},
    properties: {},
    type: 'Feature',
  };
}

function safeLayerId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, '');
}
