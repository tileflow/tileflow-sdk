import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {type MapLibreStyle} from '@tileflow/core';
import {createLineBackgroundFixture} from '../../../scripts/mobile-fixture-line-backgrounds.mjs';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {tileflowSyntheticAssetOrigin, withStandaloneTileflowPage} from '../src/standalone';

test(
  'web renders the native line-background qualification scene across themes, zoom and pitch',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1' || !process.env.TILEFLOW_LINE_GLYPH_ROOT},
  async (t) => {
    const fixture = createLineBackgroundFixture({
      base: tileflowSyntheticAssetOrigin,
      center: [-3.7, 40.42],
      directory: process.env.TILEFLOW_LINE_GLYPH_ROOT,
    });
    assert.ok(fixture);
    const names = Object.keys(fixture.styles).filter((name) => name !== 'line-empty');
    const assets = fixture
      .entries(names)
      .map((entry: {name: string; contentType: string; body: Buffer}) => ({
        fileName: new URL(entry.name).pathname.slice(1),
        url: entry.name,
        contentType: entry.contentType,
        source: entry.body,
      }));
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    t.after(() => browser.close());
    const output = process.env.TILEFLOW_LINE_REPORTS;
    if (output) await mkdir(join(output, 'web'), {recursive: true});
    for (const name of names) {
      await withStandaloneTileflowPage(
        {
          browser,
          style: fixture.styles[name] as MapLibreStyle,
          assets,
          viewport: {width: 390, height: 844, dpr: 2},
        },
        async (host) => {
          await host.load([]);
          for (const zoom of [12, 14, 16])
            for (const pitch of [0, 45]) {
              await host.step('map-idle', '__tileflowCaptureIdle', {
                camera: {type: 'center', center: [-3.7, 40.42], zoom, pitch, bearing: 0},
                mapEventTimeoutMs: host.mapEventTimeoutMs,
              });
              const ids = await host.page.evaluate(() => {
                const map = (
                  globalThis as unknown as {
                    __tileflowMap: {
                      queryRenderedFeatures(options: {layers: string[]}): {id?: unknown}[];
                    };
                  }
                ).__tileflowMap;
                return [
                  ...new Set(
                    map.queryRenderedFeatures({layers: ['line-labels']}).map(({id}) => id),
                  ),
                ].sort();
              });
              assert.deepEqual(ids, [1, 2, 3], `${name}, zoom ${zoom}, pitch ${pitch}`);
              if (output)
                await writeFile(
                  join(output, 'web', `${name}-z${zoom}-p${pitch}.png`),
                  await host.screenshot(),
                );
            }
          assert.equal(host.result().networkDependent, false);
          assert.deepEqual(host.result().warnings, []);
        },
      );
    }
  },
);
