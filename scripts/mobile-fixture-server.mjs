import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';

const require = createRequire(import.meta.url);
const fontRoot = dirname(require.resolve('@fontsource/noto-sans/package.json'));
const font = await readFile(resolve(fontRoot, 'files/noto-sans-latin-400-normal.woff2'));
const port = Number(process.env.TILEFLOW_FIXTURE_PORT ?? 18645);
const base = `http://127.0.0.1:${port}`;
const fontFaces = [
  {family: 'Noto Sans', source: `${base}/font.woff2`, style: 'normal', weight: '400'},
];
const features = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {name: 'Tileflow park'},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-3.71, 40.41],
            [-3.69, 40.41],
            [-3.69, 40.43],
            [-3.71, 40.43],
            [-3.71, 40.41],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'road',
      properties: {name: 'Example road'},
      geometry: {
        type: 'LineString',
        coordinates: [
          [-3.72, 40.415],
          [-3.68, 40.425],
        ],
      },
    },
    {
      type: 'Feature',
      id: 42,
      properties: {
        name: 'Tileflow',
        category: 'food-drink',
        type: 'cafe',
        icon: 'cafe',
        filter_rank: 1,
        size_rank: 1,
      },
      geometry: {type: 'Point', coordinates: [-3.7, 40.42]},
    },
  ],
};
const style = (dark) => ({
  version: 8,
  metadata: {
    'tileflow:fontFaces': fontFaces,
    'tileflow:notices': [{id: 'fixture-notice', sources: ['places'], text: 'Not for navigation'}],
    'tileflow:interaction-manifest': {
      version: 3,
      domains: {
        poi: {
          identity: 'maplibre-feature-id-if-present',
          fields: {
            category: 'category',
            filterRank: 'filter_rank',
            icon: 'icon',
            name: 'name',
            sizeRank: 'size_rank',
            type: 'type',
          },
          hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
          deduplication: {
            identity: ['source', 'source-layer', 'feature-id'],
            representationPriority: ['marker', 'icon', 'combined', 'label'],
          },
          layers: [
            {
              anchor: 'pointer-coordinate',
              layerId: 'poi',
              priority: 20,
              representation: 'marker',
              source: 'places',
            },
          ],
        },
      },
    },
  },
  sources: {places: {type: 'geojson', data: './data.json'}},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {'background-color': dark ? '#202a37' : '#e8e2d8'},
    },
    {
      id: 'park',
      type: 'fill',
      source: 'places',
      filter: ['==', '$type', 'Polygon'],
      paint: {'fill-color': dark ? '#34594e' : '#a6c893'},
    },
    {
      id: 'road',
      type: 'line',
      source: 'places',
      filter: ['==', '$type', 'LineString'],
      paint: {'line-color': dark ? '#f1ca8b' : '#ffffff', 'line-width': 8},
    },
    {
      id: 'poi',
      type: 'circle',
      source: 'places',
      filter: ['==', '$type', 'Point'],
      paint: {'circle-color': '#e9573f', 'circle-radius': 10},
    },
    {
      id: 'label',
      type: 'symbol',
      source: 'places',
      filter: ['==', '$type', 'Point'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans'],
        'text-size': 18,
        'text-offset': [0, -1.5],
      },
      paint: {'text-color': dark ? '#ffffff' : '#202a37'},
    },
  ],
});

// A Nautical scene: sea, depth areas and marks, with the notice a Nautical style declares.
const nauticalData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {depth: 'shallow'},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [2.16, 41.35],
            [2.2, 41.35],
            [2.2, 41.37],
            [2.16, 41.37],
            [2.16, 41.35],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {name: 'Fairway buoy'},
      geometry: {type: 'Point', coordinates: [2.19, 41.36]},
    },
    {
      type: 'Feature',
      properties: {name: 'Breakwater light'},
      geometry: {type: 'Point', coordinates: [2.175, 41.365]},
    },
  ],
};
const nauticalStyle = (dark) => ({
  version: 8,
  metadata: {
    'tileflow:fontFaces': fontFaces,
    'tileflow:notices': [{id: 'nautical', sources: ['sea'], text: 'Not for navigation'}],
  },
  sources: {sea: {type: 'geojson', data: './nautical-data.json'}},
  layers: [
    {id: 'water', type: 'background', paint: {'background-color': dark ? '#0b2236' : '#bcd9ea'}},
    {
      id: 'shallow',
      type: 'fill',
      source: 'sea',
      filter: ['==', '$type', 'Polygon'],
      paint: {'fill-color': dark ? '#16405c' : '#8ec2df'},
    },
    {
      id: 'marks',
      type: 'circle',
      source: 'sea',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-color': '#e8b04a',
        'circle-radius': 8,
        'circle-stroke-color': '#1d2a33',
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'mark-labels',
      type: 'symbol',
      source: 'sea',
      filter: ['==', '$type', 'Point'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans'],
        'text-size': 14,
        'text-offset': [0, -1.4],
      },
      paint: {'text-color': dark ? '#e6f0f5' : '#10324a'},
    },
  ],
});

// A city block whose style declares Core's 3D buildings. The buildings come from vector tiles,
// encoded here, which the 3D renderer reads directly.
const sceneCenter = [-3.7, 40.42];
const buildings = [];
for (let row = -4; row <= 4; row += 1)
  for (let column = -4; column <= 4; column += 1) {
    const west = sceneCenter[0] + column * 0.0009 - 0.0003;
    const south = sceneCenter[1] + row * 0.0007 - 0.00025;
    buildings.push({
      ring: [
        [west, south],
        [west + 0.0006, south],
        [west + 0.0006, south + 0.0005],
        [west, south + 0.0005],
      ],
      height: 12 + ((row * 7 + column * 13 + 81) % 9) * 9,
    });
  }
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
/** One `building` layer of a Mapbox Vector Tile with the buildings inside tile z/x/y. */
function buildingTile(z, x, y) {
  const extent = 4096;
  const scale = 2 ** z;
  const project = ([longitude, latitude]) => {
    const radians = (latitude * Math.PI) / 180;
    const worldX = ((longitude + 180) / 360) * scale;
    const worldY =
      ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale;
    return [Math.round((worldX - x) * extent), Math.round((worldY - y) * extent)];
  };
  const values = [];
  const features = [];
  for (const [index, building] of buildings.entries()) {
    const points = building.ring.map(project);
    if (points.every(([px, py]) => px < 0 || py < 0 || px > extent || py > extent)) continue;
    // A clockwise exterior ring on screen: west-south, west-north, east-north, east-south.
    const ring = [points[0], points[3], points[2], points[1]];
    const geometry = [9];
    let [cx, cy] = [0, 0];
    ring.forEach(([px, py], position) => {
      if (position === 1) geometry.push(2 | ((ring.length - 1) << 3));
      geometry.push(zigzag(px - cx), zigzag(py - cy));
      [cx, cy] = [px, py];
    });
    geometry.push(15);
    values.push(field(3, 1, [...new Uint8Array(new Float64Array([building.height]).buffer)]));
    features.push(
      field(2, 2, [
        ...field(1, 0, varint(index + 1)),
        ...field(2, 2, [...varint(0), ...varint(values.length - 1)]),
        ...field(3, 0, varint(3)),
        ...field(4, 2, geometry.flatMap(varint)),
      ]),
    );
  }
  const layer = [
    ...field(15, 0, varint(2)),
    ...field(1, 2, [...Buffer.from('building')]),
    ...features.flat(),
    ...field(3, 2, [...Buffer.from('render_height')]),
    ...values.flatMap((value) => field(4, 2, value)),
    ...field(5, 0, varint(extent)),
  ];
  return Buffer.from(field(3, 2, layer));
}
const sceneStyle = (dark) => ({
  version: 8,
  metadata: {
    'tileflow:fontFaces': fontFaces,
    'tileflow:buildings': {
      version: 1,
      source: 'city',
      layers: {building: 'building'},
      color: dark ? '#6d7684' : '#e3d9c6',
      edges: 0.4,
      lighting: 'sun',
      colorVariation: 0.2,
      verticalGradient: true,
      nightLight: 0,
      windows: false,
      shadows: true,
      occlusion: true,
    },
  },
  sources: {
    city: {type: 'vector', tiles: [`${base}/city/{z}/{x}/{y}.mvt`], minzoom: 13, maxzoom: 15},
  },
  layers: [
    {id: 'ground', type: 'background', paint: {'background-color': dark ? '#1c2129' : '#ece6da'}},
    {
      id: 'footprints',
      type: 'fill',
      source: 'city',
      'source-layer': 'building',
      paint: {'fill-color': dark ? '#2a313b' : '#d6ccb8'},
    },
  ],
});
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/archive.bin') {
    const length = 9 * 1024 * 1024;
    response.setHeader('Content-Type', 'application/octet-stream');
    if (request.method === 'HEAD') {
      response.setHeader('Content-Length', length);
      response.end();
    } else if (request.headers.range === 'bytes=16-17') {
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes 16-17/${length}`);
      response.end(Buffer.from([16, 17]));
    } else {
      response.setHeader('Content-Length', length);
      response.end(Buffer.alloc(length));
    }
    return;
  }
  if (request.url === '/redirect') {
    response.writeHead(302, {Location: `${base}/archive.bin`});
    response.end();
    return;
  }
  const tile = /^\/city\/(\d+)\/(\d+)\/(\d+)\.mvt$/u.exec(request.url ?? '');
  if (tile) {
    response.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
    response.end(buildingTile(...tile.slice(1).map(Number)));
    return;
  }
  if (request.url === '/font.woff2') {
    response.setHeader('Content-Type', 'font/woff2');
    response.end(font);
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  const value =
    request.url === '/manifest.json'
      ? {
          version: 1,
          maps: {
            fixture: {
              defaultTheme: 'light',
              systemThemes: {light: 'light', dark: 'dark'},
              view: {center: [-3.7, 40.42], zoom: 13, bearing: 0, pitch: 0},
              themes: {
                light: {styleUrl: `${base}/light.json`, colorScheme: 'light', fontFaces},
                dark: {styleUrl: `${base}/dark.json`, colorScheme: 'dark', fontFaces},
              },
            },
            nautical: {
              defaultTheme: 'day',
              systemThemes: {light: 'day', dark: 'night'},
              view: {center: [2.18, 41.36], zoom: 13, bearing: 0, pitch: 0},
              themes: {
                day: {styleUrl: `${base}/nautical-day.json`, colorScheme: 'light', fontFaces},
                night: {styleUrl: `${base}/nautical-night.json`, colorScheme: 'dark', fontFaces},
              },
            },
            scene: {
              defaultTheme: 'day',
              systemThemes: {light: 'day', dark: 'night'},
              view: {center: sceneCenter, zoom: 16.2, bearing: -20, pitch: 60},
              themes: {
                day: {styleUrl: `${base}/scene-day.json`, colorScheme: 'light', fontFaces},
                night: {styleUrl: `${base}/scene-night.json`, colorScheme: 'dark', fontFaces},
              },
            },
          },
        }
      : request.url === '/light.json'
        ? style(false)
        : request.url === '/dark.json'
          ? style(true)
          : request.url === '/data.json'
            ? features
            : request.url === '/nautical-day.json' || request.url === '/nautical-night.json'
              ? nauticalStyle(request.url === '/nautical-night.json')
              : request.url === '/nautical-data.json'
                ? nauticalData
                : request.url === '/scene-day.json' || request.url === '/scene-night.json'
                  ? sceneStyle(request.url === '/scene-night.json')
                  : null;
  if (!value) response.statusCode = 404;
  response.end(JSON.stringify(value));
});
server.listen(port, '127.0.0.1', () => console.log(`Mobile test map: ${base}/manifest.json`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
