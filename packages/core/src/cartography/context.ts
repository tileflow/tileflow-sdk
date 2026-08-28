import type {ResolvedTileflowData} from '../data';
import type {ResolvedMarine} from '../marine';
import type {TileflowResolvedColors, TileflowResolvedImages} from '../themes';
import type {ResolvedTileflowTypography, ResolvedTileflowTypographyStyle} from '../types';
import type {TileflowTextStyle} from './styles';

export type TileflowDomainCompileContext = {
  colors: TileflowResolvedColors;
  data: ResolvedTileflowData;
  /** Concrete semantic image-role catalog from the selected theme. */
  images: TileflowResolvedImages;
  /** Explicit auxiliary marine selection; undefined preserves the World V1 bathymetry fallback. */
  marine?: ResolvedMarine;
  typography: ResolvedTileflowTypography;
};

export function typographyTextStyle(
  typography: ResolvedTileflowTypographyStyle,
): Pick<TileflowTextStyle, 'fallbacks' | 'font' | 'letterSpacing' | 'transform'> {
  return {
    font: typography.font,
    ...(typography.fallbacks ? {fallbacks: typography.fallbacks} : {}),
    ...(typography.letterSpacing === undefined ? {} : {letterSpacing: typography.letterSpacing}),
    ...(typography.transform === undefined ? {} : {transform: typography.transform}),
  };
}
