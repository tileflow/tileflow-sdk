import type {MapView} from './contract';
import type {NativeReadinessEvidence} from './native-readiness';

export type NativeSurfaceEvent =
  | (NativeReadinessEvidence & Readonly<{surface: string}>)
  | Readonly<{
      surface: string;
      style: string;
      sequence: number;
      layout: number;
      kind: 'gesture-start' | 'gesture-change' | 'gesture-end';
      gesture: number;
      view: MapView;
    }>;

/** One themed value: a layer ID, a style-specification property name, and its plain value. */
export type NativeThemeValue = readonly [layer: string, property: string, value: unknown];
/** Pattern artwork mixed in pixels: `target` shows `from` and `to` mixed at `t` from 0 to 1. */
export type NativeThemeImage = readonly [target: string, from: string, to: string, t: number];
/** A batch of themed values applied together to the current style. */
export type NativeThemeValues = Readonly<{
  paint?: readonly NativeThemeValue[];
  layout?: readonly NativeThemeValue[];
  images?: readonly NativeThemeImage[];
  light?: Readonly<Record<string, unknown>>;
}>;

// There is no renderer handle or imperative command in the public Map ref.
export type NativeSurfaceModule = {
  attachSurface(root: number): Promise<Readonly<{surface: string}>>;
  expectStyle(surface: string, style: string): Promise<Readonly<{accepted: true}>>;
  commitLayout(surface: string, style: string): Promise<Readonly<{layout: number}>>;
  requestFrame(surface: string, style: string): Promise<Readonly<{requested: true}>>;
  applyCamera(
    surface: string,
    command: number,
    view: MapView,
  ): Promise<Readonly<{command: number; invalidation: number; view: MapView}>>;
  cancelCamera(surface: string, command: number): Promise<Readonly<{cancelled: true}>>;
  acknowledgeSurface(surface: string, sequence: number): Promise<Readonly<{acknowledged: true}>>;
  retireSurface(surface: string): Promise<Readonly<{detached: true}>>;
  retireRoot(root: number): Promise<Readonly<{detached: true}>>;
  // Theme motion. Native builds that predate these methods change themes at once.
  coverSurface?(surface: string, duration: number): Promise<Readonly<{covered: boolean}>>;
  revealSurface?(surface: string, duration: number): Promise<Readonly<{revealed: true}>>;
  discardSurfaceCover?(surface: string): Promise<Readonly<{discarded: true}>>;
  applyThemeValues?(
    surface: string,
    style: string,
    values: NativeThemeValues,
  ): Promise<Readonly<{applied: number}>>;
};

export type NativeSurface = Readonly<{
  id: string;
  expectStyle(style: string): Promise<void>;
  commitLayout(style: string): Promise<number>;
  requestFrame(style: string): Promise<void>;
  applyCamera(command: number, view: MapView): Promise<Readonly<{command: number; view: MapView}>>;
  cancelCamera(command: number): Promise<Readonly<{cancelled: true}>>;
  retire(): Promise<void>;
  /**
   * Covers the map with a snapshot of its current frame that follows the camera. Resolves false,
   * without a cover, for reduced motion, a map that is not drawn, or a native build without it.
   */
  cover?(duration: number): Promise<boolean>;
  /** Fades the covers out once the map has drawn a complete frame, then removes them. */
  reveal?(duration: number): Promise<void>;
  /** Removes every cover at once. */
  discardCover?(): Promise<void>;
  /** Applies themed values to the current style; only for the style the surface expects. */
  applyThemeValues?(style: string, values: NativeThemeValues): Promise<number>;
}>;

export class NativeSurfaceError extends Error {
  readonly code = 'NATIVE_SURFACE_UNAVAILABLE';
  constructor() {
    super('Native surface operation failed.');
    this.name = 'NativeSurfaceError';
  }
}
