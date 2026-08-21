import type {TileflowCaptureScene} from './capture-scene';
import {
  compileStreetsStyle,
  type TileflowStreetsCompileOptions,
  type TileflowStreetsMapConfig,
} from './cartography/streets';
import {tileflowStreetsBasemapDefinition} from './basemaps';
import {parseTileflowMap, parseTileflowProject} from './schema-v2';
import type {MapLibreStyle, TileflowProjectIconSets, TileflowProjectThemes} from './types';

export type TileflowConfig = TileflowStreetsMapConfig;
export type TileflowMapConfig = TileflowStreetsMapConfig;
export type TileflowStyleOptions = TileflowStreetsCompileOptions;

const tileflowBasemapCompilers = Object.freeze({
  streets: Object.freeze({
    ...tileflowStreetsBasemapDefinition,
    compile: compileStreetsStyle,
  }),
} as const satisfies Record<
  TileflowMapConfig['basemap']['type'],
  {
    type: TileflowMapConfig['basemap']['type'];
    version: TileflowMapConfig['basemap']['basemapVersion'];
    compile: typeof compileStreetsStyle;
  }
>);

export type TileflowProjectConfig = {
  icons?: TileflowProjectIconSets;
  maps: Record<string, TileflowMapConfig>;
  scenes?: Record<string, TileflowCaptureScene>;
  themes?: TileflowProjectThemes;
};

export type TileflowManifest = {
  maps: Record<string, string>;
  styles: Record<string, string>;
  version: 2;
};

export function createStyle(
  config: TileflowConfig,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  return compileTileflowMap(
    parseTileflowMap(config, {icons: options.iconSets, themes: options.themes}),
    options,
  );
}

export function createStyleFromProject<
  const TProject extends TileflowProjectConfig,
  const TMapName extends keyof TProject['maps'] & string,
>(project: TProject, mapName: TMapName, options?: TileflowStyleOptions): MapLibreStyle;

export function createStyleFromProject(
  project: TileflowProjectConfig,
  mapName: string,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const parsedProject = parseTileflowProject(project);
  const map = Object.hasOwn(parsedProject.maps, mapName) ? parsedProject.maps[mapName] : undefined;
  if (!map) throw new Error(`Unknown Tileflow map: ${mapName}`);

  return compileTileflowMap(map, {
    ...options,
    iconSets: parsedProject.icons,
    themes: parsedProject.themes,
  });
}

function compileTileflowMap(
  config: TileflowMapConfig,
  options: TileflowStyleOptions,
): MapLibreStyle {
  switch (config.basemap.type) {
    case 'streets': {
      const compiler = tileflowBasemapCompilers.streets;
      if (config.basemap.basemapVersion !== compiler.version) {
        throw new Error(
          `Unsupported Tileflow ${compiler.type} basemap version: ${String(config.basemap.basemapVersion)}`,
        );
      }
      return compiler.compile(config, options);
    }
  }
}

export function createManifest(
  project: TileflowProjectConfig,
  options: {styleBaseUrl?: string} = {},
): TileflowManifest {
  const parsedProject = parseTileflowProject(project);
  const styleBaseUrl = (options.styleBaseUrl ?? '').replace(/\/+$/, '');
  const entries = Object.keys(parsedProject.maps)
    .sort()
    .map((mapName) => [mapName, `${styleBaseUrl}/styles/${mapName}.json`]);

  return {
    version: 2,
    maps: Object.fromEntries(entries),
    styles: Object.fromEntries(entries),
  };
}
