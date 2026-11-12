import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {MapLibreStyle} from '@tileflow/core';
import {createTileflowStyleFamily} from '@tileflow/core/build';

export const frameworkMapFixture = '/tileflow-fixture/manifest.json';
export const frameworkBackgroundStyle = {
  version: 8,
  sources: {},
  layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}],
};

/** Files served by the fixture's existing application server, not an additional listener. */
export async function writeFrameworkMapFixture(
  root: string,
  style: unknown = frameworkBackgroundStyle,
  options: {family?: boolean} = {},
): Promise<void> {
  const directory = join(root, 'public', 'tileflow-fixture');
  await mkdir(directory, {recursive: true});
  await Promise.all([
    writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: options.family ? 3 : 1,
        maps: {
          main: {
            defaultTheme: 'light',
            ...(options.family ? {familyUrl: './family.json'} : {}),
            themes: {
              light: {colorScheme: 'light', styleUrl: './style.json', fontFaces: []},
            },
          },
        },
      }),
      'utf8',
    ),
    // Family fixtures omit the flat file, so bypassing family preparation fails in the browser.
    options.family
      ? writeFile(
          join(directory, 'family.json'),
          JSON.stringify(createTileflowStyleFamily({light: style as MapLibreStyle})),
          'utf8',
        )
      : writeFile(join(directory, 'style.json'), JSON.stringify(style), 'utf8'),
  ]);
}

/** Two themes with a label font and placement anchors, as a compiled map has. */
export async function writeDataLayerFixture(cwd: string, origin: string) {
  const directory = join(cwd, 'public/tileflow-fixture');
  await mkdir(join(directory, 'glyphs/Test'), {recursive: true});
  const style = (background: string) => ({
    glyphs: `${origin}/tileflow-fixture/glyphs/{fontstack}/{range}.pbf`,
    layers: [
      {id: 'background', paint: {'background-color': background}, type: 'background'},
      {
        id: 'labels',
        layout: {'text-field': ['get', 'name'], 'text-font': ['Test']},
        source: 'places',
        type: 'symbol',
      },
    ],
    metadata: {
      'tileflow:overlay-placement-manifest': {
        anchors: {'above-labels': null, 'below-labels': 'labels'},
        schemaVersion: 1,
      },
    },
    sources: {places: {data: {features: [], type: 'FeatureCollection'}, type: 'geojson'}},
    version: 8,
  });
  await Promise.all([
    writeFile(join(directory, 'glyphs/Test/0-255.pbf'), ''),
    writeFile(join(directory, 'light.json'), JSON.stringify(style('#dfe7ef'))),
    writeFile(join(directory, 'dark.json'), JSON.stringify(style('#101820'))),
    writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        maps: {
          main: {
            defaultTheme: 'light',
            themes: {
              dark: {colorScheme: 'dark', fontFaces: [], styleUrl: './dark.json'},
              light: {colorScheme: 'light', fontFaces: [], styleUrl: './light.json'},
            },
          },
        },
        version: 1,
      }),
    ),
  ]);
}
