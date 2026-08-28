import type {TileflowCaptureScene} from '../capture-scene';
import type {TileflowResolvedSemanticModuleOverrides} from '../cartography/domain-registry';
import type {TileflowDataConfig} from '../data';
import type {TileflowMarine} from '../marine';
import {tileflowPortableIdSchema} from '../portable-identity';
import type {TileflowTheme, TileflowThemeName} from '../themes';
import type {TileflowProjection, TileflowTerrain, TileflowViewConfig} from '../types';
import type {TileflowFontDirectory, TileflowGlyphs, TileflowIconDirectory} from './assets';
import type {TileflowAuthoringModules} from './operations';

/** Portable, filesystem-safe identity shared by maps and their leaf-owned scenes. */
export const tileflowMapIdSchema = tileflowPortableIdSchema;

/** Identity is always owned by the map being resolved and never inherited. */
export type TileflowMapIdentity = {
  id: string;
  name?: string;
  /** Editorial version of this map. */
  version: number;
};

/** A capture scene owned by one singular map; its map id is implicit. */
export type TileflowMapScene = Omit<TileflowCaptureScene, 'map'>;

/** Tooling metadata belongs to the leaf definition and is never inherited. */
export type TileflowMapTooling = {
  scenes?: Record<string, TileflowMapScene>;
};

type TileflowMapTextAssets =
  | {fonts?: never; glyphs?: never}
  | {fonts: readonly TileflowFontDirectory[]; glyphs?: never}
  | {fonts?: never; glyphs: TileflowGlyphs};

/** Cartographic fields supported by the V1 semantic compiler. */
export type TileflowMapDesign = TileflowMapTextAssets & {
  data?: TileflowDataConfig;
  /** Name used whenever a concrete theme is not explicitly requested. */
  defaultTheme?: TileflowThemeName;
  /** Ordered icon directories. Omission inherits; declaration replaces; [] means no icons. */
  icons?: readonly TileflowIconDirectory[];
  /** Independent Bathymetry and Nautical products composed by the compiler. */
  marine?: TileflowMarine;
  /** Semantic domains, expressed directly or with explicit refine/disable operations. */
  modules?: TileflowAuthoringModules;
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

/** Complete semantic map at the base of a lineage. The compiler is implicit. */
export type TileflowStandaloneMap = TileflowMapIdentity &
  TileflowMapTooling &
  TileflowMapDesign & {
    defaultTheme: TileflowThemeName;
    extends?: never;
    themes: Readonly<Record<TileflowThemeName, TileflowTheme>>;
  };

export type TileflowDerivedMap = TileflowMapIdentity &
  TileflowMapTooling &
  TileflowMapDesign & {
    extends: TileflowMap;
  };

/** Executable authoring definition using the one implicit semantic compiler. */
export type TileflowMap = TileflowDerivedMap | TileflowStandaloneMap;

type ResolvedTileflowMapDesign<TDesign extends TileflowMapDesign = TileflowMapDesign> =
  TDesign extends TileflowMapDesign ? Omit<TDesign, 'defaultTheme' | 'modules' | 'themes'> : never;

/** A standalone map definition with inheritance removed. */
export type ResolvedTileflowMap = Omit<TileflowMapIdentity, 'name'> &
  ResolvedTileflowMapDesign & {
    defaultTheme: TileflowThemeName;
    extends?: never;
    modules?: TileflowResolvedSemanticModuleOverrides;
    name: string;
    themes: Readonly<Record<TileflowThemeName, TileflowTheme>>;
  };

export type ResolveMapOptions = {
  /** Maximum number of map definitions in a lineage, including its standalone base. */
  maxDepth?: number;
};
