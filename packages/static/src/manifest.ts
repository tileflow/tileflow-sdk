import {z} from 'zod';
import {hashStableValue, isSafeHttpUrl, stripUndefined} from './canonical';
import {
  normalizeStaticScene,
  type StaticSceneInput,
  staticSceneSchema,
  validateStaticScene,
} from './scene';

export const staticRendererSchemaVersion = 1;

export const staticRenderManifestSchema = z.object({
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
      scene: normalizeStaticScene(input.scene),
      styleId: input.styleId,
      styleRevision: input.styleRevision,
      styleUrl: input.styleUrl,
    }),
  );
}

export async function hashRenderManifest(manifest: StaticRenderManifest): Promise<string> {
  const normalized = staticRenderManifestSchema.parse({
    ...manifest,
    scene: normalizeStaticScene(manifest.scene),
  });
  return hashStableValue(normalized);
}

export async function hashStaticSceneRequest(scene: StaticSceneInput): Promise<string> {
  const validation = validateStaticScene(scene);
  if (!validation.ok) throw new Error(`Invalid Tileflow static scene: ${validation.error}`);
  return hashStableValue(validation.scene);
}
