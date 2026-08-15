import type {TileflowFilterExpression, TileflowStyleValue} from './values';

export type TileflowLineCap = 'butt' | 'round' | 'square';
export type TileflowLineJoin = 'bevel' | 'miter' | 'round';
export type TileflowSymbolPlacement = 'line' | 'line-center' | 'point';
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

export type TileflowLayerRange = {
  filter?: TileflowFilterExpression;
  maxZoom?: number;
  minZoom?: number;
  visible?: boolean;
};

export type TileflowFillStyle = TileflowLayerRange & {
  color?: TileflowStyleValue<string>;
  opacity?: TileflowStyleValue<number>;
  outlineColor?: TileflowStyleValue<string>;
  pattern?: TileflowStyleValue<string>;
};

export type TileflowLineStyle = TileflowLayerRange & {
  blur?: TileflowStyleValue<number>;
  cap?: TileflowLineCap;
  color?: TileflowStyleValue<string>;
  dash?: TileflowStyleValue<readonly number[]>;
  gapWidth?: TileflowStyleValue<number>;
  join?: TileflowLineJoin;
  offset?: TileflowStyleValue<number>;
  opacity?: TileflowStyleValue<number>;
  pattern?: TileflowStyleValue<string>;
  width?: TileflowStyleValue<number>;
};

export type TileflowTextStyle = TileflowLayerRange & {
  allowOverlap?: boolean;
  anchor?: TileflowTextAnchor;
  color?: TileflowStyleValue<string>;
  field?: TileflowStyleValue<string>;
  font?: readonly string[];
  haloBlur?: TileflowStyleValue<number>;
  haloColor?: TileflowStyleValue<string>;
  haloWidth?: TileflowStyleValue<number>;
  ignorePlacement?: boolean;
  letterSpacing?: TileflowStyleValue<number>;
  lineHeight?: TileflowStyleValue<number>;
  maxWidth?: TileflowStyleValue<number>;
  offset?: readonly [number, number];
  optional?: boolean;
  padding?: TileflowStyleValue<number>;
  placement?: TileflowSymbolPlacement;
  priority?: TileflowStyleValue<number>;
  rotate?: TileflowStyleValue<number>;
  size?: TileflowStyleValue<number>;
  spacing?: TileflowStyleValue<number>;
  transform?: 'lowercase' | 'none' | 'uppercase';
};

export type TileflowIconStyle = TileflowLayerRange & {
  allowOverlap?: boolean;
  image?: TileflowStyleValue<string>;
  ignorePlacement?: boolean;
  offset?: readonly [number, number];
  opacity?: TileflowStyleValue<number>;
  optional?: boolean;
  padding?: TileflowStyleValue<number>;
  rotate?: TileflowStyleValue<number>;
  size?: TileflowStyleValue<number>;
};
