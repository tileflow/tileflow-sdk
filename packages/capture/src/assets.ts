import type {TileflowBuildAsset} from '@tileflow/dev/artifacts';

export const tileflowSyntheticAssetOrigin = 'https://tileflow.local.invalid';

export type TileflowCaptureAsset = TileflowBuildAsset & {url?: string};
