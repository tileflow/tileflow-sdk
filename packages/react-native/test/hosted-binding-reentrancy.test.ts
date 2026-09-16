import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeSourceController,
  type TileflowNativeSourceState,
} from '@tileflow/core/native';
import {createHostedNativeBindingResolver} from '../src/hosted-binding';
import {snapshotMobileConfiguration} from '../src/mobile-configuration';

function source(usageMode: 'session' | undefined): TileflowNativeSourceState {
  const theme = {
    name: 'light',
    colorScheme: 'light' as const,
    styleUrl: 'https://maps.example.test/light.json',
  };
  return {
    status: 'ready',
    generation: 1,
    source: {map: 'streets', manifestUrl: 'https://maps.example.test/manifest.json'},
    manifestUrl: 'https://maps.example.test/manifest.json',
    manifest: {
      version: 1,
      maps: {streets: {defaultTheme: 'light', themes: {light: theme}}},
    },
    map: {
      name: 'streets',
      defaultTheme: 'light',
      themes: {light: theme},
      apiUrl: 'https://api.example.test',
      mapId: 'map_abcdefghijklmnop',
      usageMode,
    },
    theme,
  };
}

test('a reflected rejection cannot publish an error after replacing its own resolution', async () => {
  let replacement: Promise<unknown> | undefined;
  const error = new Proxy(new Error('Untrusted native details.'), {
    getOwnPropertyDescriptor(target, property) {
      if (property === 'code') replacement = resolver.replace(source(undefined));
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const resolver = createHostedNativeBindingResolver(async () => {
    throw error;
  });
  await assert.rejects(resolver.replace(source('session')), {
    code: 'NATIVE_CONFIGURATION_REPLACED',
  });
  assert.deepEqual(await replacement, {kind: 'direct'});
  resolver.dispose();
});

test('real Core resolution preserves the manifest API binding without inferring an origin', async () => {
  for (const usageMode of [undefined, 'session'] as const) {
    const body = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        apiUrl: 'https://unapproved.example.test',
        maps: {
          streets: {
            apiUrl: 'https://api.example.test',
            mapId: 'map_abcdefghijklmnop',
            usageMode,
            defaultTheme: 'light',
            themes: {light: {colorScheme: 'light', styleUrl: './light.json'}},
          },
        },
      }),
    );
    let configurations = 0;
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
    const resolver = createHostedNativeBindingResolver(async () => {
      configurations++;
      return snapshotMobileConfiguration({
        apiOrigin: 'https://api.example.test',
        credential: `tf_public_${'d'.repeat(48)}`,
      });
    });
    try {
      await core.replace({
        map: 'streets',
        manifestUrl: 'https://maps.example.test/manifest.json',
      });
      const state = core.state;
      assert.ok(state?.status === 'ready');
      const binding = await resolver.replace(state);
      if (usageMode === undefined) {
        assert.deepEqual(binding, {kind: 'direct'});
        assert.equal(configurations, 0);
      } else {
        assert.equal(binding.kind, 'hosted');
        assert.ok(binding.kind === 'hosted');
        assert.equal(binding.mapId, 'map_abcdefghijklmnop');
        assert.equal(binding.apiOrigin, 'https://api.example.test');
        assert.equal(configurations, 1);
      }
    } finally {
      resolver.dispose();
      core.dispose();
    }
  }
});
