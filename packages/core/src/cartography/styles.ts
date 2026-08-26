import type {TileflowStyleValue} from './values';

export type TileflowLineCap = 'butt' | 'round' | 'square';
export type TileflowLineJoin = 'bevel' | 'miter' | 'round';
export type TileflowSymbolPlacement = 'line' | 'line-center' | 'point';
export type TileflowSymbolZOrder = 'auto' | 'source' | 'viewport-y';
export type TileflowTextAnchor =
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'center'
  | 'left'
  | 'right'
  | 'top'
  | 'top-left'
  | 'top-right';
export type TileflowTextJustify = 'auto' | 'center' | 'left' | 'right';
export type TileflowIconAnchor = TileflowTextAnchor;
export type TileflowAlignment = 'auto' | 'map' | 'viewport';

/** Visibility and zoom bounds shared by every visual primitive. */
export type TileflowLayerRange = {
  maxZoom?: number;
  minZoom?: number;
  visible?: boolean;
};

export type TileflowBackgroundPaint = {
  color?: TileflowStyleValue<string>;
  opacity?: TileflowStyleValue<number>;
  pattern?: TileflowStyleValue<string>;
};
export type TileflowBackgroundStyle = TileflowLayerRange & TileflowBackgroundPaint;

export type TileflowFillPaint = {
  antialias?: boolean;
  color?: TileflowStyleValue<string>;
  opacity?: TileflowStyleValue<number>;
  pattern?: TileflowStyleValue<string>;
};
export type TileflowFillStyle = TileflowLayerRange & TileflowFillPaint;

export type TileflowLinePaint = {
  blur?: TileflowStyleValue<number>;
  color?: TileflowStyleValue<string>;
  dash?: TileflowStyleValue<readonly number[]>;
  gapWidth?: TileflowStyleValue<number>;
  offset?: TileflowStyleValue<number>;
  opacity?: TileflowStyleValue<number>;
  pattern?: TileflowStyleValue<string>;
  width?: TileflowStyleValue<number>;
};
export type TileflowLineLayout = {
  cap?: TileflowStyleValue<TileflowLineCap>;
  join?: TileflowStyleValue<TileflowLineJoin>;
  miterLimit?: number;
  roundLimit?: number;
};
export type TileflowLineStyle = TileflowLayerRange & TileflowLinePaint & TileflowLineLayout;

/** Repeated diagonal marks placed along a stroked geographic feature. */
export type TileflowLineHatchStyle = TileflowLayerRange & {
  angle?: TileflowStyleValue<number>;
  color?: TileflowStyleValue<string>;
  opacity?: TileflowStyleValue<number>;
  /** Sprite pattern clipped to the line deck; when set, it replaces glyph hatching. */
  pattern?: TileflowStyleValue<string>;
  /**
   * Intrinsic pixel heights available as `${pattern}-${width}` sprites. Tileflow
   * selects the closest height to the rendered line width so marks retain a
   * nearly fixed screen-pixel thickness instead of stretching with the road.
   * Requires `pattern` to be a literal sprite-name prefix.
   */
  patternWidths?: readonly number[];
  size?: TileflowStyleValue<number>;
  spacing?: TileflowStyleValue<number>;
};

export type TileflowTextPaint = {
  color?: TileflowStyleValue<string>;
  haloBlur?: TileflowStyleValue<number>;
  haloColor?: TileflowStyleValue<string>;
  haloWidth?: TileflowStyleValue<number>;
  opacity?: TileflowStyleValue<number>;
};
export type TileflowTextLayout = {
  allowOverlap?: boolean;
  anchor?: TileflowTextAnchor;
  field?: TileflowStyleValue<string>;
  font?: string;
  fallbacks?: readonly string[];
  ignorePlacement?: boolean;
  justify?: TileflowTextJustify;
  keepUpright?: boolean;
  letterSpacing?: TileflowStyleValue<number>;
  lineHeight?: TileflowStyleValue<number>;
  maxAngle?: number;
  maxWidth?: TileflowStyleValue<number>;
  offset?: readonly [number, number];
  optional?: boolean;
  padding?: TileflowStyleValue<number>;
  radialOffset?: TileflowStyleValue<number>;
  rotate?: TileflowStyleValue<number>;
  size?: TileflowStyleValue<number>;
  transform?: 'lowercase' | 'none' | 'uppercase';
  variableAnchors?: readonly TileflowTextAnchor[];
};
export type TileflowTextStyle = TileflowLayerRange & TileflowTextPaint & TileflowTextLayout;

export type TileflowIconPaint = {
  color?: TileflowStyleValue<string>;
  haloBlur?: TileflowStyleValue<number>;
  haloColor?: TileflowStyleValue<string>;
  haloWidth?: TileflowStyleValue<number>;
  opacity?: TileflowStyleValue<number>;
};
export type TileflowIconLayout = {
  allowOverlap?: boolean;
  anchor?: TileflowIconAnchor;
  image?: TileflowStyleValue<string>;
  ignorePlacement?: boolean;
  keepUpright?: boolean;
  offset?: readonly [number, number];
  optional?: boolean;
  padding?: TileflowStyleValue<number>;
  pitchAlignment?: TileflowAlignment;
  rotate?: TileflowStyleValue<number>;
  rotationAlignment?: TileflowAlignment;
  size?: TileflowStyleValue<number>;
};
export type TileflowIconStyle = TileflowLayerRange & TileflowIconPaint & TileflowIconLayout;

export type TileflowSymbolPlacementStyle = TileflowLayerRange & {
  placement?: TileflowSymbolPlacement;
  priority?: TileflowStyleValue<number>;
  spacing?: TileflowStyleValue<number>;
  zOrder?: TileflowSymbolZOrder;
};

export type TileflowCirclePaint = {
  blur?: TileflowStyleValue<number>;
  color?: TileflowStyleValue<string>;
  opacity?: TileflowStyleValue<number>;
  pitchAlignment?: 'map' | 'viewport';
  pitchScale?: 'map' | 'viewport';
  radius?: TileflowStyleValue<number>;
  strokeColor?: TileflowStyleValue<string>;
  strokeOpacity?: TileflowStyleValue<number>;
  strokeWidth?: TileflowStyleValue<number>;
};
export type TileflowCircleStyle = TileflowLayerRange & TileflowCirclePaint;

export type TileflowExtrusionPaint = {
  base?: TileflowStyleValue<number>;
  color?: TileflowStyleValue<string>;
  height?: TileflowStyleValue<number>;
  opacity?: TileflowStyleValue<number>;
  pattern?: TileflowStyleValue<string>;
  verticalGradient?: boolean;
};
export type TileflowExtrusionStyle = TileflowLayerRange & TileflowExtrusionPaint;

/** A polygon rendered as a fill and, when requested, a separate line layer. */
export type TileflowAreaStyle = {
  fill?: TileflowFillStyle;
  outline?: TileflowLineStyle;
};

/** The canonical ordered phases used for roads, aeroways, and other stroked paths. */
export type TileflowLineStackStyle = {
  casing?: TileflowLineStyle;
  fill?: TileflowLineStyle;
  shadow?: TileflowLineStyle;
};

/** A symbol layer composed from one placement policy and optional text/icon parts. */
export type TileflowSymbolStyle = TileflowSymbolPlacementStyle & {
  icon?: TileflowIconStyle;
  marker?: TileflowCircleStyle;
  text?: TileflowTextStyle;
};
