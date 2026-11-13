import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  defineMap,
  type MapLibreStyle,
  officialFontFallback,
  parseTileflowMap,
} from '@tileflow/core';
import {tileflowOfficialFontAssetSet} from '@tileflow/core/build';
import {prepareTileflowStyleFonts} from '@tileflow/dev/fonts';
import {streets, streetsThemes} from '@tileflow/maps';
import {officialFontFile} from '../../../scripts/official-fonts.mjs';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {tileflowSyntheticAssetOrigin, withStandaloneTileflowPage} from '../src/standalone';

test(
  'web draws local Latin and complete official Greek/CJK fonts from isolated packed resources',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-font-fallback-'));
    t.after(() => rm(cwd, {recursive: true, force: true}));
    await mkdir(join(cwd, 'fonts'));
    await cp(
      new URL('../../dev/test/fixtures/fonts/oxanium/', import.meta.url),
      join(cwd, 'fonts'),
      {recursive: true},
    );
    const map = parseTileflowMap(
      defineMap({
        id: 'proof',
        version: 1,
        extends: streets,
        fonts: ['./fonts'],
        fontFallback: officialFontFallback,
        themes: {light: streetsThemes.light},
        defaultTheme: 'light',
      }),
    );
    const style: MapLibreStyle = {
      version: 8,
      name: 'Fallback',
      sources: {
        labels: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 1,
                properties: {name: 'Madrid'},
                geometry: {type: 'Point', coordinates: [-0.25, 0]},
              },
              {
                type: 'Feature',
                id: 2,
                properties: {name: 'Ω中'},
                geometry: {type: 'Point', coordinates: [0.25, 0]},
              },
              {
                type: 'Feature',
                id: 3,
                properties: {name: 'القاهرة'},
                geometry: {type: 'Point', coordinates: [0, 0.2]},
              },
            ],
          },
        },
      },
      layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#fff'}},
        {
          id: 'labels',
          type: 'symbol',
          source: 'labels',
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Oxanium Medium'],
            'text-size': 24,
            'text-allow-overlap': true,
          },
        },
      ],
    };
    const prepared = await prepareTileflowStyleFonts(
      {maps: {proof: map}},
      {proof: {light: style}},
      {cwd, target: 'local', assetBaseUrl: tileflowSyntheticAssetOrigin},
    );
    const output = prepared.styles.proof!.light!;
    // Runtime label operations can keep the declared names without knowing a compiler alias.
    (output.layers[1]!.layout as Record<string, unknown>)['text-font'] = [
      'Oxanium Medium',
      'Noto Sans Regular',
    ];
    const sharedAssets = await Promise.all(
      tileflowOfficialFontAssetSet.manifest.files.map(async (file) => ({
        fileName: `base/${tileflowOfficialFontAssetSet.assetSetSha256}/${file.path}`,
        url: `https://api.tileflow.dev/base/${tileflowOfficialFontAssetSet.assetSetSha256}/${file.path}`,
        contentType: file.contentType,
        source: await officialFontFile(file.path),
      })),
    );
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    t.after(() => browser.close());
    await withStandaloneTileflowPage(
      {
        browser,
        style: output,
        assets: [...prepared.assets, ...sharedAssets],
        viewport: {width: 320, height: 180, dpr: 1},
      },
      async (host) => {
        const requests: string[] = [];
        host.page.on('request', (request) => requests.push(request.url()));
        await host.load([]);
        await host.step('map-idle', '__tileflowCaptureIdle', {
          camera: {type: 'center', center: [0, 0], zoom: 8, pitch: 0, bearing: 0},
          mapEventTimeoutMs: host.mapEventTimeoutMs,
        });
        const ids = await host.page.evaluate(() => {
          const map = (
            globalThis as unknown as {
              __tileflowMap: {queryRenderedFeatures(options: {layers: string[]}): {id?: unknown}[]};
            }
          ).__tileflowMap;
          return [
            ...new Set(map.queryRenderedFeatures({layers: ['labels']}).map(({id}) => id)),
          ].sort();
        });
        assert.deepEqual(ids, [1, 2, 3]);
        assert.ok(requests.some((url) => url.endsWith('.ttf')));
        assert.ok(
          requests.some((url) => url.includes('/NotoSans-Regular.ttf')),
          requests.join('\n'),
        );
        assert.ok(
          requests.some((url) => url.includes('/NotoSansCJKjp-Regular.otf')),
          requests.join('\n'),
        );
        assert.ok(
          requests.some((url) => url.includes('/NotoSansArabic-Regular.ttf')),
          requests.join('\n'),
        );
        assert.equal(host.result().networkDependent, false);
        assert.deepEqual(host.result().warnings, []);
      },
    );
  },
);
