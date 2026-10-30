import {createHash, randomUUID} from 'node:crypto';

/**
 * A minimal Hosted map for the mobile fixture server: session start, discovery and the WebView
 * profile manifest, one versioned style with its TileJSON and vector tiles, Hosted offline packs
 * (creation, grant-authorized downloads, revalidation) and counters tests read.
 *
 * Protected resources answer only a current session grant (`X-Tileflow-Native-Grant`) or pack
 * grant (`X-Tileflow-Offline-Grant`), with a strong `ETag` and `private, no-cache`; `If-None-Match`
 * answers 304. Tests read and reset the counters with `GET`/`POST /__fixture/hosted`, and choose the
 * revalidation state with `POST /__fixture/hosted?revalidation=not_updatable`.
 */
export const hostedMapId = 'map_offlinefixture01';

export function createHostedFixture({base, tile, center}) {
  const mapPath = `/maps/${hostedMapId}/mobile`;
  const urls = {
    discovery: `${base}${mapPath}/manifest.json`,
    profile: `${base}${mapPath}/webview-v1/manifest.json`,
    style: `${base}${mapPath}/webview-v1/v1/day.json`,
    tilejson: `${base}/tiles/world/tiles.json?map=${hostedMapId}`,
    template: `${base}/tiles/world/1/{z}/{x}/{y}.pbf?map=${hostedMapId}`,
  };
  const zooms = [13, 15];
  const documents = {
    [urls.discovery]: {
      version: 1,
      mapId: hostedMapId,
      deploymentVersion: 1,
      representations: {'webview-v1': {manifestUrl: urls.profile}},
    },
    [urls.profile]: {
      version: 1,
      maps: {
        map: {
          mapId: hostedMapId,
          defaultTheme: 'day',
          view: {center, zoom: 15.5, bearing: 0, pitch: 0},
          themes: {day: {styleUrl: urls.style, colorScheme: 'light'}},
        },
      },
    },
    [urls.style]: {
      version: 8,
      sources: {world: {type: 'vector', url: urls.tilejson}},
      layers: [
        {id: 'ground', type: 'background', paint: {'background-color': '#ece6da'}},
        {
          id: 'buildings',
          type: 'fill',
          source: 'world',
          'source-layer': 'building',
          paint: {'fill-color': '#d6ccb8'},
        },
      ],
    },
    [urls.tilejson]: {
      tilejson: '3.0.0',
      tiles: [urls.template],
      minzoom: zooms[0],
      maxzoom: zooms[1],
      attribution: 'Fixture World',
    },
  };
  const publicUrls = new Set([urls.discovery, urls.profile]);
  const sessions = new Set();
  const packs = new Set();
  const state = {revalidation: 'current'};
  const counters = () => ({
    sessions: 0,
    packs: 0,
    revalidations: 0,
    downloads: 0,
    notModified: 0,
    sessionResources: 0,
    packResources: 0,
  });
  let count = counters();

  const sha = (body) => createHash('sha256').update(body).digest('hex');
  const iso = (date) => date.toISOString();
  const json = (response, status, value, headers = {}) => {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    });
    response.end(JSON.stringify(value));
  };
  const readBody = (request) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  const body = (url) => {
    if (documents[url]) return Buffer.from(JSON.stringify(documents[url]));
    const match = /\/tiles\/world\/1\/(\d+)\/(\d+)\/(\d+)\.pbf\?map=/u.exec(url);
    return match ? tile(...match.slice(1).map(Number)) : null;
  };
  // The tiles of a box at a zoom, a subset of the service's row cover: the box's own tile range.
  const project = (longitude, latitude, zoom) => {
    const scale = 2 ** zoom;
    const radians = (latitude * Math.PI) / 180;
    return [
      Math.floor(((longitude + 180) / 360) * scale),
      Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale),
    ];
  };

  function manifest(request, now) {
    const [west, south, east, north] = request.region.bbox;
    const documentEntry = (kind, url, billable) => {
      const bytes = body(url);
      return {
        kind,
        url,
        bytes: bytes.length,
        sha256: sha(bytes),
        billable,
        access: billable ? 'grant' : 'public',
      };
    };
    const docs = [
      documentEntry('discovery', urls.discovery, false),
      documentEntry('profile', urls.profile, false),
      documentEntry('style', urls.style, true),
      documentEntry('tilejson', urls.tilejson, true),
    ];
    const low = Math.max(request.minZoom, zooms[0]);
    const high = Math.min(request.maxZoom, zooms[1]);
    const entries = [];
    for (let z = low; z <= high; z += 1) {
      const [x0, y0] = project(west, north, z);
      const [x1, y1] = project(east, south, z);
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) entries.push([z, x, y, tile(z, x, y).length]);
    }
    const billable = docs.filter((entry) => entry.billable).length + entries.length;
    return {
      version: 1,
      packId: `opk_${randomUUID().replaceAll('-', '').slice(0, 22)}`,
      mapId: hostedMapId,
      profile: request.profile,
      deploymentVersion: 1,
      themes: request.themes,
      region: request.region,
      minZoom: request.minZoom,
      maxZoom: request.maxZoom,
      terrainMaxZoom: request.terrainMaxZoom,
      createdAt: iso(now),
      documents: docs,
      tiles: [
        {
          source: 'world',
          template: urls.template,
          zooms: low <= high ? [low, high] : null,
          entries,
        },
      ],
      excluded: [],
      totals: {
        resources: docs.length + entries.length,
        billableResources: billable,
        bytes:
          docs.reduce((sum, entry) => sum + entry.bytes, 0) +
          entries.reduce((sum, entry) => sum + entry[3], 0),
      },
      attribution: {
        sources: [
          {
            source: 'world',
            text: 'Fixture World',
            regionalObligations: [
              {
                id: 'fixture-region',
                exact: 'Fixture regional credit',
                href: 'https://example.com/credit',
                regions: [[center[0] - 0.05, center[1] - 0.05, center[0] + 0.05, center[1] + 0.05]],
              },
            ],
          },
        ],
      },
      limits: {maxPackResources: 10_000, dailyDownloads: 20_000},
      revalidation: {url: `${base}/v1/offline/packs/revalidate`, intervalSeconds: 86_400},
      download: {expiresAt: iso(new Date(now.getTime() + 86_400_000))},
    };
  }

  /** Answers a Hosted route; false for any other request. */
  return function handle(request, response) {
    const url = `${base}${request.url}`;
    const path = request.url.split('?')[0];
    if (path === '/__fixture/hosted') {
      if (request.method === 'POST') {
        count = counters();
        const revalidation = new URL(url).searchParams.get('revalidation');
        state.revalidation = revalidation ?? 'current';
      }
      json(response, 200, {...count, revalidation: state.revalidation});
      return true;
    }
    if (request.method === 'POST' && path === '/v1/sessions/start') {
      readBody(request).then((text) => {
        const body = JSON.parse(text);
        if (!request.headers['x-tileflow-mobile-client'] || body.mapId !== hostedMapId)
          return json(response, 401, {code: 'MOBILE_CREDENTIAL_INVALID', error: 'refused'});
        count.sessions += 1;
        const grant = `tf_native_v1.${Buffer.from(randomUUID()).toString('base64url')}.fixture`;
        sessions.add(grant);
        const now = new Date();
        json(response, 201, {
          ok: true,
          kind: 'native',
          version: 1,
          usageMode: 'session',
          counted: false,
          grant,
          mapId: hostedMapId,
          sessionId: body.sessionId,
          surfaceId: body.surfaceId,
          credentialId: 'key_fixturefixture',
          credentialRevision: 1,
          deliveryPolicyRevision: 1,
          issuedAt: iso(now),
          serverTime: iso(now),
          expiresAt: iso(new Date(now.getTime() + 900_000)),
          meterMode: 'disabled',
          disposition: 'unmetered',
          resourceOrigins: [base],
          resourceScopes: ['style', 'tilejson', 'tile'],
          tilesetIds: ['world'],
        });
      });
      return true;
    }
    if (request.method === 'POST' && path === '/v1/offline/packs') {
      readBody(request).then((text) => {
        const body = JSON.parse(text);
        if (!request.headers['x-tileflow-mobile-client'] || body.mapId !== hostedMapId)
          return json(response, 401, {code: 'MOBILE_CREDENTIAL_INVALID', error: 'refused'});
        count.packs += 1;
        const grant = `tf_offline_v1.${Buffer.from(randomUUID()).toString('base64url')}.fixture`;
        packs.add(grant);
        json(response, 201, {
          version: 1,
          kind: 'offline_pack',
          grant,
          manifest: manifest(body, new Date()),
        });
      });
      return true;
    }
    if (request.method === 'POST' && path === '/v1/offline/packs/revalidate') {
      readBody(request).then((text) => {
        if (!packs.has(JSON.parse(text).grant))
          return json(response, 401, {code: 'OFFLINE_PACK_GRANT_INVALID', error: 'refused'});
        count.revalidations += 1;
        json(
          response,
          200,
          state.revalidation === 'not_updatable'
            ? {state: 'not_updatable', reason: 'credential_revoked', checkedAt: iso(new Date())}
            : {state: state.revalidation, checkedAt: iso(new Date()), intervalSeconds: 86_400},
        );
      });
      return true;
    }
    const bytes = request.method === 'GET' ? body(url) : null;
    if (!bytes) return false;
    if (!publicUrls.has(url)) {
      const session = request.headers['x-tileflow-native-grant'];
      const pack = request.headers['x-tileflow-offline-grant'];
      if (sessions.has(session)) count.sessionResources += 1;
      else if (packs.has(pack)) count.packResources += 1;
      else {
        json(response, 401, {code: 'MOBILE_GRANT_INVALID', error: 'refused'});
        return true;
      }
    }
    const etag = `"${sha(bytes)}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader(
      'Content-Type',
      url.includes('.pbf') ? 'application/vnd.mapbox-vector-tile' : 'application/json',
    );
    if (request.headers['if-none-match'] === etag) {
      count.notModified += 1;
      response.statusCode = 304;
      response.end();
      return true;
    }
    count.downloads += 1;
    response.end(bytes);
    return true;
  };
}
