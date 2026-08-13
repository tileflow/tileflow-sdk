import {z} from 'zod';
import {tileflowCaptureSceneNameSchema, tileflowCaptureSceneSchema} from './capture-scene';
import type {
  TileflowConfig,
  TileflowProjectConfig,
  ValidationMessage,
  ValidationResult,
} from './compiler';

const legacyThemeNames = new Set(['standard', 'light', 'dark', 'minimal', 'osm-bright-2']);
const prototypeSafeInputSchema = z.unknown().superRefine((value, context) => {
  const unsafe = findUnsafeObjectStructure(value);

  if (unsafe) {
    context.addIssue({
      code: 'custom',
      message:
        unsafe.reason === 'key'
          ? 'Expected an object without prototype-mutating keys'
          : 'Expected plain configuration objects without inherited properties',
      path: unsafe.path,
    });
  }
});
const identifierSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, {
    message: 'Expected letters, numbers, underscores, or hyphens',
  })
  .refine((value) => value !== '__proto__', {
    message: 'Expected an identifier that cannot mutate an object prototype',
  });
const sourceVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, {
  message: 'Expected a portable source version',
});

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'Expected a hex color like #F6F7F3 or #F6F7F3FF',
  });

type ColorGroupShape<TKey extends string> = {
  [TName in TKey]: z.ZodOptional<typeof hexColorSchema>;
};

function colorGroupSchema<const TKeys extends readonly string[]>(keys: TKeys) {
  const shape = Object.fromEntries(
    keys.map((key) => [key, hexColorSchema.optional()]),
  ) as ColorGroupShape<TKeys[number]>;

  return z.object(shape).strict();
}

const colorConfigSchema = z
  .object({
    accent: hexColorSchema.optional(),
    background: hexColorSchema.optional(),
    boundary: hexColorSchema.optional(),
    building: hexColorSchema.optional(),
    canvas: hexColorSchema.optional(),
    greenspace: hexColorSchema.optional(),
    land: hexColorSchema.optional(),
    nature: hexColorSchema.optional(),
    park: hexColorSchema.optional(),
    road: hexColorSchema.optional(),
    roadCasing: hexColorSchema.optional(),
    roadMajor: hexColorSchema.optional(),
    text: hexColorSchema.optional(),
    textHalo: hexColorSchema.optional(),
    textMuted: hexColorSchema.optional(),
    water: hexColorSchema.optional(),
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

const styleLayerOverrideSchema = z
  .object({
    before: z.string().min(1).optional(),
    filter: z.unknown().optional(),
    layout: z.record(z.string(), z.unknown()).optional(),
    maxzoom: z.number().finite().min(0).max(24).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    minzoom: z.number().finite().min(0).max(24).optional(),
    paint: z.record(z.string(), z.unknown()).optional(),
    source: z.string().min(1).optional(),
    'source-layer': z.string().min(1).optional(),
    type: z.string().min(1).optional(),
  })
  .catchall(z.unknown());

const typographyStyleSchema = z
  .object({
    font: z.string().trim().min(1).optional(),
    fontFamily: z.string().trim().min(1).optional(),
    weight: z.enum(['regular', 'medium', 'semibold', 'bold']).optional(),
  })
  .strict();

const typographySchema = typographyStyleSchema.extend({
  places: typographyStyleSchema.optional(),
  poi: typographyStyleSchema.optional(),
  roads: typographyStyleSchema.optional(),
  water: typographyStyleSchema.optional(),
});

const fontsSchema = z
  .object({
    body: z.string().trim().min(1).optional(),
    labels: z.string().trim().min(1).optional(),
  })
  .strict();

export const tileflowThemeSchema = z
  .object({
    colors: colorConfigSchema.optional(),
    extends: z.string().trim().min(1).optional(),
    fonts: fontsSchema.optional(),
    layers: z.record(z.string(), styleLayerOverrideSchema).optional(),
    mode: z.enum(['light', 'dark']).optional(),
    modules: themeModulesSchema.optional(),
    typography: typographySchema.optional(),
  })
  .strict();

const themeConfigSchema = tileflowThemeSchema;

const sourceLayersSchema = z
  .object({
    landcover: z.string().optional(),
    landuse: z.string().optional(),
    park: z.string().optional(),
    water: z.string().optional(),
    waterName: z.string().optional(),
    waterway: z.string().optional(),
    road: z.string().optional(),
    roadName: z.string().optional(),
    building: z.string().optional(),
    boundary: z.string().optional(),
    place: z.string().optional(),
    poi: z.string().optional(),
  })
  .strict();

const basemapSchema = z
  .object({
    type: z.literal('osm'),
    attribution: z.string().optional(),
    glyphs: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
    sourceLayers: sourceLayersSchema.optional(),
    sprite: z.string().min(1).optional(),
    tileset: z.string().trim().min(1).optional(),
    url: z.url().optional(),
    version: sourceVersionSchema.optional(),
  })
  .strict();

const roadDetailSchema = z.enum(['none', 'highways', 'major', 'streets', 'all']);
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

const roadsModuleSchema = z
  .object({
    type: z.literal('roads'),
    detail: roadDetailSchema.optional(),
    extras: z
      .object({
        ferry: z.boolean().optional(),
        paths: z.boolean().optional(),
        rail: z.boolean().optional(),
      })
      .strict()
      .optional(),
    hierarchy: z.enum(['subtle', 'clear', 'strong']).optional(),
    oneWayMarkers: z.boolean().optional(),
    outline: z.enum(['none', 'subtle', 'strong']).optional(),
    weight: z.enum(['thin', 'regular', 'bold']).optional(),
    widthScale: z.partialRecord(roadClassSchema, z.number().finite().min(0.1).max(8)).optional(),
  })
  .strict();

const labelDetailSchema = z.enum(['none', 'major', 'all']);

const labelsModuleSchema = z
  .object({
    type: z.literal('labels'),
    language: z.string().trim().min(1).optional(),
    places: labelDetailSchema.optional(),
    roadClasses: z.array(roadClassSchema).min(1).max(9).optional(),
    roads: roadDetailSchema.optional(),
    water: labelDetailSchema.optional(),
  })
  .strict();

const poiModuleSchema = z
  .object({
    type: z.literal('poi'),
    categories: z.array(identifierSchema).optional(),
    classMapping: z.record(identifierSchema, z.array(identifierSchema).min(1).max(64)).optional(),
    color: z.enum(['uniform', 'category']).optional(),
    density: z.enum(['sparse', 'balanced', 'dense']).optional(),
    icons: z.union([z.boolean(), z.enum(['essential', 'full'])]).optional(),
    labels: z.enum(['none', 'minimal', 'balanced', 'full']).optional(),
    minZoom: z.number().finite().min(0).max(24).optional(),
    placement: z
      .object({
        coupleIconAndLabel: z.boolean().optional(),
        iconPadding: z.number().finite().min(0).max(64).optional(),
        textPadding: z.number().finite().min(0).max(64).optional(),
      })
      .strict()
      .optional(),
    preset: z.enum(['none', 'minimal', 'balanced', 'full']).optional(),
  })
  .strict();

const styleOverrideModuleSchema = z
  .object({
    type: z.literal('styleOverride'),
    layers: z.record(z.string(), styleLayerOverrideSchema).optional(),
    removeLayers: z.array(z.string().min(1)).optional(),
  })
  .strict();

const moduleSchema = z.discriminatedUnion('type', [
  labelsModuleSchema,
  poiModuleSchema,
  roadsModuleSchema,
  styleOverrideModuleSchema,
]);

const iconSetSchema: z.ZodType<unknown> = z.union([
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

const viewSchema = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    center: z
      .tuple([z.number().finite(), z.number().finite()])
      .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
        message: 'Expected center as [lng, lat] within world bounds',
      })
      .optional(),
    zoom: z.number().finite().min(0).max(24).optional(),
  })
  .strict();

const buildingStyleSchema = z
  .object({
    fillOpacity: z.number().finite().min(0).max(1).optional(),
    heightThreshold: z.number().finite().min(0).max(1000).optional(),
    outlineOpacity: z.number().finite().min(0).max(1).optional(),
    outlineWidth: z.number().finite().min(0).max(16).optional(),
  })
  .strict();

const terrainConfigSchema = z
  .object({
    attribution: z.string().optional(),
    encoding: z.enum(['mapbox', 'terrarium']).optional(),
    exaggeration: z.number().min(0).max(10).optional(),
    mode: z.enum(['none', 'hillshade', '3d']).optional(),
    sourceId: z.string().min(1).optional(),
    tileset: z.string().trim().min(1).optional(),
    url: z.url().optional(),
  })
  .strict();

const tilesSchema = z
  .object({
    sourceId: z.string().min(1).optional(),
    tileset: z.string().trim().min(1).optional(),
    url: z.url().optional(),
    attribution: z.string().optional(),
    sourceLayers: sourceLayersSchema.optional(),
    version: sourceVersionSchema.optional(),
  })
  .strict();

export const tileflowMapSchema = z
  .object({
    basemap: basemapSchema.optional(),
    name: z.string().min(1).optional(),
    tileset: z.string().trim().min(1).optional(),
    theme: z.union([z.string().trim().min(1), themeConfigSchema]).optional(),
    modules: z.array(moduleSchema).optional(),
    layers: z.record(z.string(), styleLayerOverrideSchema).optional(),
    colors: colorConfigSchema.optional(),
    typography: typographySchema.optional(),
    density: z.enum(['clean', 'balanced', 'dense']).optional(),
    roads: z.enum(['hidden', 'soft', 'standard', 'detailed']).optional(),
    labels: z.enum(['none', 'essential', 'balanced', 'full']).optional(),
    poi: z.enum(['none', 'minimal', 'balanced', 'full']).optional(),
    buildings: z.enum(['hidden', 'flat', '3d']).optional(),
    buildingStyle: buildingStyleSchema.optional(),
    terrain: z.union([z.enum(['none', 'hillshade', '3d']), terrainConfigSchema]).optional(),
    renderer: z.enum(['auto', 'osm-bright', 'generated']).optional(),
    glyphs: z.string().min(1).optional(),
    icons: iconSetSchema.optional(),
    sprite: z.string().min(1).optional(),
    tiles: tilesSchema.optional(),
    view: viewSchema.optional(),
    allowedOrigins: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
  })
  .strict();

export const configSchema = prototypeSafeInputSchema.pipe(tileflowMapSchema);

const tilesetConfigSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    attribution: z.string().optional(),
    sourceLayers: sourceLayersSchema.optional(),
    version: sourceVersionSchema.optional(),
  })
  .strict();

const captureScenesSchema = z
  .record(tileflowCaptureSceneNameSchema, tileflowCaptureSceneSchema)
  .superRefine((scenes, context) => {
    const namesByCaseFold = new Map<string, string>();
    for (const name of Object.keys(scenes).sort()) {
      const folded = name.toLowerCase();
      const existing = namesByCaseFold.get(folded);
      if (existing !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `Expected a portable scene name distinct from "${existing}" on case-insensitive filesystems`,
          path: [name],
        });
      } else {
        namesByCaseFold.set(folded, name);
      }
    }
  });

export const tileflowProjectSchema = prototypeSafeInputSchema.pipe(
  z
    .object({
      icons: z.record(identifierSchema, iconSetSchema).optional(),
      scenes: captureScenesSchema.optional(),
      themes: z.record(identifierSchema, themeConfigSchema).optional(),
      tilesets: z.record(identifierSchema, tilesetConfigSchema).optional(),
      maps: z.record(identifierSchema, configSchema).refine((maps) => {
        return Object.keys(maps).length > 0;
      }, 'Expected at least one map'),
    })
    .strict(),
);

const projectConfigSchema = tileflowProjectSchema;

export function parseTileflowMap(input: unknown): TileflowConfig {
  const parsed = configSchema.parse(input) as TileflowConfig;
  const messages = validateMapThemeReference(parsed, undefined, 'theme');

  if (messages.length > 0) {
    throw new Error(messages.map((message) => `${message.path}: ${message.message}`).join('; '));
  }

  return parsed;
}

export function parseTileflowProject(input: unknown): TileflowProjectConfig {
  const parsed = projectConfigSchema.parse(input) as TileflowProjectConfig;
  const messages = validateProjectThemeReferences(parsed);

  if (messages.length > 0) {
    throw new Error(messages.map((message) => `${message.path}: ${message.message}`).join('; '));
  }

  return parsed;
}

export function validateConfig(input: unknown): ValidationResult {
  if (isProjectConfigLike(input)) {
    const parsed = projectConfigSchema.safeParse(input);

    if (parsed.success) {
      const messages = validateProjectThemeReferences(parsed.data as TileflowProjectConfig);

      if (messages.length > 0) {
        return {valid: false, messages};
      }

      return {valid: true, messages: []};
    }

    return {
      valid: false,
      messages: parsed.error.issues.map((issue) => ({
        level: 'error',
        path: issue.path.join('.') || 'config',
        message: issue.message,
      })),
    };
  }

  const parsed = configSchema.safeParse(input);

  if (parsed.success) {
    const messages = validateMapThemeReference(parsed.data as TileflowConfig, undefined, 'theme');
    if (messages.length > 0) {
      return {valid: false, messages};
    }

    return {valid: true, messages: []};
  }

  return {
    valid: false,
    messages: parsed.error.issues.map((issue) => ({
      level: 'error',
      path: issue.path.join('.') || 'config',
      message: issue.message,
    })),
  };
}

export const validateTileflowConfig = validateConfig;

function isProjectConfigLike(input: unknown): input is TileflowProjectConfig {
  return Boolean(
    input &&
    typeof input === 'object' &&
    Object.hasOwn(input, 'maps') &&
    typeof (input as {maps?: unknown}).maps === 'object',
  );
}

function findUnsafeObjectStructure(
  input: unknown,
): {path: Array<string | number>; reason: 'key' | 'prototype'} | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const pending: Array<{path: Array<string | number>; value: object}> = [{path: [], value: input}];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current.value)) continue;
    visited.add(current.value);

    if (!Array.isArray(current.value)) {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) {
        return {path: current.path, reason: 'prototype'};
      }
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
      ) {
        pending.push({path, value: descriptor.value});
      }
    }
  }

  return undefined;
}

function validateProjectThemeReferences(project: TileflowProjectConfig): ValidationMessage[] {
  const themeNames = new Set(Object.keys(project.themes ?? {}));
  const themeMessages = validateThemeExtends(project.themes, themeNames);
  const iconMessages = validateProjectIconReferences(project);
  const sceneMessages = validateProjectSceneReferences(project);
  const mapMessages = Object.entries(project.maps).flatMap(([mapName, mapConfig]) =>
    validateMapThemeReference(mapConfig, themeNames, `maps.${mapName}.theme`),
  );

  return [...themeMessages, ...iconMessages, ...sceneMessages, ...mapMessages];
}

function validateProjectSceneReferences(project: TileflowProjectConfig): ValidationMessage[] {
  return Object.entries(project.scenes ?? {}).flatMap(([sceneName, scene]) =>
    Object.hasOwn(project.maps, scene.map)
      ? []
      : [
          {
            level: 'error' as const,
            path: `scenes.${sceneName}.map`,
            message: `Unknown Tileflow map "${scene.map}"`,
          },
        ],
  );
}

function validateMapThemeReference(
  config: Pick<TileflowConfig, 'theme'>,
  themeNames: Set<string> | undefined,
  path: string,
): ValidationMessage[] {
  if (!config.theme) {
    return [];
  }

  if (typeof config.theme === 'string') {
    if (legacyThemeNames.has(config.theme) || themeNames?.has(config.theme)) {
      return [];
    }

    return [
      {
        level: 'error',
        path,
        message: `Unknown Tileflow theme "${config.theme}"`,
      },
    ];
  }

  if (!config.theme.extends) {
    return [];
  }

  if (legacyThemeNames.has(config.theme.extends) || themeNames?.has(config.theme.extends)) {
    return [];
  }

  return [
    {
      level: 'error',
      path: `${path}.extends`,
      message: `Unknown Tileflow theme "${config.theme.extends}"`,
    },
  ];
}

function validateThemeExtends(
  themes: TileflowProjectConfig['themes'],
  themeNames: Set<string>,
): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  for (const [themeName, theme] of Object.entries(themes ?? {})) {
    if (theme.extends && !legacyThemeNames.has(theme.extends) && !themeNames.has(theme.extends)) {
      messages.push({
        level: 'error',
        path: `themes.${themeName}.extends`,
        message: `Unknown Tileflow theme "${theme.extends}"`,
      });
    }
  }

  for (const themeName of themeNames) {
    const cycle = findThemeCycle(themeName, themes, []);

    if (cycle) {
      messages.push({
        level: 'error',
        path: `themes.${themeName}.extends`,
        message: `Circular Tileflow theme extends: ${cycle.join(' -> ')}`,
      });
    }
  }

  return messages;
}

function findThemeCycle(
  themeName: string,
  themes: TileflowProjectConfig['themes'],
  path: string[],
): string[] | undefined {
  if (path.includes(themeName)) {
    return [...path, themeName];
  }

  const nextThemeName = themes?.[themeName]?.extends;

  if (!nextThemeName || legacyThemeNames.has(nextThemeName)) {
    return undefined;
  }

  return findThemeCycle(nextThemeName, themes, [...path, themeName]);
}

type IconSetValue = NonNullable<TileflowProjectConfig['icons']>[string];

function validateProjectIconReferences(project: TileflowProjectConfig): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  const iconSets = project.icons ?? {};

  for (const [iconSetName, iconSet] of Object.entries(iconSets)) {
    const extendedName = iconSetReference(iconSet);

    if (extendedName && !Object.hasOwn(iconSets, extendedName)) {
      messages.push({
        level: 'error',
        path: iconSetExtendsPath(`icons.${iconSetName}`, iconSet),
        message: `Unknown Tileflow icon set "${extendedName}"`,
      });
    }
  }

  for (const iconSetName of Object.keys(iconSets)) {
    const cycle = findIconSetCycle(iconSetName, iconSets, []);

    if (cycle) {
      messages.push({
        level: 'error',
        path: iconSetExtendsPath(`icons.${iconSetName}`, iconSets[iconSetName]),
        message: `Circular Tileflow icon set extends: ${cycle.join(' -> ')}`,
      });
    }
  }

  for (const [mapName, mapConfig] of Object.entries(project.maps)) {
    if (!isIconSetObject(mapConfig.icons) || !mapConfig.icons.extends) {
      continue;
    }

    if (!Object.hasOwn(iconSets, mapConfig.icons.extends)) {
      messages.push({
        level: 'error',
        path: `maps.${mapName}.icons.extends`,
        message: `Unknown Tileflow icon set "${mapConfig.icons.extends}"`,
      });
    }
  }

  return messages;
}

function findIconSetCycle(
  iconSetName: string,
  iconSets: TileflowProjectConfig['icons'],
  path: string[],
): string[] | undefined {
  if (path.includes(iconSetName)) {
    return [...path, iconSetName];
  }

  const nextIconSetName = Object.hasOwn(iconSets ?? {}, iconSetName)
    ? iconSetReference(iconSets?.[iconSetName])
    : undefined;

  if (!nextIconSetName || !Object.hasOwn(iconSets ?? {}, nextIconSetName)) {
    return undefined;
  }

  return findIconSetCycle(nextIconSetName, iconSets, [...path, iconSetName]);
}

function iconSetReference(iconSet: IconSetValue | undefined) {
  if (typeof iconSet === 'string') {
    return iconSet;
  }

  return isIconSetObject(iconSet) ? iconSet.extends : undefined;
}

function iconSetExtendsPath(basePath: string, iconSet: IconSetValue) {
  return isIconSetObject(iconSet) ? `${basePath}.extends` : basePath;
}

function isIconSetObject(value: unknown): value is {extends?: string} {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
