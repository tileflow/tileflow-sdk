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
import {staticOverlayPlacements} from './scene-contract';

export const staticRendererSchemaVersion = 1;
export const staticAttributionPlanSchemaVersion = 1;
export const staticRenderCompositionSchemaVersion = 1;
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

export const staticAttributionPlanSchema = z
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
export type StaticAttributionPlan = z.infer<typeof staticAttributionPlanSchema>;
export type StaticResolvedAttributionPosition = z.infer<
  typeof staticResolvedAttributionPositionSchema
>;

const placementAnchorsSchema = z
  .object({
    'above-water': z.string().min(1).max(256).nullable(),
    'below-roads': z.string().min(1).max(256).nullable(),
    'above-roads': z.string().min(1).max(256).nullable(),
    'above-buildings': z.string().min(1).max(256).nullable(),
    'below-labels': z.string().min(1).max(256).nullable(),
    'above-labels': z.null(),
  })
  .strict()
  .refine(anchorsHaveTerminalNulls, {
    message: 'Placement anchors may become null only at the end of semantic order',
  });
const resolvedIconSchema = z
  .object({
    height: z.number().int().positive().max(2048),
    icon: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    overlayIndex: z.number().int().min(0).max(23),
    width: z.number().int().positive().max(2048),
  })
  .strict();

export const staticRenderCompositionSchema = z
  .object({
    anchors: placementAnchorsSchema,
    icons: z.array(resolvedIconSchema).max(24),
    schemaVersion: z.literal(staticRenderCompositionSchemaVersion),
  })
  .strict()
  .refine(
    (composition) =>
      composition.icons.every(
        (icon, index) =>
          index === 0 || composition.icons[index - 1]!.overlayIndex < icon.overlayIndex,
      ),
    {message: 'Resolved symbol icons must be unique and sorted by overlay index'},
  );

export type StaticRenderComposition = z.infer<typeof staticRenderCompositionSchema>;

const staticRenderManifestBaseShape = {
  attribution: staticAttributionPlanSchema,
  autoFit: staticAutoFitPlanSchema.optional(),
  composition: staticRenderCompositionSchema,
  mapId: z.string().trim().min(1).max(128),
  rendererVersion: z.string().trim().min(1).max(64),
  schemaVersion: z.literal(staticRendererSchemaVersion),
  scene: staticSceneSchema,
  styleId: z.string().trim().min(1).max(128).optional(),
  styleRevision: z.string().trim().min(1).max(128),
  styleUrl: z.string().trim().url().max(512).refine(isSafeHttpUrl, {
    message: 'Expected an http(s) style URL without credentials or a fragment',
  }),
} as const;

export const staticRenderManifestSchema = z.object(staticRenderManifestBaseShape).strict();
export type StaticRenderManifest = z.infer<typeof staticRenderManifestSchema>;

export function validateStaticRenderManifest(
  input: unknown,
): {manifest: StaticRenderManifest; ok: true} | {error: string; ok: false} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {error: 'manifest: Expected an object', ok: false};
  }

  if ((input as Record<string, unknown>).schemaVersion !== staticRendererSchemaVersion) {
    return {error: 'manifest.schemaVersion: Unsupported renderer schema version', ok: false};
  }

  const rawScene = (input as {scene?: unknown}).scene;
  const sceneValidation = validateStaticScene(rawScene);
  if (!sceneValidation.ok) return sceneValidation;

  const parsed = staticRenderManifestSchema.safeParse({
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
  if (!attributionMatchesScene(parsed.data.attribution, sceneValidation.scene)) {
    return {
      error: 'manifest.attribution: Expected the exact request resolved from scene',
      ok: false,
    };
  }
  if (!compositionMatchesScene(parsed.data.composition, sceneValidation.scene)) {
    return {
      error: 'manifest.composition: Expected exact resolved symbol icon references',
      ok: false,
    };
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
  attribution: StaticAttributionPlan;
  composition: StaticRenderComposition;
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
      attribution: input.attribution,
      autoFit,
      composition: input.composition,
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

function attributionMatchesScene(
  plan: StaticAttributionPlan,
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

function compositionMatchesScene(
  composition: StaticRenderComposition,
  scene: ReturnType<typeof normalizeStaticScene>,
) {
  const expected = scene.overlays.flatMap((overlay, overlayIndex) =>
    overlay.type === 'symbol' && overlay.icon ? [{icon: overlay.icon, overlayIndex}] : [],
  );
  return (
    expected.length === composition.icons.length &&
    expected.every(
      (icon, index) =>
        composition.icons[index]?.icon === icon.icon &&
        composition.icons[index]?.overlayIndex === icon.overlayIndex,
    )
  );
}

function expectedAutoFit(scene: ReturnType<typeof normalizeStaticScene>) {
  if (scene.camera.type !== 'auto') return undefined;
  const analysis = analyzeStaticAutoFit(scene);
  if (!analysis.ok) throw new Error(`Invalid Tileflow auto-fit scene: ${analysis.error}`);
  return analysis.plan;
}

function anchorsHaveTerminalNulls(anchors: Record<string, string | null>) {
  let sawNull = false;
  for (const placement of staticOverlayPlacements) {
    const anchor = anchors[placement];
    if (anchor === null) sawNull = true;
    else if (sawNull) return false;
  }
  return true;
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
