import type {TileflowCircleStyle} from '../../cartography/styles';
import type {TileflowThemeColorValue, TileflowThemeNumberValue} from '../../cartography/values';
import type {
  TileflowTreeFinish,
  TileflowTreeForm,
  TileflowTreeFormMix,
  TileflowTreeRegion,
} from '../../trees-3d';

export type TileflowVegetationMode = '3d' | 'flat' | 'auto';

export type TileflowVegetationThreeDimensionalStyle = {
  barkColor?: TileflowThemeColorValue;
  /** Sunlit leaf colours of broadleaf trees, from darkest to lightest; up to four are used. */
  broadleafColors?: readonly TileflowThemeColorValue[];
  /** Sunlit needle colours of conifers and columns, from darkest to lightest. */
  coniferColors?: readonly TileflowThemeColorValue[];
  /** Sunlit frond colours of palms, from darkest to lightest; the broadleaf colours by default. */
  palmColors?: readonly TileflowThemeColorValue[];
  /**
   * Whether the data's hedges stand as clipped green walls beside the trees, at their height or
   * 1.3 m, a metre higher on an earth bank. Defaults to true where the data has hedges.
   */
  hedges?: boolean;
  /** Sunlit colours of hedges, from darkest to lightest; the two darkest broadleaf colours by default. */
  hedgeColors?: readonly TileflowThemeColorValue[];
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
  /**
   * Each form's own scales, on top of `heightScale` and `crownScale`, such as taller palms, and the
   * map's own models it draws: ids of `.glb` files in the map's `models` directories, one to four,
   * each tree drawing one. A model's materials named `bark`, `leaves`, `fronds` or `stem` take
   * those parts' colours.
   */
  forms?: Partial<
    Record<
      TileflowTreeForm,
      {
        heightScale?: TileflowThemeNumberValue;
        crownScale?: TileflowThemeNumberValue;
        models?: readonly string[];
      }
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
  /** `3d` uses models at every pitch; `auto` follows the runtime's explicit 2D/3D view mode. */
  mode?: TileflowVegetationMode;
  /** Representation when a renderer cannot draw models. Defaults to `flat`. */
  fallback?: 'flat' | 'none';
  /** Initial visibility; a runtime control may override it. Defaults to true. */
  visible?: boolean;
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
