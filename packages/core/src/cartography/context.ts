import type {ResolvedTileflowData} from '../data';
import type {TileflowResolvedColors} from '../themes';
import type {ResolvedTileflowTypography} from '../types';

export type TileflowDomainCompileContext = {
  colors: TileflowResolvedColors;
  data: ResolvedTileflowData;
  icons?: {mapping?: Record<string, string>};
  typography: ResolvedTileflowTypography;
};
