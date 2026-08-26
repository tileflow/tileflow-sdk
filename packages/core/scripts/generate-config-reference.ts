import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {format} from 'prettier';
import {z} from 'zod';
import {tileflowCaptureSceneSchema} from '../src/capture-scene';
import {tileflowMapMergeStrategies} from '../src/maps/resolve';
import {resolvedTileflowMapSchema} from '../src/resolved-map-schema';

const referencePath = fileURLToPath(
  new URL('../../../docs/modules-api-reference.json', import.meta.url),
);

type JsonSchema = Record<string, unknown>;

const authoringMapReference = '#/$defs/TileflowAuthoringMap';
const resolvedMapReference = '#/$defs/ResolvedTileflowMap';
const mapSceneReference = '#/$defs/TileflowMapScene';

export function createTileflowConfigReference(): JsonSchema {
  const generatedResolvedMap = z.toJSONSchema(resolvedTileflowMapSchema, {
    io: 'input',
    reused: 'ref',
    unrepresentable: 'any',
  }) as JsonSchema;
  const generatedMapScene = namespaceLocalDefinitions(
    z.toJSONSchema(tileflowCaptureSceneSchema, {
      io: 'input',
      reused: 'ref',
      unrepresentable: 'any',
    }) as JsonSchema,
    'scene_',
  );
  enforceExactTuples(generatedResolvedMap);
  enforceExactTuples(generatedMapScene);
  enrichResolvedMapReference(generatedResolvedMap);
  enrichCaptureSceneReference(generatedMapScene);

  const definitions = asRecord(generatedResolvedMap.$defs, 'resolved map definitions');
  const sceneDefinitions = asOptionalRecord(generatedMapScene.$defs, 'capture scene definitions');
  const properties = asRecord(generatedResolvedMap.properties, 'resolved map properties');
  const modulesReference = asRecord(properties.modules, 'modules schema').$ref;
  if (typeof modulesReference !== 'string') {
    throw new Error('The resolved map modules schema must use one local JSON Schema reference.');
  }
  const modulesSchema = resolveLocalReference(generatedResolvedMap, modulesReference);
  const moduleProperties = asRecord(modulesSchema.properties, 'module properties');
  const modules = Object.fromEntries(
    Object.keys(moduleProperties)
      .sort(compareCodeUnits)
      .map((name) => {
        const moduleSchema = asRecord(moduleProperties[name], `module ${name}`);
        const moduleType = asRecord(
          asRecord(moduleSchema.properties, `${name} properties`).type,
          `${name} type`,
        ).const;
        if (moduleType !== name) {
          throw new Error(`Module ${name} does not expose its matching type discriminator.`);
        }
        return [
          name,
          {
            type: name,
            schemaRef: `${modulesReference}/properties/${escapeJsonPointer(name)}`,
          },
        ];
      }),
  );
  const {$schema, $defs: _resolvedDefinitions, ...resolvedMapSchema} = generatedResolvedMap;
  const {
    $schema: _sceneDialect,
    $defs: _sceneDefinitions,
    ...captureSceneSchema
  } = generatedMapScene;
  const mapSceneSchema = omitRequiredProperty(captureSceneSchema, 'map', 'capture scene');
  const {root: rootSchema, ...sharedAuthoringProperties} = properties;
  if (!rootSchema) throw new Error('The resolved map schema must define root.');

  const scenesSchema = {
    type: 'object',
    propertyNames: properties.id,
    additionalProperties: {$ref: mapSceneReference},
  };
  const authoringProperties = {...sharedAuthoringProperties, scenes: scenesSchema};
  const exclusiveTextProviders = {not: {required: ['fonts', 'glyphs']}};
  const rootMapSchema = {
    description:
      'Compiler-owned root passed to defineRootMap(). It declares root and cannot declare extends.',
    type: 'object',
    properties: {...authoringProperties, root: rootSchema},
    required: ['id', 'root', 'version'],
    additionalProperties: false,
    ...exclusiveTextProviders,
  };
  const derivedMapSchema = {
    description:
      'Ordinary map passed to defineMap(). It extends an imported map object and cannot declare root.',
    type: 'object',
    properties: {
      ...authoringProperties,
      extends: {$ref: authoringMapReference},
    },
    required: ['extends', 'id', 'version'],
    additionalProperties: false,
    ...exclusiveTextProviders,
  };

  return {
    $schema,
    $id: 'https://tileflow.dev/schemas/tileflow-config-reference-v2.json',
    schemaVersion: 2,
    kind: 'tileflow.config.reference',
    authority:
      '@tileflow/core resolvedTileflowMapSchema and tileflowCaptureSceneSchema (input); authoring branches are generated from their shared fields',
    description:
      'Generated machine-readable reference for writing and inspecting one singular Tileflow map. The document root is the authoring schema.',
    'x-tileflow-refinement-contract':
      'Standard JSON Schema keywords encode every representable constraint. x-tileflow-refinements records the remaining relational checks enforced by the same Core parser and tileflow validate.',
    'x-tileflow-inheritance': createInheritanceReference(),
    entrypoints: {
      authoring: {
        role: 'tileflow.config.ts default export',
        schemaRef: authoringMapReference,
        description:
          'Exactly one of root or extends. In TypeScript, extends normally receives an imported map object; scenes belong only to the leaf definition.',
      },
      resolved: {
        role: 'validate, inspect, build, and compiler input after inheritance',
        schemaRef: resolvedMapReference,
        description: 'Standalone map with a required name and root, without extends or scenes.',
      },
    },
    modules,
    $ref: authoringMapReference,
    $defs: {
      TileflowAuthoringMap: {
        description:
          'The singular map exported by tileflow.config.ts: exactly one root or derived map definition.',
        oneOf: [{$ref: '#/$defs/TileflowRootMap'}, {$ref: '#/$defs/TileflowDerivedMap'}],
      },
      TileflowRootMap: rootMapSchema,
      TileflowDerivedMap: derivedMapSchema,
      TileflowMapScene: {
        description:
          'Leaf-owned capture scene. Its map id is implicit from the containing map and must not be declared.',
        ...mapSceneSchema,
      },
      ResolvedTileflowMap: {
        description:
          'Standalone compiler input after inheritance. Tooling scenes and extends are no longer present.',
        ...resolvedMapSchema,
        ...exclusiveTextProviders,
      },
      ...definitions,
      ...sceneDefinitions,
    },
  };
}

function createInheritanceReference(): JsonSchema {
  return {
    authority: '@tileflow/core tileflowMapMergeStrategies',
    fields: Object.fromEntries(
      Object.entries(tileflowMapMergeStrategies).sort(([left], [right]) =>
        compareCodeUnits(left, right),
      ),
    ),
    strategies: {
      atomic: 'The nearest declaration replaces the complete inherited value.',
      deep: 'Plain objects merge recursively; arrays and non-objects replace atomically.',
      icons:
        'Omission inherits; any declared array replaces atomically; [] selects no icon directories.',
      identity: 'The leaf map owns the value; it is never inherited.',
      leaf: 'Tooling metadata is read only from the leaf and is never inherited.',
      lineage: 'Defines or traverses the map lineage and is removed from the resolved design.',
      modules:
        'Each declared module domain replaces that complete domain; omitted domains inherit.',
      'text-assets':
        'One declaration atomically replaces the inherited text provider and removes the other provider kind.',
    },
  };
}

export async function serializeTileflowConfigReference(): Promise<string> {
  return format(JSON.stringify(createTileflowConfigReference(), null, 2), {parser: 'json'});
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const expected = await serializeTileflowConfigReference();
  if (mode === '--write') {
    await writeFile(referencePath, expected, 'utf8');
    return;
  }
  if (mode !== '--check') {
    throw new Error('Usage: generate-config-reference.ts --check | --write');
  }
  const actual = await readFile(referencePath, 'utf8').catch(() => '');
  if (actual !== expected) {
    throw new Error(
      'docs/modules-api-reference.json is stale. Run pnpm reference:generate and commit the result.',
    );
  }
}

function resolveLocalReference(schema: JsonSchema, reference: string): JsonSchema {
  if (!reference.startsWith('#/'))
    throw new Error(`Unsupported non-local schema reference: ${reference}`);
  let current: unknown = schema;
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    current = asRecord(current, reference)[segment];
  }
  return asRecord(current, reference);
}

function enrichResolvedMapReference(schema: JsonSchema): void {
  const properties = asRecord(schema.properties, 'resolved map properties');
  enrichIdentifierConstraints(schema);
  enrichExactFontConstraints(schema);
  enrichHostedOriginConstraints(schema);
  enrichLineHatchConstraints(schema);
  enrichPoiRankConstraints(schema);
  enrichDirectDataConstraints(schema);
  const icons = asRecord(properties.icons, 'icons property');
  const fonts = asRecord(properties.fonts, 'fonts property');
  const glyphs = asRecord(properties.glyphs, 'glyphs property');
  icons.description =
    'Ordered icon directories. In authoring, omission inherits, declaration atomically replaces, [] selects no icons, and a later directory wins by exact canonical ID.';
  fonts.description =
    'Ordered local font directories. In authoring, omission inherits, declaration atomically replaces either text provider, and [] explicitly selects no provider for a text-free map.';
  glyphs.description =
    'One explicit PBF glyph provider. In authoring, declaration atomically replaces inherited fonts or glyphs; fonts and glyphs are mutually exclusive.';

  const iconArray = dereferenceSchema(schema, icons, 'icons array');
  iconArray.description = icons.description;
  iconArray.examples = [
    [],
    [{kind: 'package-directory', package: '@tileflow/maps', path: 'assets/streets/icons'}],
    [
      {kind: 'package-directory', package: '@tileflow/maps', path: 'assets/streets/icons'},
      {kind: 'package-directory', package: '@tileflow/maps', path: 'assets/verdant/icons'},
    ],
  ];
  const fontArray = dereferenceSchema(schema, fonts, 'fonts array');
  fontArray.description = fonts.description;
  fontArray.examples = [
    [],
    [
      {
        kind: 'package-directory',
        package: '@tileflow/maps',
        path: 'assets/cyberpunk/fonts',
      },
    ],
  ];
  const assetDirectory = dereferenceSchema(
    schema,
    asRecord(iconArray.items, 'icon directory items'),
    'asset directory',
  );
  const directoryBranches = assetDirectory.anyOf;
  if (!Array.isArray(directoryBranches) || directoryBranches.length !== 2) {
    throw new Error('Asset directories must expose local and package branches.');
  }
  const localDirectory = dereferenceSchema(
    schema,
    asRecord(directoryBranches[0], 'local asset directory'),
    'local asset directory',
  );
  localDirectory.pattern =
    '^(?:\\./|(?:\\.\\./)+)(?!\\.\\.?($|/))(?!.*/\\.\\.?($|/))(?!.*//)(?!.*[\\\\\\u0000-\\u001F\\u007F-\\u009F])[^/]+(?:/[^/]+)*$';
  localDirectory.description =
    'Canonical config-relative directory beginning with ./ or one or more ../ segments; no empty, dot, dot-dot, backslash, or control segments.';

  const packageDirectory = dereferenceSchema(
    schema,
    asRecord(directoryBranches[1], 'package asset directory'),
    'package asset directory',
  );
  const packageProperties = asRecord(packageDirectory.properties, 'package directory properties');
  const packagePath = dereferenceSchema(
    schema,
    asRecord(packageProperties.path, 'package directory path'),
    'package directory path',
  );
  packagePath.pattern =
    '^(?!/)(?!\\.\\.?($|/))(?!.*/\\.\\.?($|/))(?!.*//)(?!.*\\\\)[^/]+(?:/[^/]+)*$';
  packagePath.description =
    'Portable package-relative directory with non-empty segments and no dot, dot-dot, or backslash segments.';
  packageDirectory.description =
    'Package-owned asset descriptor. Prefer importing the descriptor exported by its owning package.';

  const glyphProvider = dereferenceSchema(schema, glyphs, 'glyph provider');
  glyphProvider.description =
    'Complete standalone glyph provider owned by the map: an explicit URL template plus every exact MapLibre font-stack request key it uses.';
  const glyphProperties = asRecord(glyphProvider.properties, 'glyph provider properties');
  const fontStacks = dereferenceSchema(
    schema,
    asRecord(glyphProperties.fontStacks, 'fontStacks property'),
    'fontStacks array',
  );
  fontStacks.uniqueItems = true;
  fontStacks.description =
    'Unique exact comma-joined MapLibre request keys, in NFC, without surrounding whitespace, controls, slash, or backslash.';
  const stack = dereferenceSchema(
    schema,
    asRecord(fontStacks.items, 'font stack items'),
    'font stack',
  );
  stack.pattern = '^(?!\\s)(?!.*\\s$)(?!.*[\\\\/\\u0000-\\u001F\\u007F-\\u009F]).+$';
  stack.description = 'Exact NFC MapLibre font-stack request key.';
  stack['x-tileflow-normalization'] = 'NFC';

  const kind = dereferenceSchema(
    schema,
    asRecord(glyphProperties.kind, 'glyph kind'),
    'glyph kind',
  ).const;
  if (kind !== 'url') throw new Error('Glyphs must expose only the explicit URL provider.');
  const url = dereferenceSchema(schema, asRecord(glyphProperties.url, 'glyph URL'), 'glyph URL');
  url.pattern =
    '^(?=.*\\{fontstack\\})(?=.*\\{range\\})(?!//)(?!.*[\\\\#\\u0000-\\u001F\\u007F-\\u009F])(?:(?:[Hh][Tt][Tt][Pp][Ss]?://(?![^/]*@))|/(?!/)|\\./|\\.\\./).+$';
  url.description =
    'Exact HTTP(S), root-relative, or path-relative glyph URL containing {fontstack} and {range}; no credentials, fragment, backslash, or controls.';

  schema['x-tileflow-refinements'] = [
    {
      path: '**.{minZoom,maxZoom}',
      rule: 'When both values exist, minZoom must be less than or equal to maxZoom.',
    },
    {
      path: 'data.{minzoom,maxzoom}',
      rule: 'For direct vector tiles, minzoom must be less than or equal to maxzoom.',
    },
    {
      path: 'data.bounds',
      rule: 'West must be less than east and south must be less than north.',
    },
    {
      path: '**.{font,fallbacks[]}',
      rule: 'Every exact font face name must already be Unicode NFC.',
    },
    {
      path: 'glyphs.fontStacks[]',
      rule: 'Each exact key must already be Unicode NFC.',
    },
    {
      path: 'delivery.hosted.allowedOrigins[]',
      rule: 'Each value must equal its canonical WHATWG HTTP(S) origin and contain no path, credentials, query, fragment, or redundant trailing slash/default port.',
    },
    {
      path: '**.hatch.patternWidths[]',
      rule: 'Literal pattern widths must be strictly increasing.',
    },
    {
      path: 'modules.poi.{maxRank,styles.*.maxRank}.stops',
      rule: 'Zooms must be strictly increasing and rank limits must not decrease.',
    },
  ];
}

function enrichIdentifierConstraints(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (node.type !== 'string') return;
    if (node.pattern === '^[a-z][a-z0-9-]{0,63}$') {
      node.not = {
        enum: [
          'aux',
          'com1',
          'com2',
          'com3',
          'com4',
          'com5',
          'com6',
          'com7',
          'com8',
          'com9',
          'con',
          'constructor',
          'lpt1',
          'lpt2',
          'lpt3',
          'lpt4',
          'lpt5',
          'lpt6',
          'lpt7',
          'lpt8',
          'lpt9',
          'nul',
          'prn',
          'prototype',
        ],
      };
      node.description =
        'Portable lowercase kebab-case identifier; prototype keys and reserved Windows filenames are forbidden.';
    } else if (node.pattern === '^[A-Za-z0-9_-]+$') {
      node.not = {const: '__proto__'};
    }
  });
}

function enrichExactFontConstraints(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const properties = node.properties as Record<string, unknown>;
    if (properties.font && typeof properties.font === 'object') {
      const font = dereferenceSchema(schema, properties.font as JsonSchema, 'exact font face');
      if (font.type === 'string' && font.maxLength === 100) enrichExactFontFace(font);
    }
    if (properties.fallbacks && typeof properties.fallbacks === 'object') {
      const fallbacks = dereferenceSchema(
        schema,
        properties.fallbacks as JsonSchema,
        'font fallbacks',
      );
      if (fallbacks.type !== 'array' || fallbacks.maxItems !== 8 || !fallbacks.items) return;
      fallbacks.uniqueItems = true;
      fallbacks.description = 'Unique exact fallback face names or CSS generic families.';
      const item = dereferenceSchema(
        schema,
        asRecord(fallbacks.items, 'font fallback item'),
        'font fallback item',
      );
      enrichExactFontFace(item);
    }
  });
}

function enrichExactFontFace(schema: JsonSchema): void {
  schema.pattern = '^(?!\\s)(?!.*\\s$)(?!.*[\\\\\\u0000-\\u001F\\u007F-\\u009F]).+$';
  schema.description =
    'Exact NFC OpenType full name, exact glyph stack ID, or CSS generic; no surrounding whitespace, controls, or backslash.';
  schema['x-tileflow-normalization'] = 'NFC';
}

function enrichHostedOriginConstraints(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const allowedOrigins = (node.properties as Record<string, unknown>).allowedOrigins;
    if (!allowedOrigins || typeof allowedOrigins !== 'object' || Array.isArray(allowedOrigins)) {
      return;
    }
    const origins = dereferenceSchema(schema, allowedOrigins as JsonSchema, 'allowed origins');
    if (origins.type !== 'array' || origins.maxItems !== 20 || !origins.items) return;
    const origin = dereferenceSchema(
      schema,
      asRecord(origins.items, 'allowed origin item'),
      'allowed origin item',
    );
    origin.pattern =
      '^https?://(?![^/?#]*@)(?!.*[/?#\\\\\\s\\u0000-\\u001F\\u007F-\\u009F])(?:\\[[0-9A-Fa-f:.]+\\]|[A-Za-z0-9._~-]+)(?::[0-9]+)?$';
    origin.description =
      'Canonical HTTP(S) origin only: no path, credentials, query, fragment, trailing slash, controls, or whitespace.';
    origin['x-tileflow-refinement'] = 'Must equal the canonical WHATWG URL origin.';
  });
}

function enrichLineHatchConstraints(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const properties = node.properties as Record<string, unknown>;
    if (!properties.patternWidths || !properties.pattern) return;
    appendAllOf(node, {
      if: {required: ['patternWidths']},
      then: {required: ['pattern'], properties: {pattern: {type: 'string'}}},
    });
    node['x-tileflow-refinements'] = [
      {path: 'patternWidths', rule: 'Values must be strictly increasing.'},
    ];
  });
}

function enrichPoiRankConstraints(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const properties = node.properties as Record<string, unknown>;
    if (!properties.interpolation || !properties.base || !properties.stops) return;
    const stops = dereferenceSchema(schema, asRecord(properties.stops, 'zoom stops'), 'zoom stops');
    if (!stops.items) return;
    const tuple = dereferenceSchema(
      schema,
      asRecord(stops.items, 'zoom stop tuple'),
      'zoom stop tuple',
    );
    if (!Array.isArray(tuple.prefixItems) || tuple.prefixItems.length !== 2) return;
    const output = dereferenceSchema(
      schema,
      asRecord(tuple.prefixItems[1], 'zoom stop output'),
      'zoom stop output',
    );
    if (output.type !== 'integer' || output.minimum !== 1) return;

    appendAllOf(
      node,
      {
        if: {properties: {interpolation: {const: 'step'}}, required: ['interpolation']},
        then: {properties: {stops: {minItems: 2}}},
      },
      {
        if: {
          properties: {interpolation: {const: 'exponential'}},
          required: ['interpolation'],
        },
        then: {required: ['base']},
        else: {not: {required: ['base']}},
      },
    );
    node['x-tileflow-refinements'] = [
      {path: 'stops.*.0', rule: 'Zooms must be strictly increasing.'},
      {path: 'stops.*.1', rule: 'Rank limits must not decrease.'},
    ];
  });
}

function enrichDirectDataConstraints(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const properties = node.properties as Record<string, unknown>;
    if (!properties.tiles || !properties.minzoom || !properties.maxzoom) return;
    node['x-tileflow-refinements'] = [
      {path: '{minzoom,maxzoom}', rule: 'minzoom must be less than or equal to maxzoom.'},
      {path: 'bounds', rule: 'West < east and south < north when bounds is present.'},
    ];
  });
}

function appendAllOf(schema: JsonSchema, ...rules: JsonSchema[]): void {
  schema.allOf = [...(Array.isArray(schema.allOf) ? schema.allOf : []), ...rules];
}

function enrichCaptureSceneReference(schema: JsonSchema): void {
  enrichIdentifierConstraints(schema);
  const properties = asRecord(schema.properties, 'capture scene properties');
  const camera = asRecord(properties.camera, 'capture camera');
  const cameraBranches = camera.oneOf;
  if (!Array.isArray(cameraBranches) || cameraBranches.length !== 2) {
    throw new Error('Capture camera must expose center and bounds branches.');
  }
  const boundsCamera = dereferenceSchema(
    schema,
    asRecord(cameraBranches[1], 'bounds camera'),
    'bounds camera',
  );
  boundsCamera.description =
    'Bounds camera. South must be less than north; west and east must define a non-empty span.';
  boundsCamera['x-tileflow-refinements'] = [
    {path: 'bounds', rule: 'south < north and west !== east'},
  ];

  const viewport = dereferenceSchema(
    schema,
    asRecord(properties.viewport, 'capture viewport'),
    'capture viewport',
  );
  viewport.description =
    'Logical viewport. Physical width and height (logical dimension multiplied by dpr) are each at most 4096.';
  viewport.allOf = [
    {
      if: {properties: {dpr: {const: 2}}, required: ['dpr']},
      then: {properties: {height: {maximum: 2048}, width: {maximum: 2048}}},
    },
  ];

  const target = asRecord(properties.target, 'capture target');
  const targetBranches = target.oneOf;
  if (!Array.isArray(targetBranches) || targetBranches.length !== 2) {
    throw new Error('Capture target must expose map and application branches.');
  }
  const applicationTarget = dereferenceSchema(
    schema,
    asRecord(targetBranches[1], 'application capture target'),
    'application capture target',
  );
  applicationTarget.not = {required: ['captureId', 'selector']};
  applicationTarget.description =
    'Application capture target. captureId and selector are mutually exclusive.';
  const applicationProperties = asRecord(
    applicationTarget.properties,
    'application target properties',
  );
  const applicationPath = dereferenceSchema(
    schema,
    asRecord(applicationProperties.path, 'application path'),
    'application path',
  );
  applicationPath.pattern = '^(?!.*\\s$)/(?!/)(?!.*[#\\\\\\u0000-\\u001F\\u007F]).*$';
  applicationPath.description =
    'Exact root-relative application path without origin, credentials, fragment, backslash, controls, or surrounding whitespace.';
  const selector = dereferenceSchema(
    schema,
    asRecord(applicationProperties.selector, 'application selector'),
    'application selector',
  );
  selector.pattern = '.*\\S.*';
  selector.description = 'Non-empty CSS selector after trimming surrounding whitespace.';
}

function enforceExactTuples(schema: JsonSchema): void {
  visitJsonSchema(schema, (node) => {
    if (!Array.isArray(node.prefixItems)) return;
    node.minItems = node.prefixItems.length;
    node.maxItems = node.prefixItems.length;
    node.items = false;
  });
}

function visitJsonSchema(value: unknown, visit: (node: JsonSchema) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitJsonSchema(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as JsonSchema;
  visit(node);
  for (const child of Object.values(node)) visitJsonSchema(child, visit);
}

function dereferenceSchema(root: JsonSchema, value: JsonSchema, label: string): JsonSchema {
  let current = value;
  const seen = new Set<string>();
  while (typeof current.$ref === 'string') {
    if (seen.has(current.$ref)) throw new Error(`Circular JSON Schema reference for ${label}.`);
    seen.add(current.$ref);
    current = resolveLocalReference(root, current.$ref);
  }
  return current;
}

function asRecord(value: unknown, label: string): JsonSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value as JsonSchema;
}

function asOptionalRecord(value: unknown, label: string): JsonSchema {
  return value === undefined ? {} : asRecord(value, label);
}

function omitRequiredProperty(schema: JsonSchema, property: string, label: string): JsonSchema {
  const properties = asRecord(schema.properties, `${label} properties`);
  if (!Object.hasOwn(properties, property)) {
    throw new Error(`Expected ${label} to define ${property}.`);
  }
  const {[property]: _omittedProperty, ...remainingProperties} = properties;
  const required = asStringArray(schema.required, `${label} required properties`).filter(
    (name) => name !== property,
  );
  const {properties: _properties, required: _required, ...rest} = schema;
  return {...rest, properties: remainingProperties, required};
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Expected ${label} to be an array of strings.`);
  }
  return value as string[];
}

function namespaceLocalDefinitions(schema: JsonSchema, prefix: string): JsonSchema {
  return mapJsonSchema(schema, (key, value) => {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
      return `#/$defs/${prefix}${value.slice('#/$defs/'.length)}`;
    }
    if (key === '$defs') {
      const definitions = asRecord(value, 'JSON Schema definitions');
      return Object.fromEntries(
        Object.entries(definitions).map(([name, definition]) => [
          `${prefix}${name}`,
          mapJsonSchema(definition, (childKey, childValue) => {
            if (
              childKey === '$ref' &&
              typeof childValue === 'string' &&
              childValue.startsWith('#/$defs/')
            ) {
              return `#/$defs/${prefix}${childValue.slice('#/$defs/'.length)}`;
            }
            return childValue;
          }),
        ]),
      );
    }
    return value;
  }) as JsonSchema;
}

function mapJsonSchema(
  value: unknown,
  transform: (key: string, value: unknown) => unknown,
): unknown {
  if (Array.isArray(value)) return value.map((entry) => mapJsonSchema(entry, transform));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const transformed = transform(key, child);
      return [key, transformed === child ? mapJsonSchema(child, transform) : transformed];
    }),
  );
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Unable to generate Tileflow reference.',
    );
    process.exitCode = 1;
  });
}
