import {jsonByteLength, roundNumber, stripUndefined} from './canonical';
import {normalizeStaticCoordinate, normalizeStaticOverlay} from './overlay-normalization';
import {
  type StaticScene,
  type StaticSceneInput,
  staticSceneLimits,
  staticSceneSchema,
} from './scene-contract';

export {staticSceneLimits, staticSceneSchema, staticSceneSchemaVersion} from './scene-contract';
export type {StaticCoordinate, StaticScene, StaticSceneInput} from './scene-contract';

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

  return {ok: true, scene: normalizeParsedStaticScene(parsed.data)};
}

export function normalizeStaticScene(scene: StaticSceneInput): StaticScene {
  return normalizeParsedStaticScene(staticSceneSchema.parse(scene));
}

function normalizeParsedStaticScene(parsed: StaticScene): StaticScene {
  return stripUndefined({
    camera:
      parsed.camera.type === 'center'
        ? {
            bearing: roundNumber(parsed.camera.bearing ?? 0),
            center: normalizeStaticCoordinate(parsed.camera.center),
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
