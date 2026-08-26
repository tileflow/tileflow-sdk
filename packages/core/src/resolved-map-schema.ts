import {z} from 'zod';
import {copyResolvedModuleEffects} from './cartography/module-effects';
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
  tileflowStreetsCompilerVersion,
} from './maps/types';
import {
  isSafeTileflowDemUrlTemplate,
  isTileflowContourDensityWithinBudget,
} from './terrain/contour-protocol';
import type {ValidationMessage} from './types';

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
const numberValueSchema = z.union([z.number().finite(), expressionSchema, zoomValueSchema]);
const stringValueSchema = z.union([z.string(), expressionSchema, zoomValueSchema]);
const numberArrayValueSchema = z.union([
  z.array(z.number().finite()),
  expressionSchema,
  zoomValueSchema,
]);
const lineCapValueSchema = z.union([
  z.enum(['butt', 'round', 'square']),
  expressionSchema,
  zoomValueSchema,
]);
const lineJoinValueSchema = z.union([
  z.enum(['bevel', 'miter', 'round']),
  expressionSchema,
  zoomValueSchema,
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
      'active',
      'businessCorridor',
      'businessCorridorOutline',
      'civic',
      'commercial',
      'destination',
      'extrusion',
      'fill',
      'generic',
      'highRise',
      'highRiseOutline',
      'industrial',
      'lowRise',
      'lowRiseOutline',
      'outline',
      'residential',
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
    landcover: colorGroupSchema([
      'farmland',
      'flowerbed',
      'grass',
      'ice',
      'meadow',
      'protected',
      'recreationGround',
      'rock',
      'sand',
      'scrub',
      'urbanPark',
      'villageGreen',
      'wetland',
      'wood',
    ]).optional(),
    landuse: colorGroupSchema([
      'cemetery',
      'civic',
      'commercial',
      'education',
      'government',
      'industrial',
      'medical',
      'military',
      'parking',
      'recreation',
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
    fallbacks: fontFallbacksSchema.optional(),
    font: exactFontFaceSchema.optional(),
    letterSpacing: z.number().finite().min(-1).max(10).optional(),
    transform: z.enum(['lowercase', 'none', 'uppercase']).optional(),
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
    mode: z.enum(['light', 'dark']).optional(),
    modules: themeModulesSchema.optional(),
    typography: typographySchema.optional(),
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
    color: stringValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: stringValueSchema.optional(),
  })
  .strict();
const fillStyleSchema = z
  .object({
    ...rangeShape,
    antialias: z.boolean().optional(),
    color: stringValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: stringValueSchema.optional(),
  })
  .strict();
const lineStyleSchema = z
  .object({
    ...rangeShape,
    blur: numberValueSchema.optional(),
    cap: lineCapValueSchema.optional(),
    color: stringValueSchema.optional(),
    dash: numberArrayValueSchema.optional(),
    gapWidth: numberValueSchema.optional(),
    join: lineJoinValueSchema.optional(),
    miterLimit: z.number().finite().min(0).optional(),
    offset: numberValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: stringValueSchema.optional(),
    roundLimit: z.number().finite().min(0).optional(),
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
    fallbacks: fontFallbacksSchema.optional(),
    field: stringValueSchema.optional(),
    font: exactFontFaceSchema.optional(),
    haloBlur: numberValueSchema.optional(),
    haloColor: stringValueSchema.optional(),
    haloWidth: numberValueSchema.optional(),
    ignorePlacement: z.boolean().optional(),
    justify: z.enum(['auto', 'center', 'left', 'right']).optional(),
    keepUpright: z.boolean().optional(),
    letterSpacing: numberValueSchema.optional(),
    lineHeight: numberValueSchema.optional(),
    maxAngle: z.number().finite().min(0).max(180).optional(),
    maxWidth: numberValueSchema.optional(),
    offset: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    optional: z.boolean().optional(),
    opacity: numberValueSchema.optional(),
    padding: numberValueSchema.optional(),
    radialOffset: numberValueSchema.optional(),
    rotate: numberValueSchema.optional(),
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
    color: stringValueSchema.optional(),
    haloBlur: numberValueSchema.optional(),
    haloColor: stringValueSchema.optional(),
    haloWidth: numberValueSchema.optional(),
    ignorePlacement: z.boolean().optional(),
    image: stringValueSchema.optional(),
    offset: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    opacity: numberValueSchema.optional(),
    keepUpright: z.boolean().optional(),
    optional: z.boolean().optional(),
    padding: numberValueSchema.optional(),
    pitchAlignment: z.enum(['auto', 'map', 'viewport']).optional(),
    rotate: numberValueSchema.optional(),
    rotationAlignment: z.enum(['auto', 'map', 'viewport']).optional(),
    size: numberValueSchema.optional(),
  })
  .strict();

const symbolPlacementShape = {
  ...rangeShape,
  placement: z.enum(['line', 'line-center', 'point']).optional(),
  priority: numberValueSchema.optional(),
  spacing: numberValueSchema.optional(),
  zOrder: z.enum(['auto', 'source', 'viewport-y']).optional(),
};
const circleStyleSchema = z
  .object({
    ...rangeShape,
    blur: numberValueSchema.optional(),
    color: stringValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pitchAlignment: z.enum(['map', 'viewport']).optional(),
    pitchScale: z.enum(['map', 'viewport']).optional(),
    radius: numberValueSchema.optional(),
    strokeColor: stringValueSchema.optional(),
    strokeOpacity: numberValueSchema.optional(),
    strokeWidth: numberValueSchema.optional(),
  })
  .strict();
const extrusionStyleSchema = z
  .object({
    ...rangeShape,
    base: numberValueSchema.optional(),
    color: stringValueSchema.optional(),
    height: numberValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: stringValueSchema.optional(),
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
    color: stringValueSchema.optional(),
    opacity: numberValueSchema.optional(),
    pattern: stringValueSchema.optional(),
    patternWidths: z.array(z.number().int().positive().max(1024)).min(2).optional(),
    size: numberValueSchema.optional(),
    spacing: numberValueSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.patternWidths === undefined) return;
    if (typeof value.pattern !== 'string') {
      context.addIssue({
        code: 'custom',
        message: 'patternWidths requires pattern to be a literal sprite-name prefix',
        path: ['pattern'],
      });
    }
    for (let index = 1; index < value.patternWidths.length; index += 1) {
      if (value.patternWidths[index]! <= value.patternWidths[index - 1]!) {
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
    marker: circleStyleSchema.optional(),
    text: textStyleSchema.optional(),
  })
  .strict();
const poiRankZoomValueSchema = zoomValueSchema
  .extend({
    stops: z.array(z.tuple([zoomNumberSchema, z.number().int().min(1)])).min(1),
  })
  .superRefine((value, context) => {
    if (value.interpolation === 'step' && value.stops.length < 2) {
      context.addIssue({
        code: 'custom',
        message: 'Step POI rank interpolation requires at least two stops',
        path: ['stops'],
      });
    }
    if (value.interpolation === 'exponential' && value.base === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Exponential POI rank interpolation requires a positive base',
        path: ['base'],
      });
    }
    if (value.interpolation !== 'exponential' && value.base !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only exponential POI rank interpolation accepts a base',
        path: ['base'],
      });
    }

    let previousZoom = -Infinity;
    let previousRank = -Infinity;
    for (const [index, [stopZoom, stopRank]] of value.stops.entries()) {
      if (stopZoom <= previousZoom) {
        context.addIssue({
          code: 'custom',
          message: 'POI rank zoom stops must be strictly increasing',
          path: ['stops', index, 0],
        });
      }
      if (stopRank < previousRank) {
        context.addIssue({
          code: 'custom',
          message: 'POI maxRank must not decrease as zoom increases',
          path: ['stops', index, 1],
        });
      }
      previousZoom = stopZoom;
      previousRank = stopRank;
    }
  });
const poiRankLimitSchema = z.union([z.number().int().min(1), poiRankZoomValueSchema]);
const poiCategoryStyleSchema = symbolStyleSchema
  .extend({maxRank: poiRankLimitSchema.optional()})
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
  'pathway',
  'footway',
  'cycleway',
  'steps',
  'pedestrian',
]);
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
    widthScale: z.number().finite().positive().optional(),
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
  })
  .strict();
const addressesModuleSchema = z
  .object({
    type: z.literal('addresses'),
    enabled: z.boolean().optional(),
    labels: symbolStyleSchema.optional(),
  })
  .strict();
const landformClassSchema = z.enum(['peak', 'volcano', 'saddle', 'ridge', 'cliff', 'arete']);
const landformsModuleSchema = z
  .object({
    type: z.literal('landforms'),
    classes: z.partialRecord(landformClassSchema, symbolStyleSchema).optional(),
    elevation: z.boolean().optional(),
    enabled: z.boolean().optional(),
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
    area: areaStyleSchema.optional(),
    enabled: z.boolean().optional(),
    runway: lineStackStyleSchema.optional(),
    runwayRef: symbolStyleSchema.optional(),
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
    crossings: iconStyleSchema.extend({image: stringValueSchema}).strict().optional(),
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
    widthScale: z.partialRecord(roadClassSchema, z.number().finite().positive()).optional(),
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
            networks: z.record(identifierSchema, symbolStyleSchema).optional(),
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
    categories: z.array(identifierSchema).optional(),
    classMapping: z.record(identifierSchema, z.array(identifierSchema).min(1)).optional(),
    color: z.enum(['uniform', 'category']).optional(),
    density: z.enum(['sparse', 'balanced', 'dense']).optional(),
    enabled: z.boolean().optional(),
    icons: z.union([z.boolean(), z.enum(['essential', 'full'])]).optional(),
    labels: z.enum(['none', 'minimal', 'balanced', 'full']).optional(),
    maxRank: poiRankLimitSchema.optional(),
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
    styles: z.record(identifierSchema, poiCategoryStyleSchema).optional(),
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
        threeDimensional: z
          .object({
            barkColor: hexColorSchema.optional(),
            broadleafColors: z.array(hexColorSchema).min(1).max(8).optional(),
            coniferColors: z.array(hexColorSchema).min(1).max(8).optional(),
            crownScale: z.number().finite().positive().max(10).optional(),
            heightScale: z.number().finite().positive().max(10).optional(),
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
    minHeight: z.string().trim().min(1),
    minZoom: z.string().trim().min(1),
    mtbScale: z.string().trim().min(1),
    name: z.string().trim().min(1),
    nameEnglish: z.string().trim().min(1),
    nameLatin: z.string().trim().min(1),
    network: z.string().trim().min(1),
    official: z.string().trim().min(1),
    oneway: z.string().trim().min(1),
    ramp: z.string().trim().min(1),
    rank: z.string().trim().min(1),
    ref: z.string().trim().min(1),
    refLength: z.string().trim().min(1),
    renderHeight: z.string().trim().min(1),
    renderMinZoom: z.string().trim().min(1),
    renderMinHeight: z.string().trim().min(1),
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
const publicVectorUrlSchema = z.string().superRefine((value, context) => {
  try {
    validatePublicVectorUrl(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid Tileflow vector tile URL.',
    });
  }
});
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
const mapRootSchema = z
  .object({
    compiler: z.literal('streets'),
    compilerVersion: z.literal(tileflowStreetsCompilerVersion),
  })
  .strict();
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
    accentColor: hexColorSchema.optional(),
    exaggeration: z.number().finite().min(0).max(1).optional(),
    highlightColor: hexColorSchema.optional(),
    illuminationAnchor: z.enum(['map', 'viewport']).optional(),
    illuminationDirection: z.number().finite().min(0).max(359).optional(),
    shadowColor: hexColorSchema.optional(),
  })
  .strict();
const terrainContourLineSchema = z
  .object({
    ...terrainLayerRangeShape,
    color: hexColorSchema.optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    width: z.number().finite().min(0).max(32).optional(),
  })
  .strict();
const terrainContourLabelSchema = z
  .object({
    ...terrainLayerRangeShape,
    color: hexColorSchema.optional(),
    font: exactFontFaceSchema.optional(),
    haloColor: hexColorSchema.optional(),
    haloWidth: z.number().finite().min(0).max(16).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    size: z.number().finite().min(1).max(64).optional(),
    spacing: z.number().finite().min(1).max(1000).optional(),
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
const streetsThemeSchema = tileflowThemeSchema;
const lightSchema = z
  .object({
    anchor: z.enum(['map', 'viewport']).optional(),
    color: hexColorSchema.optional(),
    intensity: z.number().finite().min(0).max(1).optional(),
    position: z
      .tuple([
        z.number().finite().min(0),
        z.number().finite().min(0).max(360),
        z.number().finite().min(0).max(180),
      ])
      .optional(),
  })
  .strict();

export const resolvedTileflowMapSchema: z.ZodType<TileflowCompilerConfig> = z
  .object({
    data: dataSchema.optional(),
    delivery: deliverySchema.optional(),
    fonts: fontDirectoriesSchema.optional(),
    glyphs: glyphsSchema.optional(),
    icons: iconDirectoriesSchema.optional(),
    id: tileflowMapIdSchema,
    light: lightSchema.optional(),
    modules: modulesSchema.optional(),
    name: z.string().trim().min(1),
    projection: z.enum(['globe', 'mercator']).optional(),
    root: mapRootSchema,
    terrain: terrainSchema.optional(),
    theme: streetsThemeSchema.optional(),
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
    validateZoomRanges(map, context);
  }) as z.ZodType<TileflowCompilerConfig>;

export function parseResolvedTileflowMap(input: unknown): TileflowCompilerConfig {
  const map = parseOrThrow(
    resolvedTileflowMapSchema,
    input,
    'resolved map',
  ) as TileflowCompilerConfig;
  copyResolvedModuleEffects(input, map);
  return map;
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
