import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  createStyle,
  defineMap,
  deriveTileflowLineBackgroundGlyphs,
  disable,
  fixed,
  parseTileflowLineBackgroundFontStack,
  poi,
  zoom,
} from '../packages/core/dist/index.js';
import {streets, streetsThemes} from '../packages/maps/dist/index.js';

/** Optional real glyph fixture. The caller supplies the verified official Noto Sans Bold files. */
export function createLineBackgroundFixture({base, center, directory}) {
  if (!directory) return undefined;
  const sourceStack = 'Noto Sans Bold';
  const glyphRoot = `${base}/base/fe873949787f8f1e2ff72853d13c1e6e3c1de83474e4c1de60dae6ac33fe3081/glyphs`;
  const glyphs = `${glyphRoot}/{fontstack}/{range}.pbf`;
  const licenseUrl = `${glyphRoot}/${encodeURIComponent(sourceStack)}/LICENSE.md`;
  const license = readFileSync(join(directory, 'LICENSE.md'));
  const styles = {};
  const modules = Object.fromEntries(
    [
      'addresses',
      'aeroways',
      'boundaries',
      'buildings',
      'labels',
      'land',
      'landforms',
      'roads',
      'transit',
      'vegetation',
      'water',
    ].map((name) => [name, disable()]),
  );

  for (const dark of [false, true]) {
    for (const backed of [false, true]) {
      const name = `line-${backed ? 'backed' : 'plain'}-${dark ? 'dark' : 'light'}`;
      const map = defineMap({
        id: 'line-proof',
        version: 1,
        extends: streets,
        icons: [],
        terrain: 'none',
        themes: {light: streetsThemes.light},
        defaultTheme: 'light',
        modules: {
          ...modules,
          poi: poi({
            categories: ['arts-entertainment'],
            icons: false,
            labels: true,
            styles: {
              'arts-entertainment': {
                text: {
                  ...(backed
                    ? {
                        background: {
                          fit: 'lines',
                          color: fixed(dark ? '#203C50' : '#FFFFFF', {
                            reason: 'Qualification strip',
                          }),
                        },
                      }
                    : {}),
                  color: fixed(dark ? '#FFFFFF' : '#101820', {reason: 'Qualification text'}),
                  font: fixed(sourceStack, {reason: 'Qualification font'}),
                  letterSpacing: fixed(0.08, {reason: 'Qualification tracking'}),
                  size: zoom.linear([
                    [12, 18],
                    [16, 28],
                  ]),
                  ...(!backed ? {haloWidth: fixed(0, {reason: 'No background baseline'})} : {}),
                },
              },
            },
          }),
        },
      });
      const compiled = createStyle(map, {theme: 'light'});
      const text = compiled.layers.find((layer) => layer.id === 'tileflow-poi-label');
      if (!text) throw new Error('Core did not compile the qualification text style.');
      styles[name] = {
        version: 8,
        name,
        glyphs,
        metadata: {
          'tileflow:colorScheme': dark ? 'dark' : 'light',
          'tileflow:fontLicenses': [licenseUrl],
        },
        sources: {
          labels: {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [
                'Madrid\nParque del Retiro',
                'حديقة المدينة\nالقاهرة',
                'גן העיר\nירושלים',
              ].map((name, index) => ({
                type: 'Feature',
                id: index + 1,
                properties: {name, offset: [0, (index - 1) * 4]},
                geometry: {
                  type: 'Point',
                  coordinates: center,
                },
              })),
            },
          },
        },
        layers: [
          {
            id: 'ground',
            type: 'background',
            paint: {'background-color': dark ? '#090E14' : '#E2D8C8'},
          },
          {
            id: 'line-labels',
            type: 'symbol',
            source: 'labels',
            layout: {
              'text-field': ['get', 'name'],
              'text-offset': ['get', 'offset'],
              'text-font': text.layout['text-font'],
              'text-size': text.layout['text-size'],
              'text-letter-spacing': text.layout['text-letter-spacing'],
              'text-line-height': 1.2,
              'text-max-width': 20,
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'text-pitch-alignment': 'map',
              'text-rotation-alignment': 'map',
            },
            paint: text.paint,
          },
        ],
      };
    }
  }
  styles['line-empty'] = {
    ...styles['line-plain-light'],
    sources: {},
    layers: styles['line-plain-light'].layers.slice(0, 1),
  };
  const ranges = new Map();
  const body = (url) => {
    if (url === licenseUrl) return license;
    if (!url.startsWith(`${glyphRoot}/`)) return undefined;
    const match = /^([^/]+)\/(\d+-\d+)\.pbf$/u.exec(url.slice(glyphRoot.length + 1));
    if (!match) return undefined;
    const stack = decodeURIComponent(match[1]);
    const backed = parseTileflowLineBackgroundFontStack(stack);
    if ((backed?.source ?? stack) !== sourceStack) return undefined;
    const key = `${stack}/${match[2]}`;
    if (!ranges.has(key)) {
      const source = readFileSync(join(directory, `${match[2]}.pbf`));
      ranges.set(
        key,
        backed ? Buffer.from(deriveTileflowLineBackgroundGlyphs(source, backed.metrics)) : source,
      );
    }
    return ranges.get(key);
  };
  const entries = (themes) => {
    const stacks = new Set(
      themes
        .filter((name) => styles[name]?.layers.length > 1)
        .map((name) => styles[name].layers[1].layout['text-font'][0]),
    );
    return [
      {name: licenseUrl, contentType: 'text/plain; charset=utf-8', body: license},
      ...[...stacks].flatMap((stack) =>
        ['0-255', '1280-1535', '1536-1791', '65024-65279', '65280-65535'].map((range) => {
          const url = glyphs
            .replace('{fontstack}', encodeURIComponent(stack))
            .replace('{range}', range);
          return {name: url, contentType: 'application/x-protobuf', body: body(url)};
        }),
      ),
    ];
  };
  return {styles, body, entries, licenseUrl};
}
