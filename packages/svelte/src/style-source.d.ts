import type {TileflowMapProps} from './index.js';

type TileflowMapStyleInput = {
  config?: TileflowMapProps['config'];
  map?: TileflowMapProps['map'];
  mapStyle?: TileflowMapProps['mapStyle'];
  styleBaseUrl?: TileflowMapProps['styleBaseUrl'];
  styleUrl?: TileflowMapProps['styleUrl'];
  themes?: TileflowMapProps['themes'];
};

type TileflowMapStyleInputValidation =
  | {ok: true}
  | {
      error: string;
      ok: false;
    };

export declare function validateTileflowMapStyleInputs(
  input: TileflowMapStyleInput,
): TileflowMapStyleInputValidation;

export declare function assertTileflowMapStyleInputs(input: TileflowMapStyleInput): void;
