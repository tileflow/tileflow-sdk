import {z} from 'zod';
import {tileflowStreetsBasemapVersion} from './basemaps';
import {tileflowCaptureSceneNameSchema, tileflowCaptureSceneSchema} from './capture-scene';
import {openMapTiles, openMapTilesContractVersion} from './data';
import type {TileflowConfig, TileflowProjectConfig} from './project';
import type {ValidationMessage, ValidationResult} from './types';

const identifierSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, 'Expected letters, numbers, underscores, or hyphens')
  .refine((value) => value !== '__proto__', 'Expected a safe identifier');
const revisionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'Expected a portable data revision');
const zoomNumberSchema = z.number().finite().min(0).max(24);
const expressionSchema = z
  .object({kind: z.literal('expression'), value: z.array(z.unknown()).min(1)})
  .strict();
const zoomValueSchema = z
  .object({
    kind: z.literal('zoom'),
    interpolation: z.enum(['linear', 'exponential', 'step']),
    base: z.number().finite().positive().optional(),
    stops: z.array(z.tuple([zoomNumberSchema, z.unknown()])).min(1),
  })
  .strict();
const filterSchema = z
  .object({kind: z.literal('filter'), value: z.array(z.unknown()).min(1)})
  .strict();
const valueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  expressionSchema,
  zoomValueSchema,
]);
const numberValueSchema = z.union([z.number().finite(), expressionSchema, zoomValueSchema]);
const stringValueSchema = z.union([z.string(), expressionSchema, zoomValueSchema]);
const numberArrayValueSchema = z.union([
  z.array(z.number().finite()),
  expressionSchema,
  zoomValueSchema,
]);

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'Expected a hex color like #F6F7F3 or #F6F7F3FF',
  });

function colorGroupSchema<const TKey extends string>(keys: readonly TKey[]) {
  return z
    .object(
      Object.fromEntries(keys.map((key) => [key, hexColorSchema.optional()])) as Record<
        TKey,
        z.ZodOptional<typeof hexColorSchema>
      >,
    )
    .strict();
}

const themeModulesSchema = z
  .object({
    boundaries: colorGroupSchema(['admin', 'disputed', 'major', 'maritime']).optional(),
    buildings: colorGroupSchema([
      'extrusion',
      'fill',
      'highRise',
      'highRiseOutline',
      'lowRise',
      'lowRiseOutline',
      'outline',
    ]).optional(),
    hydro: colorGroupSchema(['ferry', 'label', 'water', 'waterway']).optional(),
    labels: colorGroupSchema([
      'country',
      'halo',
      'muted',
      'neighborhood',
      'poi',
      'primary',
      'road',
      'settlement',
      'water',
    ]).optional(),
    landcover: colorGroupSchema(['grass', 'ice', 'park', 'protected', 'sand', 'wood']).optional(),
    landuse: colorGroupSchema([
      'cemetery',
      'civic',
      'commercial',
      'industrial',
      'residential',
    ]).optional(),
    poi: colorGroupSchema([
      'coffee',
      'culture',
      'education',
      'food',
      'halo',
      'health',
      'icon',
      'label',
      'lodging',
      'services',
      'shopping',
      'transit',
    ]).optional(),
    roads: colorGroupSchema([
      'bridge',
      'casing',
      'ferry',
      'minor',
      'motorway',
      'path',
      'primary',
      'rail',
      'secondary',
      'trunk',
      'tunnel',
    ]).optional(),
  })
  .strict();

const typographyStyleSchema = z
  .object({
    font: z.string().trim().min(1).optional(),
    weight: z.enum(['regular', 'medium', 'semibold', 'bold']).optional(),
  })
  .strict();
const typographySchema = typographyStyleSchema.extend({
  places: typographyStyleSchema.optional(),
  poi: typographyStyleSchema.optional(),
  roads: typographyStyleSchema.optional(),
  water: typographyStyleSchema.optional(),
});
const themeColorSchema = z
  .object({
    background: hexColorSchema.optional(),
    boundary: hexColorSchema.optional(),
    building: hexColorSchema.optional(),
    land: hexColorSchema.optional(),
    park: hexColorSchema.optional(),
    road: hexColorSchema.optional(),
    roadCasing: hexColorSchema.optional(),
    roadMajor: hexColorSchema.optional(),
    text: hexColorSchema.optional(),
    textHalo: hexColorSchema.optional(),
    textMuted: hexColorSchema.optional(),
    water: hexColorSchema.optional(),
  })
  .strict();
export const tileflowThemeSchema = z
  .object({
    colors: themeColorSchema.optional(),
    extends: z.string().trim().min(1).optional(),
    mode: z.enum(['light', 'dark']).optional(),
    modules: themeModulesSchema.optional(),
    typography: typographySchema.optional(),
  })
  .strict();

const rangeShape = {
  filter: filterSchema.optional(),
  maxZoom: zoomNumberSchema.optional(),
  minZoom: zoomNumberSchema.optional(),
  visible: z.boolean().optional(),
};
const fillStyleSchema = z
  .object({
    ...rangeShape,
    color: stringValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    outlineColor: stringValueSchema.optional(),
    pattern: stringValueSchema.optional(),
  })
  .strict();
const lineStyleSchema = z
  .object({
    ...rangeShape,
    blur: numberValueSchema.optional(),
    cap: z.enum(['butt', 'round', 'square']).optional(),
    color: stringValueSchema.optional(),
    dash: numberArrayValueSchema.optional(),
    gapWidth: numberValueSchema.optional(),
    join: z.enum(['bevel', 'miter', 'round']).optional(),
    offset: numberValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: stringValueSchema.optional(),
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
    color: stringValueSchema.optional(),
    field: stringValueSchema.optional(),
    font: z.array(z.string().trim().min(1)).min(1).optional(),
    haloBlur: numberValueSchema.optional(),
    haloColor: stringValueSchema.optional(),
    haloWidth: numberValueSchema.optional(),
    ignorePlacement: z.boolean().optional(),
    letterSpacing: numberValueSchema.optional(),
    lineHeight: numberValueSchema.optional(),
    maxWidth: numberValueSchema.optional(),
    offset: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    optional: z.boolean().optional(),
    padding: numberValueSchema.optional(),
    placement: z.enum(['line', 'line-center', 'point']).optional(),
    priority: numberValueSchema.optional(),
    rotate: numberValueSchema.optional(),
    size: numberValueSchema.optional(),
    spacing: numberValueSchema.optional(),
    transform: z.enum(['lowercase', 'none', 'uppercase']).optional(),
  })
  .strict();
const iconStyleSchema = z
  .object({
    ...rangeShape,
    allowOverlap: z.boolean().optional(),
    ignorePlacement: z.boolean().optional(),
    image: stringValueSchema.optional(),
    offset: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    opacity: numberValueSchema.optional(),
    optional: z.boolean().optional(),
    padding: numberValueSchema.optional(),
    rotate: numberValueSchema.optional(),
    size: numberValueSchema.optional(),
  })
  .strict();

const roadClassSchema = z.enum([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'path',
]);
const roadLayerStyleSchema = z
  .object({
    casing: lineStyleSchema.optional(),
    fill: lineStyleSchema.optional(),
    shadow: lineStyleSchema.optional(),
  })
  .strict();
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

const landModuleSchema = z
  .object({
    type: z.literal('land'),
    background: fillStyleSchema.optional(),
    enabled: z.boolean().optional(),
    landcover: z
      .object({
        farmland: fillStyleSchema.optional(),
        grass: fillStyleSchema.optional(),
        ice: fillStyleSchema.optional(),
        park: fillStyleSchema.optional(),
        protected: fillStyleSchema.optional(),
        sand: fillStyleSchema.optional(),
        scrub: fillStyleSchema.optional(),
        wood: fillStyleSchema.optional(),
      })
      .strict()
      .optional(),
    landuse: z
      .object({
        cemetery: fillStyleSchema.optional(),
        civic: fillStyleSchema.optional(),
        commercial: fillStyleSchema.optional(),
        industrial: fillStyleSchema.optional(),
        railway: fillStyleSchema.optional(),
        residential: fillStyleSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const waterModuleSchema = z
  .object({
    type: z.literal('water'),
    bodies: fillStyleSchema.optional(),
    enabled: z.boolean().optional(),
    intermittent: z
      .object({bodies: fillStyleSchema.optional(), waterways: lineStyleSchema.optional()})
      .strict()
      .optional(),
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
    enabled: z.boolean().optional(),
    extrusion: fillStyleSchema
      .extend({base: numberValueSchema.optional(), height: numberValueSchema.optional()})
      .optional(),
    fill: fillStyleSchema.optional(),
    mode: z.enum(['3d', 'flat']).optional(),
    outline: lineStyleSchema.optional(),
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
  })
  .strict();
const aerowaysModuleSchema = z
  .object({
    type: z.literal('aeroways'),
    area: fillStyleSchema.optional(),
    enabled: z.boolean().optional(),
    runway: z
      .object({casing: lineStyleSchema.optional(), fill: lineStyleSchema.optional()})
      .strict()
      .optional(),
    taxiway: z
      .object({casing: lineStyleSchema.optional(), fill: lineStyleSchema.optional()})
      .strict()
      .optional(),
  })
  .strict();
const transitModuleSchema = z
  .object({
    type: z.literal('transit'),
    cableway: lineStyleSchema.optional(),
    enabled: z.boolean().optional(),
    ferry: lineStyleSchema.optional(),
    rail: lineStyleSchema.optional(),
    railHatching: lineStyleSchema.optional(),
    serviceRail: lineStyleSchema.optional(),
  })
  .strict();
const roadsModuleSchema = z
  .object({
    type: z.literal('roads'),
    areas: z
      .object({
        pier: fillStyleSchema.optional(),
        pierLine: lineStyleSchema.optional(),
        road: fillStyleSchema.optional(),
      })
      .strict()
      .optional(),
    classes: z.partialRecord(roadClassSchema, roadClassStyleSchema).optional(),
    detail: z.enum(['none', 'highways', 'major', 'streets', 'all']).optional(),
    enabled: z.boolean().optional(),
    extras: z.object({paths: z.boolean().optional()}).strict().optional(),
    hierarchy: z.enum(['subtle', 'clear', 'strong']).optional(),
    oneWayMarkers: z.boolean().optional(),
    outline: z.enum(['none', 'subtle', 'strong']).optional(),
    structures: roadStructureMapSchema.optional(),
    weight: z.enum(['thin', 'regular', 'bold']).optional(),
    widthScale: z.partialRecord(roadClassSchema, z.number().finite().positive()).optional(),
  })
  .strict();

const placeLabelStylesSchema = z
  .object({
    city: textStyleSchema.optional(),
    continent: textStyleSchema.optional(),
    country: textStyleSchema.optional(),
    neighborhood: textStyleSchema.optional(),
    other: textStyleSchema.optional(),
    state: textStyleSchema.optional(),
    town: textStyleSchema.optional(),
    village: textStyleSchema.optional(),
  })
  .strict();
const waterLabelStylesSchema = z
  .object({
    line: textStyleSchema.optional(),
    ocean: textStyleSchema.optional(),
    other: textStyleSchema.optional(),
    waterway: textStyleSchema.optional(),
  })
  .strict();
const labelsModuleSchema = z
  .object({
    type: z.literal('labels'),
    enabled: z.boolean().optional(),
    language: z.string().trim().min(1).optional(),
    places: z.enum(['none', 'major', 'all']).optional(),
    roadClasses: z.array(roadClassSchema).min(1).optional(),
    roads: z.enum(['none', 'highways', 'major', 'streets', 'all']).optional(),
    styles: z
      .object({
        aerodrome: textStyleSchema.optional(),
        places: placeLabelStylesSchema.optional(),
        roads: z.partialRecord(roadClassSchema, textStyleSchema).optional(),
        shields: textStyleSchema.optional(),
        water: waterLabelStylesSchema.optional(),
      })
      .strict()
      .optional(),
    water: z.enum(['none', 'major', 'all']).optional(),
  })
  .strict();
const poiModuleSchema = z
  .object({
    type: z.literal('poi'),
    categories: z.array(identifierSchema).optional(),
    classMapping: z.record(identifierSchema, z.array(identifierSchema).min(1)).optional(),
    color: z.enum(['uniform', 'category']).optional(),
    density: z.enum(['sparse', 'balanced', 'dense']).optional(),
    enabled: z.boolean().optional(),
    icons: z.union([z.boolean(), z.enum(['essential', 'full'])]).optional(),
    labels: z.enum(['none', 'minimal', 'balanced', 'full']).optional(),
    minZoom: zoomNumberSchema.optional(),
    placement: z
      .object({
        coupleIconAndLabel: z.boolean().optional(),
        iconPadding: z.number().finite().min(0).optional(),
        textPadding: z.number().finite().min(0).optional(),
      })
      .strict()
      .optional(),
    preset: z.enum(['none', 'minimal', 'balanced', 'full']).optional(),
    styles: z
      .record(
        identifierSchema,
        z.object({icon: iconStyleSchema.optional(), text: textStyleSchema.optional()}).strict(),
      )
      .optional(),
  })
  .strict();

const modulesSchema = z
  .object({
    aeroways: aerowaysModuleSchema.optional(),
    boundaries: boundariesModuleSchema.optional(),
    buildings: buildingsModuleSchema.optional(),
    labels: labelsModuleSchema.optional(),
    land: landModuleSchema.optional(),
    poi: poiModuleSchema.optional(),
    roads: roadsModuleSchema.optional(),
    transit: transitModuleSchema.optional(),
    water: waterModuleSchema.optional(),
  })
  .strict();

const layerBindingsSchema = z
  .object({
    aerodromeLabel: z.string().trim().min(1),
    aeroway: z.string().trim().min(1),
    boundary: z.string().trim().min(1),
    building: z.string().trim().min(1),
    landcover: z.string().trim().min(1),
    landuse: z.string().trim().min(1),
    park: z.string().trim().min(1),
    place: z.string().trim().min(1),
    poi: z.string().trim().min(1),
    road: z.string().trim().min(1),
    roadName: z.string().trim().min(1),
    water: z.string().trim().min(1),
    waterName: z.string().trim().min(1),
    waterway: z.string().trim().min(1),
  })
  .strict();
const fieldBindingsSchema = z
  .object({
    adminLevel: z.string().trim().min(1),
    brunnel: z.string().trim().min(1),
    class: z.string().trim().min(1),
    disputed: z.string().trim().min(1),
    height: z.string().trim().min(1),
    hide3d: z.string().trim().min(1),
    intermittent: z.string().trim().min(1),
    minHeight: z.string().trim().min(1),
    name: z.string().trim().min(1),
    nameEnglish: z.string().trim().min(1),
    nameLatin: z.string().trim().min(1),
    oneway: z.string().trim().min(1),
    rank: z.string().trim().min(1),
    ref: z.string().trim().min(1),
    renderHeight: z.string().trim().min(1),
    renderMinHeight: z.string().trim().min(1),
    service: z.string().trim().min(1),
    subclass: z.string().trim().min(1),
  })
  .strict();
const openMapTilesSchema = z
  .object({
    type: z.literal('openmaptiles'),
    contractVersion: z.literal(openMapTilesContractVersion),
    fields: fieldBindingsSchema.partial().optional(),
    layers: layerBindingsSchema.partial().optional(),
  })
  .strict()
  .transform((schema) => openMapTiles({fields: schema.fields, layers: schema.layers}));
const dataSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('tileflow-world'), revision: revisionSchema.optional()}).strict(),
  z
    .object({
      type: z.literal('vector-tiles'),
      attribution: z.string().trim().min(1),
      revision: revisionSchema.optional(),
      schema: openMapTilesSchema,
      url: z.string().trim().min(1),
    })
    .strict(),
]);
const basemapSchema = z
  .object({
    type: z.literal('streets'),
    basemapVersion: z.literal(tileflowStreetsBasemapVersion),
    variant: z.enum(['dark', 'light']),
  })
  .strict();
const placementSchema = z.union([
  z.object({before: z.string().trim().min(1)}).strict(),
  z.object({after: z.string().trim().min(1)}).strict(),
]);
const rawOverrideSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('patch'),
      id: z.string().trim().min(1),
      patch: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({kind: z.literal('remove'), id: z.string().trim().min(1)}).strict(),
  z
    .object({kind: z.literal('move'), id: z.string().trim().min(1), placement: placementSchema})
    .strict(),
  z
    .object({
      kind: z.literal('add'),
      layer: z
        .record(z.string(), z.unknown())
        .and(z.object({id: z.string().trim().min(1), type: z.string().trim().min(1)})),
      placement: placementSchema,
    })
    .strict(),
]);
const iconSetSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      extends: z.string().trim().min(1).optional(),
      mapping: z.record(identifierSchema, z.string().trim().min(1)).optional(),
      source: z.string().trim().min(1).optional(),
      sprite: z.string().trim().min(1).optional(),
    })
    .strict(),
]);
const terrainSchema = z.union([
  z.enum(['none', 'hillshade', '3d']),
  z
    .object({
      attribution: z.string().optional(),
      encoding: z.enum(['mapbox', 'terrarium']).optional(),
      exaggeration: z.number().finite().min(0).max(10).optional(),
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
    zoom: zoomNumberSchema.optional(),
  })
  .strict();
const streetsThemeSchema = tileflowThemeSchema;

export const tileflowMapSchema = z
  .object({
    allowedOrigins: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
    basemap: basemapSchema,
    data: dataSchema.optional(),
    glyphs: z.string().trim().min(1).optional(),
    icons: iconSetSchema.optional(),
    modules: modulesSchema.optional(),
    name: z.string().trim().min(1).optional(),
    overrides: z.array(rawOverrideSchema).optional(),
    sprite: z.string().trim().min(1).optional(),
    terrain: terrainSchema.optional(),
    theme: z.union([z.string().trim().min(1), streetsThemeSchema]).optional(),
    view: viewSchema.optional(),
  })
  .strict();
export const configSchema = tileflowMapSchema;

const scenesSchema = z
  .record(tileflowCaptureSceneNameSchema, tileflowCaptureSceneSchema)
  .superRefine((scenes, context) => {
    const namesByCaseFold = new Map<string, string>();
    for (const name of Object.keys(scenes).sort()) {
      const folded = name.toLowerCase();
      const existing = namesByCaseFold.get(folded);
      if (existing) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `Expected a portable scene name distinct from "${existing}" on case-insensitive filesystems`,
        });
      } else namesByCaseFold.set(folded, name);
    }
  });
export const tileflowProjectSchema = z
  .object({
    icons: z.record(identifierSchema, iconSetSchema).optional(),
    maps: z
      .record(identifierSchema, tileflowMapSchema)
      .refine((maps) => Object.keys(maps).length > 0, 'Expected at least one map'),
    scenes: scenesSchema.optional(),
    themes: z.record(identifierSchema, streetsThemeSchema).optional(),
  })
  .strict();

export function parseTileflowMap(input: unknown): TileflowConfig {
  const map = parseOrThrow(tileflowMapSchema, input, 'config') as TileflowConfig;
  const messages = validateMapReferences(map, undefined, 'theme');
  if (messages.length)
    throw new Error(messages.map((item) => `${item.path}: ${item.message}`).join('; '));
  return map;
}

export function parseTileflowProject(input: unknown): TileflowProjectConfig {
  const project = parseOrThrow(tileflowProjectSchema, input, 'config') as TileflowProjectConfig;
  const messages = validateReferences(project);
  if (messages.length)
    throw new Error(messages.map((item) => `${item.path}: ${item.message}`).join('; '));
  return project;
}

export function validateConfig(input: unknown): ValidationResult {
  const unsafe = findUnsafeObjectStructure(input);
  if (unsafe) {
    return {
      valid: false,
      messages: [
        {
          level: 'error',
          path: unsafe.path.join('.') || 'config',
          message:
            unsafe.reason === 'key'
              ? 'Expected no prototype-mutating keys'
              : 'Expected plain configuration objects',
        },
      ],
    };
  }
  const projectLike = isRecord(input) && Object.hasOwn(input, 'maps');
  const result = (projectLike ? tileflowProjectSchema : tileflowMapSchema).safeParse(input);
  if (!result.success) {
    return {
      valid: false,
      messages: validationMessagesFromIssues(result.error.issues),
    };
  }
  if (projectLike) {
    const messages = validateReferences(result.data as TileflowProjectConfig);
    return {valid: messages.length === 0, messages};
  }
  return {valid: true, messages: []};
}

export const validateTileflowConfig = validateConfig;

function parseOrThrow(schema: z.ZodType, input: unknown, name: string): unknown {
  const unsafe = findUnsafeObjectStructure(input);
  if (unsafe)
    throw new Error(
      `Invalid Tileflow ${name}. ${unsafe.path.join('.') || name}: Expected no inherited properties or prototype-mutating keys`,
    );
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(
    `Invalid Tileflow ${name}. ${validationMessagesFromIssues(result.error.issues)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ')}`,
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

function validateReferences(project: TileflowProjectConfig): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  const themes = new Set(Object.keys(project.themes ?? {}));
  messages.push(...validateThemeReferences(project, themes));
  messages.push(...validateIconReferences(project));
  for (const [mapName, map] of Object.entries(project.maps)) {
    messages.push(...validateMapReferences(map, themes, `maps.${mapName}.theme`));
  }
  for (const [sceneName, scene] of Object.entries(project.scenes ?? {})) {
    if (!Object.hasOwn(project.maps, scene.map)) {
      messages.push({
        level: 'error',
        path: `scenes.${sceneName}.map`,
        message: `Unknown Tileflow map "${scene.map}"`,
      });
    }
  }
  return messages;
}

const builtInThemes = new Set(['dark', 'light', 'minimal', 'standard']);

function validateMapReferences(
  map: TileflowConfig,
  projectThemes: Set<string> | undefined,
  path: string,
): ValidationMessage[] {
  const theme = map.theme;
  if (!theme) return [];
  const reference = typeof theme === 'string' ? theme : theme.extends;
  if (!reference || builtInThemes.has(reference) || projectThemes?.has(reference)) return [];
  return [
    {
      level: 'error',
      path: typeof theme === 'string' ? path : `${path}.extends`,
      message: `Unknown Tileflow theme "${reference}"`,
    },
  ];
}

function validateThemeReferences(
  project: TileflowProjectConfig,
  names: Set<string>,
): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  for (const [name, theme] of Object.entries(project.themes ?? {})) {
    if (theme.extends && !builtInThemes.has(theme.extends) && !names.has(theme.extends)) {
      messages.push({
        level: 'error',
        path: `themes.${name}.extends`,
        message: `Unknown Tileflow theme "${theme.extends}"`,
      });
    }
    const cycle = findReferenceCycle(name, project.themes ?? {}, (value) => value.extends);
    if (cycle) {
      messages.push({
        level: 'error',
        path: `themes.${name}.extends`,
        message: `Circular Tileflow theme extends: ${cycle.join(' -> ')}`,
      });
    }
  }
  return messages;
}

function validateIconReferences(project: TileflowProjectConfig): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  const iconSets = project.icons ?? {};
  const reference = (value: unknown) =>
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && !Array.isArray(value)
        ? (value as {extends?: string}).extends
        : undefined;
  for (const [name, iconSet] of Object.entries(iconSets)) {
    const extended = reference(iconSet);
    if (extended && !Object.hasOwn(iconSets, extended)) {
      messages.push({
        level: 'error',
        path: typeof iconSet === 'string' ? `icons.${name}` : `icons.${name}.extends`,
        message: `Unknown Tileflow icon set "${extended}"`,
      });
    }
    const cycle = findReferenceCycle(name, iconSets, reference);
    if (cycle) {
      messages.push({
        level: 'error',
        path: typeof iconSet === 'string' ? `icons.${name}` : `icons.${name}.extends`,
        message: `Circular Tileflow icon set extends: ${cycle.join(' -> ')}`,
      });
    }
  }
  for (const [mapName, map] of Object.entries(project.maps)) {
    if (!map.icons || typeof map.icons === 'string') continue;
    const extended = map.icons.extends;
    if (extended && !Object.hasOwn(iconSets, extended)) {
      messages.push({
        level: 'error',
        path: `maps.${mapName}.icons.extends`,
        message: `Unknown Tileflow icon set "${extended}"`,
      });
    }
  }
  return messages;
}

function findReferenceCycle<T>(
  start: string,
  records: Record<string, T>,
  next: (value: T) => string | undefined,
): string[] | undefined {
  const path: string[] = [];
  let current: string | undefined = start;
  while (current && Object.hasOwn(records, current)) {
    if (path.includes(current)) return [...path, current];
    path.push(current);
    current = next(records[current]!);
  }
  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
