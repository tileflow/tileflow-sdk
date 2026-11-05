import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {deflateSync, gunzipSync, gzipSync} from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
// The native representation's family document is computed with Core, as a deployment's is.
const nativeProfile = await import(
  pathToFileURL(resolve(root, 'packages/core/dist/native-profile.js')).href
);
// The platform's offline credits of Nautical and Bathymetry for Miami, Oslo and Madrid.
const marineCredits = JSON.parse(
  readFileSync(
    resolve(root, 'platforms/ios/Tests/TileflowTests/Fixtures/Marine/marine-credits.json'),
    'utf8',
  ),
).cases;

/**
 * A minimal Hosted map for the mobile fixture server: session start, discovery and the web
 * profile manifest, two versioned themes (`day`, and `terrain` over a constant 650 m elevation
 * model) with their TileJSONs, gzip vector tiles and elevation tiles, Hosted offline downloads in
 * pack format 2 (creation, grant-authorized pack downloads, revalidation) and counters tests read.
 *
 * A `marine` theme adds the Nautical and Bathymetry sources, whose TileJSONs carry the platform's
 * map credits, and the notice a Nautical style declares. A download of it carries, in its
 * manifest's attribution, the platform's credits of those sources for the place the download
 * covers (`Fixtures/Marine/marine-credits.json`: Miami, Oslo or Madrid).
 *
 * Discovery also announces the `native-v1` representation: its manifest, native styles for `day`,
 * `night`, `labels`, `marine` and `terrain` (hillshade instead of 3D terrain, recorded as a
 * degradation), and its family document, `/maps/<map>/native/family/v<version>.json` with its SHA-256 revision. Native
 * routes follow the active deployment version: `POST /__fixture/hosted?deployment=2` activates
 * version 2, so version 1's documents answer 409 `NATIVE_DEPLOYMENT_SUPERSEDED`, as the service
 * does.
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
    // A theme with a sprite and glyphs, so a renderer requests both with its own suffixes.
    labelsStyle: `${base}${mapPath}/webview-v1/v1/labels.json`,
    sprite: `${base}/sprites/fixture/sprite`,
    marineStyle: `${base}${mapPath}/webview-v1/v1/marine.json`,
    nauticalTilejson: `${base}/tiles/nautical/tiles.json?map=${hostedMapId}`,
    bathymetryTilejson: `${base}/tiles/bathymetry/tiles.json?map=${hostedMapId}`,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    nativeManifest: `${base}/maps/${hostedMapId}/native/manifest.json`,
    native: (version, name) => `${base}/maps/${hostedMapId}/native/v${version}/${name}.json`,
    nativeFamily: (version) => `${base}/maps/${hostedMapId}/native/family/v${version}.json`,
  };
  // Terrain stops at z14 online; a download stops at its terrainMaxZoom.
  const terrainZooms = [0, 14];
  const resumable = Buffer.alloc(2 * 1024 * 1024, 0);
  for (let index = 0; index < resumable.length; index += 1) resumable[index] = (index * 31) % 251;
  const zooms = [13, 15];
  /** A marine source's map credit: the platform's, with the dated chart lines. */
  const marineText = (source) => marineCredits.find((item) => item.source === source).credit.text;
  /**
   * The marine theme. Its Nautical and Bathymetry sources draw nothing here; the map credits them
   * as it credits any source of its style.
   */
  const marineStyle = (metadata = {}) => ({
    version: 8,
    metadata: {
      ...metadata,
      'tileflow:notices': [{id: 'nautical', sources: ['nautical'], text: 'Not for navigation'}],
    },
    sources: {
      world: {type: 'vector', url: urls.tilejson},
      nautical: {type: 'vector', url: urls.nauticalTilejson},
      bathymetry: {type: 'vector', url: urls.bathymetryTilejson},
    },
    layers: [
      {id: 'ground', type: 'background', paint: {'background-color': '#bcd9ea'}},
      {
        id: 'buildings',
        type: 'fill',
        source: 'world',
        'source-layer': 'building',
        paint: {'fill-color': '#d6ccb8'},
      },
    ],
  });
  const documents = {
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
            labels: {styleUrl: urls.labelsStyle, colorScheme: 'light'},
            marine: {styleUrl: urls.marineStyle, colorScheme: 'light'},
          },
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
    [urls.labelsStyle]: {
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
          id: 'marks',
          type: 'symbol',
          source: 'world',
          'source-layer': 'building',
          layout: {
            'icon-image': 'dot',
            'icon-allow-overlap': true,
            'text-field': 'Tileflow',
            'text-font': ['Noto Sans Regular'],
            'text-allow-overlap': true,
            'text-offset': [0, 1],
          },
        },
      ],
    },
    [urls.marineStyle]: marineStyle(),
    ...Object.fromEntries(
      ['nautical', 'bathymetry'].map((source) => [
        source === 'nautical' ? urls.nauticalTilejson : urls.bathymetryTilejson,
        {
          tilejson: '3.0.0',
          tiles: [`${base}/tiles/${source}/1/{z}/{x}/{y}.pbf?map=${hostedMapId}`],
          minzoom: 0,
          maxzoom: 14,
          attribution: marineText(source),
        },
      ]),
    ),
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
  // The native representation also includes a night theme.
  const sceneDegradation = {
    id: 'scene3d',
    feature: 'scene3d',
    reason: 'web-runtime',
    fallback: 'extrusions',
    layers: ['buildings-3d'],
  };
  const extrusion = (color) => ({
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: 'world',
    'source-layer': 'building',
    metadata: {'tileflow:3d-toggle': 'building', 'tileflow:domain': 'buildings'},
    paint: {
      'fill-extrusion-color': color,
      'fill-extrusion-height': ['get', 'render_height'],
      'fill-extrusion-opacity': 0.9,
    },
  });
  const nativeDay = (dark) => ({
    version: 8,
    metadata: {
      'tileflow:colorScheme': dark ? 'dark' : 'light',
      'tileflow:nativeDegradations': [sceneDegradation],
    },
    sources: {world: {type: 'vector', url: urls.tilejson}},
    layers: [
      {
        id: 'ground',
        type: 'background',
        metadata: {'tileflow:domain': 'land'},
        paint: {'background-color': dark ? '#1c2129' : '#ece6da'},
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'world',
        'source-layer': 'building',
        metadata: {'tileflow:domain': 'buildings'},
        paint: {'fill-color': dark ? '#2a313b' : '#d6ccb8'},
      },
      extrusion(dark ? '#6d7684' : '#e3d9c6'),
    ],
  });
  const nativeStyles = {
    day: nativeDay(false),
    night: nativeDay(true),
    labels: {
      ...documents[urls.labelsStyle],
      metadata: {'tileflow:colorScheme': 'light', 'tileflow:nativeDegradations': []},
    },
    marine: marineStyle({'tileflow:colorScheme': 'light', 'tileflow:nativeDegradations': []}),
    terrain: {
      version: 8,
      metadata: {
        'tileflow:colorScheme': 'light',
        'tileflow:nativeDegradations': [
          {
            id: 'terrain3d',
            feature: 'terrain3d',
            reason: 'engine-unsupported',
            fallback: 'flat',
            layers: [],
          },
        ],
      },
      sources: {
        world: {type: 'vector', url: urls.tilejson},
        terrain: {type: 'raster-dem', url: urls.terrainTilejson, tileSize: 256, encoding: 'mapbox'},
      },
      layers: [
        {id: 'ground', type: 'background', paint: {'background-color': '#ece6da'}},
        {id: 'relief', type: 'hillshade', source: 'terrain'},
        {
          id: 'buildings',
          type: 'fill',
          source: 'world',
          'source-layer': 'building',
          paint: {'fill-color': '#d6ccb8'},
        },
      ],
    },
  };
  const nativeThemes = Object.keys(nativeStyles);
  // The family names the map by its key in the one-map manifest.
  const nativeFamily = nativeProfile.createTileflowNativeFamily({
    map: 'map',
    themes: nativeThemes,
    styles: nativeStyles,
  });
  const nativeFamilyBytes = Buffer.from(JSON.stringify(nativeFamily));
  const nativeDocument = (name) =>
    Object.hasOwn(nativeStyles, name) ? Buffer.from(JSON.stringify(nativeStyles[name])) : null;
  const discovery = () => ({
    version: 1,
    mapId: hostedMapId,
    deploymentVersion: state.deployment,
    representations: {
      'webview-v1': {manifestUrl: urls.profile},
      'native-v1': {
        manifestUrl: urls.nativeManifest,
        family: {url: urls.nativeFamily(state.deployment), revision: sha(nativeFamilyBytes)},
      },
    },
  });
  const nativeManifest = () => ({
    version: 1,
    maps: {
      map: {
        mapId: hostedMapId,
        usageMode: 'session',
        defaultTheme: 'day',
        systemThemes: {light: 'day', dark: 'night'},
        view: {center, zoom: 15.5, bearing: 0, pitch: 0},
        themes: Object.fromEntries(
          nativeThemes.map((name) => [
            name,
            {
              styleUrl: urls.native(state.deployment, name),
              colorScheme: nativeStyles[name].metadata['tileflow:colorScheme'],
              revision: sha(JSON.stringify(nativeStyles[name])),
            },
          ]),
        ),
      },
    },
  });
  const publicUrls = new Set([urls.discovery, urls.profile, urls.nativeManifest]);
  const sessions = new Set();
  /** Each download's packs by path, under its grant. */
  const downloads = new Map();
  const state = {revalidation: 'current', resumableServed: 0, deployment: 1};
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
  /** An RGB PNG of `width` × `height` pixels of one colour. */
  const png = (width, height, rgb) => {
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
    header[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  const spriteBodies = {
    [`${urls.sprite}.json`]: JSON.stringify({
      dot: {x: 0, y: 0, width: 8, height: 8, pixelRatio: 1},
    }),
    [`${urls.sprite}@2x.json`]: JSON.stringify({
      dot: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 2},
    }),
    [`${urls.sprite}.png`]: png(8, 8, [0xe0, 0x30, 0x20]),
    [`${urls.sprite}@2x.png`]: png(16, 16, [0xe0, 0x30, 0x20]),
  };
  /** A glyph range of a font stack, with no glyphs: enough for a renderer to accept the range. */
  const glyphRange = (stack, range) => {
    const bytes = (value) => [...Buffer.from(value)];
    const field = (number, payload) => [number * 8 + 2, payload.length, ...payload];
    return Buffer.from(field(1, [...field(1, bytes(stack)), ...field(2, bytes(range))]));
  };
  const body = (url) => {
    if (url === urls.discovery) return Buffer.from(JSON.stringify(discovery()));
    if (url === urls.nativeManifest) return Buffer.from(JSON.stringify(nativeManifest()));
    if (documents[url]) return Buffer.from(JSON.stringify(documents[url]));
    if (spriteBodies[url]) return Buffer.from(spriteBodies[url]);
    const glyphs = /\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/u.exec(url);
    if (glyphs) return glyphRange(decodeURIComponent(glyphs[1]), glyphs[2]);
    const match = /\/tiles\/world\/1\/(\d+)\/(\d+)\/(\d+)\.pbf\?map=/u.exec(url);
    if (match) return storedTile(...match.slice(1).map(Number));
    const terrain = /\/tiles\/terrain\/1\/(\d+)\/\d+\/\d+\.png\?map=/u.exec(url);
    return terrain && Number(terrain[1]) <= terrainZooms[1] ? elevation : null;
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

  /** The `[west, south, east, north]` of tile z/x/y. */
  const tileBounds = ([z, x, y]) => {
    const side = 2 ** z;
    const latitude = (row) =>
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / side))) * 180) / Math.PI;
    return [(x / side) * 360 - 180, latitude(y + 1), ((x + 1) / side) * 360 - 180, latitude(y)];
  };
  /**
   * The platform's credits of Nautical, Bathymetry and its DEM for the place a download covers,
   * as `marine-credits.json` gives them with the dated chart lines: obligations, the regional
   * credits whose boxes touch the place, and the sources page.
   */
  const marineAttribution = (covered) => {
    const deepest = Math.max(...covered.map(({tile}) => tile[0]));
    const boxes = covered.filter(({tile}) => tile[0] === deepest).map(({tile}) => tileBounds(tile));
    const footprint = [
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ];
    const touches = ([west, south, east, north]) =>
      west <= footprint[2] &&
      east >= footprint[0] &&
      south <= footprint[3] &&
      north >= footprint[1];
    return ['nautical', 'bathymetry', 'bathymetry-dem'].flatMap((source) => {
      const found = marineCredits.find((item) => item.source === source && touches(item.bounds));
      return found ? [found.credit] : [];
    });
  };

  /** A download's manifest; its packs are assembled into `files` by path. */
  function manifest(request, now, files) {
    const covered = coverTiles(request);
    const publicResource = (kind, url) => {
      const bytes = body(url);
      return {kind, url, bytes: bytes.length, sha256: sha(bytes)};
    };
    const native = request.profile === 'native-v1';
    const publicResources = [
      publicResource('discovery', urls.discovery),
      publicResource('profile', native ? urls.nativeManifest : urls.profile),
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
    const labelsTheme = request.themes.includes('labels');
    const marineTheme = request.themes.includes('marine');
    const webStyles = [
      ...(request.themes.includes('day') ? [urls.style] : []),
      ...(labelsTheme ? [urls.labelsStyle] : []),
      ...(terrainTheme ? [urls.terrainStyle] : []),
      ...(marineTheme ? [urls.marineStyle] : []),
    ];
    const jsonEntry = (name, bytes) => ({name, contentType: 'application/json', body: bytes});
    const styles = native
      ? [
          ...request.themes.map((name) =>
            jsonEntry(urls.native(state.deployment, name), nativeDocument(name)),
          ),
          jsonEntry(urls.nativeFamily(state.deployment), nativeFamilyBytes),
        ]
      : webStyles.map((url) => jsonEntry(url, body(url)));
    const tileJson = [
      urls.tilejson,
      ...(terrainTheme ? [urls.terrainTilejson] : []),
      ...(marineTheme ? [urls.nauticalTilejson, urls.bathymetryTilejson] : []),
    ];
    add('style', 'documents', '/v1/offline/documents/style.tfpack', [
      ...styles,
      ...tileJson.map((url) => jsonEntry(url, body(url))),
    ]);
    if (labelsTheme) {
      add(
        'assets',
        'documents',
        '/v1/offline/documents/assets.tfpack',
        Object.keys(spriteBodies).map((url) => ({
          name: url,
          contentType: url.endsWith('.png') ? 'image/png' : 'application/json',
          body: body(url),
        })),
      );
      const stack = 'Noto Sans Regular';
      const glyphUrl = (range) =>
        urls.glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range);
      add(
        `glyphs/${stack}/0`,
        'documents',
        `/v1/offline/documents/glyphs/${encodeURIComponent(stack)}/0.tfpack`,
        ['0-255', '256-511'].map((range) => ({
          name: glyphUrl(range),
          contentType: 'application/x-protobuf',
          body: body(glyphUrl(range)),
        })),
      );
    }
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
      deploymentVersion: state.deployment,
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
          ...(marineTheme ? marineAttribution(covered) : []),
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
        state.deployment = Number(new URL(url).searchParams.get('deployment') ?? 1);
      }
      json(response, 200, {
        ...count,
        revalidation: state.revalidation,
        deployment: state.deployment,
      });
      return true;
    }
    // Native styles and the family document of a deployment version: an older version is
    // superseded (409), a newer one was never announced (403).
    const native =
      new RegExp(
        `^/maps/${hostedMapId}/native/v([1-9][0-9]*)/([A-Za-z][A-Za-z0-9_-]*)\\.json$`,
        'u',
      ).exec(path) ??
      new RegExp(`^/maps/${hostedMapId}/native/family/v([1-9][0-9]*)()\\.json$`, 'u').exec(path);
    if (request.method === 'GET' && native) {
      if (!sessions.has(request.headers['x-tileflow-native-grant'])) {
        json(response, 401, {code: 'MOBILE_GRANT_INVALID', error: 'refused'});
        return true;
      }
      const version = Number(native[1]);
      const document = native[2] ? nativeDocument(native[2]) : nativeFamilyBytes;
      if (version < state.deployment) {
        json(response, 409, {code: 'NATIVE_DEPLOYMENT_SUPERSEDED', error: 'superseded'});
        return true;
      }
      if (version > state.deployment || !document) {
        json(response, 403, {code: 'NATIVE_GRANT_RESOURCE_DENIED', error: 'refused'});
        return true;
      }
      count.sessionResources += 1;
      const outcome = serve(request, response, document, {
        'Cache-Control': 'private, no-cache',
        'Content-Type': 'application/json',
      });
      if (outcome === 'not-modified') count.notModified += 1;
      else count.downloads += 1;
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
          tilesetIds: ['world', 'terrain', 'nautical', 'bathymetry'],
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
    const tile = /\/tiles\/world\/1\/.*\.pbf/u.test(url);
    const gzip = tile && /\bgzip\b/u.test(request.headers['accept-encoding'] ?? '');
    const outcome = serve(request, response, tile && !gzip ? gunzipSync(bytes) : bytes, {
      'Cache-Control': 'private, no-cache',
      'Content-Type': tile
        ? 'application/vnd.mapbox-vector-tile'
        : url.includes('.pbf')
          ? 'application/x-protobuf'
          : url.includes('.png')
            ? 'image/png'
            : 'application/json',
      ...(gzip ? {'Content-Encoding': 'gzip'} : {}),
    });
    if (outcome === 'not-modified') count.notModified += 1;
    else count.downloads += 1;
    return true;
  };
}
