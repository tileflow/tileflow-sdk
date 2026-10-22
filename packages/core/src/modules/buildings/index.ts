import type {TileflowBuildingSurfaces} from '../../buildings-3d-surfaces';
import type {TileflowAreaStyle, TileflowExtrusionStyle} from '../../cartography/styles';
import type {
  TileflowThemeColorValue,
  TileflowThemeNumberValue,
  TileflowThemeValue,
} from '../../cartography/values';
import type {TileflowModelLightingRole, TileflowModelPart} from '../../models-3d-model';

export type TileflowBuildingMode = '3d' | 'flat';

/**
 * How Core's 3D buildings renderer draws the map's buildings. Their colour is the map's own 3D
 * building colour (its extrusion), else its roofs'.
 */
export type TileflowBuildingsThreeDimensionalStyle = {
  /** Use the scene sun (default), or the style's native extrusion light. */
  lighting?: 'style' | 'sun';
  /** Per-building brightness variation, from 0 to 1; defaults to 0 (authored colour). */
  colorVariation?: TileflowThemeNumberValue;
  /** How strongly roof outlines and outer corners catch the light, from 0 (default) to 1. */
  edges?: TileflowThemeNumberValue;
  /** Radius in metres for softened exterior corners and roof lighting, from 0 to 1; defaults to 0.8. */
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
  /** Per-role physical materials and emission, separate from palette slots and occlusion. */
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
        metallic?: TileflowThemeNumberValue;
        roughness?: TileflowThemeNumberValue;
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
  /** The colours of the models' parts; a part without one takes it from the building colour. */
  modelColors?: Partial<Record<TileflowBuildingModelPart, TileflowThemeColorValue>>;
  /**
   * Tileflow's landmarks, such as the Eiffel Tower, drawn as models in place of the buildings
   * under them. On by default with Tileflow World data; `false` switches them off, and `url` names
   * the TileJSON of another landmarks tileset. The map's own `models` come first: a landmark with
   * the same id as one, or whose footprint meets one's, is not drawn.
   */
  landmarks?: boolean | {url: string};
};

/** The parts of a building model, as its materials name them. */
export type TileflowBuildingModelPart = TileflowModelPart;

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
