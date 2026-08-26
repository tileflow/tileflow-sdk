export type TileflowMapFixtureOptions = {
  /** Additional static imports placed before the Tileflow imports. */
  imports?: string;
  /** Use a hermetic external vector source instead of inherited Tileflow World current. */
  data?: 'fixture' | 'inherited';
  /** Raw map fields appended after identity and inheritance. */
  fields?: string;
  id: string;
  /**
   * Most CLI fixtures disable POI icons and use no icon directories so tests
   * unrelated to icon compilation perform no asset I/O. `official` inherits
   * Streets assets; `authored` leaves the field to `fields`.
   */
  icons?: 'authored' | 'none' | 'official';
  /** Executable setup placed after imports and before the default export. */
  setup?: string;
  version?: number;
};

/** Emit one executable singular Tileflow map config for CLI integration tests. */
export function tileflowMapFixture(options: TileflowMapFixtureOptions): string {
  const fields = [
    options.data === 'fixture'
      ? `data: vectorTiles({
  attribution: '© Tileflow CLI fixture',
  revision: 'cli-fixture-v1',
  schema: openMapTiles(),
  tiles: ['https://tiles.example.invalid/{z}/{x}/{y}.pbf']
})`
      : '',
    options.icons === undefined || options.icons === 'none' ? `icons: []` : '',
    `modules: {
  addresses: {type: 'addresses', enabled: false},
  aeroways: {type: 'aeroways', enabled: false},
  boundaries: {type: 'boundaries', enabled: false},
  buildings: {type: 'buildings', enabled: false},
  labels: {type: 'labels', enabled: false},
  land: {type: 'land', enabled: false},
  landforms: {type: 'landforms', enabled: false},
  poi: {type: 'poi', enabled: false},
  roads: {type: 'roads', enabled: false},
  transit: {type: 'transit', enabled: false},
  vegetation: {type: 'vegetation', enabled: false},
  water: {type: 'water', enabled: false}
}`,
    `glyphs: {
  kind: 'url',
  url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
}`,
    options.fields?.trim() ?? '',
  ]
    .filter(Boolean)
    .join(',\n');
  const coreImports =
    options.data === 'fixture' ? 'defineMap, openMapTiles, vectorTiles' : 'defineMap';
  return `${normalizeSection(options.imports)}import {${coreImports}} from '@tileflow/core';
import {streets} from '@tileflow/maps';

${normalizeSection(options.setup)}export default defineMap({
  id: ${JSON.stringify(options.id)},
  version: ${options.version ?? 1},
  extends: streets${fields ? `,\n${indent(fields, 2)}` : ''}
});
`;
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function normalizeSection(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? `${normalized}\n` : '';
}
