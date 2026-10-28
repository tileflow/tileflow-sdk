import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {ElevationError, elevationPoints, elevationProfile} from '../src/index';

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
const operations = {
  'elevation.points': elevationPoints,
  'elevation.profile': elevationProfile,
} as Record<string, (request: never, options: never) => Promise<unknown>>;

const serve =
  (operation: Operation, answer: () => Response): typeof fetch =>
  async (input, init) => {
    assert.equal(String(input), `https://api.example.test${operation.path}`);
    assert.equal(init?.method, operation.method);
    assert.deepEqual(JSON.parse(String(init?.body)), operation.request);
    return answer();
  };

test('the native contract fixture holds Elevation requests and answers this client accepts', async () => {
  for (const [name, call] of Object.entries(operations)) {
    const operation = fixture.operations[name] as Operation;
    const answer = await call(
      operation.request as never,
      {
        apiKey: fixture.credential,
        apiUrl: 'https://api.example.test',
        fetch: serve(operation, () => Response.json(operation.response)),
      } as never,
    );
    assert.deepEqual(answer, operation.response, name);
  }
});

test('the native contract fixture maps Elevation failures as this client does', async () => {
  for (const failure of fixture.errors.filter((item: {operation: string}) =>
    item.operation.startsWith('elevation.'),
  )) {
    const operation = fixture.operations[failure.operation] as Operation;
    const error = await operations[failure.operation]!(
      operation.request as never,
      {
        apiKey: fixture.credential,
        apiUrl: 'https://api.example.test',
        fetch: serve(
          operation,
          () =>
            new Response(failure.rawBody ?? JSON.stringify(failure.body), {
              status: failure.status,
              headers: failure.headers ?? {},
            }),
        ),
      } as never,
    ).catch((caught: unknown) => caught);
    assert.ok(error instanceof ElevationError);
    assert.equal(error.status, failure.expect.status);
    assert.equal(error.code, failure.expect.code ?? null);
    assert.equal(error.requestId, failure.expect.requestId ?? null);
    assert.equal(error.retryAfterSeconds, failure.expect.retryAfterSeconds ?? null);
    if (failure.expect.message) assert.equal(error.message, failure.expect.message);
  }
});
