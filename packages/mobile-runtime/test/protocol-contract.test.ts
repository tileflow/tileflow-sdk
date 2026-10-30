import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {constantName, renderProtocol, validateProtocol} from '../../../scripts/mobile-protocol.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const contract = JSON.parse(await read('packages/mobile-runtime/protocol.json'));
const render = async (value: unknown) =>
  renderProtocol(value, {
    typescript: async (source: string) =>
      format(source, {
        ...(await resolveConfig(resolve(root, 'packages/mobile-runtime/src/contract.ts'))),
        parser: 'typescript',
      }),
    sessionFixture: await read('packages/mobile-runtime/test/fixtures/native-session.json'),
    sequenceFixture: await read('packages/mobile-runtime/test/fixtures/session-sequences.json'),
  });
const clone = () => structuredClone(contract);

test('the protocol contract is valid and every generated file is current', async () => {
  assert.deepEqual(validateProtocol(contract), []);
  for (const [path, content] of Object.entries(await render(contract)))
    assert.equal(await read(path), content, `Regenerate ${path}.`);
});

test('contract rules reject definitions the hosts could not honour', () => {
  const cases: [string, (value: ReturnType<typeof clone>) => void][] = [
    ['minimumVersion', (value) => (value.minimumVersion = value.version + 1)],
    ['hello', (value) => (value.events.hello = {level: 'essential'})],
    ['events.tap', (value) => (value.events.tap = {level: 'everything'})],
    [
      'eventLevels.continuous',
      (value) => {
        delete value.events.cameraMoved;
        delete value.events.trackedPointsMoved;
      },
    ],
    ['methods', (value) => value.methods.push('initialize')],
    [
      'cancel',
      (value) => (value.methods = value.methods.filter((name: string) => name !== 'cancel')),
    ],
    ['recoverable', (value) => delete value.errors.timeout.recoverable],
    ['sources', (value) => (value.errors.timeout.sources = ['browser'])],
    ['cancelled', (value) => (value.errors.cancelled.sources = ['host'])],
    [
      'maximumDataBytes',
      (value) => (value.limits.maximumDataBytes = value.limits.maximumMessageBytes),
    ],
    ['cameraReasons', (value) => (value.cameraReasons.gesture = '')],
    ['errors.timeout', (value) => (value.errors.timeout.description = 'No sentence')],
  ];
  for (const [expected, change] of cases) {
    const value = clone();
    change(value);
    const problems = validateProtocol(value);
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      `${expected}: ${problems.join('; ')}`,
    );
  }
});

test('hosts receive every method, event and error with its classification', async () => {
  const outputs = await render(contract);
  const swiftContract = outputs['platforms/ios/Sources/Tileflow/Bridge/ProtocolContract.swift'];
  const swiftTypes = outputs['platforms/ios/Sources/Tileflow/ProtocolTypes.swift'];
  const kotlinContract =
    outputs['platforms/android/tileflow/src/main/java/dev/tileflow/sdk/bridge/ProtocolContract.kt'];
  const kotlinTypes =
    outputs['platforms/android/tileflow/src/main/java/dev/tileflow/sdk/ProtocolTypes.kt'];
  for (const method of contract.methods) {
    assert.ok(swiftContract.includes(`    case ${method}\n`), method);
    assert.ok(kotlinContract.includes(`${constantName(method)}("${method}"),`), method);
  }
  for (const [name, event] of Object.entries<{level?: string}>(contract.events)) {
    const level = event.level ? `.${event.level}` : 'nil';
    assert.ok(swiftContract.includes(`case .${name}: ${level}\n`), name);
    const kotlinLevel = event.level ? `TileflowEventLevel.${constantName(event.level)}` : 'null';
    assert.ok(kotlinContract.includes(`${constantName(name)}("${name}", ${kotlinLevel}),`), name);
  }
  for (const [code, error] of Object.entries<{recoverable: boolean}>(contract.errors)) {
    assert.ok(swiftTypes.includes(`case .${code}: ${error.recoverable}\n`), code);
    assert.ok(
      kotlinTypes.includes(`${constantName(code)}("${code}", ${error.recoverable}),`),
      code,
    );
  }
  assert.ok(swiftContract.includes(`static let version = ${contract.version}\n`));
  assert.ok(kotlinContract.includes(`const val MINIMUM_VERSION = ${contract.minimumVersion}\n`));
  assert.ok(kotlinContract.includes('const val REQUEST_TIMEOUT_MILLIS = 30000L'));
  assert.ok(swiftContract.includes('static let requestTimeoutMilliseconds = 30000'));
});

test('generated names follow each platform convention', () => {
  assert.equal(constantName('setCamera'), 'SET_CAMERA');
  assert.equal(constantName('invalidGeoJSON'), 'INVALID_GEO_JSON');
  assert.equal(constantName('maximumDataTotalBytes'), 'MAXIMUM_DATA_TOTAL_BYTES');
  assert.equal(constantName('scene'), 'SCENE');
});

test('an invalid contract is never rendered', async () => {
  const value = clone();
  value.version = 0;
  await assert.rejects(render(value), /Invalid protocol\.json/u);
});
