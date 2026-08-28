import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {z} from 'zod';
import {tileflowCaptureSceneSchema} from '../src/capture-scene';
import {tileflowDataExpressionLimits} from '../src/cartography/data-expression';
import {tileflowRenderStackLimits} from '../src/cartography/render-stack';
import {tileflowSemanticFieldNames} from '../src/cartography/semantic-bindings';
import {tileflowThemeTokenCategories} from '../src/cartography/values';
import {tileflowMapDefaultMaxDepth, tileflowMapMergeStrategies} from '../src/maps/resolve';
import {resolvedTileflowMapSchema} from '../src/resolved-map-schema';
import {tileflowThemeLimits} from '../src/themes';

const referencePath = fileURLToPath(
  new URL('../../../docs/modules-api-reference.json', import.meta.url),
);

type JsonSchema = Record<string, unknown>;

const authoringMapReference = '#/$defs/TileflowAuthoringMap';
const resolvedMapReference = '#/$defs/ResolvedTileflowMap';
const mapSceneReference = '#/$defs/TileflowMapScene';
const dataExpressionReference = '#/$defs/TileflowDataExpression';
const expressionAstReferences = {
  color: '#/$defs/TileflowDataExpressionColor',
  image: '#/$defs/TileflowDataExpressionImage',
  number: '#/$defs/TileflowDataExpressionNumber',
  structural: '#/$defs/TileflowDataExpressionStructural',
} as const;

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
  enrichDataExpressionSchemas(generatedResolvedMap);
  enrichResolvedMapReference(generatedResolvedMap);
  enrichCaptureSceneReference(generatedMapScene);

  const definitions = asRecord(generatedResolvedMap.$defs, 'resolved map definitions');
  if (Object.hasOwn(definitions, 'TileflowReset')) {
    throw new Error('Generated schema already defines TileflowReset.');
  }
  definitions.TileflowReset = resetSchema;
  const sceneDefinitions = asOptionalRecord(generatedMapScene.$defs, 'capture scene definitions');
  const properties = asRecord(generatedResolvedMap.properties, 'resolved map properties');
  const modulesReference = asRecord(properties.modules, 'modules schema').$ref;
  if (typeof modulesReference !== 'string') {
    throw new Error('The resolved map modules schema must use one local JSON Schema reference.');
  }
  const modulesSchema = resolveLocalReference(generatedResolvedMap, modulesReference);
  const moduleProperties = asRecord(modulesSchema.properties, 'module properties');
  const authoringModuleProperties: Record<string, JsonSchema> = {};
  const patchState = createPatchSchemaState(generatedResolvedMap, definitions);
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
        const resolvedReference = `${modulesReference}/properties/${escapeJsonPointer(name)}`;
        const resolvedDefinitionName = `Tileflow${toPascalCase(name)}ModuleResolved`;
        const authoringDefinitionName = `Tileflow${toPascalCase(name)}ModuleAuthoring`;
        const optionsDefinitionName = `Tileflow${toPascalCase(name)}ModuleOptions`;
        const patchDefinitionName = `Tileflow${toPascalCase(name)}ModulePatch`;
        if (Object.hasOwn(definitions, resolvedDefinitionName)) {
          throw new Error(`Generated resolved module collides with ${resolvedDefinitionName}.`);
        }
        if (Object.hasOwn(definitions, authoringDefinitionName)) {
          throw new Error(`Generated authoring module collides with ${authoringDefinitionName}.`);
        }
        if (Object.hasOwn(definitions, optionsDefinitionName)) {
          throw new Error(`Generated module options collide with ${optionsDefinitionName}.`);
        }
        definitions[resolvedDefinitionName] = {
          $ref: resolvedReference,
          description: `Resolved ${name} semantic-domain request accepted by the compiler.`,
        };
        const authoringModuleSchema = omitTopLevelModuleProperties(moduleSchema, name, ['enabled']);
        const moduleOptionsSchema = omitTopLevelModuleProperties(authoringModuleSchema, name, [
          'type',
        ]);
        definitions[authoringDefinitionName] = authoringModuleSchema;
        definitions[optionsDefinitionName] = {
          ...moduleOptionsSchema,
          description: `Options accepted by ${name}(options); compiler-owned type and enabled fields are omitted.`,
        };
        const stableResolvedReference = `#/$defs/${resolvedDefinitionName}`;
        const optionsReference = `#/$defs/${optionsDefinitionName}`;
        const directReference = `#/$defs/${authoringDefinitionName}`;
        const patchReference = createPatchReference(
          moduleOptionsSchema,
          patchDefinitionName,
          patchState,
        );
        authoringModuleProperties[name] = {
          description: `Author ${name} directly or select one explicit inheritance operation.`,
          oneOf: [
            {$ref: directReference},
            operationSchema('refine', {
              patches: {
                type: 'array',
                minItems: 1,
                items: patchReference,
              },
            }),
            operationSchema('disable'),
          ],
        };
        return [
          name,
          {
            type: name,
            schemaRef: stableResolvedReference,
            authoringSchemaRef: `#/$defs/TileflowAuthoringModules/properties/${escapeJsonPointer(name)}`,
            optionsSchemaRef: optionsReference,
            patchSchemaRef: `#/$defs/${patchDefinitionName}`,
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
  const authoringModulesReference = '#/$defs/TileflowAuthoringModules';
  const sharedAuthoringProperties = {
    ...properties,
    modules: {$ref: authoringModulesReference},
  };

  const scenesSchema = {
    type: 'object',
    propertyNames: properties.id,
    additionalProperties: {$ref: mapSceneReference},
  };
  const authoringProperties = {...sharedAuthoringProperties, scenes: scenesSchema};
  const exclusiveTextProviders = {not: {required: ['fonts', 'glyphs']}};
  const standaloneMapSchema = {
    description:
      'Complete semantic map passed to defineMap(). The sole compiler is implicit and it cannot declare extends.',
    type: 'object',
    properties: authoringProperties,
    required: ['defaultTheme', 'id', 'themes', 'version'],
    additionalProperties: false,
    ...exclusiveTextProviders,
  };
  const derivedMapSchema = {
    description:
      'Inherited semantic map passed to defineMap(). It extends exactly one imported map object.',
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
    $id: 'https://tileflow.dev/schemas/tileflow-config-reference-v3.json',
    schemaVersion: 3,
    kind: 'tileflow.config.reference',
    authority:
      '@tileflow/core resolvedTileflowMapSchema and tileflowCaptureSceneSchema (input); authoring branches are generated from their shared fields',
    description:
      'Generated machine-readable reference for writing and inspecting one singular Tileflow map. The document root is the authoring schema.',
    'x-tileflow-refinement-contract':
      'Standard JSON Schema keywords encode every representable constraint. x-tileflow-refinements records the remaining relational checks enforced by the same Core parser and tileflow validate.',
    'x-tileflow-inheritance': createInheritanceReference(),
    'x-tileflow-theme-contract': createThemeContractReference(),
    entrypoints: {
      authoring: {
        role: 'tileflow.config.ts default export',
        schemaRef: authoringMapReference,
        description:
          'A complete map omits extends; an inherited map references exactly one imported map object. Scenes belong only to the leaf definition.',
      },
      resolved: {
        role: 'validate, inspect, build, and compiler input after inheritance',
        schemaRef: resolvedMapReference,
        description: 'Standalone map with a required name, without extends or scenes.',
      },
    },
    expressions: {
      grammarSchemaRef: dataExpressionReference,
      astSchemaRefs: expressionAstReferences,
    },
    modules,
    $ref: authoringMapReference,
    $defs: {
      TileflowAuthoringMap: {
        description:
          'The singular semantic map exported by tileflow.config.ts: standalone or inherited.',
        oneOf: [{$ref: '#/$defs/TileflowStandaloneMap'}, {$ref: '#/$defs/TileflowDerivedMap'}],
      },
      TileflowStandaloneMap: standaloneMapSchema,
      TileflowDerivedMap: derivedMapSchema,
      TileflowMapScene: {
        description:
          'Leaf-owned capture scene. Its map id is implicit from the containing map and must not be declared.',
        ...mapSceneSchema,
      },
      TileflowAuthoringModules: {
        additionalProperties: false,
        description:
          'Closed semantic-domain record. Direct declarations replace; refine/disable make inheritance intent explicit.',
        properties: authoringModuleProperties,
        type: 'object',
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

function omitTopLevelModuleProperties(
  moduleSchema: JsonSchema,
  name: string,
  omitted: readonly string[],
): JsonSchema {
  const properties = asRecord(moduleSchema.properties, `${name} properties`);
  const authoringProperties = Object.fromEntries(
    Object.entries(properties).filter(([property]) => !omitted.includes(property)),
  );
  const required = Array.isArray(moduleSchema.required)
    ? moduleSchema.required.filter((property) => !omitted.includes(String(property)))
    : moduleSchema.required;
  return {
    ...moduleSchema,
    properties: authoringProperties,
    ...(required === undefined ? {} : {required}),
  };
}

function createThemeContractReference(): JsonSchema {
  return {
    authority:
      '@tileflow/core defineTheme, resolvedTileflowMapSchema, category-safe style schemas, and theme audit',
    identity: {
      selector:
        'Each themes object key is the concrete runtime selector used in manifests, URLs, builds, captures, and receipts.',
      document:
        'theme.id and theme.version are editorial/provenance identity and may differ from the selector key.',
      system:
        'system is reserved for browser selection policy and is never a concrete theme name or compiled artifact key.',
    },
    relationalRules: [
      {
        path: 'defaultTheme',
        enforcement: 'config-validation',
        rule: 'Must name an own entry of themes.',
      },
      {
        path: 'themes.*.tokens.{color,font,image,number}',
        enforcement: 'config-validation',
        rule: 'Every theme on one map must expose exactly the same token keys in every category.',
      },
      {
        path: 'systemThemes.{light,dark}',
        enforcement: 'config-validation',
        rule: 'Each declared selector must exist in themes and its theme.colorScheme must match the system key.',
      },
      {
        path: 'themes.*',
        enforcement: 'theme-resolution',
        rule: 'Unknown, cyclic, and cross-category token references are rejected before style compilation.',
      },
      {
        path: 'modules|terrain',
        enforcement: 'schema-and-theme-audit',
        rule: 'Token categories must match their visual slot directly, in zoom stops, and in expression outputs.',
      },
    ],
    visualIntent: {
      explicitNodes: {
        semantic: 'token.color/font/image/number(name)',
        invariant: 'fixed(value, {reason}) with a non-empty reason',
        derivedColor: 'color.alpha(...) or color.mix(..., {space: "oklch"})',
      },
      implicitLiterals: [
        {
          categories: ['color', 'font', 'image'],
          code: 'THEME_IMPLICIT_FIXED',
          severity: 'error',
          effect:
            'inspect reports the exact semantic path; createStyle, validate, preview, build, and capture fail closed.',
        },
        {
          categories: ['number'],
          code: 'THEME_IMPLICIT_FIXED',
          severity: 'warning',
          effect:
            'inspect reports the exact semantic path; compilation remains valid because ordinary numeric styling is common.',
        },
      ],
    },
  };
}

function createInheritanceReference(): JsonSchema {
  return {
    authority: '@tileflow/core tileflowMapMergeStrategies',
    maxDepth: tileflowMapDefaultMaxDepth,
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
        'Omission inherits. A direct declaration replaces atomically; refine() deep-merges records and replaces arrays/scalars; reset() removes one inherited override; disable() suppresses the domain.',
      'text-assets':
        'One declaration atomically replaces the inherited text provider and removes the other provider kind.',
    },
  };
}

function operationSchema(operation: 'disable' | 'refine', fields: JsonSchema = {}): JsonSchema {
  const properties = {op: {const: operation}, ...fields};
  return {
    additionalProperties: false,
    properties,
    required: ['op', ...Object.keys(fields)],
    type: 'object',
  };
}

const resetSchema: JsonSchema = {
  additionalProperties: false,
  description: 'Serializable reset() sentinel; valid only at a property inside refine().',
  properties: {$tileflow: {const: 'reset'}},
  required: ['$tileflow'],
  type: 'object',
};

type PatchSchemaState = {
  definitions: Record<string, unknown>;
  nextReference: number;
  prefix: string;
  references: Map<string, string>;
  root: JsonSchema;
};

function createPatchReference(
  moduleSchema: JsonSchema,
  definitionName: string,
  state: PatchSchemaState,
): JsonSchema {
  if (Object.hasOwn(state.definitions, definitionName)) {
    throw new Error(`Generated patch definition collides with ${definitionName}.`);
  }
  const targetReference = `#/$defs/${escapeJsonPointer(definitionName)}`;
  state.definitions[definitionName] = {};
  const sourceReference = moduleSchema.$ref;
  const source =
    typeof sourceReference === 'string'
      ? resolveLocalReference(state.root, sourceReference)
      : moduleSchema;
  if (typeof sourceReference === 'string') {
    state.references.set(sourceReference, targetReference);
  }
  state.definitions[definitionName] = transformPatchSchema(source, state);
  return {$ref: targetReference};
}

function createPatchSchemaState(
  root: JsonSchema,
  definitions: Record<string, unknown>,
): PatchSchemaState {
  return {
    definitions,
    nextReference: 1,
    prefix: 'TileflowModulePatch',
    references: new Map(),
    root,
  };
}

function transformPatchSchema(input: JsonSchema, state: PatchSchemaState): JsonSchema {
  if (typeof input.$ref === 'string') return patchReference(input.$ref, state);
  if (input.type === 'array') return cloneSchema(input);
  if (isExpressionObjectSchema(input, state.root)) return cloneSchema(input);

  const result = cloneSchema(input);
  for (const union of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = result[union];
    if (Array.isArray(branches)) {
      result[union] = branches.map((branch) =>
        transformPatchSchema(asRecord(branch, `${union} patch branch`), state),
      );
    }
  }

  const isObject =
    result.type === 'object' ||
    isLooseRecord(result.properties) ||
    isLooseRecord(result.additionalProperties);
  if (!isObject) return result;

  delete result.required;
  if (isLooseRecord(result.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, schema]) => [
        key,
        resettablePatchSchema(
          transformPatchSchema(asRecord(schema, `patch property ${key}`), state),
        ),
      ]),
    );
  }
  if (isLooseRecord(result.additionalProperties)) {
    result.additionalProperties = resettablePatchSchema(
      transformPatchSchema(result.additionalProperties, state),
    );
  }
  return result;
}

function enrichDataExpressionSchemas(root: JsonSchema): void {
  const definitions = asRecord(root.$defs, 'resolved map definitions');
  const categories = ['structural', 'number', 'color', 'image'] as const;
  type ExpressionCategory = (typeof categories)[number];
  const categorySuffix = (category: ExpressionCategory): string =>
    `${category[0].toUpperCase()}${category.slice(1)}`;
  const categoryExpressionReferences: Readonly<Record<ExpressionCategory, string>> =
    expressionAstReferences;
  const categoryValueReferences = Object.fromEntries(
    categories.map((category) => [
      category,
      `#/$defs/TileflowExpressionCategoryValue${categorySuffix(category)}`,
    ]),
  ) as Record<ExpressionCategory, string>;
  const refs = {
    expression: dataExpressionReference,
    field: '#/$defs/TileflowSemanticFieldReference',
    json: '#/$defs/TileflowJsonValue',
    operand: '#/$defs/TileflowDataExpressionOperand',
    themeColorNode: '#/$defs/TileflowExpressionThemeColorNode',
    themeColor: '#/$defs/TileflowExpressionThemeColorValue',
    themeNumberNode: '#/$defs/TileflowExpressionThemeNumberNode',
    themeNumber: '#/$defs/TileflowExpressionThemeNumberValue',
  } as const;
  for (const name of [
    'TileflowDataExpression',
    'TileflowDataExpressionOperand',
    ...categories.map((category) => `TileflowDataExpression${categorySuffix(category)}`),
    ...categories.map((category) => `TileflowExpressionCategoryValue${categorySuffix(category)}`),
    'TileflowExpressionThemeColorNode',
    'TileflowExpressionThemeColorValue',
    'TileflowExpressionThemeNumberNode',
    'TileflowExpressionThemeNumberValue',
    'TileflowJsonValue',
    'TileflowSemanticFieldReference',
  ]) {
    if (Object.hasOwn(definitions, name)) {
      throw new Error(`Generated schema already defines ${name}.`);
    }
  }

  definitions.TileflowJsonValue = {
    description: 'Finite JSON value accepted only behind expr.literal().',
    oneOf: [
      {type: 'null'},
      {type: 'boolean'},
      {type: 'number'},
      {type: 'string'},
      {type: 'array', items: {$ref: refs.json}},
      {type: 'object', additionalProperties: {$ref: refs.json}},
    ],
  };
  definitions.TileflowSemanticFieldReference = {
    additionalProperties: false,
    description: 'Schema-bound semantic field emitted by field(name); never a physical column.',
    properties: {
      kind: {const: 'tileflow-data-field'},
      name: {enum: tileflowSemanticFieldNames, type: 'string'},
    },
    required: ['kind', 'name'],
    type: 'object',
  };

  const themeToken = (category?: 'color' | 'number'): JsonSchema => ({
    additionalProperties: false,
    properties: {
      category: category ? {const: category} : {enum: tileflowThemeTokenCategories, type: 'string'},
      kind: {const: 'theme-token'},
      token: {
        pattern: '^[A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z][A-Za-z0-9_-]*)*$',
        type: 'string',
      },
    },
    required: ['category', 'kind', 'token'],
    type: 'object',
  });
  const fixed = (value: JsonSchema): JsonSchema => ({
    additionalProperties: false,
    properties: {
      kind: {const: 'theme-fixed'},
      reason: {minLength: 1, type: 'string'},
      value,
    },
    required: ['kind', 'reason', 'value'],
    type: 'object',
  });
  definitions.TileflowExpressionThemeNumberNode = {
    oneOf: [themeToken('number'), fixed({type: 'number'})],
  };
  definitions.TileflowExpressionThemeNumberValue = {
    oneOf: [{type: 'number'}, {$ref: refs.themeNumberNode}],
  };
  definitions.TileflowExpressionThemeColorNode = {
    oneOf: [
      themeToken('color'),
      fixed({type: 'string'}),
      {
        additionalProperties: false,
        properties: {
          color: {$ref: refs.themeColor},
          kind: {const: 'theme-color'},
          opacity: {$ref: refs.themeNumber},
          operation: {const: 'alpha'},
        },
        required: ['color', 'kind', 'opacity', 'operation'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          amount: {$ref: refs.themeNumber},
          from: {$ref: refs.themeColor},
          kind: {const: 'theme-color'},
          operation: {const: 'mix'},
          space: {const: 'oklch'},
          to: {$ref: refs.themeColor},
        },
        required: ['amount', 'from', 'kind', 'operation', 'space', 'to'],
        type: 'object',
      },
    ],
  };
  definitions.TileflowExpressionThemeColorValue = {
    oneOf: [{type: 'string'}, {$ref: refs.themeColorNode}],
  };
  definitions.TileflowDataExpressionOperand = {
    description: 'One typed operand or nested node from the closed expr.* language.',
    anyOf: [
      {type: 'null'},
      {type: 'boolean'},
      {type: 'number'},
      {type: 'string'},
      {$ref: refs.expression},
      themeToken(),
      fixed({$ref: refs.json}),
      {$ref: refs.themeColorNode},
    ],
  };

  const operand = {$ref: refs.operand};
  const exact = (operator: string, items: readonly JsonSchema[]): JsonSchema => ({
    type: 'array',
    prefixItems: [{const: operator}, ...items],
    items: false,
    minItems: items.length + 1,
    maxItems: items.length + 1,
  });
  const variadic = (operator: string, minimum: number): JsonSchema => ({
    type: 'array',
    prefixItems: [{const: operator}],
    items: operand,
    minItems: minimum + 1,
    maxItems: tileflowDataExpressionLimits.maxOperands + 1,
  });
  const matchLabelPrimitive: JsonSchema = {
    oneOf: [{type: 'boolean'}, {type: 'number'}, {type: 'string'}],
  };
  const matchLabel: JsonSchema = {
    oneOf: [
      matchLabelPrimitive,
      {type: 'array', minItems: 1, items: {type: 'boolean'}},
      {type: 'array', minItems: 1, items: {type: 'number'}},
      {type: 'array', minItems: 1, items: {type: 'string'}},
    ],
  };
  const interpolation: JsonSchema = {
    oneOf: [
      {
        type: 'array',
        prefixItems: [{const: 'linear'}],
        items: false,
        minItems: 1,
        maxItems: 1,
      },
      {
        type: 'array',
        prefixItems: [{const: 'exponential'}, {type: 'number', exclusiveMinimum: 0}],
        items: false,
        minItems: 2,
        maxItems: 2,
      },
      {
        type: 'array',
        prefixItems: [
          {const: 'cubic-bezier'},
          {type: 'number'},
          {type: 'number'},
          {type: 'number'},
          {type: 'number'},
        ],
        items: false,
        minItems: 5,
        maxItems: 5,
      },
    ],
  };
  const branchCounts = Array.from(
    {length: tileflowDataExpressionLimits.maxBranches},
    (_, index) => index + 1,
  );
  const stopCounts = Array.from(
    {length: tileflowDataExpressionLimits.maxStops},
    (_, index) => index + 1,
  );
  const cases = branchCounts.map((count) =>
    exact('case', [...Array.from({length: count}, () => [operand, operand]).flat(), operand]),
  );
  const matches = branchCounts.map((count) =>
    exact('match', [
      operand,
      ...Array.from({length: count}, () => [matchLabel, operand]).flat(),
      operand,
    ]),
  );
  const steps = stopCounts.map((count) =>
    exact('step', [
      operand,
      operand,
      ...Array.from({length: count}, () => [{type: 'number'}, operand]).flat(),
    ]),
  );
  const interpolations = stopCounts.map((count) =>
    exact('interpolate', [
      interpolation,
      operand,
      ...Array.from({length: count}, () => [{type: 'number'}, operand]).flat(),
    ]),
  );
  definitions.TileflowDataExpression = {
    description:
      'Exact serialized AST emitted by expr.*. Alternating branches/stops are bounded and tuple-checked.',
    oneOf: [
      exact('get', [{$ref: refs.field}]),
      exact('has', [{$ref: refs.field}]),
      exact('literal', [{$ref: refs.json}]),
      exact('zoom', []),
      exact('feature-state', [{minLength: 1, type: 'string'}]),
      exact('var', [{minLength: 1, type: 'string'}]),
      exact('let', [{minLength: 1, type: 'string'}, operand, operand]),
      ...['abs', '!', 'to-string'].map((operator) => exact(operator, [operand])),
      exact('boolean', [operand]),
      exact('boolean', [operand, operand]),
      exact('to-number', [operand]),
      exact('to-number', [operand, operand]),
      ...['-', '/', '!=', '<', '<=', '==', '>', '>='].map((operator) =>
        exact(operator, [operand, operand]),
      ),
      ...['+', '*', 'min', 'max', 'coalesce', 'concat'].map((operator) => variadic(operator, 2)),
      ...['all', 'any'].map((operator) => variadic(operator, 1)),
      ...cases,
      ...matches,
      ...steps,
      ...interpolations,
    ],
    'x-tileflow-refinements': [
      'expr.var names must resolve in the lexical scope of one enclosing expr.let.',
      'match labels are unique and share one primitive type.',
      'step/interpolate stops are finite and strictly increasing.',
    ],
  };

  const semanticThemeKinds = ['theme-color', 'theme-fixed', 'theme-token'];
  for (const category of categories) {
    const valueReference = categoryValueReferences[category];
    const allowedThemeNodes: JsonSchema[] =
      category === 'number'
        ? [{$ref: refs.themeNumberNode}, fixed({type: 'array', items: {type: 'number'}})]
        : category === 'color'
          ? [{$ref: refs.themeColorNode}]
          : category === 'image'
            ? [themeToken('image'), fixed({type: 'string'})]
            : [];
    definitions[`TileflowExpressionCategoryValue${categorySuffix(category)}`] = {
      description: `Recursive JSON guard for ${category} expression theme nodes.`,
      oneOf: [
        {type: 'null'},
        {type: 'boolean'},
        {type: 'number'},
        {type: 'string'},
        {type: 'array', items: {$ref: valueReference}},
        ...allowedThemeNodes,
        {
          type: 'object',
          not: {
            properties: {kind: {enum: semanticThemeKinds}},
            required: ['kind'],
          },
          additionalProperties: {$ref: valueReference},
        },
      ],
    };
    definitions[`TileflowDataExpression${categorySuffix(category)}`] = {
      description: `Exact serialized AST for a ${category} Tileflow data-expression slot.`,
      allOf: [{$ref: refs.expression}, {$ref: valueReference}],
      'x-tileflow-expression-category': category,
    };
  }

  const foundCategories = new Set<ExpressionCategory>();
  rewriteExpressionValueSchemas(
    root,
    root,
    new WeakSet<object>(),
    categoryExpressionReferences,
    foundCategories,
  );
  for (const category of categories) {
    if (!foundCategories.has(category)) {
      throw new Error(`Generated schema does not expose a ${category} data-expression slot.`);
    }
  }
}

function rewriteExpressionValueSchemas(
  root: JsonSchema,
  value: unknown,
  visited: WeakSet<object>,
  expressionReferences: Readonly<Record<'color' | 'image' | 'number' | 'structural', string>>,
  foundCategories: Set<'color' | 'image' | 'number' | 'structural'>,
): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (!Array.isArray(value)) {
    const schema = value as JsonSchema;
    const properties = isLooseRecord(schema.properties) ? schema.properties : undefined;
    const kindSchema = properties?.kind;
    if (
      properties &&
      isLooseRecord(kindSchema) &&
      resolveSchemaConstant(root, kindSchema) === 'expression'
    ) {
      const marker = 'tileflow-data-expression:';
      if (typeof schema.description !== 'string' || !schema.description.startsWith(marker)) {
        throw new Error('Generated expression schema is missing its output-category marker.');
      }
      const category = schema.description.slice(marker.length);
      if (!Object.hasOwn(expressionReferences, category)) {
        throw new Error(`Generated expression schema has unknown output category ${category}.`);
      }
      const typedCategory = category as keyof typeof expressionReferences;
      properties.value = {$ref: expressionReferences[typedCategory]};
      schema.description = `Typed ${category} Tileflow data-expression wrapper.`;
      schema['x-tileflow-expression-category'] = category;
      foundCategories.add(typedCategory);
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    rewriteExpressionValueSchemas(root, child, visited, expressionReferences, foundCategories);
  }
}

function resolveSchemaConstant(root: JsonSchema, schema: JsonSchema): unknown {
  const resolved =
    typeof schema.$ref === 'string' ? resolveLocalReference(root, schema.$ref) : schema;
  return resolved.const;
}

function isExpressionObjectSchema(schema: JsonSchema, root: JsonSchema): boolean {
  if (!isLooseRecord(schema.properties)) return false;
  const kind = schema.properties.kind;
  return isLooseRecord(kind) && resolveSchemaConstant(root, kind) === 'expression';
}

function patchReference(reference: string, state: PatchSchemaState): JsonSchema {
  const existing = state.references.get(reference);
  if (existing) return {$ref: existing};

  const name = `${state.prefix}Ref${state.nextReference}`;
  state.nextReference += 1;
  const target = `#/$defs/${escapeJsonPointer(name)}`;
  state.references.set(reference, target);
  state.definitions[name] = {};
  state.definitions[name] = transformPatchSchema(
    resolveLocalReference(state.root, reference),
    state,
  );
  return {$ref: target};
}

function resettablePatchSchema(schema: JsonSchema): JsonSchema {
  return {oneOf: [{$ref: '#/$defs/TileflowReset'}, schema]};
}

function cloneSchema<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toPascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ''}${segment.slice(1)}`)
    .join('');
}

export async function serializeTileflowConfigReference(): Promise<string> {
  const repositoryFormat = await resolveConfig(referencePath);
  return format(JSON.stringify(createTileflowConfigReference(), null, 2), {
    ...repositoryFormat,
    parser: 'json',
  });
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
  enrichRenderStackConstraints(schema);
  enrichSemanticBoundaryConstraints(schema);
  enrichZoomValueConstraints(schema);
  enrichTerrainColorConstraints(schema);
  enrichTrimmedMarineAttributionConstraints(schema);
  enrichIdentifierConstraints(schema);
  enrichExactFontConstraints(schema);
  enrichLineHatchConstraints(schema);
  enrichPoiRankConstraints(schema);
  enrichDirectDataConstraints(schema);
  enrichTerrainContourConstraints(schema);
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
      {kind: 'package-directory', package: '@tileflow/maps', path: 'assets/cyberpunk/icons'},
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
      path: '**.hatch.patternWidths[]',
      rule: 'Literal pattern widths must be strictly increasing.',
    },
    {
      path: 'terrain.contours.demUrl',
      rule: 'Must be a safe WHATWG HTTP(S) DEM template containing each of {z}, {x}, and {y} exactly once.',
    },
    {
      path: 'terrain.contours.thresholds.*',
      rule: 'The index interval must be greater than or equal to, and a whole multiple of, the minor interval.',
    },
    {
      path: 'terrain.contours.{thresholds,multiplier}',
      rule: 'Every minor interval must satisfy the zoom- and multiplier-dependent main-thread contour density budget.',
    },
    {
      path: 'terrain.contours.{thresholds,minZoom,maxZoom,overzoom}',
      rule: 'The source range must cover its threshold zooms, minZoom must not exceed maxZoom, and overzoom must not produce a negative DEM zoom.',
    },
    {
      path: 'terrain.contours.{minor,index,labels}.{minZoom,maxZoom}',
      rule: 'Each layer range must begin at or after the effective contour-source minZoom and include its own effective minZoom.',
    },
  ];
}

function enrichZoomValueConstraints(schema: JsonSchema): void {
  let matches = 0;
  visitJsonSchema(schema, (node) => {
    if (!Array.isArray(node.oneOf) || node.oneOf.length !== 3) return;
    const branches = node.oneOf.map((branch) =>
      dereferenceSchema(schema, asRecord(branch, 'zoom value branch'), 'zoom value branch'),
    );
    const interpolations = branches.map((branch) => {
      if (!isLooseRecord(branch.properties)) return undefined;
      const kind = branch.properties.kind;
      const interpolation = branch.properties.interpolation;
      const stops = branch.properties.stops;
      if (!isLooseRecord(kind) || !isLooseRecord(interpolation) || !isLooseRecord(stops)) {
        return undefined;
      }
      if (resolveSchemaConstant(schema, kind) !== 'zoom') return undefined;
      return resolveSchemaConstant(schema, interpolation);
    });
    if (!interpolations.every((value): value is string => typeof value === 'string')) return;
    if (
      [...interpolations].sort(compareCodeUnits).join('\0') !==
      ['exponential', 'linear', 'step'].join('\0')
    ) {
      return;
    }
    matches += 1;
    node['x-tileflow-refinements'] = [
      {path: 'stops.*.0', rule: 'Zoom stops must be finite and strictly increasing.'},
    ];
  });
  if (matches === 0) throw new Error('Expected at least one generated zoom-value schema.');
}

function enrichTerrainColorConstraints(schema: JsonSchema): void {
  const hexPattern = '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';
  const channel =
    '0*(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])(?:\\.[0-9]+)?|255(?:\\.0+)?)';
  const alpha = '0*(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)';
  const rgbPattern = `^rgba?\\(\\s*${channel}\\s*,\\s*${channel}\\s*,\\s*${channel}(?:\\s*,\\s*${alpha})?\\s*\\)$`;
  let matches = 0;
  visitJsonSchema(schema, (node) => {
    if (!Array.isArray(node.anyOf) || node.anyOf.length !== 2) return;
    const branches = node.anyOf.map((branch) =>
      dereferenceSchema(schema, asRecord(branch, 'terrain color branch'), 'terrain color branch'),
    );
    if (!branches.some((branch) => branch.pattern === hexPattern)) return;
    const rgb = branches.find((branch) => branch.type === 'string' && branch.pattern === undefined);
    if (!rgb) throw new Error('Terrain color schema is missing its rgb()/rgba() branch.');
    matches += 1;
    rgb.pattern = rgbPattern;
    rgb.description =
      'Exact rgb()/rgba() color with decimal channels from 0 through 255 and optional alpha from 0 through 1.';
    node.description = 'Exact Tileflow hex, rgb(), or rgba() color literal.';
  });
  if (matches !== 1) {
    throw new Error(`Expected exactly one terrain color literal schema; found ${matches}.`);
  }
}

function enrichTrimmedMarineAttributionConstraints(schema: JsonSchema): void {
  let matches = 0;
  visitJsonSchema(schema, (node) => {
    if (!isLooseRecord(node.properties) || !isLooseRecord(node.properties.attribution)) return;
    const attribution = dereferenceSchema(
      schema,
      node.properties.attribution,
      'marine attribution',
    );
    if (
      attribution.type !== 'string' ||
      attribution.minLength !== 1 ||
      attribution.maxLength !== 2_048
    ) {
      return;
    }
    matches += 1;
    attribution.pattern = '^(?!\\s)(?!.*\\s$)[\\s\\S]+$';
    attribution.description =
      'Non-empty marine attribution without leading or trailing whitespace.';
  });
  if (matches !== 3) {
    throw new Error(`Expected exactly three strict marine attribution schemas; found ${matches}.`);
  }
}

function enrichRenderStackConstraints(schema: JsonSchema): void {
  const renderStacks: JsonSchema[] = [];
  visitJsonSchema(schema, (node) => {
    if (node.description === 'tileflow-render-stack') renderStacks.push(node);
  });
  if (renderStacks.length !== 1) {
    throw new Error(
      `Expected exactly one render-stack schema marker; found ${renderStacks.length}.`,
    );
  }

  const [renderStack] = renderStacks;
  renderStack.minProperties = 1;
  renderStack.maxProperties = tileflowRenderStackLimits.maxOperations;
  renderStack['x-tileflow-limits'] = cloneSchema(tileflowRenderStackLimits);

  const operationSchema = dereferenceSchema(
    schema,
    asRecord(renderStack.additionalProperties, 'render-stack operations'),
    'render-stack operations',
  );
  const requirementsSchemas = new Set<JsonSchema>();
  const selectorSchemas = new Set<JsonSchema>();
  visitJsonSchema(operationSchema, (node) => {
    if (!isLooseRecord(node.properties) || !isLooseRecord(node.properties.kind)) return;
    const kind = resolveSchemaConstant(schema, node.properties.kind);
    if (kind !== 'render-pass' && kind !== 'refine-render-target') return;
    if (isLooseRecord(node.properties.requirements)) {
      requirementsSchemas.add(
        dereferenceSchema(schema, node.properties.requirements, 'render requirements'),
      );
    }
    if (isLooseRecord(node.properties.selector)) {
      selectorSchemas.add(dereferenceSchema(schema, node.properties.selector, 'render selector'));
    }
  });
  if (requirementsSchemas.size !== 1) {
    throw new Error(
      `Expected one shared render-requirements schema; found ${requirementsSchemas.size}.`,
    );
  }
  if (selectorSchemas.size !== 1) {
    throw new Error(`Expected one shared render-selector schema; found ${selectorSchemas.size}.`);
  }

  const [requirements] = requirementsSchemas;
  if (
    requirements.type !== 'array' ||
    requirements.minItems !== 1 ||
    requirements.maxItems !== tileflowRenderStackLimits.maxRequirements
  ) {
    throw new Error('Render requirements lost their public array limits.');
  }
  requirements.uniqueItems = true;
  requirements.description = `Between one and ${tileflowRenderStackLimits.maxRequirements} unique semantic-domain requirements.`;

  const [selector] = selectorSchemas;
  selector.description = 'Bounded recursive semantic render selector.';
  selector['x-tileflow-limits'] = {
    maxDepth: tileflowRenderStackLimits.maxSelectorDepth,
    maxNodes: tileflowRenderStackLimits.maxSelectorNodes,
  };
  selector['x-tileflow-refinements'] = [
    {
      path: '$',
      rule: `The root is level one; the complete selector may contain at most ${tileflowRenderStackLimits.maxSelectorDepth} levels and ${tileflowRenderStackLimits.maxSelectorNodes} nodes.`,
    },
    {
      path: '**.step.stops.*.zoom',
      rule: 'Zoom values must be finite and strictly increasing in authored order.',
    },
  ];

  const matches = {groups: 0, inValues: 0, matchBranches: 0, matchValues: 0, steps: 0};
  visitJsonSchema(schema, (node) => {
    if (!isLooseRecord(node.properties) || !isLooseRecord(node.properties.kind)) return;
    const kind = resolveSchemaConstant(schema, node.properties.kind);
    if (kind === 'in' && isLooseRecord(node.properties.values)) {
      const values = dereferenceSchema(schema, node.properties.values, 'in selector values');
      if (values.maxItems !== tileflowRenderStackLimits.maxScalarValues) {
        throw new Error('Render in-selector values lost their public maximum.');
      }
      matches.inValues += 1;
      return;
    }
    if (kind === 'match' && isLooseRecord(node.properties.branches)) {
      const branches = dereferenceSchema(
        schema,
        node.properties.branches,
        'match selector branches',
      );
      if (branches.maxItems !== tileflowRenderStackLimits.maxMatchBranches) {
        throw new Error('Render match-selector branches lost their public maximum.');
      }
      const branch = dereferenceSchema(
        schema,
        asRecord(branches.items, 'match selector branch'),
        'match selector branch',
      );
      const branchProperties = asRecord(branch.properties, 'match selector branch properties');
      const values = dereferenceSchema(
        schema,
        asRecord(branchProperties.values, 'match selector branch values'),
        'match selector branch values',
      );
      if (values.maxItems !== tileflowRenderStackLimits.maxScalarValues) {
        throw new Error('Render match-selector values lost their public maximum.');
      }
      matches.matchBranches += 1;
      matches.matchValues += 1;
      return;
    }
    if (kind === 'step' && isLooseRecord(node.properties.stops)) {
      const stops = dereferenceSchema(schema, node.properties.stops, 'step selector stops');
      if (stops.maxItems !== tileflowRenderStackLimits.maxStepStops) {
        throw new Error('Render step-selector stops lost their public maximum.');
      }
      stops['x-tileflow-refinements'] = [
        {
          path: '*.zoom',
          rule: 'Zoom values must be finite and strictly increasing in authored order.',
        },
      ];
      matches.steps += 1;
      return;
    }
    const selectorKinds = node.properties.kind.enum;
    if (
      Array.isArray(selectorKinds) &&
      selectorKinds.length === 2 &&
      selectorKinds.includes('all') &&
      selectorKinds.includes('any') &&
      isLooseRecord(node.properties.selectors)
    ) {
      const selectors = dereferenceSchema(
        schema,
        node.properties.selectors,
        'render selector children',
      );
      if (selectors.maxItems !== tileflowRenderStackLimits.maxSelectorChildren) {
        throw new Error('Render selector children lost their public maximum.');
      }
      matches.groups += 1;
    }
  });
  for (const [name, count] of Object.entries(matches)) {
    if (count === 0) throw new Error(`Expected at least one generated render-selector ${name}.`);
  }
}

function enrichSemanticBoundaryConstraints(schema: JsonSchema): void {
  const publicUrlPattern =
    '^(?!\\s)(?!.*\\s$)(?!//)(?!.*[#\\\\\\u0000-\\u001F\\u007F])(?:(?:https?://(?![^/?#]*@)|pmtiles://).+|/(?!/).*)$';
  const matches = {publicUrl: 0, publicDemUrl: 0, renderStack: 0, themes: 0};
  visitJsonSchema(schema, (node) => {
    switch (node.description) {
      case 'tileflow-public-vector-url':
        matches.publicUrl += 1;
        node.minLength = 1;
        node.maxLength = 4_096;
        node.pattern = publicUrlPattern;
        node.description =
          'Bounded public vector URL: HTTPS, loopback HTTP, root-relative, or pmtiles://; no surrounding whitespace, controls, backslash, fragment, protocol-relative form, or URL credentials.';
        node['x-tileflow-refinement'] =
          'Must pass the exact Core WHATWG/PMTiles parser, including loopback-host and safe archive-target checks.';
        break;
      case 'tileflow-public-dem-url':
        matches.publicDemUrl += 1;
        node.pattern = publicUrlPattern;
        node.not = {pattern: '^pmtiles://'};
        node.description =
          'Bounded public DEM TileJSON URL: HTTPS, loopback HTTP, or root-relative; PMTiles is not accepted.';
        node['x-tileflow-refinement'] =
          'Must pass the exact Core public-vector URL parser and must not use pmtiles://.';
        break;
      case 'tileflow-render-stack':
        matches.renderStack += 1;
        node.minProperties = 1;
        node.description = 'Non-empty named render-stack operations owned by one semantic domain.';
        break;
      case 'tileflow-themes':
        matches.themes += 1;
        node.minProperties = 1;
        node.maxProperties = tileflowThemeLimits.maxThemes;
        node.description = `Between one and ${tileflowThemeLimits.maxThemes} concrete named themes.`;
        break;
    }
  });
  for (const [name, count] of Object.entries(matches)) {
    if (count !== 1) {
      throw new Error(`Expected exactly one ${name} schema marker; found ${count}.`);
    }
  }
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

function enrichLineHatchConstraints(schema: JsonSchema): void {
  let matches = 0;
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const properties = node.properties as Record<string, unknown>;
    if (!properties.patternWidths || !properties.pattern) return;
    matches += 1;
    const pattern = dereferenceSchema(
      schema,
      asRecord(properties.pattern, 'line hatch pattern'),
      'line hatch pattern',
    );
    if (!Array.isArray(pattern.anyOf)) {
      throw new Error('Line hatch pattern must expose themed, expression, and zoom branches.');
    }
    const themedPattern = pattern.anyOf
      .map((branch) => asRecord(branch, 'line hatch pattern branch'))
      .find((branch) => isThemeImageValueSchema(schema, branch));
    if (!themedPattern) {
      throw new Error('Line hatch pattern is missing its literal/token/fixed image branch.');
    }

    const patternWidths = dereferenceSchema(
      schema,
      asRecord(properties.patternWidths, 'line hatch pattern widths'),
      'line hatch pattern widths',
    );
    if (!Array.isArray(patternWidths.anyOf) || patternWidths.anyOf.length !== 2) {
      throw new Error('Line hatch pattern widths must expose direct and fixed array branches.');
    }
    const widthBranches = patternWidths.anyOf.map((branch) =>
      dereferenceSchema(
        schema,
        asRecord(branch, 'line hatch width branch'),
        'line hatch width branch',
      ),
    );
    const directWidths = widthBranches.find((branch) => branch.type === 'array');
    const fixedWidths = widthBranches.find(
      (branch) =>
        isLooseRecord(branch.properties) &&
        resolveSchemaConstant(schema, asRecord(branch.properties.kind, 'fixed width kind')) ===
          'theme-fixed',
    );
    if (!directWidths?.items || !fixedWidths || !isLooseRecord(fixedWidths.properties)) {
      throw new Error('Line hatch pattern widths have an unexpected generated shape.');
    }
    constrainHatchWidthArray(directWidths);
    const fixedValue = dereferenceSchema(
      schema,
      asRecord(fixedWidths.properties.value, 'fixed line hatch widths'),
      'fixed line hatch widths',
    );
    if (fixedValue.type !== 'array' || !fixedValue.items) {
      throw new Error('Fixed line hatch pattern widths must contain an array.');
    }
    fixedValue.minItems = 2;
    fixedValue.items = {type: 'integer', minimum: 1, maximum: 1_024};

    appendAllOf(node, {
      if: {
        required: ['patternWidths'],
        properties: {patternWidths: {not: {$ref: '#/$defs/TileflowReset'}}},
      },
      then: {required: ['pattern'], properties: {pattern: cloneSchema(themedPattern)}},
    });
    node['x-tileflow-refinements'] = [
      {
        path: 'patternWidths',
        rule: 'At least two literal/fixed integer widths from 1 through 1024; known numeric widths must be strictly increasing.',
      },
    ];
  });
  if (matches !== 1) {
    throw new Error(`Expected exactly one line hatch schema; found ${matches}.`);
  }
}

function constrainHatchWidthArray(schema: JsonSchema): void {
  const items = asRecord(schema.items, 'line hatch width item');
  schema.minItems = 2;
  schema.items = {
    allOf: [
      cloneSchema(items),
      {
        if: {type: 'number'},
        then: {type: 'integer', minimum: 1, maximum: 1_024},
      },
      {
        if: {properties: {kind: {const: 'theme-fixed'}}, required: ['kind']},
        then: {properties: {value: {type: 'integer', minimum: 1, maximum: 1_024}}},
      },
    ],
  };
}

function isThemeImageValueSchema(root: JsonSchema, input: JsonSchema): boolean {
  const schema = dereferenceSchema(root, input, 'themed image value');
  if (!Array.isArray(schema.anyOf)) return false;
  let fixed = false;
  let literal = false;
  let token = false;
  for (const rawBranch of schema.anyOf) {
    const branch = dereferenceSchema(
      root,
      asRecord(rawBranch, 'themed image value branch'),
      'themed image value branch',
    );
    if (branch.type === 'string') {
      literal = true;
      continue;
    }
    if (!isLooseRecord(branch.properties)) continue;
    const kind = resolveSchemaConstant(root, asRecord(branch.properties.kind, 'theme image kind'));
    if (kind === 'theme-fixed') {
      const value = dereferenceSchema(
        root,
        asRecord(branch.properties.value, 'fixed image value'),
        'fixed image value',
      );
      fixed = value.type === 'string';
    } else if (kind === 'theme-token') {
      token =
        resolveSchemaConstant(
          root,
          asRecord(branch.properties.category, 'theme image category'),
        ) === 'image';
    }
  }
  return fixed && literal && token;
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

function enrichTerrainContourConstraints(schema: JsonSchema): void {
  let matches = 0;
  visitJsonSchema(schema, (node) => {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      return;
    }
    const properties = node.properties as Record<string, unknown>;
    if (
      !properties.demMaxZoom ||
      !properties.demUrl ||
      !properties.maxZoom ||
      !properties.minZoom ||
      !properties.overzoom ||
      !properties.thresholds
    ) {
      return;
    }
    matches += 1;

    const demUrl = dereferenceSchema(
      schema,
      asRecord(properties.demUrl, 'contour DEM URL'),
      'contour DEM URL',
    );
    demUrl.description =
      'Safe HTTP(S) DEM tile template containing each of {z}, {x}, and {y} exactly once; credentials, fragments, protocol-relative URLs, backslashes, controls, and non-loopback plain HTTP are forbidden.';
    demUrl['x-tileflow-refinement'] =
      'Must pass the exact Core DEM-template parser, including WHATWG URL and loopback checks.';

    const thresholds = dereferenceSchema(
      schema,
      asRecord(properties.thresholds, 'contour thresholds'),
      'contour thresholds',
    );
    thresholds.minProperties = 1;
    thresholds.maxProperties = 25;
    thresholds.description =
      'One to 25 zoom-indexed [minor, index] elevation intervals; zoom keys are integers from 0 through 24.';
    thresholds['x-tileflow-refinements'] = [
      {
        path: '*',
        rule: 'The index interval must be greater than or equal to, and a whole multiple of, the minor interval.',
      },
      {
        path: '*[0]',
        rule: 'The minor interval must satisfy the zoom- and multiplier-dependent main-thread contour density budget.',
      },
    ];

    node['x-tileflow-refinements'] = [
      {
        path: 'demUrl',
        rule: 'Must pass the exact safe HTTP(S) DEM-template parser described on the property.',
      },
      {
        path: 'maxZoom',
        rule: 'When present, must include the greatest threshold zoom.',
      },
      {
        path: 'minZoom',
        rule: 'When present, must not precede the smallest threshold zoom and must not exceed the effective maxZoom.',
      },
      {
        path: 'overzoom',
        rule: 'Must not exceed the smallest threshold zoom, so generated DEM zooms cannot become negative.',
      },
      {
        path: '{minor,index,labels}.{minZoom,maxZoom}',
        rule: 'Each layer minZoom must not precede the effective contour-source minZoom, and each layer maxZoom must include its effective minZoom.',
      },
    ];
  });
  if (matches !== 1) {
    throw new Error(`Expected exactly one terrain contour schema; found ${matches}.`);
  }
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
