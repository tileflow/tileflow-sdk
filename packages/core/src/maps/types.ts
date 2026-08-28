import type {TileflowCaptureScene} from '../capture-scene';
import type {TileflowStreetsModules} from '../cartography/streets-recipe';
import type {TileflowDataConfig} from '../data';
import type {TileflowMarine} from '../marine';
import {tileflowPortableIdSchema} from '../portable-identity';
import type {TileflowTheme, TileflowThemeName} from '../themes';
import type {TileflowProjection, TileflowTerrain, TileflowViewConfig} from '../types';
import type {TileflowFontDirectory, TileflowGlyphs, TileflowIconDirectory} from './assets';

/** Version of the internal Streets compiler contract understood by map roots. */
export const tileflowStreetsCompilerVersion = 1 as const;

/** Portable, filesystem-safe identity shared by maps and their leaf-owned scenes. */
export const tileflowMapIdSchema = tileflowPortableIdSchema;

export type TileflowStreetsMapRoot = {
  compiler: 'streets';
  compilerVersion: typeof tileflowStreetsCompilerVersion;
};

/** Compiler root inherited by a complete map lineage. */
export type TileflowMapRoot = TileflowStreetsMapRoot;

/** Identity is always owned by the map being resolved and never inherited. */
export type TileflowMapIdentity = {
  id: string;
  name?: string;
  /** Editorial version of this map, independent from its compiler version. */
  version: number;
};

/** A capture scene owned by one singular map; its map id is implicit. */
export type TileflowMapScene = Omit<TileflowCaptureScene, 'map'>;

export type TileflowHostedDelivery = {
  allowedOrigins?: string[];
};

export type TileflowMapDelivery = {
  hosted?: TileflowHostedDelivery;
};

/** Tooling metadata belongs to the leaf definition and is never inherited. */
export type TileflowMapTooling = {
  delivery?: TileflowMapDelivery;
  scenes?: Record<string, TileflowMapScene>;
};

type TileflowMapTextAssets =
  | {fonts?: never; glyphs?: never}
  | {fonts: readonly TileflowFontDirectory[]; glyphs?: never}
  | {fonts?: never; glyphs: TileflowGlyphs};

/** Cartographic fields supported by the current Streets compiler. */
export type TileflowMapDesign = TileflowMapTextAssets & {
  data?: TileflowDataConfig;
  /** Name used whenever a concrete theme is not explicitly requested. */
  defaultTheme?: TileflowThemeName;
  /** Ordered icon directories. Omission inherits; declaration replaces; [] means no icons. */
  icons?: readonly TileflowIconDirectory[];
  /** Independent Bathymetry and Nautical products composed by the compiler. */
  marine?: TileflowMarine;
  modules?: TileflowStreetsModules;
  projection?: TileflowProjection;
  /** Browser color-scheme mapping. Runtime resolves "system" to one of these concrete names. */
  systemThemes?: {
    dark: TileflowThemeName;
    light: TileflowThemeName;
  };
  terrain?: TileflowTerrain;
  /** Complete named appearances. Omission inherits; declaration replaces the collection. */
  themes?: Readonly<Record<TileflowThemeName, TileflowTheme>>;
  view?: TileflowViewConfig;
};

export type TileflowRootMap = TileflowMapIdentity &
  TileflowMapTooling &
  TileflowMapDesign & {
    defaultTheme: TileflowThemeName;
    extends?: never;
    root: TileflowMapRoot;
    themes: Readonly<Record<TileflowThemeName, TileflowTheme>>;
  };

export type TileflowDerivedMap = TileflowMapIdentity &
  TileflowMapTooling &
  TileflowMapDesign & {
    extends: TileflowMap;
    root?: never;
  };

/** Executable authoring definition: exactly one of `root` or `extends`. */
export type TileflowMap = TileflowRootMap | TileflowDerivedMap;

type ResolvedTileflowMapDesign<TDesign extends TileflowMapDesign = TileflowMapDesign> =
  TDesign extends TileflowMapDesign ? Omit<TDesign, 'defaultTheme' | 'themes'> : never;

/** A standalone map definition with inheritance removed. */
export type ResolvedTileflowMap = Omit<TileflowMapIdentity, 'name'> &
  Pick<TileflowMapTooling, 'delivery'> &
  ResolvedTileflowMapDesign & {
    defaultTheme: TileflowThemeName;
    extends?: never;
    name: string;
    root: TileflowMapRoot;
    themes: Readonly<Record<TileflowThemeName, TileflowTheme>>;
  };

export type ResolveMapOptions = {
  /** Maximum number of map definitions in a lineage, including the root. */
  maxDepth?: number;
};
