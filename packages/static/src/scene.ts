import {
  analyzeStaticAutoFit,
  autoFitErrorResponse,
  findStaticOverlayLatitudeFailure,
  type StaticAutoFitErrorResponse,
  type StaticAutoFitFailure,
  StaticMapRequestError,
  type StaticMapRequestErrorResponse,
  staticMapRequestErrorResponseSchema,
  type StaticMapRequestFailure,
} from './auto-fit';
import {jsonByteLength, roundNumber, stripUndefined} from './canonical';
import {normalizeStaticCoordinate, normalizeStaticOverlay} from './overlay-normalization';
import {
  type StaticPadding,
  type StaticScene,
  type StaticSceneInput,
  staticSceneLimits,
  staticSceneSchema,
} from './scene-contract';

export {
  MAX_OVERLAY_LATITUDE,
  staticAttributionPositionSchema,
  staticAttributionRequestSchema,
  staticSceneLimits,
  staticSceneSchema,
  staticSceneSchemaVersion,
} from './scene-contract';
export {StaticMapRequestError, staticMapRequestErrorResponseSchema};
export type {
  StaticAutoFitErrorResponse,
  StaticAutoFitFailure,
  StaticMapRequestErrorResponse,
  StaticMapRequestFailure,
};
export type {
  StaticCoordinate,
  StaticAttributionMode,
  StaticAttributionPosition,
  StaticAttributionRequest,
  StaticMapFormat,
  StaticPadding,
  StaticScene,
  StaticSceneInput,
} from './scene-contract';

export function validateStaticScene(
  input: unknown,
): {ok: true; scene: StaticScene} | {error: string; ok: false} | StaticMapRequestFailure {
  const overlayLatitudeFailure = findStaticOverlayLatitudeFailure(input);
  if (overlayLatitudeFailure) return overlayLatitudeFailure;

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

  const scene = normalizeParsedStaticScene(parsed.data);

  if (scene.camera.type === 'auto') {
    const analysis = analyzeStaticAutoFit(scene);
    if (!analysis.ok) return analysis;
  }

  return {ok: true, scene};
}

export function normalizeStaticScene(scene: StaticSceneInput): StaticScene {
  const overlayLatitudeFailure = findStaticOverlayLatitudeFailure(scene);
  if (overlayLatitudeFailure) {
    const {ok: _ok, ...response} = overlayLatitudeFailure;
    throw new StaticMapRequestError(response);
  }

  const normalized = normalizeParsedStaticScene(staticSceneSchema.parse(scene));

  if (normalized.camera.type === 'auto') {
    const analysis = analyzeStaticAutoFit(normalized);
    if (!analysis.ok) {
      throw new StaticMapRequestError(autoFitErrorResponse(analysis));
    }
  }

  return normalized;
}

function normalizeParsedStaticScene(parsed: StaticScene): StaticScene {
  return stripUndefined({
    ...(parsed.attribution && Object.keys(parsed.attribution).length > 0
      ? {
          attribution:
            parsed.attribution.mode === 'external'
              ? {mode: 'external'}
              : stripUndefined({
                  mode: parsed.attribution.mode,
                  position: parsed.attribution.position,
                }),
        }
      : {}),
    camera:
      parsed.camera.type === 'center'
        ? {
            bearing: roundNumber(parsed.camera.bearing ?? 0),
            center: normalizeStaticCoordinate(parsed.camera.center),
            type: 'center',
            zoom: roundNumber(parsed.camera.zoom),
          }
        : parsed.camera.type === 'bounds'
          ? {
              bearing: roundNumber(parsed.camera.bearing ?? 0),
              bounds: parsed.camera.bounds.map(roundNumber) as [number, number, number, number],
              padding: parsed.camera.padding ?? 32,
              type: 'bounds',
            }
          : {
              bearing: roundNumber(parsed.camera.bearing ?? 0),
              maxZoom: roundNumber(parsed.camera.maxZoom ?? 16),
              padding: normalizeAutoPadding(parsed.camera.padding, parsed.size),
              type: 'auto',
            },
    ...(parsed.format && parsed.format !== 'png' ? {format: parsed.format} : {}),
    map: parsed.map,
    overlays: parsed.overlays.map((overlay, index) =>
      normalizeStaticOverlay({
        ...overlay,
        id: overlay.id ?? `overlay-${index + 1}`,
      }),
    ),
    size: {
      dpr: parsed.size.dpr ?? 1,
      height: parsed.size.height,
      width: parsed.size.width,
    },
    theme: parsed.theme,
  }) as StaticScene;
}

function normalizeAutoPadding(
  padding: number | Partial<StaticPadding> | undefined,
  size: {height: number; width: number},
): StaticPadding {
  if (padding === undefined) {
    const value = Math.min(32, Math.ceil(Math.min(size.width, size.height) * 0.05));
    return {bottom: value, left: value, right: value, top: value};
  }

  if (typeof padding === 'number') {
    return {bottom: padding, left: padding, right: padding, top: padding};
  }

  return {
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
    right: padding.right ?? 0,
    top: padding.top ?? 0,
  };
}
