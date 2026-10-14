import type {TileflowCircleStyle} from '../../cartography/styles';
import type {TileflowThemeColorValue, TileflowThemeNumberValue} from '../../cartography/values';
import type {TileflowTreeFormMix, TileflowTreeRegion} from '../../trees-3d';

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
