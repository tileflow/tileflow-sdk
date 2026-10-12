// Route inks: how a theme draws an application's route on its map. Themes set them as the optional
// `route.*` tokens; the compiler publishes them, resolved, in the style's metadata, so a browser
// application draws its routes in the inks of the theme on screen and follows theme changes and
// blends without colour tables of its own.
import {mixTileflowColours} from './theme-blend';
import type {ResolvedTileflowTheme, TileflowThemeColorScheme} from './themes/model';

export const tileflowRouteMetadataKey = 'tileflow:route';

/** The resolved inks of a route, from its outer glow to its bright core. */
export type TileflowRouteInks = Readonly<{
  /** The chosen route's line. */
  line: string;
  /** The edge on each side of the line, which sets it apart from the roads under it. */
  casing: string;
  /** A thin line along the middle of the route. */
  core: string;
  /** A soft halo around the route. */
  glow: string;
  /** Other routes offered beside the chosen one. */
  alternative: string;
  /** Opacity of the glow, from 0 (no glow) to 1. */
  glowOpacity: number;
  /** Opacity of the core, from 0 (no core) to 1. */
  coreOpacity: number;
}>;

/** The token each ink is read from; a theme may set any of them. */
export const tileflowRouteTokens = Object.freeze({
  color: Object.freeze({
    line: 'route.line',
    casing: 'route.casing',
    core: 'route.core',
    glow: 'route.glow',
    alternative: 'route.alternative',
  }),
  number: Object.freeze({
    glowOpacity: 'route.glow.opacity',
    coreOpacity: 'route.core.opacity',
  }),
} as const);

/** The inks of a theme that sets no route tokens: a blue that reads on either kind of map. */
export const tileflowDefaultRouteInks: Readonly<
  Record<TileflowThemeColorScheme, TileflowRouteInks>
> = Object.freeze({
  light: Object.freeze({
    line: '#2563eb',
    casing: '#1e3a8a',
    core: '#dbeafe',
    glow: '#2563eb',
    alternative: '#94a3b8',
    glowOpacity: 0.16,
    coreOpacity: 0,
  }),
  dark: Object.freeze({
    line: '#60a5fa',
    casing: '#0b1220',
    core: '#eff6ff',
    glow: '#60a5fa',
    alternative: '#64748b',
    glowOpacity: 0.4,
    coreOpacity: 0.7,
  }),
});

const colourKeys = Object.keys(
  tileflowRouteTokens.color,
) as (keyof typeof tileflowRouteTokens.color)[];
const numberKeys = Object.keys(
  tileflowRouteTokens.number,
) as (keyof typeof tileflowRouteTokens.number)[];

/** A resolved theme's route inks: its own `route.*` tokens over its colour scheme's defaults. */
export function resolveTileflowRouteInks(theme: ResolvedTileflowTheme): TileflowRouteInks {
  const defaults = tileflowDefaultRouteInks[theme.colorScheme];
  const inks: Record<string, string | number> = {...defaults};
  for (const key of colourKeys) {
    const value = theme.tokens.color[tileflowRouteTokens.color[key]];
    if (value !== undefined) inks[key] = value;
  }
  for (const key of numberKeys) {
    const token = tileflowRouteTokens.number[key];
    const value = theme.tokens.number[token];
    if (value === undefined) continue;
    if (!(value >= 0 && value <= 1)) {
      throw new Error(
        `Tileflow theme "${theme.id}" sets number token "${token}" to ${value}; route opacities run from 0 to 1.`,
      );
    }
    inks[key] = value;
  }
  return Object.freeze(inks) as TileflowRouteInks;
}

/**
 * Reads the route inks a compiled style publishes, or undefined when its metadata has none (a
 * style compiled before route inks, or not by Tileflow).
 */
export function readTileflowRouteInks(metadata: unknown): TileflowRouteInks | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata[tileflowRouteMetadataKey];
  if (!isRecord(value) || value.version !== 1) return undefined;
  const inks: Record<string, string | number> = {};
  for (const key of colourKeys) {
    const colour = value[key];
    if (typeof colour !== 'string' || !colour) return undefined;
    inks[key] = colour;
  }
  for (const key of numberKeys) {
    const number = value[key];
    if (typeof number !== 'number' || !(number >= 0 && number <= 1)) return undefined;
    inks[key] = number;
  }
  return Object.freeze(inks) as TileflowRouteInks;
}

/**
 * The route inks of a compiled style: those it publishes, or the defaults of its colour scheme
 * (from its `tileflow:colorScheme` metadata, else `fallbackScheme`).
 */
export function tileflowStyleRouteInks(
  style: {metadata?: unknown} | undefined,
  fallbackScheme: TileflowThemeColorScheme = 'light',
): TileflowRouteInks {
  const metadata = style?.metadata;
  const published = readTileflowRouteInks(metadata);
  if (published) return published;
  const scheme = isRecord(metadata) ? metadata['tileflow:colorScheme'] : undefined;
  return tileflowDefaultRouteInks[
    scheme === 'dark' || scheme === 'light' ? scheme : fallbackScheme
  ];
}

/** The metadata entry a compiled style carries for its route inks. */
export function tileflowRouteMetadata(inks: TileflowRouteInks): Readonly<Record<string, unknown>> {
  return Object.freeze({version: 1, ...inks});
}

/**
 * Inks between two themes' inks, `t` of the way from `from` to `to`: colours mix in OKLab, as theme
 * blends mix paint colours, and opacities linearly.
 */
export function mixTileflowRouteInks(
  from: TileflowRouteInks,
  to: TileflowRouteInks,
  t: number,
): TileflowRouteInks {
  const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  if (at === 0) return from;
  if (at === 1) return to;
  const inks: Record<string, string | number> = {};
  for (const key of colourKeys)
    inks[key] = mixTileflowColours(from[key], to[key], at) ?? (at < 0.5 ? from[key] : to[key]);
  for (const key of numberKeys) inks[key] = from[key] + (to[key] - from[key]) * at;
  return Object.freeze(inks) as TileflowRouteInks;
}

/** The inks at a blend position over the blended themes' inks, in blend order. */
export function tileflowRouteInksAt(
  inks: readonly TileflowRouteInks[],
  position: number,
): TileflowRouteInks | undefined {
  if (inks.length === 0) return undefined;
  const at = Math.min(inks.length - 1, Math.max(0, Number.isFinite(position) ? position : 0));
  const lower = Math.floor(at);
  const upper = Math.min(inks.length - 1, lower + 1);
  return mixTileflowRouteInks(inks[lower]!, inks[upper]!, at - lower);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
