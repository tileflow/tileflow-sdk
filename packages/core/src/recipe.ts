export {
  addModuleLayer,
  getResolvedModuleEffects,
  internalModuleEffects as defineModuleEffects,
  patchModuleLayer,
  removeModuleLayer,
  semanticField,
  semanticLayer,
  type TileflowModuleEffect,
  type TileflowModuleLayerPlacement,
} from './cartography/module-effects';
export {toMapLibreStyleValue} from './cartography/values';
export {isMapLibreExpressionOperator} from './cartography/expression-operators';
export {
  classifyTileflowVisualProperty,
  type TileflowVisualValueCategory,
} from './themes/visual-semantics';
