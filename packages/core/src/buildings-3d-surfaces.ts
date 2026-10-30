/** Decorative finishes for ordinary extruded buildings; they do not describe surveyed materials. */
export type TileflowBuildingSurfaces<Numeric = number, Size = readonly [number, number]> = {
  walls?: {
    kind: 'brick';
    /** Brick width and course height in metres; defaults to [6, 3]. */
    size?: Size;
    /** Recessed joint width in metres; defaults to 0.12. */
    jointWidth?: Numeric;
    /** Strength of the shaded joints, from 0 to 1; defaults to 0.2. */
    contrast?: Numeric;
  };
  roof?: {
    kind: 'tiles';
    /** Square size in projected Mercator metres; defaults to 8. */
    size?: Numeric;
    /** Joint width in projected Mercator metres; defaults to 0.12. */
    jointWidth?: Numeric;
    contrast?: Numeric;
  };
  /** A painted light band and seam at the roof edge, without adding geometry. */
  cornice?: {height?: Numeric; contrast?: Numeric};
};

export type TileflowBuildingSurfaceDesign = {
  walls?: Required<NonNullable<TileflowBuildingSurfaces['walls']>>;
  roof?: Required<NonNullable<TileflowBuildingSurfaces['roof']>>;
  cornice?: Required<NonNullable<TileflowBuildingSurfaces['cornice']>>;
};

/** Read optional decoration from compiled metadata, ignoring unknown surface patterns. */
export function readTileflowBuildingSurfaces(
  value: unknown,
): TileflowBuildingSurfaceDesign | undefined {
  if (!record(value)) return undefined;
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : fallback;
  const result: TileflowBuildingSurfaceDesign = {};
  if (record(value.walls) && value.walls.kind === 'brick') {
    const size = Array.isArray(value.walls.size) ? value.walls.size : [];
    const width = number(size[0], 0.5, 100, 6);
    const height = number(size[1], 0.5, 100, 3);
    result.walls = {
      kind: 'brick',
      size: [width, height],
      jointWidth: Math.min(
        number(value.walls.jointWidth, 0.01, 2, 0.12),
        Math.min(width, height) * 0.25,
      ),
      contrast: number(value.walls.contrast, 0, 1, 0.2),
    };
  }
  if (record(value.roof) && value.roof.kind === 'tiles') {
    const size = number(value.roof.size, 0.5, 100, 8);
    result.roof = {
      kind: 'tiles',
      size,
      jointWidth: Math.min(number(value.roof.jointWidth, 0.01, 2, 0.12), size * 0.25),
      contrast: number(value.roof.contrast, 0, 1, 0.1),
    };
  }
  if (record(value.cornice))
    result.cornice = {
      height: number(value.cornice.height, 0.05, 5, 0.6),
      contrast: number(value.cornice.contrast, 0, 1, 0.2),
    };
  return Object.keys(result).length ? result : undefined;
}

/** Small tile-local coordinates for a camera-independent grid continuous across tile boundaries. */
export function tileflowBuildingSurfaceTile(
  x: number,
  y: number,
  zoom: number,
  size: number,
): readonly [number, number, number] {
  const span = 40_075_016.68557849 / 2 ** zoom;
  const phase = (value: number) => ((value % size) + size) % size;
  return [phase(x * span), phase(y * span), span / 8192];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
