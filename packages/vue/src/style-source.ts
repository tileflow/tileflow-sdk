import {
  type MapLibreStyle,
  type TileflowConfig,
  type TileflowProjectThemes,
  validateTileflowRuntimeStyleInputs,
} from '@tileflow/core';

export type TileflowMapStyleInput = {
  config?: TileflowConfig;
  map?: string;
  mapStyle?: MapLibreStyle;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: TileflowProjectThemes;
};

export type TileflowMapStyleSourceProps =
  | {
      config: TileflowConfig;
      map?: never;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: TileflowProjectThemes;
    }
  | {
      config?: never;
      map?: string;
      mapStyle: MapLibreStyle;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map?: string;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl: string;
      themes?: never;
    }
  | {
      config?: never;
      map: string;
      mapStyle?: never;
      styleBaseUrl: string;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map: string;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map?: never;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    };

export type TileflowMapStyleInputValidation =
  | {ok: true}
  | {
      error: string;
      ok: false;
    };

export function validateTileflowMapStyleInputs(
  input: TileflowMapStyleInput,
): TileflowMapStyleInputValidation {
  const validation = validateTileflowRuntimeStyleInputs({...input, style: input.mapStyle});
  if (validation.ok) return validation;

  const error = {
    'config-conflict':
      '`config` cannot be combined with `map`, `mapStyle`, `styleBaseUrl`, or `styleUrl`.',
    'missing-config': '`themes` requires `config`.',
    'missing-map': '`styleBaseUrl` requires `map`.',
    'multiple-style-sources': 'Use only one of `mapStyle`, `styleBaseUrl`, or `styleUrl`.',
  }[validation.code];
  return {error, ok: false};
}

export function assertTileflowMapStyleInputs(input: TileflowMapStyleInput): void {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap style inputs: ${validation.error}`);
  }
}
