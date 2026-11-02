import {createHash, randomUUID} from 'node:crypto';
import {deflateSync, gunzipSync, gzipSync} from 'node:zlib';

/**
 * A minimal Hosted map for the mobile fixture server: session start, discovery and the WebView
 * profile manifest, two versioned themes (`day`, and `terrain` over a constant 650 m elevation
 * model) with their TileJSONs, gzip vector tiles and elevation tiles, Hosted offline downloads in
 * pack format 2 (creation, grant-authorized pack downloads, revalidation) and counters tests read.
 *
 * Protected resources answer only a current session grant (`X-Tileflow-Native-Grant`), with a
 * strong `ETag` and `private, no-cache`; `If-None-Match` answers 304. Packs answer only their
 * download's grant (`X-Tileflow-Offline-Grant`), with their digest as a strong `ETag`,
 * `Accept-Ranges`, single ranges (206) and `If-Range`. Tests read and reset the counters with
 * `GET`/`POST /__fixture/hosted`, choose the revalidation state with
 * `POST /__fixture/hosted?revalidation=not_updatable`, and resume an interrupted transfer of
 * `/__fixture/resumable`, whose first response stops part-way.
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
    terrainStyle: `${base}${mapPath}/webview-v1/v1/terrain.json`,
    terrainTilejson: `${base}/tiles/terrain/tiles.json?map=${hostedMapId}`,
    terrainTemplate: `${base}/tiles/terrain/1/{z}/{x}/{y}.png?map=${hostedMapId}`,
    sprite: `${base}/sprites/fixture/sprite?map=${hostedMapId}`,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf?map=${hostedMapId}`,
  };
  // The sprite and glyph files a renderer derives from those templates.
  const spriteUrl = (ratio, extension) =>
    `${base}/sprites/fixture/sprite${ratio === 2 ? '@2x' : ''}.${extension}?map=${hostedMapId}`;
  const glyphUrl = (range) => `${base}/fonts/Noto%20Sans%20Regular/${range}.pbf?map=${hostedMapId}`;
  // Terrain stops at z14 online; a download stops at its terrainMaxZoom.
  const terrainZooms = [0, 14];
  const resumable = Buffer.alloc(2 * 1024 * 1024, 0);
  for (let index = 0; index < resumable.length; index += 1) resumable[index] = (index * 31) % 251;
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
          themes: {
            day: {styleUrl: urls.style, colorScheme: 'light'},
            terrain: {styleUrl: urls.terrainStyle, colorScheme: 'light'},
          },
        },
      },
    },
    [urls.style]: {
      version: 8,
      sprite: urls.sprite,
      glyphs: urls.glyphs,
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
        {
          id: 'markers',
          type: 'symbol',
          source: 'world',
          'source-layer': 'building',
          layout: {
            'icon-image': 'marker',
            'icon-allow-overlap': true,
            'text-field': 'B',
            'text-font': ['Noto Sans Regular'],
            'text-size': 16,
            'text-offset': [0, 1.2],
            'text-allow-overlap': true,
          },
          paint: {'text-color': '#1d3c8f'},
        },
      ],
    },
    [urls.terrainStyle]: {
      version: 8,
      sources: {
        world: {type: 'vector', url: urls.tilejson},
        terrain: {type: 'raster-dem', url: urls.terrainTilejson, tileSize: 256, encoding: 'mapbox'},
      },
      terrain: {source: 'terrain'},
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
    [urls.terrainTilejson]: {
      tilejson: '3.0.0',
      tiles: [urls.terrainTemplate],
      minzoom: terrainZooms[0],
      maxzoom: terrainZooms[1],
      attribution: 'Fixture Terrain',
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
  /** Each download's packs by path, under its grant. */
  const downloads = new Map();
  const state = {revalidation: 'current', resumableServed: 0};
  const counters = () => ({
    sessions: 0,
    packs: 0,
    revalidations: 0,
    downloads: 0,
    notModified: 0,
    sessionResources: 0,
    packResources: 0,
    packNotModified: 0,
    ranges: 0,
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
    for (const ratio of [1, 2]) {
      if (url === spriteUrl(ratio, 'json'))
        return Buffer.from(
          JSON.stringify({marker: {x: 0, y: 0, width: 16 * ratio, height: 16 * ratio, pixelRatio: ratio}}),
        );
      if (url === spriteUrl(ratio, 'png')) return png(16 * ratio, 16 * ratio, [224, 33, 138, 255]);
    }
    const glyphRange = /\/fonts\/Noto%20Sans%20Regular\/(\d+)-(\d+)\.pbf\?map=/u.exec(url);
    if (glyphRange) return glyphs(Number(glyphRange[1]), Number(glyphRange[2]));
    const match = /\/tiles\/world\/1\/(\d+)\/(\d+)\/(\d+)\.pbf\?map=/u.exec(url);
    if (match) return storedTile(...match.slice(1).map(Number));
    const terrain = /\/tiles\/terrain\/1\/(\d+)\/\d+\/\d+\.png\?map=/u.exec(url);
    return terrain && Number(terrain[1]) <= terrainZooms[1] ? elevation : null;
  };
  /** A solid RGBA PNG. */
  const png = (width, height, rgba) => {
    const crc = (bytes) => {
      let value = 0xffffffff;
      for (const byte of bytes) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
          value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
      return (value ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'ascii');
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6; // RGBA
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgba).flat())]);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  /**
   * A glyph range of `Noto Sans Regular` in the renderer's protobuf: every printable ASCII glyph is
   * a filled block, as a signed distance field, so labels draw without a font rasterizer.
   */
  const glyphs = (start, end) => {
    const varint = (value) => {
      const bytes = [];
      let rest = value;
      while (rest > 127) {
        bytes.push((rest & 127) | 128);
        rest = Math.floor(rest / 128);
      }
      bytes.push(rest);
      return bytes;
    };
    const field = (number, wire, payload) => [
      ...varint(number * 8 + wire),
      ...(wire === 2 ? varint(payload.length) : []),
      ...payload,
    ];
    const zigzag = (value) => (value << 1) ^ (value >> 31);
    const [width, height, buffer] = [10, 14, 3];
    const bitmap = [];
    for (let y = 0; y < height + 2 * buffer; y += 1)
      for (let x = 0; x < width + 2 * buffer; x += 1) {
        const dx = Math.max(buffer - x, x - (buffer + width - 1), 0);
        const dy = Math.max(buffer - y, y - (buffer + height - 1), 0);
        const inside = dx === 0 && dy === 0;
        const distance = inside
          ? -Math.min(x - buffer, buffer + width - 1 - x, y - buffer, buffer + height - 1 - y) - 0.5
          : Math.hypot(dx, dy) - 0.5;
        bitmap.push(Math.max(0, Math.min(255, Math.round(255 - 255 * (distance / 8 + 0.25)))));
      }
    const glyphList = [];
    for (let id = Math.max(start, 33); id <= Math.min(end, 126); id += 1)
      glyphList.push(
        field(3, 2, [
          ...field(1, 0, varint(id)),
          ...field(2, 2, bitmap),
          ...field(3, 0, varint(width)),
          ...field(4, 0, varint(height)),
          ...field(5, 0, varint(zigzag(1))),
          ...field(6, 0, varint(zigzag(-4))),
          ...field(7, 0, varint(width + 2)),
        ]),
      );
    const stack = [
      ...field(1, 2, [...Buffer.from('Noto Sans Regular')]),
      ...field(2, 2, [...Buffer.from(`${start}-${end}`)]),
      ...glyphList.flat(),
    ];
    return Buffer.from(field(1, 2, stack));
  };
  /** A 256-pixel elevation tile at 650 m everywhere, in Mapbox's RGB encoding. */
  const elevation = (() => {
    const crc = (bytes) => {
      let value = 0xffffffff;
      for (const byte of bytes) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
          value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
      return (value ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'ascii');
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(256, 0);
    header.writeUInt32BE(256, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // RGB
    // (-10000 + (1 × 65536 + 160 × 256 + 4) × 0.1) m = 650 m
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(256).fill([1, 160, 4]).flat())]);
    const pixels = deflateSync(Buffer.concat(Array(256).fill(row)));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', pixels),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  })();
  // World stores its tiles gzip-compressed and serves them as stored.
  const stored = new Map();
  const storedTile = (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    if (!stored.has(key)) stored.set(key, gzipSync(tile(z, x, y), {mtime: 0}));
    return stored.get(key);
  };

  /** A pack in format 2: header, index, bodies and the SHA-256 trailer. */
  function pack(kind, entries) {
    const index = [];
    const data = [];
    let offset = 0;
    for (const entry of entries) {
      const name = Buffer.from(entry.name);
      const type = Buffer.from(entry.contentType);
      const encoding = Buffer.from(entry.contentEncoding ?? '');
      const record = Buffer.alloc(2 + name.length + 1 + type.length + 1 + encoding.length + 12);
      let at = record.writeUInt16LE(name.length, 0);
      at += name.copy(record, at);
      at = record.writeUInt8(type.length, at);
      at += type.copy(record, at);
      at = record.writeUInt8(encoding.length, at);
      at += encoding.copy(record, at);
      at = record.writeBigUInt64LE(BigInt(offset), at);
      record.writeUInt32LE(entry.body.length, at);
      index.push(record);
      data.push(entry.body);
      offset += entry.body.length;
    }
    const indexBytes = Buffer.concat(index);
    const header = Buffer.alloc(32);
    header.write('TFPK', 0, 'ascii');
    header.writeUInt16LE(1, 4);
    header.writeUInt8(kind === 'tiles' ? 1 : 2, 6);
    header.writeUInt32LE(entries.length, 8);
    header.writeUInt32LE(indexBytes.length, 12);
    header.writeBigUInt64LE(BigInt(offset), 16);
    const content = Buffer.concat([header, indexBytes, ...data]);
    return Buffer.concat([content, createHash('sha256').update(content).digest()]);
  }

  /** Answers a resource in full, as a single range, or unchanged. A pack's tag is its trailer. */
  const serve = (request, response, bytes, headers, onBody, tag = sha(bytes)) => {
    const etag = `"${tag}"`;
    for (const [name, value] of Object.entries({...headers, ETag: etag}))
      response.setHeader(name, value);
    if (request.headers['if-none-match'] === etag) {
      response.statusCode = 304;
      response.end();
      return 'not-modified';
    }
    const range = /^bytes=(\d+)-$/u.exec(request.headers.range ?? '');
    const ifRange = request.headers['if-range'];
    if (range && (!ifRange || ifRange === etag)) {
      const start = Number(range[1]);
      if (start >= bytes.length) {
        response.writeHead(416, {'Content-Range': `bytes */${bytes.length}`});
        response.end();
        return 'unsatisfiable';
      }
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
        'Content-Length': bytes.length - start,
      });
      if (onBody) onBody(response, bytes.subarray(start));
      else response.end(bytes.subarray(start));
      return 'range';
    }
    response.setHeader('Content-Length', bytes.length);
    if (onBody) onBody(response, bytes);
    else response.end(bytes);
    return 'whole';
  };
  // Zoom bands: an anchor zoom and its deepest zoom.
  const bands = [
    [0, 6],
    [7, 10],
    [11, 15],
    [16, 20],
    [21, 22],
  ];
  /**
   * The tiles a download's cover holds, as the service plans them: each entry's covered tiles at
   * its mask zoom (its band's deepest within the download's zooms) and their ancestors, each with
   * its entry's anchor.
   */
  const coverTiles = (request) => {
    const tiles = [];
    for (const [z, x, y, mask] of request.cover) {
      const maskZoom = Math.min(bands.find(([anchor]) => anchor === z)[1], request.maxZoom);
      const side = 2 ** (maskZoom - z);
      const bits = mask === undefined ? null : Buffer.from(mask, 'base64url');
      const seen = new Set();
      for (let index = 0; index < side * side; index += 1) {
        if (bits && !(bits[index >> 3] & (1 << (index & 7)))) continue;
        const leaf = [x * side + (index % side), y * side + Math.floor(index / side)];
        for (let tz = Math.max(z, request.minZoom); tz <= maskZoom; tz += 1) {
          const tile = [tz, leaf[0] >> (maskZoom - tz), leaf[1] >> (maskZoom - tz)];
          if (seen.has(tile.join('/'))) continue;
          seen.add(tile.join('/'));
          tiles.push({tile, anchor: [z, x, y]});
        }
      }
    }
    return tiles;
  };

  /** A download's manifest; its packs are assembled into `files` by path. */
  function manifest(request, now, files) {
    const covered = coverTiles(request);
    const publicResource = (kind, url) => {
      const bytes = body(url);
      return {kind, url, bytes: bytes.length, sha256: sha(bytes)};
    };
    const publicResources = [
      publicResource('discovery', urls.discovery),
      publicResource('profile', urls.profile),
    ];
    const packs = [];
    const add = (id, kind, path, entries, extra = {}) => {
      const bytes = pack(kind, entries);
      files.set(path, bytes);
      packs.push({
        id,
        kind,
        url: `${base}${path}`,
        bytes: bytes.length,
        resources: entries.length,
        // Only tiles are billable.
        billableResources: kind === 'tiles' ? entries.length : 0,
        ...extra,
      });
    };
    // The style pack holds the requested themes' styles and the TileJSONs they use.
    const terrainTheme = request.themes.includes('terrain');
    const documentUrls = [
      ...(request.themes.includes('day') ? [urls.style] : []),
      ...(terrainTheme ? [urls.terrainStyle] : []),
      urls.tilejson,
      ...(terrainTheme ? [urls.terrainTilejson] : []),
    ];
    const assetUrls = request.themes.includes('day')
      ? [
          [spriteUrl(1, 'json'), 'application/json'],
          [spriteUrl(1, 'png'), 'image/png'],
          [spriteUrl(2, 'json'), 'application/json'],
          [spriteUrl(2, 'png'), 'image/png'],
          [glyphUrl('0-255'), 'application/x-protobuf'],
        ]
      : [];
    add('style', 'documents', '/v1/offline/documents/style.tfpack', [
      ...documentUrls.map((url) => ({name: url, contentType: 'application/json', body: body(url)})),
      ...assetUrls.map(([url, contentType]) => ({name: url, contentType, body: body(url)})),
    ]);
    const tileSources = [
      {
        source: 'world',
        template: urls.template,
        zooms,
        contentType: 'application/vnd.mapbox-vector-tile',
        contentEncoding: 'gzip',
        tile: storedTile,
      },
      ...(terrainTheme
        ? [
            {
              source: 'terrain',
              template: urls.terrainTemplate,
              zooms: [terrainZooms[0], Math.min(terrainZooms[1], request.terrainMaxZoom)],
              contentType: 'image/png',
              contentEncoding: null,
              tile: () => elevation,
            },
          ]
        : []),
    ];
    const sources = [];
    for (const source of tileSources) {
      const low = Math.max(request.minZoom, source.zooms[0]);
      const high = Math.min(request.maxZoom, source.zooms[1]);
      sources.push({
        source: source.source,
        version: '1',
        template: source.template,
        zooms: low <= high ? [low, high] : null,
        contentType: source.contentType,
        contentEncoding: source.contentEncoding,
        absentStatus: 404,
      });
      // The cover's tiles at the source's zooms, by the pack of their entry's anchor.
      const anchors = new Map();
      for (const {tile, anchor} of covered) {
        if (tile[0] < low || tile[0] > high) continue;
        const key = anchor.join('/');
        if (!anchors.has(key)) anchors.set(key, []);
        anchors.get(key).push(tile);
      }
      for (const [key, tiles] of anchors) {
        const [z, x, y] = key.split('/').map(Number);
        const end = bands.find(([anchor]) => anchor === z)[1];
        add(
          `tiles/${source.source}/${key}`,
          'tiles',
          `/v1/offline/tiles/${source.source}/1/${key}.tfpack`,
          tiles.map(([tz, tx, ty]) => ({
            name: `${tz}/${tx}/${ty}`,
            contentType: source.contentType,
            contentEncoding: source.contentEncoding,
            body: source.tile(tz, tx, ty),
          })),
          {
            source: source.source,
            anchor: [z, x, y],
            zooms: [Math.max(z, low), Math.min(end, high)],
          },
        );
      }
    }
    const resources = packs.reduce((sum, item) => sum + item.resources, 0);
    const billable = packs.reduce((sum, item) => sum + item.billableResources, 0);
    return {
      version: 2,
      downloadId: `odl_${randomUUID().replaceAll('-', '').slice(0, 22)}`,
      mapId: hostedMapId,
      profile: request.profile,
      deploymentVersion: 1,
      themes: request.themes,
      coverSha256: sha(JSON.stringify(request.cover)),
      minZoom: request.minZoom,
      maxZoom: request.maxZoom,
      terrainMaxZoom: request.terrainMaxZoom,
      createdAt: iso(now),
      sources,
      packs,
      publicResources,
      origins: [base],
      excluded: [],
      totals: {
        packs: packs.length,
        resources: resources + publicResources.length,
        billableResources: billable,
        bytes:
          packs.reduce((sum, item) => sum + item.bytes, 0) +
          publicResources.reduce((sum, item) => sum + item.bytes, 0),
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
      limits: {
        maxPackResources: 10_000,
        dailyDownloads: 20_000,
        teamDailyDownloads: 20_000,
        dailyRemaining: 20_000,
        teamDailyRemaining: 20_000,
      },
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
        state.resumableServed = 0;
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
          resourceScopes: ['style', 'tilejson', 'tile', 'sprite', 'glyph'],
          tilesetIds: ['world', 'terrain'],
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
        const grant = `tf_offline_v2.${Buffer.from(randomUUID()).toString('base64url')}.fixture`;
        const files = new Map();
        const created = manifest(body, new Date(), files);
        downloads.set(grant, files);
        json(response, 201, {version: 2, kind: 'offline_download', grant, manifest: created});
      });
      return true;
    }
    if (request.method === 'POST' && path === '/v1/offline/packs/revalidate') {
      readBody(request).then((text) => {
        if (!downloads.has(JSON.parse(text).grant))
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
    if (request.method === 'GET' && path === '/__fixture/resumable') {
      // The first transfer stops a quarter of the way; later ones resume from a range.
      const first = state.resumableServed === 0;
      state.resumableServed += 1;
      const outcome = serve(
        request,
        response,
        resumable,
        {'Accept-Ranges': 'bytes'},
        (out, bytes) => {
          if (!first) return out.end(bytes);
          out.write(bytes.subarray(0, bytes.length / 4), () =>
            setTimeout(() => out.destroy(), 200),
          );
        },
      );
      if (outcome === 'range') count.ranges += 1;
      return true;
    }
    if (request.method === 'GET' && path.startsWith('/v1/offline/') && path.endsWith('.tfpack')) {
      const bytes = downloads.get(request.headers['x-tileflow-offline-grant'])?.get(path);
      if (!bytes) {
        json(response, 403, {code: 'OFFLINE_PACK_RESOURCE_DENIED', error: 'refused'});
        return true;
      }
      const outcome = serve(
        request,
        response,
        bytes,
        {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-cache, no-transform',
          'Content-Type': 'application/vnd.tileflow.pack',
        },
        undefined,
        bytes.subarray(bytes.length - 32).toString('hex'),
      );
      if (outcome === 'not-modified') count.packNotModified += 1;
      else count.packResources += 1;
      if (outcome === 'range') count.ranges += 1;
      return true;
    }
    const bytes = request.method === 'GET' ? body(url) : null;
    if (!bytes) return false;
    if (!publicUrls.has(url)) {
      const session = request.headers['x-tileflow-native-grant'];
      if (sessions.has(session)) count.sessionResources += 1;
      else {
        json(response, 401, {code: 'MOBILE_GRANT_INVALID', error: 'refused'});
        return true;
      }
    }
    // Vector tiles travel as stored to clients that accept gzip, and decoded to the others.
    const world = url.includes('/tiles/world/1/');
    const gzip = world && /\bgzip\b/u.test(request.headers['accept-encoding'] ?? '');
    const outcome = serve(
      request,
      response,
      world && !gzip ? gunzipSync(bytes) : bytes,
      {
        'Cache-Control': 'private, no-cache',
        'Content-Type': url.includes('/fonts/')
          ? 'application/x-protobuf'
          : url.includes('.pbf')
          ? 'application/vnd.mapbox-vector-tile'
          : url.includes('.png')
            ? 'image/png'
            : 'application/json',
        ...(gzip ? {'Content-Encoding': 'gzip'} : {}),
      },
    );
    if (outcome === 'not-modified') count.notModified += 1;
    else count.downloads += 1;
    return true;
  };
}
