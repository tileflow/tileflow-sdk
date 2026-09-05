import {z} from 'zod';
import {analyzeStaticAutoFit, staticAutoFitPlanSchema} from './auto-fit';
import {
  hashStableValue,
  isSafeHttpUrl,
  jsonByteLength,
  stableStringify,
  stripUndefined,
} from './canonical';
import {
  normalizeStaticScene,
  type StaticSceneInput,
  staticSceneSchema,
  validateStaticScene,
} from './scene';

export const staticRendererSchemaVersionV1 = 1;
export const staticRendererSchemaVersion = 2;
export const staticAttributionPlanSchemaVersion = 1;
export const staticAttributionLimits = {
  maxBytes: 32 * 1024,
  maxEntries: 18,
  maxLinksPerEntry: 8,
  maxTextLength: 16_384,
  maxUrlLength: 2048,
} as const;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const sourceIdSchema = z.string().min(1).max(128);
const boundedIdentitySchema = z.string().min(1).max(512).refine(hasNoControlCharacters, {
  message: 'Expected no control characters',
});
const staticResolvedAttributionPositionSchema = z.enum([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

export const staticAttributionSegmentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      text: z
        .string()
        .min(1)
        .max(staticAttributionLimits.maxTextLength)
        .refine(hasNoControlCharacters, {message: 'Attribution text contains control characters'}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('link'),
      label: z
        .string()
        .min(1)
        .max(staticAttributionLimits.maxTextLength)
        .refine(hasNoControlCharacters, {
          message: 'Attribution link label contains control characters',
        }),
      url: z.string().trim().url().max(staticAttributionLimits.maxUrlLength).refine(isSafeHttpUrl, {
        message: 'Expected an http(s) URL without credentials or a fragment',
      }),
    })
    .strict(),
]);

const attributionSourceSchema = z
  .object({
    sourceId: sourceIdSchema,
    sourceSelectionIdentity: boundedIdentitySchema,
  })
  .strict();
const attributionSourcesSchema = z
  .array(attributionSourceSchema)
  .min(1)
  .max(18)
  .refine(isUniqueSortedSources, {
    message: 'Attribution sources must be unique and sorted',
  });

export const staticAttributionProvenanceSchema = z.discriminatedUnion('authority', [
  z
    .object({
      authority: z.literal('platform-notice'),
      noticeId: boundedIdentitySchema,
      noticeSha256: sha256HexSchema,
      resource: z.enum(['terrain', 'world']),
      sources: attributionSourcesSchema,
    })
    .strict(),
  z
    .object({
      authority: z.literal('team-declared'),
      sources: z
        .array(
          attributionSourceSchema
            .extend({
              mapRevision: boundedIdentitySchema,
              resourceId: boundedIdentitySchema,
            })
            .strict(),
        )
        .min(1)
        .max(18)
        .refine(isUniqueSortedSources, {
          message: 'Attribution sources must be unique and sorted',
        }),
    })
    .strict(),
]);

export const staticAttributionEntrySchema = z
  .object({
    authority: z.enum(['platform-notice', 'team-declared']),
    provenance: staticAttributionProvenanceSchema,
    segments: z.array(staticAttributionSegmentSchema).min(1).max(17),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.authority !== entry.provenance.authority) {
      context.addIssue({
        code: 'custom',
        message: 'Attribution entry authority must match its provenance',
        path: ['authority'],
      });
    }

    const links = entry.segments.filter((segment) => segment.kind === 'link').length;
    if (links > staticAttributionLimits.maxLinksPerEntry) {
      context.addIssue({
        code: 'custom',
        message: `Attribution entries can contain at most ${staticAttributionLimits.maxLinksPerEntry} links`,
        path: ['segments'],
      });
    }
  });

export const staticAttributionPlanSchemaV1 = z
  .object({
    entries: z.array(staticAttributionEntrySchema).max(staticAttributionLimits.maxEntries),
    mode: z.enum(['embedded', 'external']),
    position: z.union([z.literal('auto'), staticResolvedAttributionPositionSchema, z.null()]),
    schemaVersion: z.literal(staticAttributionPlanSchemaVersion),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      (plan.mode === 'external' && plan.position !== null) ||
      (plan.mode === 'embedded' && plan.position === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attribution position must match its mode',
        path: ['position'],
      });
    }

    if (jsonByteLength(plan) > staticAttributionLimits.maxBytes) {
      context.addIssue({
        code: 'custom',
        message: `Attribution plan exceeds ${staticAttributionLimits.maxBytes} bytes`,
      });
    }
  });

export type StaticAttributionSegment = z.infer<typeof staticAttributionSegmentSchema>;
export type StaticAttributionProvenance = z.infer<typeof staticAttributionProvenanceSchema>;
export type StaticAttributionEntry = z.infer<typeof staticAttributionEntrySchema>;
export type StaticAttributionPlanV1 = z.infer<typeof staticAttributionPlanSchemaV1>;
export type StaticResolvedAttributionPosition = z.infer<
  typeof staticResolvedAttributionPositionSchema
>;

const staticRenderManifestBaseShape = {
  autoFit: staticAutoFitPlanSchema.optional(),
  mapId: z.string().trim().min(1).max(128),
  rendererVersion: z.string().trim().min(1).max(64),
  styleId: z.string().trim().min(1).max(128).optional(),
  styleRevision: z.string().trim().min(1).max(128),
  styleUrl: z.string().trim().url().max(512).refine(isSafeHttpUrl, {
    message: 'Expected an http(s) style URL without credentials or a fragment',
  }),
} as const;

const staticSceneSchemaV1 = staticSceneSchema.omit({attribution: true});

export const staticRenderManifestV1Schema = z.object({
  ...staticRenderManifestBaseShape,
  schemaVersion: z.literal(staticRendererSchemaVersionV1),
  scene: staticSceneSchemaV1,
});

export const staticRenderManifestV2Schema = z
  .object({
    ...staticRenderManifestBaseShape,
    attribution: staticAttributionPlanSchemaV1,
    schemaVersion: z.literal(staticRendererSchemaVersion),
    scene: staticSceneSchema,
  })
  .strict();

export const staticRenderManifestSchema = z.discriminatedUnion('schemaVersion', [
  staticRenderManifestV1Schema,
  staticRenderManifestV2Schema,
]);

export type StaticRenderManifestV1 = z.infer<typeof staticRenderManifestV1Schema>;
export type StaticRenderManifestV2 = z.infer<typeof staticRenderManifestV2Schema>;
export type StaticRenderManifest = z.infer<typeof staticRenderManifestSchema>;

export function validateStaticRenderManifest(
  input: unknown,
): {manifest: StaticRenderManifest; ok: true} | {error: string; ok: false} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {error: 'manifest: Expected an object', ok: false};
  }

  const schemaVersion = (input as Record<string, unknown>).schemaVersion;
  if (
    schemaVersion !== staticRendererSchemaVersionV1 &&
    schemaVersion !== staticRendererSchemaVersion
  ) {
    return {error: 'manifest.schemaVersion: Unsupported renderer schema version', ok: false};
  }

  const rawScene = (input as {scene?: unknown}).scene;
  const sceneValidation = validateVersionedScene(rawScene, schemaVersion);

  if (!sceneValidation.ok) return sceneValidation;

  const schema =
    schemaVersion === staticRendererSchemaVersionV1
      ? staticRenderManifestV1Schema
      : staticRenderManifestV2Schema;
  const parsed = schema.safeParse({
    ...(input as Record<string, unknown>),
    scene: sceneValidation.scene,
  });

  if (!parsed.success) return zodFailure(parsed.error);

  const autoFit = expectedAutoFit(sceneValidation.scene);
  if (
    (autoFit === undefined) !== (parsed.data.autoFit === undefined) ||
    (autoFit !== undefined && stableStringify(autoFit) !== stableStringify(parsed.data.autoFit))
  ) {
    return {error: 'manifest.autoFit: Expected the exact plan derived from scene', ok: false};
  }

  if (
    schemaVersion === staticRendererSchemaVersion &&
    (!('attribution' in parsed.data) ||
      !attributionMatchesScene(parsed.data.attribution, sceneValidation.scene))
  ) {
    return {
      error: 'manifest.attribution: Expected the exact request resolved from scene',
      ok: false,
    };
  }

  return {
    manifest: {
      ...parsed.data,
      ...(autoFit === undefined ? {} : {autoFit}),
      scene: sceneValidation.scene,
    } as StaticRenderManifest,
    ok: true,
  };
}

export function createRenderManifestV1(input: {
  mapId: string;
  rendererVersion: string;
  scene: StaticSceneInput;
  styleId?: string;
  styleRevision: string;
  styleUrl: string;
}): StaticRenderManifestV1 {
  const rawScene = staticSceneSchemaV1.parse(input.scene);
  const scene = normalizeStaticScene(rawScene);
  const autoFit = expectedAutoFit(scene);

  return staticRenderManifestV1Schema.parse(
    stripUndefined({
      autoFit,
      mapId: input.mapId,
      rendererVersion: input.rendererVersion,
      schemaVersion: staticRendererSchemaVersionV1,
      scene,
      styleId: input.styleId,
      styleRevision: input.styleRevision,
      styleUrl: input.styleUrl,
    }),
  );
}

/** Compatibility creation path for historical manifest v1 fixtures and readers. */
export const createRenderManifest = createRenderManifestV1;

export function createRenderManifestV2(input: {
  attribution: StaticAttributionPlanV1;
  mapId: string;
  rendererVersion: string;
  scene: StaticSceneInput;
  styleId?: string;
  styleRevision: string;
  styleUrl: string;
}): StaticRenderManifestV2 {
  const scene = normalizeStaticScene(input.scene);
  const autoFit = expectedAutoFit(scene);

  return staticRenderManifestV2Schema.parse(
    stripUndefined({
      attribution: input.attribution,
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

function validateVersionedScene(input: unknown, version: 1 | 2) {
  if (version === 1 && input && typeof input === 'object' && !Array.isArray(input)) {
    const {attribution: _attribution, ...legacy} = input as Record<string, unknown>;
    return validateStaticScene(legacy);
  }
  return validateStaticScene(input);
}

function attributionMatchesScene(
  plan: StaticAttributionPlanV1,
  scene: ReturnType<typeof normalizeStaticScene>,
) {
  const request = scene.attribution;
  const expectedMode = request?.mode === 'external' ? 'external' : 'embedded';
  const expectedPosition =
    expectedMode === 'external'
      ? null
      : request && 'position' in request
        ? (request.position ?? 'auto')
        : 'auto';

  return plan.mode === expectedMode && plan.position === expectedPosition;
}

function expectedAutoFit(scene: ReturnType<typeof normalizeStaticScene>) {
  if (scene.camera.type !== 'auto') return undefined;
  const analysis = analyzeStaticAutoFit(scene);
  if (!analysis.ok) throw new Error(`Invalid Tileflow auto-fit scene: ${analysis.error}`);
  return analysis.plan;
}

function hasNoControlCharacters(value: string) {
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function isUniqueSortedSources(values: readonly {sourceId: string}[]) {
  return values.every(
    (value, index) =>
      index === 0 || compareCodeUnits(values[index - 1]!.sourceId, value.sourceId) < 0,
  );
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function zodFailure(error: z.ZodError): {error: string; ok: false} {
  return {
    error: error.issues
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; '),
    ok: false,
  };
}
