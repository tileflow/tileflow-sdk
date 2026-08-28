import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diffTileflowMaps,
  disable,
  fixed,
  isTileflowCompilationPhase,
  parseTileflowMap,
  tileflowAuthoringManifest,
  tileflowAuthoringManifestSchemaVersion,
  tileflowCompilationPhases,
  tileflowCompilationPlannerStages,
  tileflowMapDefaultMaxDepth,
  tileflowRenderStackLimits,
  tileflowSemanticDiffSchemaVersion,
  water,
} from '../src';
import {tileflowSemanticDomainMetadata} from '../src/cartography/domain-registry';
import {
  tileflowSemanticFieldNames,
  tileflowSemanticLayerNames,
} from '../src/cartography/semantic-bindings';
import {extendStreets} from './map-fixture';

test('publishes a frozen V1 authoring manifest derived from the closed domain registry', () => {
  assert.equal(tileflowAuthoringManifest.schemaVersion, tileflowAuthoringManifestSchemaVersion);
  assert.equal(tileflowAuthoringManifest.language, 'tileflow-semantic-v1');
  assert.deepEqual(
    tileflowAuthoringManifest.domains,
    tileflowSemanticDomainMetadata.map(({dependencies, name, order, provides}) => ({
      api: `${name}(options?)`,
      authoringSchemaRef: `#/$defs/TileflowAuthoringModules/properties/${name}`,
      dependencies: {
        modules: [...dependencies.modules],
        services: [...dependencies.services],
      },
      name,
      optionsSchemaRef: `#/$defs/Tileflow${name[0]!.toUpperCase()}${name.slice(1)}ModuleOptions`,
      order,
      patchSchemaRef: `#/$defs/Tileflow${name[0]!.toUpperCase()}${name.slice(1)}ModulePatch`,
      provides: [...provides],
      resolvedSchemaRef: `#/$defs/Tileflow${name[0]!.toUpperCase()}${name.slice(1)}ModuleResolved`,
      targetDiscovery: {
        command: 'tileflow explain --json',
        domain: name,
        reportPath: 'compilation.report.domains[].targets',
      },
    })),
  );
  assert.deepEqual(
    tileflowAuthoringManifest.operations.map(({name}) => name),
    [
      'define-map',
      'extend-map',
      'replace-domain',
      'refine-domain',
      'reset-value',
      'disable-domain',
      'data-expression',
      'render-pass',
      'refine-render-target',
    ],
  );
  assert.deepEqual(tileflowAuthoringManifest.resolution, {
    arrays: 'replace',
    domains: 'replace-refine-disable-reset',
    identity: 'leaf-owned',
    inheritance: {maxDepth: tileflowMapDefaultMaxDepth},
    namedRecords: 'merge-by-key',
    records: 'deep-merge',
    scalars: 'replace',
    themes: 'replace-collection',
    view: 'deep-merge',
  });
  assert.ok(
    tileflowAuthoringManifest.expressions.builders.some(({name}) => name === 'interpolate'),
  );
  assert.deepEqual(tileflowAuthoringManifest.expressions.builders.map(({name}) => name).sort(), [
    'abs',
    'add',
    'all',
    'any',
    'case',
    'coalesce',
    'concat',
    'divide',
    'eq',
    'featureState',
    'get',
    'gt',
    'gte',
    'has',
    'interpolate',
    'let',
    'literal',
    'lt',
    'lte',
    'match',
    'max',
    'min',
    'multiply',
    'ne',
    'not',
    'step',
    'subtract',
    'toBoolean',
    'toNumber',
    'toString',
    'var',
    'zoom',
  ]);
  assert.deepEqual(tileflowAuthoringManifest.expressions.categorySchemaRefs, {
    color: '#/$defs/TileflowDataExpressionColor',
    image: '#/$defs/TileflowDataExpressionImage',
    number: '#/$defs/TileflowDataExpressionNumber',
    structural: '#/$defs/TileflowDataExpressionStructural',
  });
  assert.deepEqual(tileflowAuthoringManifest.expressions.limits, {
    maxBranches: 16,
    maxOperands: 16,
    maxStops: 16,
  });
  assert.equal(tileflowAuthoringManifest.expressions.fieldReference, 'field(name)');
  assert.deepEqual(
    tileflowAuthoringManifest.commands.map(
      ({name, outputKind, outputSchemaRef, outputVersion, writes}) => ({
        name,
        outputKind,
        outputSchemaRef,
        outputVersion,
        writes,
      }),
    ),
    [
      {
        name: 'language-manifest',
        outputKind: 'raw-authoring-manifest',
        outputSchemaRef: 'urn:tileflow:schema:authoring-manifest:v1',
        outputVersion: 1,
        writes: false,
      },
      {
        name: 'language-schema',
        outputKind: 'raw-config-reference',
        outputSchemaRef: 'https://tileflow.dev/schemas/tileflow-config-reference-v3.json',
        outputVersion: 3,
        writes: false,
      },
      {
        name: 'validate',
        outputKind: 'command-envelope',
        outputSchemaRef: 'urn:tileflow:schema:cli:validate:v1',
        outputVersion: 1,
        writes: false,
      },
      {
        name: 'inspect',
        outputKind: 'command-envelope',
        outputSchemaRef: 'urn:tileflow:schema:cli:inspect:v1',
        outputVersion: 1,
        writes: false,
      },
      {
        name: 'explain',
        outputKind: 'command-envelope',
        outputSchemaRef: 'urn:tileflow:schema:cli:explain:v1',
        outputVersion: 1,
        writes: false,
      },
      {
        name: 'semantic-diff',
        outputKind: 'command-envelope',
        outputSchemaRef: 'urn:tileflow:schema:cli:semantic-diff:v1',
        outputVersion: 1,
        writes: false,
      },
    ],
  );
  assert.deepEqual(tileflowAuthoringManifest.schemas, {
    authoring: '#/$defs/TileflowAuthoringMap',
    document: 'https://tileflow.dev/schemas/tileflow-config-reference-v3.json',
    modules: '#/$defs/TileflowAuthoringModules',
    resolved: '#/$defs/ResolvedTileflowMap',
  });
  assert.deepEqual(tileflowAuthoringManifest.workflows, {
    author: ['validate', 'inspect', 'explain'],
    discover: ['language-manifest', 'language-schema'],
    review: ['semantic-diff', 'validate', 'explain'],
  });
  assert.deepEqual(tileflowAuthoringManifest.renderStack.features, tileflowSemanticLayerNames);
  assert.deepEqual(tileflowAuthoringManifest.renderStack.fields, tileflowSemanticFieldNames);
  assert.deepEqual(tileflowAuthoringManifest.renderStack.limits, tileflowRenderStackLimits);
  assert.equal(tileflowAuthoringManifest.renderStack.operationNamePattern, '^[a-z][A-Za-z0-9_-]*$');
  assert.equal(
    tileflowAuthoringManifest.renderStack.targetPattern,
    '^[a-z][a-z0-9-]*(?:\\.[A-Za-z0-9_-]+)*$',
  );
  assert.deepEqual(
    tileflowAuthoringManifest.compilation.report.planner.stages,
    tileflowCompilationPlannerStages,
  );
  assert.deepEqual(
    tileflowAuthoringManifest.compilation.diagnostic.phases,
    tileflowCompilationPhases,
  );
  for (const phase of tileflowCompilationPhases) {
    assert.equal(isTileflowCompilationPhase(phase), true);
  }
  assert.equal(isTileflowCompilationPhase('semantic-magic'), false);
  assert.deepEqual(tileflowAuthoringManifest.compilation.result.success.required, [
    'diagnostics',
    'ok',
    'report',
    'style',
  ]);
  assert.deepEqual(tileflowAuthoringManifest.compilation.result.failure.forbidden, ['style']);
  assert.deepEqual(tileflowAuthoringManifest.compilation.physicalInspection, {
    addressable: false,
    command: 'tileflow explain --inspection --json',
    mode: 'opt-in-read-only',
    reportPath: 'compilation.report.provenance',
    stability: 'physical-output-only',
  });
  assert.ok(Object.isFrozen(tileflowAuthoringManifest));
  assert.ok(Object.isFrozen(tileflowAuthoringManifest.domains));
  assert.ok(Object.isFrozen(tileflowAuthoringManifest.domains[0]!.dependencies.modules));
});

test('semantic diff accepts resolved compiler state and excludes identity-only changes', () => {
  const difference = diffTileflowMaps(
    parseTileflowMap(
      extendStreets({
        id: 'before',
        modules: {water: disable()},
        name: 'Before',
        version: 1,
      }),
    ),
    parseTileflowMap(
      extendStreets({
        id: 'after',
        modules: {water: disable()},
        name: 'After',
        version: 9,
      }),
    ),
  );

  assert.deepEqual(difference, {
    changes: [],
    from: {id: 'before', version: 1},
    schemaVersion: tileflowSemanticDiffSchemaVersion,
    summary: {add: 0, change: 0, remove: 0, total: 0},
    to: {id: 'after', version: 9},
  });
});

test('semantic diff emits deterministic RFC 6901 paths and treats arrays atomically', () => {
  const before = extendStreets({
    id: 'before',
    modules: {
      water: water({
        bodies: {
          fill: {
            opacity: fixed(0.8, {reason: 'Regression fixture keeps a fixed water density'}),
          },
        },
      }),
    },
    view: {center: [-3.7, 40.4], zoom: 12},
  });
  const after = extendStreets({
    id: 'after',
    modules: {water: disable()},
    projection: 'globe',
    view: {center: [-3.69, 40.41], zoom: 13},
  });

  const first = diffTileflowMaps(before, after);
  const second = diffTileflowMaps(before, after);
  assert.deepEqual(first, second);
  assert.deepEqual(first.changes, [
    {
      before: {
        fill: {
          opacity: {
            kind: 'theme-fixed',
            reason: 'Regression fixture keeps a fixed water density',
            value: 0.8,
          },
        },
      },
      kind: 'remove',
      path: '/modules/water/bodies',
    },
    {after: false, kind: 'add', path: '/modules/water/enabled'},
    {after: 'globe', kind: 'add', path: '/projection'},
    {
      after: [-3.69, 40.41],
      before: [-3.7, 40.4],
      kind: 'change',
      path: '/view/center',
    },
    {after: 13, before: 12, kind: 'change', path: '/view/zoom'},
  ]);
  assert.deepEqual(first.summary, {add: 2, change: 2, remove: 1, total: 5});
  assert.ok(first.changes.every(({path}) => path === '' || path.startsWith('/')));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.changes));
});
