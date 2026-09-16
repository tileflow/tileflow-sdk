import assert from 'node:assert/strict';
import test from 'node:test';
import {projectNativeResources} from '../src/native-resource-projection';
import {apiOrigin, mapId} from './session-fixture';

const styleUrl = `${apiOrigin}/maps/${mapId}/light.json`;
const url = `${apiOrigin}/fonts/fb_example/regular.ttf`;
const policy = {
  mapId,
  resourceOrigins: [apiOrigin],
  resourceScopes: ['style', 'font'] as const,
  tilesetIds: [],
};
const faces = [
  {
    id: 'Brand Regular',
    family: 'Brand',
    url,
    format: 'ttf' as const,
    style: 'normal' as const,
    weight: '400' as const,
  },
];
const style = {
  version: 8,
  sources: {},
  layers: [
    {id: 'text', type: 'symbol', layout: {'text-field': 'A', 'text-font': ['Brand Regular']}},
  ],
  'font-faces': {
    'Brand Regular': [{url, 'font-family': 'Brand', 'font-style': 'normal', 'font-weight': 400}],
  },
};

function input(value: Record<string, unknown> = style) {
  return {
    styleUrl,
    policy,
    fontFaces: faces,
    current: () => true,
    async accept() {},
    discriminate: (value: string) => `${value}?__tf_native_context=one`,
    async read(request: string) {
      return {
        url: request,
        value: JSON.parse(JSON.stringify(value)),
        bytes: JSON.stringify(value).length,
      };
    },
  };
}

test('managed fonts retain the native-v1 array shape and exact font attributes', async () => {
  const result = await projectNativeResources(input());
  const wire = result.style['font-faces'] as Record<string, Array<Record<string, unknown>>>;
  assert.deepEqual(wire['Brand Regular'], [
    {
      url: `${url}?__tf_native_context=one`,
      'font-family': 'Brand',
      'font-style': 'normal',
      'font-weight': 400,
    },
  ]);
  assert.ok(result.resources.some((resource) => resource.url === url && resource.scope === 'font'));
  assert.equal(style['font-faces']['Brand Regular'][0].url, url);
});

test('font metadata cannot silently point at another resource or unsupported native format', async () => {
  await assert.rejects(
    projectNativeResources({
      ...input(),
      fontFaces: [{...faces[0], url: `${apiOrigin}/fonts/fb_other/regular.ttf`}],
    }),
  );
  for (const value of [
    {'Brand Regular': url},
    {'Brand Regular': [{url: `${apiOrigin}/fonts/fb_example/regular.woff2`}]},
    {'Brand Regular': [{url, 'font-family': 'Other'}]},
  ]) {
    await assert.rejects(projectNativeResources(input({...style, 'font-faces': value})));
  }
});
