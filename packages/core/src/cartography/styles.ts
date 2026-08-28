import type {
  TileflowExpression,
  TileflowFixedValue,
  TileflowThemeColorValue,
  TileflowThemeFontValue,
  TileflowThemeImageValue,
  TileflowThemeNumberValue,
  TileflowZoomValue,
} from './values';

/** A color literal, semantic color token, color operation, expression, or zoom ramp. */
export type TileflowColorStyleValue =
  | TileflowExpression<string>
  | TileflowThemeColorValue
  | TileflowZoomValue<TileflowThemeColorValue>;

/** An image name, semantic image token, expression, or zoom ramp. */
export type TileflowImageStyleValue =
  | TileflowExpression<string>
  | TileflowThemeImageValue
  | TileflowZoomValue<TileflowThemeImageValue>;

/** A number, semantic number token, expression, or zoom ramp. */
export type TileflowNumberStyleValue =
  | TileflowExpression<number>
  | TileflowThemeNumberValue
  | TileflowZoomValue<TileflowThemeNumberValue>;

/** A visual numeric array whose components may be themed, or whose full shape is fixed. */
export type TileflowThemeNumberArrayValue =
  | readonly TileflowThemeNumberValue[]
  | TileflowFixedValue<readonly number[]>;

/** A visual numeric array, expression, or zoom ramp with explicit theme intent. */
export type TileflowNumberArrayStyleValue =
  | TileflowExpression<readonly number[]>
  | TileflowThemeNumberArrayValue
  | TileflowZoomValue<TileflowThemeNumberArrayValue>;

/** A two-dimensional visual offset with category-safe numeric components. */
export type TileflowNumberOffsetStyleValue =
  | readonly [TileflowThemeNumberValue, TileflowThemeNumberValue]
  | TileflowFixedValue<readonly number[]>
  | TileflowExpression<readonly number[]>
  | TileflowZoomValue<
      | readonly [TileflowThemeNumberValue, TileflowThemeNumberValue]
      | TileflowFixedValue<readonly number[]>
    >;

/** Top, right, bottom, and left visual insets with category-safe numeric components. */
export type TileflowNumberInsetsStyleValue =
  | readonly [
      TileflowThemeNumberValue,
      TileflowThemeNumberValue,
      TileflowThemeNumberValue,
      TileflowThemeNumberValue,
    ]
  | TileflowFixedValue<readonly [number, number, number, number]>
  | TileflowExpression<readonly number[]>
  | TileflowZoomValue<
      | readonly [
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
          TileflowThemeNumberValue,
        ]
      | TileflowFixedValue<readonly [number, number, number, number]>
    >;

/** A structural value that does not participate in semantic theme-token substitution. */
export type TileflowStructuralStyleValue<T> = T | TileflowExpression<T> | TileflowZoomValue<T>;

/** Structural text, including expressions and zoom-dependent literal strings. */
export type TileflowStringStyleValue = TileflowStructuralStyleValue<string>;

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
export type TileflowIconTextFit = 'both' | 'height' | 'none' | 'width';

/** Visibility and zoom bounds shared by every visual primitive. */
export type TileflowLayerRange = {
  maxZoom?: number;
  minZoom?: number;
  visible?: boolean;
};

export type TileflowBackgroundPaint = {
  color?: TileflowColorStyleValue;
  opacity?: TileflowNumberStyleValue;
  pattern?: TileflowImageStyleValue;
};
export type TileflowBackgroundStyle = TileflowLayerRange & TileflowBackgroundPaint;

export type TileflowFillPaint = {
  antialias?: boolean;
  color?: TileflowColorStyleValue;
  opacity?: TileflowNumberStyleValue;
  pattern?: TileflowImageStyleValue;
};
export type TileflowFillStyle = TileflowLayerRange & TileflowFillPaint;

export type TileflowLinePaint = {
  blur?: TileflowNumberStyleValue;
  color?: TileflowColorStyleValue;
  dash?: TileflowNumberArrayStyleValue;
  gapWidth?: TileflowNumberStyleValue;
  offset?: TileflowNumberStyleValue;
  opacity?: TileflowNumberStyleValue;
  pattern?: TileflowImageStyleValue;
  width?: TileflowNumberStyleValue;
};
export type TileflowLineLayout = {
  cap?: TileflowStructuralStyleValue<TileflowLineCap>;
  join?: TileflowStructuralStyleValue<TileflowLineJoin>;
  miterLimit?: TileflowNumberStyleValue;
  roundLimit?: TileflowNumberStyleValue;
};
export type TileflowLineStyle = TileflowLayerRange & TileflowLinePaint & TileflowLineLayout;

/** Repeated diagonal marks placed along a stroked geographic feature. */
export type TileflowLineHatchStyle = TileflowLayerRange & {
  angle?: TileflowNumberStyleValue;
  color?: TileflowColorStyleValue;
  opacity?: TileflowNumberStyleValue;
  /** Sprite pattern clipped to the line deck; when set, it replaces glyph hatching. */
  pattern?: TileflowImageStyleValue;
  /**
   * Intrinsic pixel heights available as `${pattern}-${width}` sprites. Tileflow
   * selects the closest height to the rendered line width so marks retain a
   * nearly fixed screen-pixel thickness instead of stretching with the road.
   * Requires `pattern` to be a literal sprite-name prefix.
   */
  patternWidths?: TileflowThemeNumberArrayValue;
  size?: TileflowNumberStyleValue;
  spacing?: TileflowNumberStyleValue;
};

export type TileflowTextPaint = {
  color?: TileflowColorStyleValue;
  haloBlur?: TileflowNumberStyleValue;
  haloColor?: TileflowColorStyleValue;
  haloWidth?: TileflowNumberStyleValue;
  opacity?: TileflowNumberStyleValue;
};
export type TileflowTextLayout = {
  allowOverlap?: boolean;
  anchor?: TileflowTextAnchor;
  field?: TileflowStringStyleValue;
  font?: TileflowThemeFontValue;
  fallbacks?: readonly TileflowThemeFontValue[];
  ignorePlacement?: boolean;
  justify?: TileflowTextJustify;
  keepUpright?: boolean;
  letterSpacing?: TileflowNumberStyleValue;
  lineHeight?: TileflowNumberStyleValue;
  maxAngle?: TileflowNumberStyleValue;
  maxWidth?: TileflowNumberStyleValue;
  offset?: TileflowNumberOffsetStyleValue;
  optional?: boolean;
  padding?: TileflowNumberStyleValue;
  pitchAlignment?: TileflowAlignment;
  radialOffset?: TileflowNumberStyleValue;
  rotate?: TileflowNumberStyleValue;
  rotationAlignment?: TileflowAlignment;
  size?: TileflowNumberStyleValue;
  transform?: 'lowercase' | 'none' | 'uppercase';
  variableAnchors?: readonly TileflowTextAnchor[];
};
export type TileflowTextStyle = TileflowLayerRange & TileflowTextPaint & TileflowTextLayout;

export type TileflowIconPaint = {
  color?: TileflowColorStyleValue;
  haloBlur?: TileflowNumberStyleValue;
  haloColor?: TileflowColorStyleValue;
  haloWidth?: TileflowNumberStyleValue;
  opacity?: TileflowNumberStyleValue;
};
export type TileflowIconLayout = {
  allowOverlap?: boolean;
  anchor?: TileflowIconAnchor;
  image?: TileflowImageStyleValue;
  ignorePlacement?: boolean;
  keepUpright?: boolean;
  offset?: TileflowNumberOffsetStyleValue;
  optional?: boolean;
  padding?: TileflowNumberStyleValue;
  pitchAlignment?: TileflowAlignment;
  rotate?: TileflowNumberStyleValue;
  rotationAlignment?: TileflowAlignment;
  size?: TileflowNumberStyleValue;
  textFit?: TileflowIconTextFit;
  textFitPadding?: TileflowNumberInsetsStyleValue;
};
export type TileflowIconStyle = TileflowLayerRange & TileflowIconPaint & TileflowIconLayout;

export type TileflowSymbolPlacementStyle = TileflowLayerRange & {
  placement?: TileflowSymbolPlacement;
  priority?: TileflowStructuralStyleValue<number>;
  spacing?: TileflowNumberStyleValue;
  zOrder?: TileflowSymbolZOrder;
};

export type TileflowCirclePaint = {
  blur?: TileflowNumberStyleValue;
  color?: TileflowColorStyleValue;
  opacity?: TileflowNumberStyleValue;
  pitchAlignment?: 'map' | 'viewport';
  pitchScale?: 'map' | 'viewport';
  radius?: TileflowNumberStyleValue;
  strokeColor?: TileflowColorStyleValue;
  strokeOpacity?: TileflowNumberStyleValue;
  strokeWidth?: TileflowNumberStyleValue;
};
export type TileflowCircleStyle = TileflowLayerRange & TileflowCirclePaint;

export type TileflowExtrusionPaint = {
  base?: TileflowNumberStyleValue;
  color?: TileflowColorStyleValue;
  height?: TileflowNumberStyleValue;
  opacity?: TileflowNumberStyleValue;
  pattern?: TileflowImageStyleValue;
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
