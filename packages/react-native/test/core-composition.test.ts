import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTileflowNativeInitialView,
  TileflowNativeSourceError,
  type TileflowNativeSourceState,
} from '@tileflow/core/native';
import {resolveMapInitialView} from '../src/initial-view';
import {projectMapSourceState} from '../src/source-state';

const theme = {name: 'light', colorScheme: 'light' as const, styleUrl: 'https://maps.example.test/private?secret=value'};

function ready(): Extract<TileflowNativeSourceState, {status: 'ready'; kind: 'tileflow'}> {
  return {
    status: 'ready', kind: 'tileflow', generation: 2,
    source: {kind: 'tileflow', map: 'streets', manifestUrl: 'https://maps.example.test/manifest.json?secret=value'},
    manifestUrl: 'https://maps.example.test/manifest.json?secret=value',
    manifest: {version: 1, maps: {streets: {defaultTheme: 'light', themes: {light: theme}}}},
    map: {name: 'streets', defaultTheme: 'light', themes: {light: theme}},
    theme,
  };
}

test('projects an immutable source diagnostic without URLs, bodies or exception details', () => {
  const source = ready();
  const projected = projectMapSourceState(source);
  assert.deepEqual(projected, {
    status: 'ready', kind: 'tileflow', generation: 2,
    map: 'streets', theme: {name: 'light', colorScheme: 'light'},
  });
  assert.ok(Object.isFrozen(projected));
  if (projected?.status !== 'ready' || projected.kind !== 'tileflow') assert.fail('Expected Tileflow selection.');
  assert.ok(Object.isFrozen(projected.theme));
  assert.equal(Object.isFrozen(source), false);
  assert.equal(JSON.stringify(projected).includes('secret'), false);

  const error = new TileflowNativeSourceError('NATIVE_SOURCE_ABORTED', 'signal');
  Object.defineProperty(error, 'cause', {get() { throw new Error('Remote details.'); }});
  const failure = projectMapSourceState({status: 'error', generation: 3, error});
  assert.deepEqual(failure, {status: 'error', generation: 3,
    error: {code: 'NATIVE_SOURCE_ABORTED', field: 'signal', kind: 'cancelled'}});
  if (failure?.status !== 'error') assert.fail('Expected source error.');
  assert.ok(Object.isFrozen(failure.error));
  assert.equal('message' in failure.error, false);
  assert.equal('cause' in failure.error, false);
});

test('direct, loading and absent source diagnostics preserve the canonical discriminants', () => {
  assert.equal(projectMapSourceState(undefined), undefined);
  assert.deepEqual(projectMapSourceState({status: 'loading', generation: 1}), {status: 'loading', generation: 1});
  const direct = projectMapSourceState({status: 'ready', kind: 'maplibre', generation: 4,
    source: {kind: 'maplibre', style: 'https://maps.example.test/style.json?token=private'}});
  assert.deepEqual(direct, {status: 'ready', kind: 'maplibre', generation: 4});
  assert.ok(Object.isFrozen(direct));
});

test('initial-view composition delegates to Core without changing precedence or error shape', () => {
  const input = {
    manifestView: {center: [-3.7, 40.4] as const, zoom: 8, pitch: 20, bearing: 12},
    mapOptionsView: {zoom: 9, pitch: 30},
    view: {zoom: 11},
  };
  const actual = resolveMapInitialView(input);
  assert.deepEqual(actual, resolveTileflowNativeInitialView(input));
  assert.deepEqual(actual, {center: [-3.7, 40.4], zoom: 11, pitch: 30, bearing: 12});
  assert.ok(Object.isFrozen(actual));
  assert.ok(Object.isFrozen(actual.center));
  assert.equal(Object.isFrozen(input), false);
  assert.deepEqual(resolveMapInitialView({}), resolveTileflowNativeInitialView());
  assert.throws(() => resolveMapInitialView({view: {pitch: 86}}), {
    code: 'NATIVE_SOURCE_INVALID', field: 'view', kind: 'terminal',
  });
});
