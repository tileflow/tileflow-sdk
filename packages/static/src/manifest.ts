import {z} from 'zod';
import {analyzeStaticAutoFit, staticAutoFitPlanSchema} from './auto-fit';
import {hashStableValue, isSafeHttpUrl, stableStringify, stripUndefined} from './canonical';
import {
  normalizeStaticScene,
  type StaticSceneInput,
  staticSceneSchema,
  validateStaticScene,
} from './scene';

export const staticRendererSchemaVersion = 1;

export const staticRenderManifestSchema = z.object({
  autoFit: staticAutoFitPlanSchema.optional(),
  mapId: z.string().trim().min(1).max(128),
  rendererVersion: z.string().trim().min(1).max(64),
  schemaVersion: z.literal(staticRendererSchemaVersion),
  scene: staticSceneSchema,
  styleId: z.string().trim().min(1).max(128).optional(),
  styleRevision: z.string().trim().min(1).max(128),
  styleUrl: z.string().trim().url().max(512).refine(isSafeHttpUrl, {
    message: 'Expected an http(s) style URL without credentials or a fragment',
  }),
});

export type StaticRenderManifest = z.infer<typeof staticRenderManifestSchema>;

export function validateStaticRenderManifest(
  input: unknown,
): {manifest: StaticRenderManifest; ok: true} | {error: string; ok: false} {
  const rawScene =
    input && typeof input === 'object' && !Array.isArray(input) && 'scene' in input
      ? (input as {scene: unknown}).scene
      : undefined;
  const sceneValidation = validateStaticScene(rawScene);

  if (!sceneValidation.ok) {
    return sceneValidation;
  }

  const parsed = staticRenderManifestSchema.safeParse({
    ...(input as Record<string, unknown>),
    scene: sceneValidation.scene,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
        .join('; '),
      ok: false,
    };
  }

  const autoFit = expectedAutoFit(sceneValidation.scene);
  if (
    (autoFit === undefined) !== (parsed.data.autoFit === undefined) ||
    (autoFit !== undefined && stableStringify(autoFit) !== stableStringify(parsed.data.autoFit))
  ) {
    return {error: 'manifest.autoFit: Expected the exact plan derived from scene', ok: false};
  }

  return {
    manifest: {
      ...parsed.data,
      ...(autoFit === undefined ? {} : {autoFit}),
      scene: sceneValidation.scene,
    },
    ok: true,
  };
}

export function createRenderManifest(input: {
  mapId: string;
  rendererVersion: string;
  scene: StaticSceneInput;
  styleId?: string;
  styleRevision: string;
  styleUrl: string;
}): StaticRenderManifest {
  const scene = normalizeStaticScene(input.scene);
  const autoFit = expectedAutoFit(scene);

  return staticRenderManifestSchema.parse(
    stripUndefined({
      autoFit,
      mapId: input.mapId,
      rendererVersion: input.rendererVersion,
      schemaVersion: staticRendererSchemaVersion,
      scene,
      styleId: input.styleId,
      styleRevision: input.styleRevision,
      styleUrl: input.styleUrl,
    }),
  );
}

export async function hashRenderManifest(manifest: StaticRenderManifest): Promise<string> {
  const validation = validateStaticRenderManifest(manifest);
  if (!validation.ok) throw new Error(`Invalid Tileflow render manifest: ${validation.error}`);
  return hashStableValue(validation.manifest);
}

export async function hashStaticSceneRequest(scene: StaticSceneInput): Promise<string> {
  const validation = validateStaticScene(scene);
  if (!validation.ok) throw new Error(`Invalid Tileflow static scene: ${validation.error}`);
  return hashStableValue(validation.scene);
}

function expectedAutoFit(scene: ReturnType<typeof normalizeStaticScene>) {
  if (scene.camera.type !== 'auto') return undefined;
  const analysis = analyzeStaticAutoFit(scene);
  if (!analysis.ok) throw new Error(`Invalid Tileflow auto-fit scene: ${analysis.error}`);
  return analysis.plan;
}
