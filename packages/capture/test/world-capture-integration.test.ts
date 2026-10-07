import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {PNG} from 'pngjs';
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowCaptureSession, TileflowCaptureError} from '../src/index';

test(
  'captures visible World geometry above its advertised resolution at both densities',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-world-overzoom-'));
    await linkWorkspacePackages(cwd);
    const releaseId = 'world-v1-capture-metadata';
    const descriptorSha256 = 'd'.repeat(64);
    let maximum = 15;
    let discoveryRequests = 0;
    let vectorLayers: Array<{id: string; fields: Record<string, string>}> = [];
    const requestedZooms: number[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', origin);
      response.setHeader('Access-Control-Allow-Origin', '*');

      if (url.pathname === '/tiles/world/tiles.json') {
        discoveryRequests += 1;
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end(
          JSON.stringify({
            tilejson: '3.0.0',
            minzoom: 0,
            maxzoom: maximum,
            bounds: [-180, -85, 180, 85],
            scheme: 'xyz',
            attribution: 'World capture fixture',
            tiles: [
              `${origin}/tiles/world/${releaseId}/{z}/{x}/{y}.pbf?worldDescriptorSha256=${descriptorSha256}`,
            ],
            vector_layers: vectorLayers,
            tileflow: {
              world: {
                product: 'world-v1',
                releaseId,
                descriptorSha256,
                archiveSha256: 'a'.repeat(64),
                contractSha256: 'b'.repeat(64),
                dataContractSha256: 'c'.repeat(64),
              },
            },
          }),
        );
        return;
      }

      const tile = new RegExp(`^/tiles/world/${releaseId}/(\\d+)/(\\d+)/(\\d+)\\.pbf$`).exec(
        url.pathname,
      );
      if (tile) {
        assert.equal(url.searchParams.get('worldDescriptorSha256'), descriptorSha256);
        const zoom = Number(tile[1]);
        requestedZooms.push(zoom);
        response.writeHead(zoom <= maximum ? 200 : 400, {
          'Content-Type': 'application/x-protobuf',
        });
        response.end(zoom <= maximum ? waterTile : undefined);
        return;
      }

      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      await writeFile(
        join(cwd, 'tileflow.config.ts'),
        `import {defineMap, disable, tileflowWorld} from '@tileflow/core';
import {streetsThemes} from '@tileflow/maps';

export default defineMap({
  id: 'world-proof',
  version: 1,
  defaultTheme: 'light',
  themes: streetsThemes,
  data: tileflowWorld(),
  modules: {
    addresses: disable(), aeroways: disable(), boundaries: disable(), buildings: disable(),
    labels: disable(), land: disable(), landforms: disable(), nautical: disable(), poi: disable(),
    roads: disable(), transit: disable(), vegetation: disable(), water: {type: 'water'}
  },
  scenes: {
    overview: {theme: 'light', camera: {type: 'center', center: [0.001, 0.001], zoom: 10}, viewport: {width: 128, height: 128, dpr: 1}},
    detail: {theme: 'light', camera: {type: 'center', center: [0.001, 0.001], zoom: 16}, viewport: {width: 128, height: 128, dpr: 1}},
    retina: {theme: 'light', camera: {type: 'center', center: [0.001, 0.001], zoom: 16}, viewport: {width: 128, height: 128, dpr: 2}},
    closer: {theme: 'light', camera: {type: 'center', center: [0.001, 0.001], zoom: 19}, viewport: {width: 128, height: 128, dpr: 2}}
  }
});`,
      );
      const artifacts = await createTileflowBuildArtifacts({cwd, apiBaseUrl: origin});
      vectorLayers = [
        ...new Set(
          artifacts.styles['world-proof']!.light!.layers.map(
            (layer) => layer['source-layer'],
          ).filter((id): id is string => typeof id === 'string'),
        ),
      ].map((id) => ({id, fields: id === 'water' ? {class: 'String'} : {}}));

      for (const advertisedMaximum of [15, 12]) {
        maximum = advertisedMaximum;
        discoveryRequests = 0;
        requestedZooms.length = 0;
        const session = createTileflowCaptureSession({allowBrowserInstall: false});

        try {
          const scenes = ['overview', 'detail', 'retina', 'closer'];
          const result = await session.captureArtifacts(artifacts, scenes);
          const retry = await session.captureArtifacts(artifacts, ['detail']);

          assert.equal(discoveryRequests, 1, 'one upstream TileJSON for all scenes and retries');
          assert.ok(requestedZooms.includes(advertisedMaximum));
          assert.ok(requestedZooms.every((zoom) => zoom <= advertisedMaximum));
          assert.equal(result.captures.length, scenes.length);
          assert.equal(retry.captures[0]?.sha256, result.captures[1]?.sha256);

          for (const capture of result.captures) {
            const image = PNG.sync.read(Buffer.from(capture.png));
            assert.equal(image.width, 128 * capture.dpr);
            assert.equal(image.height, 128 * capture.dpr);
            const center = (Math.floor(image.height / 2) * image.width + image.width / 2) * 4;
            assert.ok(image.data[center + 2]! > image.data[center]!, 'visible blue water geometry');
            assert.equal(capture.receipt.data.kind, 'tileflow-world');
            if (capture.receipt.data.kind === 'tileflow-world') {
              assert.equal(capture.receipt.data.releaseId, releaseId);
              assert.equal(capture.receipt.data.descriptorSha256, descriptorSha256);
            }
          }
        } finally {
          await session.close();
        }
      }

      vectorLayers = [];
      const incompatible = createTileflowCaptureSession({allowBrowserInstall: false});

      try {
        await assert.rejects(
          incompatible.captureArtifacts(artifacts, ['detail']),
          (error: unknown) =>
            error instanceof TileflowCaptureError && error.code === 'MAP_LOAD_FAILED',
          'missing advertised source layers must remain a rendering failure',
        );
      } finally {
        await incompatible.close();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(cwd, {recursive: true, force: true});
    }
  },
);

// One extent-4096 polygon covers the complete tile in source-layer water, with class=lake.
const waterTile = Buffer.from(
  'GjV4AgoFd2F0ZXISGAgBEgIAABgDIg4JAAAagEAAAIBA/z8ADxoFY2xhc3MiBgoEbGFrZSiAIA==',
  'base64',
);
