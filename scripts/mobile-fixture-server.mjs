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
          },
        }
      : request.url === '/light.json'
        ? style(false)
        : request.url === '/dark.json'
          ? style(true)
          : request.url === '/data.json'
            ? features
            : null;
  if (!value) response.statusCode = 404;
  response.end(JSON.stringify(value));
});
server.listen(port, '127.0.0.1', () => console.log(`Mobile test map: ${base}/manifest.json`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
