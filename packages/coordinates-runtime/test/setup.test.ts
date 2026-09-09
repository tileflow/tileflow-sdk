import assert from 'node:assert/strict';
import {lstat, mkdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import test from 'node:test';
import {CoordinatesSetupError, createCoordinatesSetup} from '../src/setup';
import {alternateRelease, createSetupFixture, distribution, readJson} from './setup-fixture';

test('installs a complete local release into its immutable directory and writes active receipt', async () => {
  const fixture = await createSetupFixture();
  const validated: string[] = [];
  const setup = createCoordinatesSetup({
    validateInstalled: async (directory) => {
      validated.push(directory);
    },
  });
  try {
    const result = await setup({
      source: fixture.source,
      cacheDirectory: fixture.cache,
      allowDevelopment: true,
    });
    const directory = join(
      fixture.cache,
      'releases',
      fixture.release.releaseId,
      fixture.release.artifacts[0]!.id,
    );
    assert.equal(result.status, 'installed');
    assert.equal(result.directory, directory);
    assert.equal(validated.length, 1);
    assert.equal(validated[0]!.includes('.pending-'), true);
    assert.deepEqual(await readJson(join(directory, 'release.json')), fixture.release);
    assert.deepEqual(await readJson(join(fixture.cache, 'active.json')), {
      releaseId: fixture.release.releaseId,
      artifactId: fixture.release.artifacts[0]!.id,
    });
  } finally {
    await fixture.close();
  }
});

test('a local source never calls fetch and a later install reuses verified cached assets', async () => {
  const fixture = await createSetupFixture();
  let fetches = 0;
  let validated = 0;
  const setup = createCoordinatesSetup({
    fetch: async () => {
      fetches += 1;
      throw new Error('fetch must not run for local source');
    },
    validateInstalled: async () => {
      validated += 1;
    },
  });
  try {
    await setup({source: fixture.source, cacheDirectory: fixture.cache, allowDevelopment: true});
    const directory = join(
      fixture.cache,
      'releases',
      fixture.release.releaseId,
      fixture.release.artifacts[0]!.id,
    );
    await rm(directory, {force: true, recursive: true});
    await rm(join(fixture.source, fixture.assets[0]!.location));
    await rm(join(fixture.source, fixture.assets[1]!.location));
    const second = await setup({
      source: fixture.source,
      cacheDirectory: fixture.cache,
      allowDevelopment: true,
    });
    assert.equal(second.status, 'installed');
    assert.equal(second.acquiredBytes, 0);
    assert.equal(fetches, 0);
    assert.equal(validated, 2);
  } finally {
    await fixture.close();
  }
});

test('delivery locations on different HTTPS hosts do not change release identity or asset digests', async () => {
  const fixture = await createSetupFixture();
  const artifact = fixture.release.artifacts[0]!;
  const locationsFor = (host: string) => ({
    [artifact.id]: Object.fromEntries(
      fixture.assets.map((asset) => [asset.id, `https://${host}/${asset.id}`]),
    ),
  });
  const setupFor = (host: string) => {
    const document = distribution(fixture.release, locationsFor(host));
    return createCoordinatesSetup({
      fetch: async (url) => {
        const href = String(url);
        if (href.endsWith('/distribution.json')) return Response.json(document);
        const asset = fixture.assets.find((candidate) => href.endsWith(`/${candidate.id}`));
        if (!asset) return new Response(null, {status: 404});
        return new Response(asset.body);
      },
      validateInstalled: async () => undefined,
    });
  };
  try {
    const one = await setupFor('first.example')({
      source: 'https://first.example/distribution.json',
      cacheDirectory: join(fixture.directory, 'cache-one'),
      allowDevelopment: true,
    });
    const two = await setupFor('second.example')({
      source: 'https://second.example/distribution.json',
      cacheDirectory: join(fixture.directory, 'cache-two'),
      allowDevelopment: true,
    });
    assert.equal(one.releaseId, two.releaseId);
    assert.deepEqual(one.assets, two.assets);
    assert.equal(one.releaseId, fixture.release.releaseId);
  } finally {
    await fixture.close();
  }
});

test('relative asset locations resolve from the final redirected manifest URL', async () => {
  const fixture = await createSetupFixture();
  const artifact = fixture.release.artifacts[0]!;
  const server = createServer((request, response) => {
    if (request.url === '/old') {
      response.writeHead(302, {location: '/releases/current/distribution.json'});
      response.end();
      return;
    }
    if (request.url === '/releases/current/distribution.json') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(
          distribution(fixture.release, {
            [artifact.id]: Object.fromEntries(
              fixture.assets.map((asset) => [asset.id, `assets/${asset.id}`]),
            ),
          }),
        ),
      );
      return;
    }
    const asset = fixture.assets.find(
      (candidate) => request.url === `/releases/current/assets/${candidate.id}`,
    );
    if (asset) {
      response.end(asset.body);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
  try {
    const result = await setup({
      source: `http://127.0.0.1:${address.port}/old`,
      cacheDirectory: fixture.cache,
      allowDevelopment: true,
    });
    assert.equal(result.releaseId, fixture.release.releaseId);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture.close();
  }
});

test('cancelling the second asset leaves the prior active receipt and no promoted runtime', async () => {
  const fixture = await createSetupFixture();
  const controller = new AbortController();
  const artifact = fixture.release.artifacts[0]!;
  const prior = {releaseId: `cr_${'0'.repeat(64)}`, artifactId: 'prior'};
  await mkdir(fixture.cache, {recursive: true});
  await writeFile(join(fixture.cache, 'active.json'), `${JSON.stringify(prior)}\n`);
  const locations = {
    [artifact.id]: Object.fromEntries(
      fixture.assets.map((asset) => [asset.id, `https://delivery.example/${asset.id}`]),
    ),
  };
  const setup = createCoordinatesSetup({
    fetch: async (url) => {
      const href = String(url);
      if (href.endsWith('/distribution.json'))
        return Response.json(distribution(fixture.release, locations));
      if (href.endsWith(`/${fixture.assets[0]!.id}`)) return new Response(fixture.assets[0]!.body);
      controller.abort();
      return new Response(fixture.assets[1]!.body);
    },
    validateInstalled: async () => undefined,
  });
  try {
    await assert.rejects(
      setup({
        source: 'https://delivery.example/distribution.json',
        cacheDirectory: fixture.cache,
        allowDevelopment: true,
        signal: controller.signal,
      }),
      (error: unknown) =>
        error instanceof CoordinatesSetupError && error.code === 'COORDINATES_SETUP_CANCELLED',
    );
    assert.deepEqual(await readJson(join(fixture.cache, 'active.json')), prior);
    await assert.rejects(
      lstat(
        join(
          fixture.cache,
          'releases',
          fixture.release.releaseId,
          fixture.release.artifacts[0]!.id,
        ),
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('a corrupt asset reports integrity failure instead of delivery unavailability', async () => {
  const fixture = await createSetupFixture();
  try {
    const corrupt = Buffer.from(fixture.assets[0]!.body);
    corrupt[0] ^= 1;
    await writeFile(join(fixture.source, fixture.assets[0]!.location), corrupt);
    const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
    await assert.rejects(
      setup({source: fixture.source, cacheDirectory: fixture.cache, allowDevelopment: true}),
      (error: unknown) =>
        error instanceof CoordinatesSetupError &&
        error.code === 'COORDINATES_SETUP_INTEGRITY_FAILED',
    );
  } finally {
    await fixture.close();
  }
});

test('a pre-existing runtime with another release receipt is rejected before readiness', async () => {
  const fixture = await createSetupFixture();
  const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
  try {
    await setup({source: fixture.source, cacheDirectory: fixture.cache, allowDevelopment: true});
    const directory = join(
      fixture.cache,
      'releases',
      fixture.release.releaseId,
      fixture.release.artifacts[0]!.id,
    );
    await writeFile(
      join(directory, 'release.json'),
      `${JSON.stringify(alternateRelease(fixture.release))}\n`,
    );
    await assert.rejects(
      setup({source: fixture.source, cacheDirectory: fixture.cache, allowDevelopment: true}),
      (error: unknown) =>
        error instanceof CoordinatesSetupError &&
        error.code === 'COORDINATES_SETUP_INTEGRITY_FAILED',
    );
  } finally {
    await fixture.close();
  }
});

test('unknown options, release mismatch, and development without opt-in fail', async () => {
  const fixture = await createSetupFixture();
  const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
  try {
    await assert.rejects(
      setup({source: fixture.source, cacheDirectory: fixture.cache, unknown: true} as any),
      (error: unknown) =>
        error instanceof CoordinatesSetupError &&
        error.code === 'COORDINATES_SETUP_INVALID_REQUEST',
    );
    await assert.rejects(
      setup({
        source: fixture.source,
        cacheDirectory: fixture.cache,
        allowDevelopment: true,
        requiredReleaseId: `cr_${'f'.repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof CoordinatesSetupError &&
        error.code === 'COORDINATES_SETUP_RELEASE_UNAVAILABLE',
    );
    await assert.rejects(
      setup({source: fixture.source, cacheDirectory: fixture.cache}),
      (error: unknown) =>
        error instanceof CoordinatesSetupError &&
        error.code === 'COORDINATES_SETUP_RELEASE_UNAVAILABLE',
    );
  } finally {
    await fixture.close();
  }
});
