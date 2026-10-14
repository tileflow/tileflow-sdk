import type {TileflowCircleStyle} from '../../cartography/styles';
import type {TileflowThemeColorValue, TileflowThemeNumberValue} from '../../cartography/values';
import type {
  TileflowTreeFinish,
  TileflowTreeForm,
  TileflowTreeFormMix,
  TileflowTreeRegion,
} from '../../trees-3d';

export type TileflowVegetationMode = '3d' | 'flat';

export type TileflowVegetationThreeDimensionalStyle = {
  barkColor?: TileflowThemeColorValue;
  /** Sunlit leaf colours of broadleaf trees, from darkest to lightest; up to four are used. */
  broadleafColors?: readonly TileflowThemeColorValue[];
  /** Sunlit needle colours of conifers and columns, from darkest to lightest. */
  coniferColors?: readonly TileflowThemeColorValue[];
  /** Sunlit frond colours of palms, from darkest to lightest; the broadleaf colours by default. */
  palmColors?: readonly TileflowThemeColorValue[];
  crownScale?: TileflowThemeNumberValue;
  heightScale?: TileflowThemeNumberValue;
  /**
   * How trees take the light: `faceted` (the default), low-poly facets softened towards a round
   * crown; `smooth`, round crowns; or `toon`, three bands of light and a crisp shadow, as a drawn
   * tree has them.
   */
  finish?: TileflowTreeFinish;
  /** How strongly an outline rings each tree, from 0 (none, the default) to 1. */
  edges?: TileflowThemeNumberValue;
  /** The outline's colour; the crown's darkest colour, deepened, by default. */
  edgeColor?: TileflowThemeColorValue;
  /** Each form's own scales, on top of `heightScale` and `crownScale`, such as taller palms. */
  forms?: Partial<
    Record<
      TileflowTreeForm,
      {heightScale?: TileflowThemeNumberValue; crownScale?: TileflowThemeNumberValue}
    >
  >;
  /**
   * The forms of trees whose data gives none, as relative weights: `round`, `open` and `tall`
   * (broadleaf), `conifer`, `columnar` and `palm`. Each tree draws one from a stable hash, so it
   * keeps its form everywhere. Defaults to the three broadleaf forms, evenly. A tree the data calls
   * broadleaved keeps to the broadleaf forms of the mix.
   */
  unknownForms?: TileflowTreeFormMix;
  /**
   * Regions whose trees without a form in the data take their own mix, such as palms along a
   * subtropical coast. Bounds are `[west, south, east, north]` in degrees; the first region holding
   * a tree applies. At most 16.
   */
  regions?: readonly TileflowTreeRegion[];
};

export type TileflowVegetationModuleOptions = {
  flat?: TileflowCircleStyle;
  mode?: TileflowVegetationMode;
  threeDimensional?: TileflowVegetationThreeDimensionalStyle;
};

export type TileflowVegetationModuleConfig = TileflowVegetationModuleOptions & {
  type: 'vegetation';
};

export function vegetation(
  options: TileflowVegetationModuleOptions = {},
): TileflowVegetationModuleConfig {
  return {type: 'vegetation', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
