import type {TileflowBuildingSurfaces} from '../../buildings-3d-surfaces';
import type {TileflowAreaStyle, TileflowExtrusionStyle} from '../../cartography/styles';
import type {
  TileflowThemeColorValue,
  TileflowThemeNumberValue,
  TileflowThemeValue,
} from '../../cartography/values';
import type {TileflowModelLightingRole} from '../../models-3d-model';

export type TileflowBuildingMode = '3d' | 'flat';

/**
 * How Core's 3D buildings renderer draws the map's buildings. Their colour is the map's own 3D
 * building colour (its extrusion), else its roofs'.
 */
export type TileflowBuildingsThreeDimensionalStyle = {
  /** Use the scene sun (default), or the style's native extrusion light. */
  lighting?: 'style' | 'sun';
  /** Keep flat footprints beneath 3D buildings (default true); false restores them in 2D. */
  flatFootprints?: boolean;
  /** Per-building brightness variation, from 0 to 1; defaults to 0 (authored colour). */
  colorVariation?: TileflowThemeNumberValue;
  /** How strongly roof outlines and outer corners catch the light, from 0 (default) to 1. */
  edges?: TileflowThemeNumberValue;
  /** Radius in metres for softened exterior corners and roof lighting, from 0 to 1.5; defaults to 0.8. */
  edgeRadius?: number;
  /** Their own colour, drawn unlit; without it they take the building's colour, lightened. */
  edgeColor?: TileflowThemeColorValue;
  /** How bright the buildings light the street at night, from 0 (none) to 2; defaults to 0. */
  nightLight?: TileflowThemeNumberValue;
  /** Height-selected architectural flood lighting. Off by default; follows scene darkness. */
  floodLight?: {
    intensity?: TileflowThemeNumberValue;
    /** Compensates authored light-colour transforms during darkness evaluation; defaults to 1. */
    brightnessScale?: TileflowThemeNumberValue;
    color?: TileflowThemeColorValue;
    /** Stable per-building ground radius range in metres; defaults to [30, 100]. */
    groundRadius?: readonly [number, number];
    /** Ground light starts at this height in metres; defaults to 30. */
    minGroundHeight?: number;
    /** Wall light starts above this height in metres; defaults to 200. */
    minWallHeight?: number;
    /** Wall radius as a fraction of building height; defaults to 1/3. */
    wallHeightRatio?: number;
  };
  /** Per-role physical materials and emission, separate from model parts and occlusion. */
  modelLighting?: Partial<
    Record<
      TileflowModelLightingRole,
      {
        emissiveStrength?: TileflowThemeNumberValue;
        /** Stable per-model addition to emission, from zero to this amount. */
        emissiveVariation?: TileflowThemeNumberValue;
        emissiveColor?: TileflowThemeColorValue;
        /** Height fractions, multipliers and curve exponent; defaults to a constant multiplier of one. */
        emissiveHeight?: readonly [
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
        ];
        /** Physical-material tint. Explicit modelColors take precedence. */
        color?: TileflowThemeColorValue;
        colorMix?: TileflowThemeNumberValue;
        /** Relative brightness after role/part colours, from zero to one; defaults to one. */
        colorScale?: TileflowThemeNumberValue;
        metallic?: TileflowThemeNumberValue;
        roughness?: TileflowThemeNumberValue;
        /** Normalize matte light to ordinary buildings, or retain physical glTF lighting (default). */
        shading?: 'physical' | 'map';
        /** Role multiplier for model ambient occlusion, from zero to one; defaults to one. */
        ambientOcclusion?: TileflowThemeNumberValue;
        /** Named-part colour contribution after the role tint, from zero to one; defaults to one. */
        partColorMix?: TileflowThemeNumberValue;
        /** Independent HSL ranges, seeded by model identity; no window geometry is invented. */
        colorVariation?: {
          hue: readonly [TileflowThemeNumberValue, TileflowThemeNumberValue];
          saturation: readonly [TileflowThemeNumberValue, TileflowThemeNumberValue];
          lightness: readonly [TileflowThemeNumberValue, TileflowThemeNumberValue];
          space?: 'srgb' | 'linear';
        };
      }
    >
  >;
  /**
   * The zoom bands the city comes in over: zooming in, across each band its part fades in and rises
   * from the ground, and zooming out it sinks and fades again. Defaults to the 0.3 zooms from the
   * renderer's `minzoom` (15) for the buildings, and to the 0.4 zooms from 0.8 before it for the
   * placed models and landmarks, which stand first. With reduced motion they only fade.
   */
  entrance?: {buildings?: readonly [number, number]; models?: readonly [number, number]};
  /** Contact shadow at the foot of the walls and in tight corners; defaults to true. */
  occlusion?: boolean;
  /** Ground contact shadow strength, from 0 to 1; defaults to 0.16. Facade shading is independent. */
  groundOcclusion?: TileflowThemeNumberValue;
  /** Ground contact shadow reach in metres, from 0 to 20; defaults to 3. Zero hides it. */
  groundOcclusionRadius?: TileflowThemeNumberValue;
  /** Prepared model ambient occlusion strength, from 0 to 1; defaults to 0.75. */
  modelOcclusion?: TileflowThemeNumberValue;
  /** Shadows from the sun, on the buildings and the flat map; defaults to true. */
  shadows?: boolean;
  /**
   * Invented night windows, lit by rooms: decoration, not data. With World's `class`, none on sheds,
   * barns, factories and churches, and homes lit apart from offices. Defaults to false.
   */
  windows?: boolean;
  /** Decorative wall joints, roof tiles and painted cornices. Off by default; ordinary buildings only. */
  surfaces?: TileflowBuildingSurfaces<
    TileflowThemeNumberValue,
    TileflowThemeValue<readonly [number, number]>
  >;
  /**
   * Building models the map places in its city, from the glTF binaries in its `models`
   * directories. Each stands in for the buildings under its footprint.
   */
  models?: readonly TileflowBuildingModelPlacementConfig[];
  /**
   * The colours of the models' parts, by the names their materials give them, such as `glass` or
   * `water`. A part the map gives no colour keeps its material's own.
   */
  modelColors?: Partial<Record<TileflowBuildingModelPart, TileflowThemeColorValue>>;
  /**
   * Tileflow's landmarks, such as the Eiffel Tower, drawn as models in place of the buildings
   * under them. On by default with Tileflow World data; `false` switches them off, and `url` names
   * the TileJSON of another landmarks tileset. The map's own `models` come first: a landmark with
   * the same id as one, or whose footprint meets one's, is not drawn.
   */
  landmarks?: boolean | {url: string};
};

/**
 * A part of a building model, as its materials name it: lower-case words joined by hyphens or
 * underscores, such as `surface`, `glass`, `roof` or `water`.
 */
export type TileflowBuildingModelPart = string;

/** Where a building model stands. */
export type TileflowBuildingModelPlacementConfig = {
  /** The model's id: the name of its `.glb` file in the map's `models` directories. */
  model: string;
  /**
   * The HTTPS address of the model's prepared file when it is served elsewhere, such as a model
   * Tileflow hosts for its own maps; the map then needs no `.glb` of its own for it.
   */
  url?: string;
  /** Longitude and latitude of the model's origin, where it stands on the ground. */
  at: readonly [number, number];
  /** Degrees clockwise from north that the model's own north (its +y) is turned to; defaults to 0. */
  heading?: number;
};

export type TileflowBuildingsModuleOptions = {
  businessCorridor?: TileflowAreaStyle;
  extrusion?: TileflowExtrusionStyle;
  flat?: TileflowAreaStyle;
  mode?: TileflowBuildingMode;
  threeDimensional?: TileflowBuildingsThreeDimensionalStyle;
};

export type TileflowBuildingsModuleConfig = TileflowBuildingsModuleOptions & {type: 'buildings'};

export function buildings(
  options: TileflowBuildingsModuleOptions = {},
): TileflowBuildingsModuleConfig {
  return {type: 'buildings', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
