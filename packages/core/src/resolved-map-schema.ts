import {z} from 'zod';
import {
  tileflowRenderStackOperationNamePattern,
  tileflowSemanticTargetPattern,
} from './cartography/contributions';
import {validateTileflowDataExpression} from './cartography/data-expression';
import {tileflowLayerDomains} from './cartography/domains';
import {
  tileflowRenderSelectorComparisons,
  tileflowRenderSelectorGeometries,
  tileflowRenderStackLimits,
  tileflowRenderStackPhases,
  tileflowRenderStackRenderers,
  validateTileflowRenderSelectorConstraints,
} from './cartography/render-stack';
import {
  tileflowSemanticFieldNames,
  tileflowSemanticLayerNames,
} from './cartography/semantic-bindings';
import {tileflowThemeTokenCategories} from './cartography/values';
import {
  openMapTiles,
  openMapTilesContractVersion,
  tileflowWorldGeneration,
  validatePublicVectorUrl,
} from './data';
import {tileflowWorldReleaseIdSchema} from './data/world-release-id';
import {
  isTileflowLocalDirectory,
  tileflowLocalDirectoryMaximumLength,
  tileflowLocalDirectoryMessage,
} from './maps/assets';
import {
  type ResolvedTileflowMap as TileflowCompilerConfig,
  tileflowMapIdSchema,
} from './maps/types';
import {tileflowLandformClasses} from './modules/landforms';
import {tileflowRoadClasses} from './modules/roads/semantics';
import {tileflowThemeNameSchema} from './portable-identity';
import {
  isSafeTileflowDemUrlTemplate,
  isTileflowContourDensityWithinBudget,
} from './terrain/contour-protocol';
import {resolveTileflowTheme, type TileflowTheme, tileflowThemeLimits} from './themes';
import {tileflowPoiCategories, type ValidationMessage} from './types';

/** Structured schema failure preserved for CLI/editor diagnostics. */
export class TileflowResolvedMapValidationError extends Error {
  readonly code = 'CONFIG_INVALID' as const;
  readonly messages: ValidationMessage[];
  readonly phase = 'config-validation' as const;

  constructor(name: string, messages: ValidationMessage[]) {
    super(
      `Invalid Tileflow ${name}. ${messages
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'TileflowResolvedMapValidationError';
    this.messages = messages;
  }
}

const identifierSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, 'Expected letters, numbers, underscores, or hyphens')
  .refine((value) => value !== '__proto__', 'Expected a safe identifier');
const revisionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'Expected a portable data revision');
const zoomNumberSchema = z.number().finite().min(0).max(24);
function zoomValueSchemaFor(valueSchema: z.ZodType) {
  const stops = z
    .array(z.tuple([zoomNumberSchema, valueSchema]))
    .min(1)
    .superRefine((entries, context) => {
      for (let index = 1; index < entries.length; index += 1) {
        if (entries[index]![0] <= entries[index - 1]![0]) {
          context.addIssue({
            code: 'custom',
            message: 'Zoom stops must be strictly increasing',
            path: [index, 0],
          });
        }
      }
    });
  return z.discriminatedUnion('interpolation', [
    z
      .object({
        base: z.number().finite().positive(),
        interpolation: z.literal('exponential'),
        kind: z.literal('zoom'),
        stops,
      })
      .strict(),
    z
      .object({
        interpolation: z.literal('linear'),
        kind: z.literal('zoom'),
        stops,
      })
      .strict(),
    z
      .object({
        interpolation: z.literal('step'),
        kind: z.literal('zoom'),
        stops,
      })
      .strict(),
  ]);
}

const themeTokenNameSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/,
    'Expected a portable dot-separated semantic token name',
  );
const themeTokenReferenceSchema = z
  .object({
    category: z.enum(tileflowThemeTokenCategories),
    kind: z.literal('theme-token'),
    token: themeTokenNameSchema,
  })
  .strict();
const themeNumberReferenceSchema = themeTokenReferenceSchema.extend({
  category: z.literal('number'),
});
const fixedNumberSchema = z
  .object({
    kind: z.literal('theme-fixed'),
    reason: z.string().trim().min(1),
    value: z.number().finite(),
  })
  .strict();
const fixedNumberArraySchema = z
  .object({
    kind: z.literal('theme-fixed'),
    reason: z.string().trim().min(1),
    value: z.array(z.number().finite()),
  })
  .strict();
const fixedNumberOffsetSchema = z
  .object({
    kind: z.literal('theme-fixed'),
    reason: z.string().trim().min(1),
    value: z.tuple([z.number().finite(), z.number().finite()]),
  })
  .strict();
const fixedNumberInsetsSchema = z
  .object({
    kind: z.literal('theme-fixed'),
    reason: z.string().trim().min(1),
    value: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  })
  .strict();
const fixedStringSchema = z
  .object({kind: z.literal('theme-fixed'), reason: z.string().trim().min(1), value: z.string()})
  .strict();
const themeColorOperationSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('operation', [
    z
      .object({
        color: themeColorValueSchema,
        kind: z.literal('theme-color'),
        opacity: themeNumberValueSchema,
        operation: z.literal('alpha'),
      })
      .strict(),
    z
      .object({
        amount: themeNumberValueSchema,
        from: themeColorValueSchema,
        kind: z.literal('theme-color'),
        operation: z.literal('mix'),
        space: z.literal('oklch'),
        to: themeColorValueSchema,
      })
      .strict(),
  ]),
);
const themeNumberValueSchema: z.ZodType = z.lazy(() =>
  z.union([z.number().finite(), fixedNumberSchema, themeNumberReferenceSchema]),
);
const themeColorValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string().min(1),
    fixedStringSchema,
    themeTokenReferenceSchema.extend({category: z.literal('color')}),
    themeColorOperationSchema,
  ]),
);
const themeFontValueSchema = z.union([
  z.string().min(1),
  fixedStringSchema,
  themeTokenReferenceSchema.extend({category: z.literal('font')}),
]);
const themeImageValueSchema = z.union([
  z.string().min(1),
  fixedStringSchema,
  themeTokenReferenceSchema.extend({category: z.literal('image')}),
]);
type ExpressionThemeCategory = 'color' | 'image' | 'number' | undefined;

function expressionSchemaFor(expectedCategory: ExpressionThemeCategory) {
  const category = expectedCategory ?? 'structural';
  return z
    .object({kind: z.literal('expression'), value: z.array(z.unknown()).min(1)})
    .strict()
    .superRefine((expression, context) => {
      for (const issue of validateTileflowDataExpression(expression.value)) {
        context.addIssue({
          code: 'custom',
          message: issue.message,
          path: ['value', ...issue.path],
        });
      }
      validateExpressionFieldNames(expression.value, context, ['value']);
      validateExpressionThemeValues(expression.value, expectedCategory, context, ['value']);
    })
    .describe(`tileflow-data-expression:${category}`);
}

function validateExpressionFieldNames(
  value: unknown,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      validateExpressionFieldNames(entry, context, [...path, index]);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind === 'tileflow-data-field' &&
    (typeof candidate.name !== 'string' ||
      !Object.hasOwn(fieldBindingsSchema.shape, candidate.name))
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Expected a registered semantic field name.',
      path: [...path, 'name'],
    });
    return;
  }
  for (const [key, entry] of Object.entries(candidate)) {
    validateExpressionFieldNames(entry, context, [...path, key]);
  }
}

function validateExpressionThemeValues(
  value: unknown,
  expectedCategory: ExpressionThemeCategory,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      validateExpressionThemeValues(entry, expectedCategory, context, [...path, index]);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'theme-token') {
    const parsed = themeTokenReferenceSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.category !== expectedCategory) {
      context.addIssue({
        code: 'custom',
        message:
          expectedCategory === undefined
            ? 'Structural expressions cannot contain theme-token references'
            : `Expected a ${expectedCategory} theme-token reference`,
        path,
      });
    }
    return;
  }
  if (candidate.kind === 'theme-fixed') {
    const parsed =
      expectedCategory === 'number'
        ? z.union([fixedNumberSchema, fixedNumberArraySchema]).safeParse(candidate)
        : expectedCategory === 'color' || expectedCategory === 'image'
          ? fixedStringSchema.safeParse(candidate)
          : undefined;
    if (!parsed?.success) {
      context.addIssue({
        code: 'custom',
        message:
          expectedCategory === undefined
            ? 'Structural expressions cannot contain theme-fixed values'
            : `Expected a fixed ${expectedCategory} value`,
        path,
      });
    }
    return;
  }
  if (candidate.kind === 'theme-color') {
    if (expectedCategory !== 'color' || !themeColorOperationSchema.safeParse(candidate).success) {
      context.addIssue({
        code: 'custom',
        message: 'Theme color operations are valid only in color expressions',
        path,
      });
    }
    return;
  }

  for (const [key, entry] of Object.entries(candidate)) {
    validateExpressionThemeValues(entry, expectedCategory, context, [...path, key]);
  }
}

const numberExpressionSchema = expressionSchemaFor('number');
const colorExpressionSchema = expressionSchemaFor('color');
const imageExpressionSchema = expressionSchemaFor('image');
const structuralExpressionSchema = expressionSchemaFor(undefined);
const numberZoomValueSchema = zoomValueSchemaFor(themeNumberValueSchema);
const colorZoomValueSchema = zoomValueSchemaFor(themeColorValueSchema);
const imageZoomValueSchema = zoomValueSchemaFor(themeImageValueSchema);
const stringZoomValueSchema = zoomValueSchemaFor(z.string());
const numberValueSchema = z.union([
  themeNumberValueSchema,
  numberExpressionSchema,
  numberZoomValueSchema,
]);
const structuralNumberValueSchema = z.union([
  z.number().finite(),
  structuralExpressionSchema,
  zoomValueSchemaFor(z.number().finite()),
]);
const colorValueSchema = z.union([
  themeColorValueSchema,
  colorExpressionSchema,
  colorZoomValueSchema,
]);
const imageValueSchema = z.union([
  themeImageValueSchema,
  imageExpressionSchema,
  imageZoomValueSchema,
]);
const stringValueSchema = z.union([z.string(), structuralExpressionSchema, stringZoomValueSchema]);
const themeNumberArraySchema = z.array(themeNumberValueSchema);
const themeNumberArrayValueSchema = z.union([themeNumberArraySchema, fixedNumberArraySchema]);
const numberArrayValueSchema = z.union([
  themeNumberArrayValueSchema,
  numberExpressionSchema,
  zoomValueSchemaFor(themeNumberArrayValueSchema),
]);
const themeNumberOffsetSchema = z.tuple([themeNumberValueSchema, themeNumberValueSchema]);
const themeNumberOffsetValueSchema = z.union([themeNumberOffsetSchema, fixedNumberOffsetSchema]);
const numberOffsetValueSchema = z.union([
  themeNumberOffsetValueSchema,
  numberExpressionSchema,
  zoomValueSchemaFor(themeNumberOffsetValueSchema),
]);
const themeNumberInsetsSchema = z.tuple([
  themeNumberValueSchema,
  themeNumberValueSchema,
  themeNumberValueSchema,
  themeNumberValueSchema,
]);
const themeNumberInsetsValueSchema = z.union([themeNumberInsetsSchema, fixedNumberInsetsSchema]);
const numberInsetsValueSchema = z.union([
  themeNumberInsetsValueSchema,
  numberExpressionSchema,
  zoomValueSchemaFor(themeNumberInsetsValueSchema),
]);
const lineCapSchema = z.enum(['butt', 'round', 'square']);
const lineCapValueSchema = z.union([
  lineCapSchema,
  structuralExpressionSchema,
  zoomValueSchemaFor(lineCapSchema),
]);
const lineJoinSchema = z.enum(['bevel', 'miter', 'round']);
const lineJoinValueSchema = z.union([
  lineJoinSchema,
  structuralExpressionSchema,
  zoomValueSchemaFor(lineJoinSchema),
]);
const exactFontFaceSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      value === value.trim() && value === value.normalize('NFC') && !/[\p{Cc}\\]/u.test(value),
    'Expected an exact NFC font face name without surrounding whitespace, controls, or backslashes',
  );
const fontFallbacksSchema = z
  .array(exactFontFaceSchema)
  .max(8)
  .superRefine((fallbacks, context) => {
    const seen = new Set<string>();
    for (const [index, fallback] of fallbacks.entries()) {
      if (seen.has(fallback)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate exact fallback face "${fallback}"`,
          path: [index],
        });
      }
      seen.add(fallback);
    }
  });
const moduleFontValueSchema = z.union([
  exactFontFaceSchema,
  fixedStringSchema,
  themeTokenReferenceSchema.extend({category: z.literal('font')}),
]);
const moduleFontFallbacksSchema = z.array(moduleFontValueSchema).max(8);

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'Expected a hex color like #F6F7F3 or #F6F7F3FF',
  });
const rgbColorSchema = z.string().refine((value) => {
  const match = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/iu,
  );
  if (!match) return false;
  const channels = match.slice(1, 4).map(Number);
  const alpha = Number(match[4] ?? 1);
  return channels.every((channel) => channel >= 0 && channel <= 255) && alpha >= 0 && alpha <= 1;
}, 'Expected a Tileflow hex, rgb(), or rgba() color');
const terrainColorLiteralSchema = z.union([hexColorSchema, rgbColorSchema]);
const terrainColorValueSchema = z.union([
  terrainColorLiteralSchema,
  fixedStringSchema.extend({value: terrainColorLiteralSchema}),
  themeTokenReferenceSchema.extend({category: z.literal('color')}),
  themeColorOperationSchema,
]);

function terrainNumberValueSchema(schema: z.ZodNumber) {
  return z.union([schema, fixedNumberSchema.extend({value: schema}), themeNumberReferenceSchema]);
}

const themeTypographyStyleSchema = z
  .object({
    fallbacks: z.array(themeFontValueSchema).max(8).optional(),
    font: themeFontValueSchema.optional(),
    letterSpacing: themeNumberValueSchema.optional(),
    transform: z.enum(['lowercase', 'none', 'uppercase']).optional(),
  })
  .strict();
const themeTypographySchema = themeTypographyStyleSchema.extend({
  places: themeTypographyStyleSchema.optional(),
  poi: themeTypographyStyleSchema.optional(),
  roads: themeTypographyStyleSchema.optional(),
  water: themeTypographyStyleSchema.optional(),
});
const themeLightingSchema = z
  .object({
    anchor: z.enum(['map', 'viewport']).optional(),
    color: themeColorValueSchema.optional(),
    intensity: themeNumberValueSchema.optional(),
    position: z
      .tuple([themeNumberValueSchema, themeNumberValueSchema, themeNumberValueSchema])
      .optional(),
  })
  .strict();
export const tileflowThemeSchema = z
  .object({
    colorScheme: z.enum(['light', 'dark']),
    id: tileflowThemeNameSchema,
    lighting: themeLightingSchema,
    tokens: z
      .object({
        color: z.record(themeTokenNameSchema, themeColorValueSchema),
        font: z.record(themeTokenNameSchema, themeFontValueSchema),
        image: z.record(themeTokenNameSchema, themeImageValueSchema),
        number: z.record(themeTokenNameSchema, themeNumberValueSchema),
      })
      .strict(),
    typography: themeTypographySchema,
    version: z.number().int().positive(),
  })
  .strict();

const rangeShape = {
  maxZoom: zoomNumberSchema.optional(),
  minZoom: zoomNumberSchema.optional(),
  visible: z.boolean().optional(),
};
const backgroundStyleSchema = z
  .object({
    ...rangeShape,
    color: colorValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: imageValueSchema.optional(),
  })
  .strict();
const fillStyleSchema = z
  .object({
    ...rangeShape,
    antialias: z.boolean().optional(),
    color: colorValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: imageValueSchema.optional(),
    translate: numberOffsetValueSchema.optional(),
    translateAnchor: z.enum(['map', 'viewport']).optional(),
  })
  .strict();
const lineStyleSchema = z
  .object({
    ...rangeShape,
    blur: numberValueSchema.optional(),
    cap: lineCapValueSchema.optional(),
    color: colorValueSchema.optional(),
    dash: numberArrayValueSchema.optional(),
    gapWidth: numberValueSchema.optional(),
    join: lineJoinValueSchema.optional(),
    miterLimit: numberValueSchema.optional(),
    offset: numberValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: imageValueSchema.optional(),
    roundLimit: numberValueSchema.optional(),
    translate: numberOffsetValueSchema.optional(),
    translateAnchor: z.enum(['map', 'viewport']).optional(),
    width: numberValueSchema.optional(),
  })
  .strict();
const textStyleSchema = z
  .object({
    ...rangeShape,
    allowOverlap: z.boolean().optional(),
    anchor: z
      .enum([
        'bottom',
        'bottom-left',
        'bottom-right',
        'center',
        'left',
        'right',
        'top',
        'top-left',
        'top-right',
      ])
      .optional(),
    color: colorValueSchema.optional(),
    fallbacks: moduleFontFallbacksSchema.optional(),
    field: stringValueSchema.optional(),
    font: moduleFontValueSchema.optional(),
    haloBlur: numberValueSchema.optional(),
    haloColor: colorValueSchema.optional(),
    haloWidth: numberValueSchema.optional(),
    ignorePlacement: z.boolean().optional(),
    justify: z.enum(['auto', 'center', 'left', 'right']).optional(),
    keepUpright: z.boolean().optional(),
    letterSpacing: numberValueSchema.optional(),
    lineHeight: numberValueSchema.optional(),
    maxAngle: numberValueSchema.optional(),
    maxWidth: numberValueSchema.optional(),
    offset: numberOffsetValueSchema.optional(),
    optional: z.boolean().optional(),
    opacity: numberValueSchema.optional(),
    padding: numberValueSchema.optional(),
    pitchAlignment: z.enum(['auto', 'map', 'viewport']).optional(),
    radialOffset: numberValueSchema.optional(),
    rotate: numberValueSchema.optional(),
    rotationAlignment: z.enum(['auto', 'map', 'viewport']).optional(),
    size: numberValueSchema.optional(),
    transform: z.enum(['lowercase', 'none', 'uppercase']).optional(),
    variableAnchors: z
      .array(
        z.enum([
          'bottom',
          'bottom-left',
          'bottom-right',
          'center',
          'left',
          'right',
          'top',
          'top-left',
          'top-right',
        ]),
      )
      .min(1)
      .optional(),
  })
  .strict();
const iconStyleSchema = z
  .object({
    ...rangeShape,
    allowOverlap: z.boolean().optional(),
    anchor: z
      .enum([
        'bottom',
        'bottom-left',
        'bottom-right',
        'center',
        'left',
        'right',
        'top',
        'top-left',
        'top-right',
      ])
      .optional(),
    color: colorValueSchema.optional(),
    haloBlur: numberValueSchema.optional(),
    haloColor: colorValueSchema.optional(),
    haloWidth: numberValueSchema.optional(),
    ignorePlacement: z.boolean().optional(),
    image: imageValueSchema.optional(),
    offset: numberOffsetValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    keepUpright: z.boolean().optional(),
    optional: z.boolean().optional(),
    padding: numberValueSchema.optional(),
    pitchAlignment: z.enum(['auto', 'map', 'viewport']).optional(),
    rotate: numberValueSchema.optional(),
    rotationAlignment: z.enum(['auto', 'map', 'viewport']).optional(),
    size: numberValueSchema.optional(),
    textFit: z.enum(['both', 'height', 'none', 'width']).optional(),
    textFitPadding: numberInsetsValueSchema.optional(),
  })
  .strict();

const symbolPlacementShape = {
  ...rangeShape,
  placement: z.enum(['line', 'line-center', 'point']).optional(),
  priority: structuralNumberValueSchema.optional(),
  priorityOrder: z.enum(['higher-first', 'lower-first']).optional(),
  spacing: numberValueSchema.optional(),
  zOrder: z.enum(['auto', 'source', 'viewport-y']).optional(),
};
const circleStyleSchema = z
  .object({
    ...rangeShape,
    blur: numberValueSchema.optional(),
    color: colorValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pitchAlignment: z.enum(['map', 'viewport']).optional(),
    pitchScale: z.enum(['map', 'viewport']).optional(),
    priority: structuralNumberValueSchema.optional(),
    priorityOrder: z.enum(['higher-first', 'lower-first']).optional(),
    radius: numberValueSchema.optional(),
    strokeColor: colorValueSchema.optional(),
    strokeOpacity: numberValueSchema.optional(),
    strokeWidth: numberValueSchema.optional(),
    translate: numberOffsetValueSchema.optional(),
    translateAnchor: z.enum(['map', 'viewport']).optional(),
  })
  .strict();
const extrusionStyleSchema = z
  .object({
    ...rangeShape,
    base: numberValueSchema.optional(),
    color: colorValueSchema.optional(),
    height: numberValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: imageValueSchema.optional(),
    verticalGradient: z.boolean().optional(),
  })
  .strict();
const areaStyleSchema = z
  .object({fill: fillStyleSchema.optional(), outline: lineStyleSchema.optional()})
  .strict();
const lineStackStyleSchema = z
  .object({
    casing: lineStyleSchema.optional(),
    fill: lineStyleSchema.optional(),
    shadow: lineStyleSchema.optional(),
  })
  .strict();
const lineHatchStyleSchema = z
  .object({
    ...rangeShape,
    angle: numberValueSchema.optional(),
    color: colorValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: imageValueSchema.optional(),
    patternWidths: themeNumberArrayValueSchema.optional(),
    size: numberValueSchema.optional(),
    spacing: numberValueSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.patternWidths === undefined) return;
    const patternIsDeferredThemeValue =
      typeof value.pattern === 'object' &&
      value.pattern !== null &&
      ['theme-fixed', 'theme-token'].includes(String(value.pattern.kind));
    if (typeof value.pattern !== 'string' && !patternIsDeferredThemeValue) {
      context.addIssue({
        code: 'custom',
        message: 'patternWidths requires pattern to be a literal sprite-name prefix',
        path: ['pattern'],
      });
    }
    const authoredWidths = Array.isArray(value.patternWidths)
      ? value.patternWidths
      : value.patternWidths.value;
    const widths = authoredWidths.map((entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).kind === 'theme-fixed'
        ? (entry as Record<string, unknown>).value
        : entry,
    );
    if (widths.length < 2) {
      context.addIssue({
        code: 'custom',
        message: 'Expected at least two pattern widths',
        path: ['patternWidths'],
      });
    }
    for (let index = 0; index < widths.length; index += 1) {
      const width = widths[index];
      if (typeof width === 'number' && (!Number.isInteger(width) || width <= 0 || width > 1024)) {
        context.addIssue({
          code: 'custom',
          message: 'Expected an integer pattern width between 1 and 1024',
          path: ['patternWidths', index],
        });
      }
      if (
        index > 0 &&
        typeof width === 'number' &&
        typeof widths[index - 1] === 'number' &&
        width <= (widths[index - 1] as number)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'patternWidths must be strictly increasing',
          path: ['patternWidths', index],
        });
      }
    }
  });
const roadLayerStyleSchema = lineStackStyleSchema
  .extend({hatch: lineHatchStyleSchema.optional()})
  .strict();
const symbolStyleSchema = z
  .object({
    ...symbolPlacementShape,
    icon: iconStyleSchema.optional(),
    text: textStyleSchema.optional(),
  })
  .strict();
const markerSymbolStyleSchema = symbolStyleSchema
  .extend({marker: circleStyleSchema.optional()})
  .strict();
const poiCategoryStyleSchema = markerSymbolStyleSchema
  .omit({priority: true, priorityOrder: true})
  .strict();

const renderScalarSchema = z.union([z.boolean(), z.number().finite(), z.string()]);
const renderTargetSchema = z
  .string()
  .regex(tileflowSemanticTargetPattern, 'Expected a semantic target');
const renderStackOperationNameSchema = z
  .string()
  .regex(
    tileflowRenderStackOperationNamePattern,
    'Expected a lowercase-initial portable render-stack operation name without dots',
  );
const renderFieldNormalizationShape = {
  coerce: z.literal('number').optional(),
  fallback: renderScalarSchema.optional(),
  field: z.enum(tileflowSemanticFieldNames),
};
const renderSelectorNodeSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({kind: z.literal('literal'), value: z.boolean()}).strict(),
    z
      .object({kind: z.literal('geometry'), geometry: z.enum(tileflowRenderSelectorGeometries)})
      .strict(),
    z.object({kind: z.literal('has'), field: z.enum(tileflowSemanticFieldNames)}).strict(),
    z
      .object({
        ...renderFieldNormalizationShape,
        kind: z.literal('compare'),
        operator: z.enum(tileflowRenderSelectorComparisons),
        value: renderScalarSchema,
      })
      .strict(),
    z
      .object({
        ...renderFieldNormalizationShape,
        kind: z.literal('in'),
        values: z.array(renderScalarSchema).min(1).max(tileflowRenderStackLimits.maxScalarValues),
      })
      .strict(),
    z
      .object({
        ...renderFieldNormalizationShape,
        branches: z
          .array(
            z
              .object({
                result: z.boolean(),
                values: z
                  .array(renderScalarSchema)
                  .min(1)
                  .max(tileflowRenderStackLimits.maxScalarValues),
              })
              .strict(),
          )
          .min(1)
          .max(tileflowRenderStackLimits.maxMatchBranches),
        kind: z.literal('match'),
        otherwise: z.boolean(),
      })
      .strict(),
    z.object({kind: z.literal('not'), selector: renderSelectorNodeSchema}).strict(),
    z
      .object({
        kind: z.enum(['all', 'any']),
        selectors: z
          .array(renderSelectorNodeSchema)
          .min(1)
          .max(tileflowRenderStackLimits.maxSelectorChildren),
      })
      .strict(),
    z
      .object({
        fallback: renderSelectorNodeSchema,
        kind: z.literal('step'),
        stops: z
          .array(z.object({selector: renderSelectorNodeSchema, zoom: zoomNumberSchema}).strict())
          .min(1)
          .max(tileflowRenderStackLimits.maxStepStops),
      })
      .strict(),
  ]),
);
const renderSelectorSchema: z.ZodType = renderSelectorNodeSchema.superRefine(
  (selector, context) => {
    for (const issue of validateTileflowRenderSelectorConstraints(selector)) {
      context.addIssue({code: 'custom', message: issue.message, path: [...issue.path]});
    }
  },
);
const renderVisibilitySchema = z.object({visibilityGroup: z.literal('building').optional()});
const renderStyleSchemas = {
  background: backgroundStyleSchema.extend(renderVisibilitySchema.shape).strict(),
  circle: circleStyleSchema.extend(renderVisibilitySchema.shape).strict(),
  extrusion: extrusionStyleSchema.extend(renderVisibilitySchema.shape).strict(),
  fill: fillStyleSchema.extend(renderVisibilitySchema.shape).strict(),
  line: lineStyleSchema.extend(renderVisibilitySchema.shape).strict(),
  symbol: symbolStyleSchema.extend(renderVisibilitySchema.shape).strict(),
};
const renderRequirementsSchema = z
  .array(z.enum(tileflowLayerDomains))
  .min(1)
  .max(tileflowRenderStackLimits.maxRequirements)
  .superRefine((requirements, context) => {
    const seen = new Set<string>();
    for (const [index, requirement] of requirements.entries()) {
      if (seen.has(requirement)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate render-stack requirement ${requirement}`,
          path: [index],
        });
      }
      seen.add(requirement);
    }
  });
const vectorRenderPassSchemas = tileflowRenderStackRenderers
  .filter((renderer) => renderer !== 'background')
  .map((renderer) =>
    z
      .object({
        attachTo: renderTargetSchema,
        feature: z.enum(tileflowSemanticLayerNames).optional(),
        kind: z.literal('render-pass'),
        phase: z.enum(tileflowRenderStackPhases),
        renderer: z.literal(renderer),
        requirements: renderRequirementsSchema.optional(),
        selector: renderSelectorSchema.optional(),
        style: renderStyleSchemas[renderer],
      })
      .strict(),
  );
const renderPassSchema = z.discriminatedUnion('renderer', [
  z
    .object({
      attachTo: renderTargetSchema,
      kind: z.literal('render-pass'),
      phase: z.enum(tileflowRenderStackPhases),
      renderer: z.literal('background'),
      requirements: renderRequirementsSchema.optional(),
      style: renderStyleSchemas.background,
    })
    .strict(),
  ...vectorRenderPassSchemas,
]);
const renderRefinementSchemas = tileflowRenderStackRenderers.map((renderer) =>
  z
    .object({
      kind: z.literal('refine-render-target'),
      requirements: renderRequirementsSchema.optional(),
      renderer: z.literal(renderer),
      ...(renderer === 'background' ? {} : {selector: renderSelectorSchema.optional()}),
      style: renderStyleSchemas[renderer],
      target: renderTargetSchema,
    })
    .strict(),
);
const renderStackOperationSchema = z.union([renderPassSchema, ...renderRefinementSchemas]);
const renderStackSchema = z
  .record(renderStackOperationNameSchema, renderStackOperationSchema)
  .superRefine((stack, context) => {
    const size = Object.keys(stack).length;
    if (size === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A render stack requires at least one named operation',
      });
    }
    if (size > tileflowRenderStackLimits.maxOperations) {
      context.addIssue({
        code: 'custom',
        message: `A render stack may contain at most ${tileflowRenderStackLimits.maxOperations} named operations`,
      });
    }
  })
  .describe('tileflow-render-stack');

const roadClassSchema = z.enum(tileflowRoadClasses);
const roadClassStyleSchema = z
  .object({
    enabled: z.boolean().optional(),
    bridge: roadLayerStyleSchema.optional(),
    surface: roadLayerStyleSchema.optional(),
    tunnel: roadLayerStyleSchema.optional(),
  })
  .strict();
const roadStructureMapSchema = z
  .object({
    bridge: roadLayerStyleSchema.optional(),
    surface: roadLayerStyleSchema.optional(),
    tunnel: roadLayerStyleSchema.optional(),
  })
  .strict();
const roadTreatmentLayerStyleSchema = z
  .object({
    casing: lineStyleSchema
      .pick({
        blur: true,
        color: true,
        dash: true,
        gapWidth: true,
        offset: true,
        opacity: true,
        width: true,
      })
      .optional(),
    fill: lineStyleSchema
      .pick({
        blur: true,
        color: true,
        dash: true,
        gapWidth: true,
        offset: true,
        opacity: true,
        width: true,
      })
      .optional(),
    shadow: lineStyleSchema
      .pick({
        blur: true,
        color: true,
        dash: true,
        gapWidth: true,
        offset: true,
        opacity: true,
        width: true,
      })
      .optional(),
  })
  .strict();
const roadTreatmentStyleSchema = z
  .object({
    bridge: roadTreatmentLayerStyleSchema.optional(),
    enabled: z.boolean().optional(),
    surface: roadTreatmentLayerStyleSchema.optional(),
    tunnel: roadTreatmentLayerStyleSchema.optional(),
    widthScale: themeNumberValueSchema.optional(),
  })
  .strict();

const landModuleSchema = z
  .object({
    type: z.literal('land'),
    background: backgroundStyleSchema.optional(),
    enabled: z.boolean().optional(),
    globalLandcover: fillStyleSchema.optional(),
    landcover: z
      .object({
        farmland: areaStyleSchema.optional(),
        flowerbed: areaStyleSchema.optional(),
        grass: areaStyleSchema.optional(),
        ice: areaStyleSchema.optional(),
        meadow: areaStyleSchema.optional(),
        protected: areaStyleSchema.optional(),
        recreationGround: areaStyleSchema.optional(),
        rock: areaStyleSchema.optional(),
        sand: areaStyleSchema.optional(),
        scrub: areaStyleSchema.optional(),
        urbanPark: areaStyleSchema.optional(),
        villageGreen: areaStyleSchema.optional(),
        wetland: areaStyleSchema.optional(),
        wood: areaStyleSchema.optional(),
      })
      .strict()
      .optional(),
    landuse: z
      .object({
        cemetery: areaStyleSchema.optional(),
        civic: areaStyleSchema.optional(),
        commercial: areaStyleSchema.optional(),
        education: areaStyleSchema.optional(),
        government: areaStyleSchema.optional(),
        industrial: areaStyleSchema.optional(),
        medical: areaStyleSchema.optional(),
        military: areaStyleSchema.optional(),
        parking: areaStyleSchema.optional(),
        railway: areaStyleSchema.optional(),
        recreation: areaStyleSchema.optional(),
        residential: areaStyleSchema.optional(),
      })
      .strict()
      .optional(),
    renderStack: renderStackSchema.optional(),
  })
  .strict();
const waterModuleSchema = z
  .object({
    type: z.literal('water'),
    bathymetry: fillStyleSchema.optional(),
    bathymetryContours: lineStyleSchema.optional(),
    bathymetryLabels: symbolStyleSchema.optional(),
    bodies: areaStyleSchema.optional(),
    enabled: z.boolean().optional(),
    intermittent: z
      .object({bodies: areaStyleSchema.optional(), waterways: lineStyleSchema.optional()})
      .strict()
      .optional(),
    renderStack: renderStackSchema.optional(),
    waterways: z
      .object({
        canal: lineStyleSchema.optional(),
        other: lineStyleSchema.optional(),
        river: lineStyleSchema.optional(),
        stream: lineStyleSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const buildingsModuleSchema = z
  .object({
    type: z.literal('buildings'),
    businessCorridor: areaStyleSchema.optional(),
    enabled: z.boolean().optional(),
    extrusion: extrusionStyleSchema.optional(),
    flat: areaStyleSchema.optional(),
    mode: z.enum(['3d', 'flat']).optional(),
    renderStack: renderStackSchema.optional(),
  })
  .strict();
const addressesModuleSchema = z
  .object({
    type: z.literal('addresses'),
    enabled: z.boolean().optional(),
    labels: symbolStyleSchema.optional(),
    renderStack: renderStackSchema.optional(),
  })
  .strict();
const landformClassSchema = z.enum(tileflowLandformClasses);
const landformsModuleSchema = z
  .object({
    type: z.literal('landforms'),
    classes: z.partialRecord(landformClassSchema, symbolStyleSchema).optional(),
    elevation: z.boolean().optional(),
    enabled: z.boolean().optional(),
    renderStack: renderStackSchema.optional(),
  })
  .strict();
const boundariesModuleSchema = z
  .object({
    type: z.literal('boundaries'),
    admin2: lineStyleSchema.optional(),
    admin4: lineStyleSchema.optional(),
    disputed: lineStyleSchema.optional(),
    enabled: z.boolean().optional(),
    maritime: lineStyleSchema.optional(),
    renderStack: renderStackSchema.optional(),
  })
  .strict();
const aerowaysModuleSchema = z
  .object({
    type: z.literal('aeroways'),
    area: areaStyleSchema.optional(),
    enabled: z.boolean().optional(),
    runway: lineStackStyleSchema.optional(),
    runwayRef: symbolStyleSchema.optional(),
    renderStack: renderStackSchema.optional(),
    taxiway: lineStackStyleSchema.optional(),
  })
  .strict();
const transitModuleSchema = z
  .object({
    type: z.literal('transit'),
    cableway: lineStyleSchema.optional(),
    enabled: z.boolean().optional(),
    ferry: lineStyleSchema.optional(),
    rail: z
      .object({
        bridge: lineStyleSchema.optional(),
        surface: lineStyleSchema.optional(),
        tunnel: lineStyleSchema.optional(),
      })
      .strict()
      .optional(),
    railHatching: z
      .object({
        bridge: lineStyleSchema.optional(),
        surface: lineStyleSchema.optional(),
        tunnel: lineStyleSchema.optional(),
      })
      .strict()
      .optional(),
    serviceRail: z
      .object({
        bridge: lineStyleSchema.optional(),
        surface: lineStyleSchema.optional(),
        tunnel: lineStyleSchema.optional(),
      })
      .strict()
      .optional(),
    renderStack: renderStackSchema.optional(),
  })
  .strict();
const roadsModuleSchema = z
  .object({
    type: z.literal('roads'),
    areas: z
      .object({
        pedestrian: areaStyleSchema.optional(),
        pier: areaStyleSchema.optional(),
        road: areaStyleSchema.optional(),
      })
      .strict()
      .optional(),
    classes: z.partialRecord(roadClassSchema, roadClassStyleSchema).optional(),
    crossings: iconStyleSchema.extend({image: imageValueSchema}).strict().optional(),
    detail: z.enum(['none', 'highways', 'major', 'streets', 'all']).optional(),
    enabled: z.boolean().optional(),
    extras: z.object({paths: z.boolean().optional()}).strict().optional(),
    hierarchy: z.enum(['subtle', 'clear', 'strong']).optional(),
    modifiers: z
      .object({
        construction: roadTreatmentStyleSchema.optional(),
        expressway: roadTreatmentStyleSchema.optional(),
        indoor: roadTreatmentStyleSchema.optional(),
        official: roadTreatmentStyleSchema.optional(),
        ramp: roadTreatmentStyleSchema.optional(),
        unpaved: roadTreatmentStyleSchema.optional(),
      })
      .strict()
      .optional(),
    mountainBike: z
      .object({
        '0': roadTreatmentStyleSchema.optional(),
        '0+': roadTreatmentStyleSchema.optional(),
        '1': roadTreatmentStyleSchema.optional(),
        '1+': roadTreatmentStyleSchema.optional(),
        '2': roadTreatmentStyleSchema.optional(),
        '2+': roadTreatmentStyleSchema.optional(),
        '3': roadTreatmentStyleSchema.optional(),
        '3+': roadTreatmentStyleSchema.optional(),
        '4': roadTreatmentStyleSchema.optional(),
        '5': roadTreatmentStyleSchema.optional(),
        '6': roadTreatmentStyleSchema.optional(),
      })
      .strict()
      .optional(),
    oneWayMarkers: z.boolean().optional(),
    outline: z.enum(['none', 'subtle', 'strong']).optional(),
    restrictions: z
      .object({
        access: roadTreatmentStyleSchema.optional(),
        bicycle: roadTreatmentStyleSchema.optional(),
        foot: roadTreatmentStyleSchema.optional(),
        horse: roadTreatmentStyleSchema.optional(),
        toll: roadTreatmentStyleSchema.optional(),
      })
      .strict()
      .optional(),
    renderStack: renderStackSchema.optional(),
    roundabouts: z
      .object({casing: circleStyleSchema.optional(), fill: circleStyleSchema.optional()})
      .strict()
      .optional(),
    serviceTypes: z
      .object({
        alley: roadTreatmentStyleSchema.optional(),
        crossover: roadTreatmentStyleSchema.optional(),
        driveway: roadTreatmentStyleSchema.optional(),
        parkingAisle: roadTreatmentStyleSchema.optional(),
        yard: roadTreatmentStyleSchema.optional(),
      })
      .strict()
      .optional(),
    sidewalks: z
      .object({
        outline: lineStyleSchema.optional(),
        pattern: fillStyleSchema.optional(),
        surface: fillStyleSchema.optional(),
      })
      .strict()
      .optional(),
    structures: roadStructureMapSchema.optional(),
    weight: z.enum(['thin', 'regular', 'bold']).optional(),
    widthScale: z.partialRecord(roadClassSchema, themeNumberValueSchema).optional(),
  })
  .strict();

const placeLabelStylesSchema = z
  .object({
    city: symbolStyleSchema.optional(),
    continent: symbolStyleSchema.optional(),
    country: symbolStyleSchema.optional(),
    neighborhood: symbolStyleSchema.optional(),
    other: symbolStyleSchema.optional(),
    state: symbolStyleSchema.optional(),
    town: symbolStyleSchema.optional(),
    village: symbolStyleSchema.optional(),
  })
  .strict();
const waterLabelStylesSchema = z
  .object({
    line: symbolStyleSchema.optional(),
    ocean: symbolStyleSchema.optional(),
    other: symbolStyleSchema.optional(),
    waterway: symbolStyleSchema.optional(),
  })
  .strict();
const labelsModuleSchema = z
  .object({
    type: z.literal('labels'),
    aerodromeCodes: z.enum(['none', 'iata', 'all']).optional(),
    enabled: z.boolean().optional(),
    junctions: z.boolean().optional(),
    language: z.string().trim().min(1).optional(),
    places: z.enum(['none', 'major', 'all']).optional(),
    roadClasses: z.array(roadClassSchema).min(1).optional(),
    renderStack: renderStackSchema.optional(),
    roads: z.enum(['none', 'highways', 'major', 'streets', 'all']).optional(),
    styles: z
      .object({
        aerodrome: symbolStyleSchema.optional(),
        junctions: symbolStyleSchema.optional(),
        places: placeLabelStylesSchema.optional(),
        roads: z.partialRecord(roadClassSchema, symbolStyleSchema).optional(),
        shields: z
          .object({
            default: symbolStyleSchema.optional(),
            detail: symbolStyleSchema.optional(),
            kinds: z
              .record(identifierSchema, z.object({image: themeImageValueSchema}).strict())
              .optional(),
            overview: symbolStyleSchema.optional(),
            textColors: z
              .record(identifierSchema, z.object({color: themeColorValueSchema}).strict())
              .optional(),
          })
          .strict()
          .optional(),
        water: waterLabelStylesSchema.optional(),
      })
      .strict()
      .optional(),
    shields: z.enum(['none', 'major', 'all']).optional(),
    water: z.enum(['none', 'major', 'all']).optional(),
  })
  .strict();
const poiModuleSchema = z
  .object({
    type: z.literal('poi'),
    categories: z.array(z.enum(tileflowPoiCategories)).optional(),
    color: z.enum(['uniform', 'category']).optional(),
    density: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .optional(),
    enabled: z.boolean().optional(),
    icons: z.boolean().optional(),
    labels: z.boolean().optional(),
    minZoom: zoomNumberSchema.optional(),
    placement: z
      .object({
        coupleIconAndLabel: z.boolean().optional(),
        iconPadding: z.number().finite().min(0).optional(),
        textPadding: z.number().finite().min(0).optional(),
      })
      .strict()
      .optional(),
    renderStack: renderStackSchema.optional(),
    styles: z.partialRecord(z.enum(tileflowPoiCategories), poiCategoryStyleSchema).optional(),
  })
  .strict();
const nauticalModuleSchema = z
  .object({
    type: z.literal('nautical'),
    aids: markerSymbolStyleSchema.optional(),
    coverage: areaStyleSchema.optional(),
    enabled: z.boolean().optional(),
    hazardAreas: areaStyleSchema.optional(),
    hazards: markerSymbolStyleSchema.optional(),
    labels: z
      .object({
        coverage: symbolStyleSchema.optional(),
        hazards: symbolStyleSchema.optional(),
        navigationAreas: symbolStyleSchema.optional(),
        reefs: symbolStyleSchema.optional(),
        wrecks: symbolStyleSchema.optional(),
      })
      .strict()
      .optional(),
    lighthouses: markerSymbolStyleSchema.optional(),
    lights: markerSymbolStyleSchema.optional(),
    navigationAreas: areaStyleSchema.optional(),
    reefs: areaStyleSchema.optional(),
    renderStack: renderStackSchema.optional(),
    soundings: markerSymbolStyleSchema.optional(),
    wreckAreas: areaStyleSchema.optional(),
    wrecks: markerSymbolStyleSchema.optional(),
  })
  .strict();

const modulesSchema = z
  .object({
    addresses: addressesModuleSchema.optional(),
    aeroways: aerowaysModuleSchema.optional(),
    boundaries: boundariesModuleSchema.optional(),
    buildings: buildingsModuleSchema.optional(),
    labels: labelsModuleSchema.optional(),
    land: landModuleSchema.optional(),
    landforms: landformsModuleSchema.optional(),
    nautical: nauticalModuleSchema.optional(),
    poi: poiModuleSchema.optional(),
    roads: roadsModuleSchema.optional(),
    transit: transitModuleSchema.optional(),
    vegetation: z
      .object({
        type: z.literal('vegetation'),
        enabled: z.boolean().optional(),
        flat: circleStyleSchema.optional(),
        minZoom: zoomNumberSchema.optional(),
        mode: z.enum(['3d', 'flat']).optional(),
        renderStack: renderStackSchema.optional(),
        threeDimensional: z
          .object({
            barkColor: themeColorValueSchema.optional(),
            broadleafColors: z.array(themeColorValueSchema).min(1).max(8).optional(),
            coniferColors: z.array(themeColorValueSchema).min(1).max(8).optional(),
            crownScale: z
              .union([
                z.number().finite().positive().max(10),
                themeNumberReferenceSchema,
                z
                  .object({
                    kind: z.literal('theme-fixed'),
                    reason: z.string().trim().min(1),
                    value: z.number().finite().positive().max(10),
                  })
                  .strict(),
              ])
              .optional(),
            heightScale: z
              .union([
                z.number().finite().positive().max(10),
                themeNumberReferenceSchema,
                z
                  .object({
                    kind: z.literal('theme-fixed'),
                    reason: z.string().trim().min(1),
                    value: z.number().finite().positive().max(10),
                  })
                  .strict(),
              ])
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    water: waterModuleSchema.optional(),
  })
  .strict();

const layerBindingsSchema = z
  .object({
    aerodromeLabel: z.string().trim().min(1),
    aeroway: z.string().trim().min(1),
    boundary: z.string().trim().min(1),
    building: z.string().trim().min(1),
    bathymetry: z.string().trim().min(1).optional(),
    businessCorridor: z.string().trim().min(1).optional(),
    circularFeature: z.string().trim().min(1).optional(),
    globalLandcover: z.string().trim().min(1).optional(),
    houseNumber: z.string().trim().min(1),
    landcover: z.string().trim().min(1),
    landuse: z.string().trim().min(1),
    mountainPeak: z.string().trim().min(1),
    park: z.string().trim().min(1),
    place: z.string().trim().min(1),
    poi: z.string().trim().min(1),
    road: z.string().trim().min(1),
    roadName: z.string().trim().min(1),
    roadShield: z.string().trim().min(1).optional(),
    sidewalk: z.string().trim().min(1).optional(),
    streetFurniture: z.string().trim().min(1).optional(),
    tree: z.string().trim().min(1).optional(),
    water: z.string().trim().min(1),
    waterName: z.string().trim().min(1),
    waterway: z.string().trim().min(1),
  })
  .strict();
const fieldBindingsSchema = z
  .object({
    access: z.string().trim().min(1),
    activityScore: z.string().trim().min(1),
    adminLevel: z.string().trim().min(1),
    bicycle: z.string().trim().min(1),
    bathymetryMinDepth: z.string().trim().min(1).optional(),
    bathymetrySortKey: z.string().trim().min(1).optional(),
    brunnel: z.string().trim().min(1),
    buildingKind: z.string().trim().min(1),
    buildingTone: z.string().trim().min(1),
    capital: z.string().trim().min(1),
    circularClearanceExtraAtZoom15: z.string().trim().min(1).optional(),
    circularKind: z.string().trim().min(1).optional(),
    circularRadiusAtZoom15: z.string().trim().min(1).optional(),
    circularRadiusMeters: z.string().trim().min(1).optional(),
    circularInnerRadiusMeters: z.string().trim().min(1).optional(),
    circularOuterRadiusMeters: z.string().trim().min(1).optional(),
    class: z.string().trim().min(1),
    crossing: z.string().trim().min(1),
    classificationConfidence: z.string().trim().min(1),
    confidence: z.string().trim().min(1),
    circumference: z.string().trim().min(1),
    diameterCrown: z.string().trim().min(1),
    disputed: z.string().trim().min(1),
    direction: z.string().trim().min(1).optional(),
    elevation: z.string().trim().min(1),
    elevationFeet: z.string().trim().min(1),
    expressway: z.string().trim().min(1),
    foot: z.string().trim().min(1),
    height: z.string().trim().min(1),
    hasBusiness: z.string().trim().min(1),
    hasParts: z.string().trim().min(1).optional(),
    hide3d: z.string().trim().min(1),
    horse: z.string().trim().min(1),
    houseNumber: z.string().trim().min(1),
    importanceTier: z.string().trim().min(1).optional(),
    iata: z.string().trim().min(1),
    icao: z.string().trim().min(1),
    indoor: z.string().trim().min(1),
    intermittent: z.string().trim().min(1),
    genus: z.string().trim().min(1),
    layer: z.string().trim().min(1),
    leafCycle: z.string().trim().min(1),
    leafType: z.string().trim().min(1),
    level: z.string().trim().min(1),
    maritime: z.string().trim().min(1),
    markings: z.string().trim().min(1),
    minHeight: z.string().trim().min(1),
    minZoom: z.string().trim().min(1),
    mtbScale: z.string().trim().min(1),
    name: z.string().trim().min(1),
    nameEnglish: z.string().trim().min(1),
    nameLatin: z.string().trim().min(1),
    network: z.string().trim().min(1),
    official: z.string().trim().min(1),
    oneway: z.string().trim().min(1),
    poiCategory: z.string().trim().min(1),
    poiFilterRank: z.string().trim().min(1),
    poiIcon: z.string().trim().min(1),
    poiSizeRank: z.string().trim().min(1),
    poiType: z.string().trim().min(1),
    ramp: z.string().trim().min(1),
    rank: z.string().trim().min(1),
    ref: z.string().trim().min(1),
    refLength: z.string().trim().min(1),
    renderHeight: z.string().trim().min(1),
    renderMinZoom: z.string().trim().min(1),
    renderMinHeight: z.string().trim().min(1),
    shieldKind: z.string().trim().min(1).optional(),
    shieldLineLengthMeters: z.string().trim().min(1).optional(),
    shieldNetwork: z.string().trim().min(1).optional(),
    shieldRank: z.string().trim().min(1).optional(),
    shieldText: z.string().trim().min(1).optional(),
    shieldTextColor: z.string().trim().min(1).optional(),
    service: z.string().trim().min(1),
    species: z.string().trim().min(1),
    speciesWikidata: z.string().trim().min(1),
    subclass: z.string().trim().min(1),
    surface: z.string().trim().min(1),
    toll: z.string().trim().min(1),
  })
  .strict();
const openMapTilesSchema = z
  .object({
    type: z.literal('openmaptiles'),
    contractVersion: z.literal(openMapTilesContractVersion),
    fields: fieldBindingsSchema.partial().optional(),
    layers: layerBindingsSchema.partial().optional(),
    semantics: z
      .object({parkLayer: z.enum(['mixed', 'protected-only']).optional()})
      .strict()
      .optional(),
  })
  .strict()
  .transform((schema) =>
    openMapTiles({
      capabilities:
        schema.layers === undefined
          ? undefined
          : {
              businessCorridor: schema.layers.businessCorridor !== undefined,
              bathymetry: schema.layers.bathymetry !== undefined,
              globalLandcover: schema.layers.globalLandcover !== undefined,
              tree: schema.layers.tree !== undefined,
            },
      fields: schema.fields,
      layers: schema.layers,
      semantics: schema.semantics,
    }),
  );
const vectorDataShape = {
  type: z.literal('vector-tiles'),
  attribution: z.string().trim().min(1),
  revision: revisionSchema.optional(),
  schema: openMapTilesSchema,
};
const publicVectorUrlSchema = z
  .string()
  .min(1)
  .max(4_096)
  .superRefine((value, context) => {
    try {
      validatePublicVectorUrl(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid Tileflow vector tile URL.',
      });
    }
  })
  .describe('tileflow-public-vector-url');
const marineSourceSchema = z
  .object({
    attribution: z
      .string()
      .min(1)
      .max(2_048)
      .refine((value) => value === value.trim())
      .optional(),
    sourceId: identifierSchema.optional(),
    url: publicVectorUrlSchema.optional(),
  })
  .strict();
const bathymetryDemUrlSchema = publicVectorUrlSchema
  .refine(
    (value) => !value.startsWith('pmtiles://'),
    'Expected an HTTPS, loopback HTTP, or root-relative DEM TileJSON URL',
  )
  .describe('tileflow-public-dem-url');
const bathymetryReliefSchema = z
  .object({
    accentColor: terrainColorValueSchema.optional(),
    attribution: z
      .string()
      .min(1)
      .max(2_048)
      .refine((value) => value === value.trim())
      .optional(),
    encoding: z.enum(['mapbox', 'terrarium']).optional(),
    exaggeration: terrainNumberValueSchema(z.number().finite().min(0).max(1)).optional(),
    highlightColor: terrainColorValueSchema.optional(),
    illuminationAltitude: terrainNumberValueSchema(z.number().finite().min(0).max(90)).optional(),
    illuminationAnchor: z.enum(['map', 'viewport']).optional(),
    illuminationDirection: terrainNumberValueSchema(z.number().finite().min(0).max(359)).optional(),
    maxZoom: zoomNumberSchema.optional(),
    minZoom: zoomNumberSchema.optional(),
    multidirectional: z.boolean().optional(),
    opacity: terrainNumberValueSchema(z.number().finite().min(0).max(1)).optional(),
    shadowColor: terrainColorValueSchema.optional(),
    sourceId: identifierSchema.optional(),
    tileSize: z.union([z.literal(256), z.literal(512)]).optional(),
    url: bathymetryDemUrlSchema.optional(),
    visible: z.boolean().optional(),
  })
  .strict()
  .superRefine((relief, context) => {
    if (
      relief.minZoom !== undefined &&
      relief.maxZoom !== undefined &&
      relief.minZoom > relief.maxZoom
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Expected maxZoom to be greater than or equal to minZoom',
        path: ['maxZoom'],
      });
    }
  });
const bathymetryConfigSchema = z
  .object({
    ...marineSourceSchema.shape,
    bands: z.union([z.literal(false), fillStyleSchema]).optional(),
    contours: z.union([z.literal(false), lineStyleSchema]).optional(),
    display: z.enum(['bands', 'relief', 'hybrid']).optional(),
    labels: z.union([z.literal(false), symbolStyleSchema]).optional(),
    relief: z.union([z.literal(false), bathymetryReliefSchema]).optional(),
    type: z.literal('bathymetry'),
  })
  .strict();
const marineSchema = z.union([
  z.enum(['none', 'bathymetry', 'nautical', 'chart']),
  z
    .object({
      bathymetry: z
        .union([z.literal(false), marineSourceSchema, bathymetryConfigSchema])
        .optional(),
      nautical: z.union([z.literal(false), marineSourceSchema]).optional(),
    })
    .strict(),
]);
const directVectorDataSchema = z
  .object({
    ...vectorDataShape,
    bounds: z
      .tuple([
        z.number().finite().min(-180).max(180),
        z.number().finite().min(-90).max(90),
        z.number().finite().min(-180).max(180),
        z.number().finite().min(-90).max(90),
      ])
      .optional(),
    maxzoom: z.number().int().min(0).max(30).optional(),
    minzoom: z.number().int().min(0).max(30).optional(),
    tiles: z.array(publicVectorUrlSchema).min(1).max(8),
  })
  .strict()
  .refine(
    (value) =>
      value.minzoom === undefined || value.maxzoom === undefined || value.minzoom <= value.maxzoom,
    {message: 'minzoom must not exceed maxzoom', path: ['minzoom']},
  )
  .refine(
    (value) =>
      value.bounds === undefined ||
      (value.bounds[0] < value.bounds[2] && value.bounds[1] < value.bounds[3]),
    {message: 'bounds must have increasing axes', path: ['bounds']},
  );
const dataSchema = z.union([
  z
    .object({
      type: z.literal('tileflow-world'),
      generation: z.literal(tileflowWorldGeneration),
      selection: z.discriminatedUnion('kind', [
        z.object({kind: z.literal('current'), product: z.literal('world-v1')}).strict(),
        z
          .object({
            kind: z.literal('release'),
            product: z.literal('world-v1'),
            release: z
              .object({
                descriptorSha256: z.string().regex(/^[0-9a-f]{64}$/u),
                releaseId: tileflowWorldReleaseIdSchema,
              })
              .strict(),
          })
          .strict(),
      ]),
    })
    .strict(),
  z.object({...vectorDataShape, url: publicVectorUrlSchema}).strict(),
  directVectorDataSchema,
]);
const localAssetDirectorySchema = z
  .string()
  .min(3)
  .max(tileflowLocalDirectoryMaximumLength)
  .refine(isTileflowLocalDirectory, {message: tileflowLocalDirectoryMessage});
const packageAssetDirectorySchema = z
  .object({
    kind: z.literal('package-directory'),
    package: z
      .string()
      .regex(
        /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u,
        'Expected a lowercase npm package name',
      ),
    path: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          value
            .split('/')
            .every((segment) => Boolean(segment) && segment !== '.' && segment !== '..'),
        'Expected a portable package-relative directory',
      ),
  })
  .strict();
const assetDirectorySchema = z.union([localAssetDirectorySchema, packageAssetDirectorySchema]);
const iconDirectoriesSchema = z.array(assetDirectorySchema).max(32);
const fontDirectoriesSchema = z.array(assetDirectorySchema).max(16);
const fontStacksSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          value === value.trim() && value === value.normalize('NFC') && !/[\p{Cc}\\/]/u.test(value),
        'Expected an exact NFC MapLibre font-stack key without whitespace padding, controls, slashes, or backslashes',
      ),
  )
  .min(1)
  .max(64)
  .superRefine((fontStacks, context) => {
    const seen = new Set<string>();
    for (const [index, fontStack] of fontStacks.entries()) {
      if (seen.has(fontStack)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate exact font stack "${fontStack}"`,
          path: [index],
        });
      }
      seen.add(fontStack);
    }
  });
const glyphsSchema = z
  .object({
    fontStacks: fontStacksSchema,
    kind: z.literal('url'),
    url: z
      .string()
      .min(1)
      .refine(
        (value) => value.includes('{fontstack}') && value.includes('{range}'),
        'Expected {fontstack} and {range} placeholders',
      )
      .refine(isSafeGlyphUrl, 'Expected an HTTP(S), root-relative, or path-relative glyph URL'),
  })
  .strict();
const terrainLayerRangeShape = {
  maxZoom: zoomNumberSchema.optional(),
  minZoom: zoomNumberSchema.optional(),
  visible: z.boolean().optional(),
};
const terrainHillshadeSchema = z
  .object({
    ...terrainLayerRangeShape,
    accentColor: terrainColorValueSchema.optional(),
    exaggeration: terrainNumberValueSchema(z.number().finite().min(0).max(1)).optional(),
    highlightColor: terrainColorValueSchema.optional(),
    illuminationAnchor: z.enum(['map', 'viewport']).optional(),
    illuminationDirection: terrainNumberValueSchema(z.number().finite().min(0).max(359)).optional(),
    shadowColor: terrainColorValueSchema.optional(),
  })
  .strict();
const terrainContourLineSchema = z
  .object({
    ...terrainLayerRangeShape,
    color: terrainColorValueSchema.optional(),
    opacity: terrainNumberValueSchema(z.number().finite().min(0).max(1)).optional(),
    width: terrainNumberValueSchema(z.number().finite().min(0).max(32)).optional(),
  })
  .strict();
const terrainContourLabelSchema = z
  .object({
    ...terrainLayerRangeShape,
    color: terrainColorValueSchema.optional(),
    font: moduleFontValueSchema.optional(),
    haloColor: terrainColorValueSchema.optional(),
    haloWidth: terrainNumberValueSchema(z.number().finite().min(0).max(16)).optional(),
    opacity: terrainNumberValueSchema(z.number().finite().min(0).max(1)).optional(),
    size: terrainNumberValueSchema(z.number().finite().min(1).max(64)).optional(),
    spacing: terrainNumberValueSchema(z.number().finite().min(1).max(1000)).optional(),
  })
  .strict();
const terrainContourThresholdPairSchema = z
  .tuple([z.number().finite().min(0.001).max(100_000), z.number().finite().min(0.001).max(100_000)])
  .refine(([minor, index]) => minor <= index, {
    message:
      'Expected the index contour interval to be greater than or equal to the minor interval',
  })
  .refine(([minor, index]) => isWholeContourMultiple(index, minor), {
    message: 'Expected the index contour interval to be a whole multiple of the minor interval',
  });

function isWholeContourMultiple(value: number, interval: number): boolean {
  const ratio = value / interval;
  return Math.abs(ratio - Math.round(ratio)) <= Number.EPSILON * Math.max(1, ratio) * 8;
}

const terrainContourThresholdsSchema = z
  .record(z.string().regex(/^(?:0|[1-9]|1\d|2[0-4])$/u), terrainContourThresholdPairSchema)
  .superRefine((thresholds, context) => {
    const count = Object.keys(thresholds).length;
    if (count === 0 || count > 25) {
      context.addIssue({
        code: 'custom',
        message: 'Expected between 1 and 25 contour threshold zoom entries',
      });
    }
  });
const terrainContoursSchema = z
  .object({
    demMaxZoom: z.number().int().min(0).max(24),
    demUrl: z
      .string()
      .min(1)
      .max(2048)
      .refine(
        isSafeTileflowDemUrlTemplate,
        'Expected a safe HTTP(S) DEM URL template containing {z}, {x}, and {y}',
      ),
    index: terrainContourLineSchema.optional(),
    labels: terrainContourLabelSchema.optional(),
    maxZoom: z.number().int().min(0).max(24).optional(),
    minZoom: zoomNumberSchema.optional(),
    minor: terrainContourLineSchema.optional(),
    multiplier: z.number().finite().min(0.001).max(100).optional(),
    overzoom: z.number().int().min(0).max(8).optional(),
    sourceId: identifierSchema.optional(),
    thresholds: terrainContourThresholdsSchema,
  })
  .strict()
  .superRefine((contours, context) => {
    const thresholdZooms = Object.keys(contours.thresholds).map(Number);
    const minimumThresholdZoom = Math.min(...thresholdZooms);
    const maximumThresholdZoom = Math.max(...thresholdZooms);
    const multiplier = contours.multiplier ?? 1;
    for (const [zoom, [minor]] of Object.entries(contours.thresholds)) {
      if (!isTileflowContourDensityWithinBudget(minor, multiplier, Number(zoom))) {
        context.addIssue({
          code: 'custom',
          message: 'Expected a contour interval within the supported density budget',
          path: ['thresholds', zoom, 0],
        });
      }
    }
    if (contours.maxZoom !== undefined && contours.maxZoom < maximumThresholdZoom) {
      context.addIssue({
        code: 'custom',
        message: 'Expected maxZoom to include every contour threshold zoom',
        path: ['maxZoom'],
      });
    }
    if (contours.minZoom !== undefined && contours.minZoom < minimumThresholdZoom) {
      context.addIssue({
        code: 'custom',
        message: 'Expected minZoom not to precede the first contour threshold zoom',
        path: ['minZoom'],
      });
    }
    if (
      contours.minZoom !== undefined &&
      contours.minZoom > (contours.maxZoom ?? maximumThresholdZoom)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Expected maxZoom to be greater than or equal to minZoom',
        path: ['maxZoom'],
      });
    }
    if (contours.overzoom !== undefined && contours.overzoom > minimumThresholdZoom) {
      context.addIssue({
        code: 'custom',
        message: 'Expected overzoom not to produce a negative DEM zoom',
        path: ['overzoom'],
      });
    }
    const effectiveMinimumZoom = contours.minZoom ?? minimumThresholdZoom;
    for (const layerName of ['minor', 'index', 'labels'] as const) {
      const layer = contours[layerName];
      if (layer?.minZoom !== undefined && layer.minZoom < effectiveMinimumZoom) {
        context.addIssue({
          code: 'custom',
          message: 'Expected minZoom not to precede the contour source minZoom',
          path: [layerName, 'minZoom'],
        });
      }
      if (
        layer?.maxZoom !== undefined &&
        Math.max(layer.minZoom ?? effectiveMinimumZoom, effectiveMinimumZoom) > layer.maxZoom
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Expected maxZoom to be greater than or equal to the effective minZoom',
          path: [layerName, 'maxZoom'],
        });
      }
    }
  });
const terrainSchema = z.union([
  z.enum(['none', 'hillshade', '3d']),
  z
    .object({
      attribution: z.string().optional(),
      contours: terrainContoursSchema.optional(),
      encoding: z.enum(['mapbox', 'terrarium']).optional(),
      exaggeration: z.number().finite().min(0).max(10).optional(),
      hillshade: terrainHillshadeSchema.optional(),
      mode: z.enum(['none', 'hillshade', '3d']).optional(),
      sourceId: z.string().trim().min(1).optional(),
      url: z.string().trim().min(1).optional(),
    })
    .strict(),
]);
const viewSchema = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    center: z
      .tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
      .optional(),
    pitch: z.number().finite().min(0).max(85).optional(),
    zoom: zoomNumberSchema.optional(),
  })
  .strict();
const hostingOriginSchema = z
  .string()
  .min(1)
  .max(253)
  .refine(isHttpOrigin, 'Expected an HTTP(S) origin without path, credentials, query, or fragment');
const allowedOriginsSchema = z.array(hostingOriginSchema).max(20);
const deliverySchema = z
  .object({
    hosted: z
      .object({
        allowedOrigins: allowedOriginsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const themesSchema = z
  .record(tileflowThemeNameSchema, tileflowThemeSchema)
  .superRefine((themes, context) => {
    const names = Object.keys(themes);
    if (names.length === 0) {
      context.addIssue({code: 'custom', message: 'Expected at least one named theme'});
    }
    if (names.length > tileflowThemeLimits.maxThemes) {
      context.addIssue({
        code: 'too_big',
        maximum: tileflowThemeLimits.maxThemes,
        origin: 'object',
      });
    }
    for (const [name, theme] of Object.entries(themes)) {
      try {
        resolveTileflowTheme(theme as TileflowTheme);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
          path: [name],
        });
      }
    }
  })
  .describe('tileflow-themes');
const systemThemesSchema = z
  .object({dark: tileflowThemeNameSchema, light: tileflowThemeNameSchema})
  .strict();

export const resolvedTileflowMapSchema: z.ZodType<TileflowCompilerConfig> = z
  .object({
    data: dataSchema.optional(),
    defaultTheme: tileflowThemeNameSchema,
    delivery: deliverySchema.optional(),
    fonts: fontDirectoriesSchema.optional(),
    glyphs: glyphsSchema.optional(),
    icons: iconDirectoriesSchema.optional(),
    id: tileflowMapIdSchema,
    marine: marineSchema.optional(),
    modules: modulesSchema.optional(),
    name: z.string().trim().min(1),
    projection: z.enum(['globe', 'mercator']).optional(),
    systemThemes: systemThemesSchema.optional(),
    terrain: terrainSchema.optional(),
    themes: themesSchema,
    version: z.number().int().positive(),
    view: viewSchema.optional(),
  })
  .strict()
  .superRefine((map, context) => {
    if (map.fonts !== undefined && map.glyphs !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Expected either fonts or glyphs, not both',
        path: ['fonts'],
      });
    }
    if (!Object.hasOwn(map.themes, map.defaultTheme)) {
      context.addIssue({
        code: 'custom',
        message: `Expected an existing theme name; available themes: ${Object.keys(map.themes).sort().join(', ')}`,
        path: ['defaultTheme'],
      });
    }
    const themeEntries = Object.entries(map.themes).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const baseline = themeEntries[0];
    if (baseline) {
      for (const [name, theme] of themeEntries.slice(1)) {
        for (const category of tileflowThemeTokenCategories) {
          const expected = Object.keys(baseline[1].tokens[category]).sort();
          const actual = Object.keys(theme.tokens[category]).sort();
          if (expected.join('\0') !== actual.join('\0')) {
            const missing = expected.filter((token) => !actual.includes(token));
            const extra = actual.filter((token) => !expected.includes(token));
            context.addIssue({
              code: 'custom',
              message:
                `Expected the same ${category} token schema as theme "${baseline[0]}"` +
                `${missing.length ? `; missing: ${missing.join(', ')}` : ''}` +
                `${extra.length ? `; extra: ${extra.join(', ')}` : ''}`,
              path: ['themes', name, 'tokens', category],
            });
          }
        }
      }
    }
    for (const scheme of ['light', 'dark'] as const) {
      const name = map.systemThemes?.[scheme];
      if (name !== undefined && !Object.hasOwn(map.themes, name)) {
        context.addIssue({
          code: 'custom',
          message: `Expected an existing theme name for ${scheme}`,
          path: ['systemThemes', scheme],
        });
      } else if (name !== undefined && map.themes[name]?.colorScheme !== scheme) {
        context.addIssue({
          code: 'custom',
          message: `Expected ${scheme} theme, received ${map.themes[name]?.colorScheme}`,
          path: ['systemThemes', scheme],
        });
      }
    }
    validateZoomRanges(map, context);
  }) as z.ZodType<TileflowCompilerConfig>;

export function parseResolvedTileflowMap(input: unknown): TileflowCompilerConfig {
  return parseOrThrow(resolvedTileflowMapSchema, input, 'resolved map') as TileflowCompilerConfig;
}

function parseOrThrow(schema: z.ZodType, input: unknown, name: string): unknown {
  const unsafe = findUnsafeObjectStructure(input);
  if (unsafe) {
    throw new TileflowResolvedMapValidationError(name, [
      {
        level: 'error',
        path: unsafe.path.join('.') || name,
        message: 'Expected no inherited properties or prototype-mutating keys',
      },
    ]);
  }
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new TileflowResolvedMapValidationError(
    name,
    validationMessagesFromIssues(result.error.issues),
  );
}

function validationMessagesFromIssues(issues: z.core.$ZodIssue[]): ValidationMessage[] {
  return issues.flatMap((issue) => {
    const basePath = issue.path.join('.');
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        level: 'error' as const,
        path: [basePath, key].filter(Boolean).join('.'),
        message: `Unrecognized key: "${key}"`,
      }));
    }
    return [{level: 'error', path: basePath || 'config', message: issue.message}];
  });
}

function isSafeGlyphUrl(value: string): boolean {
  if (value.startsWith('//') || value.includes('#') || /[\\\p{Cc}]/u.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      value === url.origin
    );
  } catch {
    return false;
  }
}

function validateZoomRanges(
  value: unknown,
  context: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.minZoom === 'number' &&
      typeof record.maxZoom === 'number' &&
      record.minZoom > record.maxZoom
    ) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'maxZoom'],
        message: 'Expected maxZoom to be greater than or equal to minZoom',
      });
    }
  }
  for (const [key, child] of Object.entries(value)) {
    validateZoomRanges(child, context, [...path, key]);
  }
}

function findUnsafeObjectStructure(
  input: unknown,
): {path: Array<string | number>; reason: 'key' | 'prototype'} | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const pending: Array<{path: Array<string | number>; value: object}> = [{path: [], value: input}];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    if (!Array.isArray(current.value)) {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null)
        return {path: current.path, reason: 'prototype'};
    }
    for (const key of Object.keys(current.value)) {
      const path = [...current.path, Array.isArray(current.value) ? Number(key) : key];
      if (key === '__proto__') return {path, reason: 'key'};
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (
        descriptor &&
        'value' in descriptor &&
        descriptor.value &&
        typeof descriptor.value === 'object'
      )
        pending.push({path, value: descriptor.value});
    }
  }
  return undefined;
}
