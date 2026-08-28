import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  createStyleResult,
  disable,
  land,
  nautical,
  renderPass,
  withRenderStack,
} from '../src';
import {createTileflowCompilationFailure} from '../src/cartography/compilation-report';
import {
  resolveSemanticModules,
  tileflowSemanticDomainMetadata,
  tileflowSemanticDomainRegistry,
  tileflowSemanticModuleNames,
} from '../src/cartography/domain-registry';
import {tileflowLayerDomains} from '../src/cartography/domains';
import {extendStreets} from './map-fixture';

const streetsPreparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

const compileOrder = [
  'land',
  'water',
  'nautical',
  'buildings',
  'vegetation',
  'roads',
  'transit',
  'aeroways',
  'boundaries',
  'labels',
  'landforms',
  'addresses',
  'poi',
] as const;

test('keeps names, defaults, dependencies, and orchestration in one closed registry', () => {
  assert.equal(tileflowSemanticDomainRegistry.length, 13);
  assert.deepEqual(
    tileflowSemanticDomainRegistry.map(({name}) => name),
    compileOrder,
  );
  assert.deepEqual(tileflowSemanticModuleNames, [...compileOrder].sort(compareCodeUnits));
  assert.deepEqual(tileflowLayerDomains, [...tileflowSemanticModuleNames, 'terrain']);
  assert.deepEqual(
    tileflowSemanticDomainMetadata.map(({dependencies, name, order, provides}) => ({
      dependencies,
      name,
      order,
      provides,
    })),
    compileOrder.map((name, order) => ({
      dependencies: {
        modules: name === 'labels' ? ['roads'] : [],
        services: name === 'landforms' || name === 'poi' ? ['language'] : [],
      },
      name,
      order,
      provides: name === 'labels' ? ['language'] : [],
    })),
  );

  const first = resolveSemanticModules(undefined);
  const second = resolveSemanticModules(undefined);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.poi.icons, true);
  assert.equal(first.vegetation.mode, '3d');
});

test('returns a deterministic compilation report without changing the simple style entrypoint', () => {
  const map = extendStreets();
  const options = {inspection: true, preparedAssets: streetsPreparedAssets} as const;
  const first = createStyleResult(map, options);
  const second = createStyleResult(map, options);
  assert.equal(first.ok, true, diagnosticMessages(first));
  assert.equal(second.ok, true, diagnosticMessages(second));
  if (!first.ok || !second.ok) return;

  assert.deepEqual(first, second);
  assert.deepEqual(first.style, createStyle(map, {preparedAssets: streetsPreparedAssets}));
  assert.deepEqual(first.diagnostics, []);
  assert.equal(first.report.schemaVersion, 1);
  assert.equal(first.report.map, 'test-map');
  assert.equal(first.report.theme, 'light');
  assert.deepEqual(
    first.report.domains.map(({name}) => name),
    compileOrder,
  );
  assert.deepEqual(
    first.report.planner.map(({stage}) => stage),
    ['domain-ir', 'assembly', 'render-stack', 'physical-planner', 'lowering'],
  );
  assert.deepEqual(first.report.targets, [...new Set(first.report.targets)].sort(compareCodeUnits));
  assert.deepEqual(
    first.report.requirements,
    first.style.metadata?.['tileflow:sourceRequirements'],
  );
  assert.equal(first.report.provenance?.layers.length, first.style.layers.length);
  assert.ok(first.report.provenance?.layers.every(({contributions}) => contributions.length > 0));

  const simple = createStyle(map, {preparedAssets: streetsPreparedAssets});
  assert.equal(Object.hasOwn(simple, 'ok'), false);
  assert.equal(Object.hasOwn(simple, 'report'), false);
});

test('reports disabled and capability-suppressed domains explicitly', () => {
  const result = createStyleResult(extendStreets({modules: {roads: disable()}}), {
    preparedAssets: streetsPreparedAssets,
  });
  assert.equal(result.ok, true, diagnosticMessages(result));
  if (!result.ok) return;

  const roadsReport = result.report.domains.find(({name}) => name === 'roads');
  assert.deepEqual(roadsReport, {
    contributionCount: 0,
    name: 'roads',
    renderOperationCount: 0,
    status: 'suppressed',
    suppressionReason: 'disabled',
    targets: [],
  });
  const nauticalReport = result.report.domains.find(({name}) => name === 'nautical');
  assert.equal(nauticalReport?.status, 'suppressed');
  assert.equal(nauticalReport?.suppressionReason, 'no-contributions');
  assert.equal(result.report.provenance, undefined);
});

test('reports only semantic contributions and render operations present after planning', () => {
  const nauticalWithUnavailablePass = withRenderStack(nautical(), {
    unavailableCoverage: renderPass({
      attachTo: 'nautical.coverage',
      phase: 'overlay',
      renderer: 'fill',
      requirements: ['nautical'],
      style: {opacity: 0.5},
    }),
  });
  const result = createStyleResult(
    extendStreets({modules: {nautical: nauticalWithUnavailablePass}}),
    {inspection: true, preparedAssets: streetsPreparedAssets},
  );
  assert.equal(result.ok, true, diagnosticMessages(result));
  if (!result.ok) return;

  const nauticalReport = result.report.domains.find(({name}) => name === 'nautical');
  assert.deepEqual(nauticalReport, {
    contributionCount: 0,
    name: 'nautical',
    renderOperationCount: 0,
    status: 'suppressed',
    suppressionReason: 'no-contributions',
    targets: [],
  });
  assert.equal(result.report.targets.includes('nautical.render.unavailableCoverage'), false);
  assert.equal(
    result.report.planner.find(({stage}) => stage === 'render-stack')?.candidateCount,
    1,
  );
  assert.equal(result.report.planner.find(({stage}) => stage === 'render-stack')?.selectedCount, 0);
  assert.equal(
    result.report.provenance?.layers.some(({contributions}) =>
      contributions.some(({target}) => target === 'nautical.render.unavailableCoverage'),
    ),
    false,
  );
});

test('preserves diagnostic domain and target while retaining granular compiler phases', () => {
  const domainFailure = createTileflowCompilationFailure({
    error: {
      code: 'TILEFLOW_DOMAIN_IR_TEST',
      domain: 'land',
      message: 'Invalid semantic target.',
      phase: 'domain-ir',
      target: 'land.background',
    },
    map: 'diagnostic-map',
  });
  assert.deepEqual(domainFailure.diagnostics, [
    {
      code: 'TILEFLOW_DOMAIN_IR_TEST',
      domain: 'land',
      message: 'Invalid semantic target.',
      phase: 'domain-ir',
      severity: 'error',
      target: 'land.background',
    },
  ]);

  const configFailure = createStyleResult({...extendStreets(), projection: 'invalid'} as never);
  assert.equal(configFailure.ok, false);
  if (configFailure.ok) return;
  assert.deepEqual(
    configFailure.diagnostics.map(({code, path, phase}) => ({code, path, phase})),
    [{code: 'CONFIG_INVALID', path: 'projection', phase: 'config-validation'}],
  );

  const themeFailure = createStyleResult(
    extendStreets({modules: {land: land({background: {color: '#123456'}})}}),
  );
  assert.equal(themeFailure.ok, false);
  if (themeFailure.ok) return;
  assert.deepEqual(
    themeFailure.diagnostics.map(({code, domain, phase}) => ({code, domain, phase})),
    [{code: 'THEME_IMPLICIT_FIXED', domain: 'land', phase: 'theme-audit'}],
  );
});

test('returns actionable non-blocking theme diagnostics on successful compilation', () => {
  const result = createStyleResult(
    extendStreets({modules: {land: land({background: {opacity: 0.5}})}}),
    {preparedAssets: streetsPreparedAssets},
  );
  assert.equal(result.ok, true, diagnosticMessages(result));
  if (!result.ok) return;
  assert.deepEqual(
    result.diagnostics.map(({code, domain, path, phase, severity, suggestion}) => ({
      code,
      domain,
      path,
      phase,
      severity,
      hasSuggestion: Boolean(suggestion),
    })),
    [
      {
        code: 'THEME_IMPLICIT_FIXED',
        domain: 'land',
        path: 'modules.land.background.opacity',
        phase: 'theme-audit',
        severity: 'warning',
        hasSuggestion: true,
      },
    ],
  );
});

test('converts compilation failures to stable diagnostics while createStyle still throws', () => {
  const map = extendStreets();
  const result = createStyleResult(map);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(Object.hasOwn(result, 'style'), false);
  assert.equal(result.report.schemaVersion, 1);
  assert.equal(result.report.map, 'test-map');
  assert.equal(result.report.domains.length, 13);
  assert.deepEqual(
    result.report.planner.map(({stage}) => stage),
    ['domain-ir', 'assembly', 'render-stack', 'physical-planner', 'lowering'],
  );
  assert.ok(result.report.targets.length > 0);
  assert.ok(result.report.requirements);
  assert.deepEqual(
    result.diagnostics.map(({code, phase, severity}) => ({code, phase, severity})),
    [{code: 'TILEFLOW_COMPILATION_FAILED', phase: 'assets', severity: 'error'}],
  );
  assert.match(result.diagnostics[0]!.message, /missing images/u);
  assert.throws(() => createStyle(map), /missing images/u);
});

function diagnosticMessages(result: ReturnType<typeof createStyleResult>): string {
  return result.diagnostics.map(({message}) => message).join('; ');
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
