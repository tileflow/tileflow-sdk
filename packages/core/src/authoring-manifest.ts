import {
  tileflowCompilationPhases,
  tileflowCompilationPlannerStages,
  tileflowCompilationReportSchemaVersion,
} from './cartography/compilation-report';
import {
  tileflowRenderStackOperationNamePattern,
  tileflowSemanticTargetPattern,
} from './cartography/contributions';
import {expr, tileflowDataExpressionLimits} from './cartography/data-expression';
import {
  tileflowSemanticDomainMetadata,
  type TileflowSemanticModuleName,
} from './cartography/domain-registry';
import {
  tileflowRenderSelectorComparisons,
  tileflowRenderSelectorGeometries,
  tileflowRenderSelectorKinds,
  tileflowRenderStackLimits,
  tileflowRenderStackPhases,
  tileflowRenderStackRenderers,
} from './cartography/render-stack';
import {
  tileflowSemanticFieldNames,
  tileflowSemanticLayerNames,
} from './cartography/semantic-bindings';
import {tileflowSemanticCompilerIdentity} from './cartography/semantic-compiler';
import {tileflowMapDefaultMaxDepth} from './maps/resolve';

export const tileflowAuthoringManifestSchemaVersion = 1 as const;

export type TileflowAuthoringCommandName =
  | 'explain'
  | 'inspect'
  | 'language-manifest'
  | 'language-schema'
  | 'semantic-diff'
  | 'validate';

export type TileflowAuthoringCommandOutputKind =
  | 'command-envelope'
  | 'raw-authoring-manifest'
  | 'raw-config-reference';

export type TileflowAuthoringCommand = Readonly<{
  command: string;
  name: TileflowAuthoringCommandName;
  output: string;
  outputKind: TileflowAuthoringCommandOutputKind;
  /** Stable identifier for the exact versioned JSON contract emitted on success. */
  outputSchemaRef: string;
  outputVersion: 1 | 3;
  purpose: string;
  writes: false;
}>;

export type TileflowAuthoringExpressionBuilder = Readonly<{
  arguments: readonly string[];
  name: keyof typeof expr;
  returns: string;
  serializedOperator: string;
}>;

export type TileflowAuthoringOperation = Readonly<{
  api: string;
  description: string;
  name:
    | 'define-map'
    | 'data-expression'
    | 'disable-domain'
    | 'extend-map'
    | 'refine-domain'
    | 'refine-render-target'
    | 'render-pass'
    | 'reset-value'
    | 'replace-domain';
  scope: 'domain' | 'expression' | 'map' | 'render-stack';
}>;

export type TileflowAuthoringManifestDomain = Readonly<{
  api: string;
  authoringSchemaRef: string;
  dependencies: Readonly<{
    modules: readonly TileflowSemanticModuleName[];
    services: readonly string[];
  }>;
  name: TileflowSemanticModuleName;
  optionsSchemaRef: string;
  order: number;
  patchSchemaRef: string;
  provides: readonly string[];
  resolvedSchemaRef: string;
  targetDiscovery: Readonly<{
    command: 'tileflow explain --json';
    domain: TileflowSemanticModuleName;
    reportPath: 'compilation.report.domains[].targets';
  }>;
}>;

export type TileflowAuthoringManifest = Readonly<{
  compilation: Readonly<{
    diagnostic: Readonly<{
      optional: readonly ['domain', 'path', 'suggestion', 'target'];
      phases: typeof tileflowCompilationPhases;
      required: readonly ['code', 'message', 'phase', 'severity'];
      severities: readonly ['error', 'warning'];
    }>;
    report: Readonly<{
      domain: Readonly<{
        optional: readonly ['suppressionReason'];
        required: readonly [
          'contributionCount',
          'name',
          'renderOperationCount',
          'status',
          'targets',
        ];
        statuses: readonly ['emitted', 'suppressed'];
        suppressionReasons: readonly ['disabled', 'no-contributions'];
      }>;
      optional: readonly ['provenance', 'requirements', 'theme'];
      planner: Readonly<{
        optional: readonly ['candidateCount', 'selectedCount'];
        required: readonly ['inputCount', 'outputCount', 'stage'];
        stages: typeof tileflowCompilationPlannerStages;
      }>;
      required: readonly ['domains', 'map', 'planner', 'schemaVersion', 'targets'];
      schemaVersion: typeof tileflowCompilationReportSchemaVersion;
    }>;
    physicalInspection: Readonly<{
      addressable: false;
      command: 'tileflow explain --inspection --json';
      mode: 'opt-in-read-only';
      reportPath: 'compilation.report.provenance';
      stability: 'physical-output-only';
    }>;
    result: Readonly<{
      discriminator: 'ok';
      failure: Readonly<{
        forbidden: readonly ['style'];
        ok: false;
        required: readonly ['diagnostics', 'ok', 'report'];
      }>;
      success: Readonly<{
        ok: true;
        required: readonly ['diagnostics', 'ok', 'report', 'style'];
      }>;
    }>;
  }>;
  compiler: Readonly<{
    name: typeof tileflowSemanticCompilerIdentity.name;
    version: typeof tileflowSemanticCompilerIdentity.version;
  }>;
  commands: readonly TileflowAuthoringCommand[];
  domains: readonly TileflowAuthoringManifestDomain[];
  expressions: Readonly<{
    builders: readonly TileflowAuthoringExpressionBuilder[];
    categorySchemaRefs: Readonly<{
      color: '#/$defs/TileflowDataExpressionColor';
      image: '#/$defs/TileflowDataExpressionImage';
      number: '#/$defs/TileflowDataExpressionNumber';
      structural: '#/$defs/TileflowDataExpressionStructural';
    }>;
    limits: typeof tileflowDataExpressionLimits;
    fieldReference: 'field(name)';
  }>;
  language: 'tileflow-semantic-v1';
  operations: readonly TileflowAuthoringOperation[];
  renderStack: Readonly<{
    comparisons: readonly string[];
    features: readonly string[];
    fields: readonly string[];
    geometries: readonly string[];
    limits: typeof tileflowRenderStackLimits;
    operationNamePattern: string;
    phases: readonly string[];
    renderers: readonly string[];
    selectorKinds: readonly string[];
    targetPattern: string;
  }>;
  resolution: Readonly<{
    arrays: 'replace';
    domains: 'replace-refine-disable-reset';
    identity: 'leaf-owned';
    inheritance: Readonly<{maxDepth: typeof tileflowMapDefaultMaxDepth}>;
    namedRecords: 'merge-by-key';
    records: 'deep-merge';
    scalars: 'replace';
    themes: 'replace-collection';
    view: 'deep-merge';
  }>;
  schemaVersion: typeof tileflowAuthoringManifestSchemaVersion;
  schemas: Readonly<{
    authoring: '#/$defs/TileflowAuthoringMap';
    document: 'https://tileflow.dev/schemas/tileflow-config-reference-v3.json';
    modules: '#/$defs/TileflowAuthoringModules';
    resolved: '#/$defs/ResolvedTileflowMap';
  }>;
  workflows: Readonly<{
    author: readonly ['validate', 'inspect', 'explain'];
    discover: readonly ['language-manifest', 'language-schema'];
    review: readonly ['semantic-diff', 'validate', 'explain'];
  }>;
}>;

const operations: readonly TileflowAuthoringOperation[] = [
  {
    api: 'defineMap({ ... })',
    description: 'Define one complete map for the implicit semantic compiler.',
    name: 'define-map',
    scope: 'map',
  },
  {
    api: 'defineMap({ extends, ... })',
    description: 'Extend one imported map; identity remains leaf-owned.',
    name: 'extend-map',
    scope: 'map',
  },
  {
    api: 'modules.<domain> = <domain>(options)',
    description: 'Replace one inherited domain request atomically by its registry key.',
    name: 'replace-domain',
    scope: 'domain',
  },
  {
    api: 'modules.<domain> = refine(...patches)',
    description: 'Deeply compose records while replacing arrays and scalar values.',
    name: 'refine-domain',
    scope: 'domain',
  },
  {
    api: 'reset()',
    description: 'Inside refine(), remove an inherited override and restore the registry default.',
    name: 'reset-value',
    scope: 'domain',
  },
  {
    api: 'modules.<domain> = disable()',
    description: 'Suppress every contribution owned by one semantic domain.',
    name: 'disable-domain',
    scope: 'domain',
  },
  {
    api: 'expr.<builder>(...) and field(name)',
    description: 'Build typed data expressions against semantic schema fields.',
    name: 'data-expression',
    scope: 'expression',
  },
  {
    api: 'withRenderStack(module, { name: renderPass(...) })',
    description: 'Add an owner-local semantic pass around a semantic target.',
    name: 'render-pass',
    scope: 'render-stack',
  },
  {
    api: 'withRenderStack(module, { name: refineRenderTarget(...) })',
    description: 'Refine an owner-local semantic target without a physical layer patch.',
    name: 'refine-render-target',
    scope: 'render-stack',
  },
];

const commands: readonly TileflowAuthoringCommand[] = [
  {
    command: 'tileflow language manifest --json',
    name: 'language-manifest',
    output: 'The complete versioned semantic language, operations, domains, and workflows.',
    outputKind: 'raw-authoring-manifest',
    outputSchemaRef: 'urn:tileflow:schema:authoring-manifest:v1',
    outputVersion: 1,
    purpose: 'Discover the finite public authoring surface without reading implementation code.',
    writes: false,
  },
  {
    command: 'tileflow language schema --json',
    name: 'language-schema',
    output: 'Exact authoring, options, patch, resolved, scene, and expression JSON Schemas.',
    outputKind: 'raw-config-reference',
    outputSchemaRef: 'https://tileflow.dev/schemas/tileflow-config-reference-v3.json',
    outputVersion: 3,
    purpose: 'Generate only values accepted by runtime validation and the semantic compiler.',
    writes: false,
  },
  {
    command: 'tileflow validate --json',
    name: 'validate',
    output: 'Structured diagnostics for the complete resolved map and its local inputs.',
    outputKind: 'command-envelope',
    outputSchemaRef: 'urn:tileflow:schema:cli:validate:v1',
    outputVersion: 1,
    purpose: 'Reject invalid authoring before any build, write, or network operation.',
    writes: false,
  },
  {
    command: 'tileflow inspect --json',
    name: 'inspect',
    output: 'Resolved semantic configuration, inheritance lineage, assets, and audit findings.',
    outputKind: 'command-envelope',
    outputSchemaRef: 'urn:tileflow:schema:cli:inspect:v1',
    outputVersion: 1,
    purpose: 'Inspect what the compiler will receive after deterministic inheritance resolution.',
    writes: false,
  },
  {
    command: 'tileflow explain --json',
    name: 'explain',
    output: 'Compilation diagnostics, domain targets, planner decisions, and optional provenance.',
    outputKind: 'command-envelope',
    outputSchemaRef: 'urn:tileflow:schema:cli:explain:v1',
    outputVersion: 1,
    purpose: 'Explain how semantic authoring becomes a physical MapLibre style.',
    writes: false,
  },
  {
    command: 'tileflow semantic-diff --from-config <path> --to-config <path> --json',
    name: 'semantic-diff',
    output: 'Deterministic JSON Pointer changes between two resolved semantic maps.',
    outputKind: 'command-envelope',
    outputSchemaRef: 'urn:tileflow:schema:cli:semantic-diff:v1',
    outputVersion: 1,
    purpose: 'Review authoring intent without comparing generated physical layer JSON.',
    writes: false,
  },
];

const expressionBuilders: readonly TileflowAuthoringExpressionBuilder[] = [
  {arguments: ['value: number'], name: 'abs', returns: 'number', serializedOperator: 'abs'},
  {
    arguments: ['first: number', 'second: number', '...rest: number[]'],
    name: 'add',
    returns: 'number',
    serializedOperator: '+',
  },
  {
    arguments: ['first: boolean', '...rest: boolean[]'],
    name: 'all',
    returns: 'boolean',
    serializedOperator: 'all',
  },
  {
    arguments: ['first: boolean', '...rest: boolean[]'],
    name: 'any',
    returns: 'boolean',
    serializedOperator: 'any',
  },
  {
    arguments: ['branches: nonempty {when: boolean, value: T}[]', 'fallback: T'],
    name: 'case',
    returns: 'T',
    serializedOperator: 'case',
  },
  {
    arguments: ['first: T', '...rest: T[] (at least one)'],
    name: 'coalesce',
    returns: 'T',
    serializedOperator: 'coalesce',
  },
  {
    arguments: ['first: string', '...rest: string[] (at least one)'],
    name: 'concat',
    returns: 'string',
    serializedOperator: 'concat',
  },
  {
    arguments: ['dividend: number', 'divisor: number'],
    name: 'divide',
    returns: 'number',
    serializedOperator: '/',
  },
  {
    arguments: ['left: T', 'right: T'],
    name: 'eq',
    returns: 'boolean',
    serializedOperator: '==',
  },
  {
    arguments: ['name: nonempty string'],
    name: 'featureState',
    returns: 'unknown',
    serializedOperator: 'feature-state',
  },
  {
    arguments: ['reference: field(name)'],
    name: 'get',
    returns: 'registered field value',
    serializedOperator: 'get',
  },
  {
    arguments: ['left: T', 'right: T'],
    name: 'gt',
    returns: 'boolean',
    serializedOperator: '>',
  },
  {
    arguments: ['left: T', 'right: T'],
    name: 'gte',
    returns: 'boolean',
    serializedOperator: '>=',
  },
  {
    arguments: ['reference: field(name)'],
    name: 'has',
    returns: 'boolean',
    serializedOperator: 'has',
  },
  {
    arguments: [
      'interpolation: linear | exponential(base) | cubic-bezier(x1,y1,x2,y2)',
      'input: number',
      'stops: nonempty strictly-increasing [number, T][]',
    ],
    name: 'interpolate',
    returns: 'T',
    serializedOperator: 'interpolate',
  },
  {
    arguments: ['name: nonempty string', 'value: T', 'body: R'],
    name: 'let',
    returns: 'R',
    serializedOperator: 'let',
  },
  {
    arguments: ['value: finite JSON'],
    name: 'literal',
    returns: 'literal value',
    serializedOperator: 'literal',
  },
  {
    arguments: ['left: T', 'right: T'],
    name: 'lt',
    returns: 'boolean',
    serializedOperator: '<',
  },
  {
    arguments: ['left: T', 'right: T'],
    name: 'lte',
    returns: 'boolean',
    serializedOperator: '<=',
  },
  {
    arguments: [
      'input: boolean | number | string',
      'branches: nonempty {labels, value: T}[]',
      'fallback: T',
    ],
    name: 'match',
    returns: 'T',
    serializedOperator: 'match',
  },
  {
    arguments: ['first: number', 'second: number', '...rest: number[]'],
    name: 'max',
    returns: 'number',
    serializedOperator: 'max',
  },
  {
    arguments: ['first: number', 'second: number', '...rest: number[]'],
    name: 'min',
    returns: 'number',
    serializedOperator: 'min',
  },
  {
    arguments: ['first: number', 'second: number', '...rest: number[]'],
    name: 'multiply',
    returns: 'number',
    serializedOperator: '*',
  },
  {
    arguments: ['left: T', 'right: T'],
    name: 'ne',
    returns: 'boolean',
    serializedOperator: '!=',
  },
  {
    arguments: ['value: boolean'],
    name: 'not',
    returns: 'boolean',
    serializedOperator: '!',
  },
  {
    arguments: [
      'input: number',
      'fallback: T',
      'stops: nonempty strictly-increasing [number, T][]',
    ],
    name: 'step',
    returns: 'T',
    serializedOperator: 'step',
  },
  {
    arguments: ['minuend: number', 'subtrahend: number'],
    name: 'subtract',
    returns: 'number',
    serializedOperator: '-',
  },
  {
    arguments: ['value: unknown', 'fallback?: boolean'],
    name: 'toBoolean',
    returns: 'boolean',
    serializedOperator: 'boolean',
  },
  {
    arguments: ['value: unknown', 'fallback?: number'],
    name: 'toNumber',
    returns: 'number',
    serializedOperator: 'to-number',
  },
  {
    arguments: ['value: unknown'],
    name: 'toString',
    returns: 'string',
    serializedOperator: 'to-string',
  },
  {
    arguments: ['name: nonempty bound variable'],
    name: 'var',
    returns: 'T',
    serializedOperator: 'var',
  },
  {arguments: [], name: 'zoom', returns: 'number', serializedOperator: 'zoom'},
];

assertExpressionBuilderManifest();

/**
 * Stable, JSON-serializable description of the complete public V1 authoring surface.
 * Domain order and dependencies come directly from the closed compiler registry.
 */
export const tileflowAuthoringManifest: TileflowAuthoringManifest = deepFreeze({
  compilation: {
    diagnostic: {
      optional: ['domain', 'path', 'suggestion', 'target'],
      phases: tileflowCompilationPhases,
      required: ['code', 'message', 'phase', 'severity'],
      severities: ['error', 'warning'],
    },
    report: {
      domain: {
        optional: ['suppressionReason'],
        required: ['contributionCount', 'name', 'renderOperationCount', 'status', 'targets'],
        statuses: ['emitted', 'suppressed'],
        suppressionReasons: ['disabled', 'no-contributions'],
      },
      optional: ['provenance', 'requirements', 'theme'],
      planner: {
        optional: ['candidateCount', 'selectedCount'],
        required: ['inputCount', 'outputCount', 'stage'],
        stages: tileflowCompilationPlannerStages,
      },
      required: ['domains', 'map', 'planner', 'schemaVersion', 'targets'],
      schemaVersion: tileflowCompilationReportSchemaVersion,
    },
    physicalInspection: {
      addressable: false,
      command: 'tileflow explain --inspection --json',
      mode: 'opt-in-read-only',
      reportPath: 'compilation.report.provenance',
      stability: 'physical-output-only',
    },
    result: {
      discriminator: 'ok',
      failure: {
        forbidden: ['style'],
        ok: false,
        required: ['diagnostics', 'ok', 'report'],
      },
      success: {
        ok: true,
        required: ['diagnostics', 'ok', 'report', 'style'],
      },
    },
  },
  compiler: {
    name: tileflowSemanticCompilerIdentity.name,
    version: tileflowSemanticCompilerIdentity.version,
  },
  commands,
  domains: tileflowSemanticDomainMetadata.map(({dependencies, name, order, provides}) => ({
    api: `${name}(options?)`,
    authoringSchemaRef: `#/$defs/TileflowAuthoringModules/properties/${name}`,
    dependencies: {
      modules: [...dependencies.modules],
      services: [...dependencies.services],
    },
    name,
    optionsSchemaRef: `#/$defs/Tileflow${toPascalCase(name)}ModuleOptions`,
    order,
    patchSchemaRef: `#/$defs/Tileflow${toPascalCase(name)}ModulePatch`,
    provides: [...provides],
    resolvedSchemaRef: `#/$defs/Tileflow${toPascalCase(name)}ModuleResolved`,
    targetDiscovery: {
      command: 'tileflow explain --json',
      domain: name,
      reportPath: 'compilation.report.domains[].targets',
    },
  })),
  expressions: {
    builders: expressionBuilders,
    categorySchemaRefs: {
      color: '#/$defs/TileflowDataExpressionColor',
      image: '#/$defs/TileflowDataExpressionImage',
      number: '#/$defs/TileflowDataExpressionNumber',
      structural: '#/$defs/TileflowDataExpressionStructural',
    },
    limits: tileflowDataExpressionLimits,
    fieldReference: 'field(name)',
  },
  language: 'tileflow-semantic-v1',
  operations,
  renderStack: {
    comparisons: [...tileflowRenderSelectorComparisons],
    features: [...tileflowSemanticLayerNames],
    fields: [...tileflowSemanticFieldNames],
    geometries: [...tileflowRenderSelectorGeometries],
    limits: tileflowRenderStackLimits,
    operationNamePattern: tileflowRenderStackOperationNamePattern.source,
    phases: [...tileflowRenderStackPhases],
    renderers: [...tileflowRenderStackRenderers],
    selectorKinds: [...tileflowRenderSelectorKinds],
    targetPattern: tileflowSemanticTargetPattern.source,
  },
  resolution: {
    arrays: 'replace',
    domains: 'replace-refine-disable-reset',
    identity: 'leaf-owned',
    inheritance: {maxDepth: tileflowMapDefaultMaxDepth},
    namedRecords: 'merge-by-key',
    records: 'deep-merge',
    scalars: 'replace',
    themes: 'replace-collection',
    view: 'deep-merge',
  },
  schemaVersion: tileflowAuthoringManifestSchemaVersion,
  schemas: {
    authoring: '#/$defs/TileflowAuthoringMap',
    document: 'https://tileflow.dev/schemas/tileflow-config-reference-v3.json',
    modules: '#/$defs/TileflowAuthoringModules',
    resolved: '#/$defs/ResolvedTileflowMap',
  },
  workflows: {
    author: ['validate', 'inspect', 'explain'],
    discover: ['language-manifest', 'language-schema'],
    review: ['semantic-diff', 'validate', 'explain'],
  },
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('');
}

function assertExpressionBuilderManifest(): void {
  const runtime = Object.keys(expr).sort(compareCodeUnits);
  const documented = expressionBuilders.map(({name}) => name).sort(compareCodeUnits);
  if (
    runtime.length !== documented.length ||
    runtime.some((name, index) => name !== documented[index])
  ) {
    throw new Error('Tileflow authoring manifest does not describe every expr.* builder exactly.');
  }
}
