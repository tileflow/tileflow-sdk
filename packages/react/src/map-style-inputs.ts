import {
  type MapLibreStyle,
  validateTileflowRuntimeStyleInputs,
  type TileflowConfig,
  type TileflowProjectThemes,
} from '@tileflow/core';

export type TileflowMapStyleSourceProps =
  | {
      config: TileflowConfig;
      map?: never;
      style?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: TileflowProjectThemes;
    }
  | {
      config?: never;
      map?: string;
      style: MapLibreStyle;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map?: string;
      style?: never;
      styleBaseUrl?: never;
      styleUrl: string;
      themes?: never;
    }
  | {
      config?: never;
      map: string;
      style?: never;
      styleBaseUrl: string;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map?: string;
      style?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    };

export type TileflowMapStyleInputs = {
  config?: unknown;
  map?: string;
  style?: unknown;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: unknown;
};

export type TileflowMapStyleInputsValidation = {error: string; ok: false} | {ok: true};

export function validateTileflowMapStyleInputs(
  input: TileflowMapStyleInputs,
): TileflowMapStyleInputsValidation {
  return validateTileflowRuntimeStyleInputs(input);
}

export function assertTileflowMapStyleInputs(input: TileflowMapStyleInputs): void {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid Tileflow <Map> style inputs: ${validation.error}`);
  }
}
