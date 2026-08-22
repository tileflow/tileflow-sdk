import type {MapLibreStyle, TileflowConfig} from '@tileflow/core';
import TileflowMap, {TileflowMap as NamedTileflowMap, type TileflowMapProps} from '../src/index.js';

declare const config: TileflowConfig;
declare const mapStyle: MapLibreStyle;

const validProps = [
  {},
  {config},
  {config, themes: {}},
  {map: 'main'},
  {map: 'main', mapStyle},
  {map: 'main', styleBaseUrl: '/generated'},
  {map: 'main', styleUrl: '/styles/main.json'},
  {mapStyle},
  {styleUrl: '/styles/main.json'},
] satisfies TileflowMapProps[];

// @ts-expect-error config owns the complete style source.
const configWithMap: TileflowMapProps = {config, map: 'main'};
// @ts-expect-error explicit style sources are mutually exclusive.
const competingStyles: TileflowMapProps = {mapStyle, styleUrl: '/styles/main.json'};
// @ts-expect-error styleBaseUrl only resolves a named map.
const baseWithoutMap: TileflowMapProps = {styleBaseUrl: '/generated'};
// @ts-expect-error themes only compile a config source.
const themesWithoutConfig: TileflowMapProps = {themes: {}};

const namedComponent: typeof TileflowMap = NamedTileflowMap;

void [
  validProps,
  configWithMap,
  competingStyles,
  baseWithoutMap,
  themesWithoutConfig,
  namedComponent,
];
