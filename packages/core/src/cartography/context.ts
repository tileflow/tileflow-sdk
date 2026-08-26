import type {ResolvedTileflowData} from '../data';
import type {TileflowResolvedColors} from '../themes';
import type {ResolvedTileflowTypography, ResolvedTileflowTypographyStyle} from '../types';
import type {TileflowTextStyle} from './styles';

export type TileflowDomainCompileContext = {
  colors: TileflowResolvedColors;
  data: ResolvedTileflowData;
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
