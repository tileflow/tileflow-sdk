import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {constantName} from './mobile-codegen.mjs';
import {renderMapApi, validateMapApi} from './mobile-map-api.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const contract = JSON.parse(await read('platforms/map-api.json'));
const clone = () => structuredClone(contract);

test('contract rules reject definitions the hosts could not honour', () => {
  const cases = [
    ['events.error', (value) => (value.events.error = {level: 'essential'})],
    ['events.tap', (value) => (value.events.tap = {level: 'everything'})],
    [
      'eventLevels.continuous',
      (value) => {
        delete value.events.cameraMoved;
      },
    ],
    ['methods', (value) => value.methods.push('initialize')],
    ['dispose', (value) => (value.methods = value.methods.filter((name) => name !== 'dispose'))],
    ['recoverable', (value) => delete value.errors.timeout.recoverable],
    ['sources', (value) => (value.errors.timeout.sources = ['browser'])],
    ['cancelled', (value) => (value.errors.cancelled.sources = ['host'])],
    [
      'maximumDataBytes',
      (value) => (value.limits.maximumDataBytes = value.limits.maximumDataTotalBytes + 1),
    ],
    ['cameraReasons', (value) => (value.cameraReasons.gesture = '')],
    ['errors.timeout', (value) => (value.errors.timeout.description = 'No sentence')],
  ];
  for (const [expected, change] of cases) {
    const value = clone();
    change(value);
    const problems = validateMapApi(value);
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      `${expected}: ${problems.join('; ')}`,
    );
  }
});

test('hosts receive every method, event and error with its classification', () => {
  const outputs = renderMapApi(contract);
  const swiftContract = outputs['platforms/ios/Sources/Tileflow/Model/MapContract.swift'];
  const swiftTypes = outputs['platforms/ios/Sources/Tileflow/MapTypes.swift'];
  const kotlinContract =
    outputs['platforms/android/tileflow/src/main/java/dev/tileflow/sdk/model/MapContract.kt'];
  const kotlinTypes =
    outputs['platforms/android/tileflow/src/main/java/dev/tileflow/sdk/MapTypes.kt'];
  for (const method of contract.methods) {
    assert.ok(swiftContract.includes(`    case ${method}\n`), method);
    assert.ok(kotlinContract.includes(`${constantName(method)}("${method}"),`), method);
  }
  for (const [name, event] of Object.entries(contract.events)) {
    const level = event.level ? `.${event.level}` : 'nil';
    assert.ok(swiftContract.includes(`case .${name}: ${level}\n`), name);
    const kotlinLevel = event.level ? `TileflowEventLevel.${constantName(event.level)}` : 'null';
    assert.ok(kotlinContract.includes(`${constantName(name)}("${name}", ${kotlinLevel}),`), name);
  }
  for (const [code, error] of Object.entries(contract.errors)) {
    assert.ok(swiftTypes.includes(`case .${code}: ${error.recoverable}\n`), code);
    assert.ok(
      kotlinTypes.includes(`${constantName(code)}("${code}", ${error.recoverable}),`),
      code,
    );
  }
  assert.ok(kotlinContract.includes('const val MAXIMUM_DATA_BYTES = 33_554_432'));
  assert.ok(swiftContract.includes('static let maximumDataBytes = 33_554_432'));
});

test('generated names follow each platform convention', () => {
  assert.equal(constantName('setCamera'), 'SET_CAMERA');
  assert.equal(constantName('invalidGeoJSON'), 'INVALID_GEO_JSON');
  assert.equal(constantName('maximumDataTotalBytes'), 'MAXIMUM_DATA_TOTAL_BYTES');
  assert.equal(constantName('scene'), 'SCENE');
});

test('an invalid contract is never rendered', () => {
  const value = clone();
  value.limits.maximumDataBytes = 0;
  assert.throws(() => renderMapApi(value), /Invalid map-api\.json/u);
});
