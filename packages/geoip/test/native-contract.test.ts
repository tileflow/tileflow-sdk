import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {GeoIpError, geolocate} from '../src/client';

// The Swift and Kotlin clients read the same file: this keeps their recorded answers and request
// bodies inside the contract this package publishes.
const fixture = JSON.parse(
  await readFile(
    new URL(
      '../../../platforms/ios/Tests/TileflowServiceTests/Fixtures/service-contract.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
type Operation = {method: string; path: string; request: unknown; response: unknown};

const serve =
  (operation: Operation, answer: () => Response): typeof fetch =>
  async (input, init) => {
    assert.equal(String(input), `https://api.example.test${operation.path}`);
    assert.equal(init?.method, operation.method);
    assert.deepEqual(JSON.parse(String(init?.body)), operation.request);
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return answer();
  };

test('the native contract fixture holds anonymous GeoIP answers this client accepts', async () => {
  for (const name of ['geoip.locate', 'geoip.unavailable']) {
    const operation = fixture.operations[name] as Operation;
    const answer = await geolocate({
      apiUrl: 'https://api.example.test',
      fetch: serve(operation, () => Response.json(operation.response)),
    });
    assert.deepEqual(answer, operation.response, name);
  }
});

test('the native contract fixture maps GeoIP failures as this client does', async () => {
  for (const failure of fixture.errors.filter((item: {operation: string}) =>
    item.operation.startsWith('geoip.'),
  )) {
    const operation = fixture.operations[failure.operation] as Operation;
    const error = await geolocate({
      apiUrl: 'https://api.example.test',
      fetch: serve(
        operation,
        () =>
          new Response(failure.rawBody ?? JSON.stringify(failure.body), {
            status: failure.status,
            headers: failure.headers ?? {},
          }),
      ),
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof GeoIpError);
    assert.equal(error.status, failure.expect.status);
    assert.equal(error.code, failure.expect.code ?? null);
    assert.equal(error.requestId, failure.expect.requestId ?? null);
    if (failure.expect.message) assert.equal(error.message, failure.expect.message);
  }
});
