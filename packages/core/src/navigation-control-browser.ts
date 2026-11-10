/** Where on the map a control sits. */
export type TileflowControlPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/** The zoom and compass buttons, with MapLibre's option names. */
export type TileflowNavigationControlOptions = Readonly<{
  /** Corner of the map. Defaults to `top-right`. */
  position?: TileflowControlPosition;
  /** The compass button. Defaults to `true`. */
  showCompass?: boolean;
  /** The zoom buttons. Defaults to `true`. */
  showZoom?: boolean;
  /** Tilts the compass with the map's pitch. Defaults to `false`. */
  visualizePitch?: boolean;
}>;

/** `false` removes the buttons, `true` or nothing shows them at their defaults. */
export type TileflowNavigationControlInput = boolean | TileflowNavigationControlOptions | undefined;

const positions: ReadonlySet<string> = new Set([
  'bottom-left',
  'bottom-right',
  'top-left',
  'top-right',
]);

/**
 * What to add to a map for a `navigationControl` setting, or null for no control. An unknown
 * position falls back to `top-right` and is named in the warning.
 */
export function resolveTileflowNavigationControl(input: TileflowNavigationControlInput): {
  options: {showCompass?: boolean; showZoom?: boolean; visualizePitch?: boolean};
  position: TileflowControlPosition;
} | null {
  if (input === false) return null;
  const {position, showCompass, showZoom, visualizePitch} =
    input && typeof input === 'object' ? input : ({} as TileflowNavigationControlOptions);
  let corner: TileflowControlPosition = 'top-right';
  if (position !== undefined) {
    if (positions.has(position)) corner = position;
    else
      console.warn(
        `Unknown navigationControl position ${JSON.stringify(position)}; using "top-right". Use one of ${[...positions].join(', ')}.`,
      );
  }
  return {
    options: {
      ...(showCompass === undefined ? {} : {showCompass}),
      ...(showZoom === undefined ? {} : {showZoom}),
      ...(visualizePitch === undefined ? {} : {visualizePitch}),
    },
    position: corner,
  };
}

/** A key that changes exactly when the control to show changes. */
export function tileflowNavigationControlKey(input: TileflowNavigationControlInput): string {
  const resolved = resolveTileflowNavigationControl(input);
  return resolved ? JSON.stringify([resolved.position, resolved.options]) : '';
}

export type TileflowNavigationControlBinding = {
  /** Remove the control; later calls do nothing. */
  dispose(): void;
  /** Show the control for this setting, replacing the one shown if the setting changed. */
  update(input: TileflowNavigationControlInput): void;
};

/**
 * Keeps one navigation control on a map in step with a `navigationControl` setting. The control
 * class comes from the caller, which owns the MapLibre import.
 */
export function createTileflowNavigationControlBinding(options: {
  createControl: (controlOptions: {
    showCompass?: boolean;
    showZoom?: boolean;
    visualizePitch?: boolean;
  }) => unknown;
  map: {
    addControl(control: never, position: TileflowControlPosition): unknown;
    removeControl(control: never): unknown;
  };
}): TileflowNavigationControlBinding {
  let control: unknown;
  let key: string | undefined;
  let disposed = false;
  const remove = () => {
    if (control === undefined) return;
    options.map.removeControl(control as never);
    control = undefined;
  };
  return {
    dispose() {
      disposed = true;
      key = undefined;
      remove();
    },
    update(input) {
      if (disposed) return;
      const next = tileflowNavigationControlKey(input);
      if (next === key) return;
      key = next;
      remove();
      const resolved = resolveTileflowNavigationControl(input);
      if (!resolved) return;
      control = options.createControl(resolved.options);
      options.map.addControl(control as never, resolved.position);
    },
  };
}
