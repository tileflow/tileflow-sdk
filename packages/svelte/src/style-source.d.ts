type TileflowMapStyleInput = {
  source?: unknown;
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
