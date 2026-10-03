import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowNativeSourceController} from '@tileflow/core/native';
import {createHostedNativeBindingResolver} from '../src/hosted-binding';
import {snapshotMobileConfiguration} from '../src/mobile-configuration';
import {
  directSourceFixture,
  hostedSourceFixture,
  type ReadyHostedSource,
} from './hosted-source-fixture';

const apiOrigin = 'https://api.example.test';
const credential = `tf_public_${'d'.repeat(48)}`;

async function resolveFixture(input: ReadyHostedSource): Promise<ReadyHostedSource> {
  const body = new TextEncoder().encode(JSON.stringify(input.manifest));
  const core = createTileflowNativeSourceController({
    acquire(url) {
      let offset = 0;
      return {
        cancel() {},
        response: Promise.resolve({
          url,
          status: 200,
          reader: {
            cancel() {},
            async read(maximumBytes) {
              if (offset === body.length) return {done: true};
              const value = body.slice(offset, offset + maximumBytes);
              offset += value.length;
              return {done: false, value};
            },
          },
        }),
      };
    },
  });
  try {
    await core.replace(input.source);
    const state = core.state;
    assert.ok(state?.status === 'ready', 'The serialized fixture must pass real Core resolution.');
    return state;
  } finally {
    core.dispose();
  }
}

test('a reflected rejection cannot publish an error after replacing its own resolution', async () => {
  let replacement: Promise<unknown> | undefined;
  const error = new Proxy(new Error('Untrusted native details.'), {
    getOwnPropertyDescriptor(target, property) {
      if (property === 'code') replacement = resolver.replace(directSourceFixture());
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const resolver = createHostedNativeBindingResolver(async () => {
    throw error;
  });
  try {
    await assert.rejects(resolver.replace(hostedSourceFixture()), {
      code: 'NATIVE_CONFIGURATION_REPLACED',
    });
    assert.deepEqual(await replacement, {kind: 'direct'});
  } finally {
    resolver.dispose();
  }
});

test('real Core resolution preserves the manifest API binding without inferring an origin', async () => {
  for (const declaration of ['entry', 'root', 'both'] as const) {
    const input = hostedSourceFixture();
    if (declaration === 'entry') delete input.manifest.apiUrl;
    if (declaration === 'root') delete input.manifest.maps.streets!.apiUrl;
    let configurations = 0;
    const resolver = createHostedNativeBindingResolver(async () => {
      configurations++;
      return snapshotMobileConfiguration({apiOrigin, credential});
    });
    try {
      const state = await resolveFixture(input);
      assert.equal(state.manifestUrl, input.source.manifestUrl);
      assert.equal(state.map.apiUrl, apiOrigin);
      assert.equal(state.map.worldGeneration, 'v1');
      assert.equal(state.theme.styleUrl, input.theme.styleUrl);
      assert.equal(state.theme.revision, input.theme.revision);
      const binding = await resolver.replace(state);
      assert.equal(binding.kind, 'hosted');
      assert.ok(binding.kind === 'hosted');
      assert.equal(binding.mapId, 'map_abcdefghijklmnop');
      assert.equal(binding.apiOrigin, apiOrigin);
      assert.equal(binding.credential, credential);
      assert.equal(configurations, 1);
    } finally {
      resolver.dispose();
    }
  }
});

test('Core API precedence does not authorize contradictory Hosted origin declarations', async () => {
  const input = hostedSourceFixture();
  input.manifest.apiUrl = 'https://unapproved.example.test';
  const state = await resolveFixture(input);
  assert.equal(
    state.map.apiUrl,
    apiOrigin,
    'Core still preserves the existing map-level API precedence.',
  );
  let configurations = 0;
  const resolver = createHostedNativeBindingResolver(async () => {
    configurations++;
    return snapshotMobileConfiguration({apiOrigin, credential});
  });
  try {
    await assert.rejects(resolver.replace(state), {code: 'NATIVE_CONFIGURATION_SOURCE_INVALID'});
    assert.equal(configurations, 0);
  } finally {
    resolver.dispose();
  }
});

test('real Core direct resolution never reads mobile configuration despite incidental API metadata', async () => {
  const input = directSourceFixture();
  input.manifest.apiUrl = 'https://unapproved.example.test';
  input.manifest.maps.streets!.apiUrl = apiOrigin;
  const state = await resolveFixture(input);
  assert.equal(state.map.apiUrl, apiOrigin);
  let configurations = 0;
  const resolver = createHostedNativeBindingResolver(async () => {
    configurations++;
    throw new Error('Direct delivery cannot read mobile configuration.');
  });
  try {
    assert.deepEqual(await resolver.replace(state), {kind: 'direct'});
    assert.equal(configurations, 0);
  } finally {
    resolver.dispose();
  }
});
