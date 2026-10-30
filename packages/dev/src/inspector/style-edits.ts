import {
  Color,
  createPropertyExpression,
  Formatted,
  isExpression,
  latest,
  Padding,
  ResolvedImage,
  type StylePropertySpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {AllLayoutProperties, AllPaintProperties} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import {mapValue} from './map-value';
import type {PreviewWindow} from './types';

type PropertySpec = StylePropertySpecification & {minimum?: number; maximum?: number};

export type EditTarget = {
  layer: string;
  section: 'paint' | 'layout' | 'filter';
  property: string;
  featureId?: string | number;
};
export type StyleEdit = EditTarget & {
  key: string;
  value: unknown;
  original: unknown;
  disabled?: boolean;
};
type Operation = {
  time?: number;
  redoTime?: number;
  key: string;
  before?: StyleEdit;
  after?: StyleEdit;
  gesture?: symbol;
  batch?: Operation[];
};

export function propertySpec(
  type: string,
  section: string,
  name: string,
): PropertySpec | undefined {
  if (type === 'custom' && section === 'layout' && name === 'visibility')
    return propertySpec('background', 'layout', 'visibility');
  return (latest as unknown as Record<string, Record<string, PropertySpec>>)[
    `${section}_${type}`
  ]?.[name];
}

export function propertiesFor(
  type: string,
  section: string,
): Record<string, StylePropertySpecification> {
  return (
    (latest as unknown as Record<string, Record<string, StylePropertySpecification>>)[
      `${section}_${type}`
    ] || {}
  );
}

export function evaluatedValue(
  map: MapLibreMap,
  layer: string,
  section: 'paint' | 'layout',
  property: string,
  feature?: MapGeoJSONFeature,
  zoom = map.getZoom(),
  rawOverride?: unknown,
): unknown {
  // Only the type is needed here. Serializing the whole style per feature/property is costly.
  const style = map.getLayer(layer);
  if (!style) return undefined;
  const spec = propertySpec(style.type, section, property);
  const raw =
    rawOverride ??
    (section === 'paint'
      ? map.getPaintProperty(layer, property as keyof AllPaintProperties)
      : map.getLayoutProperty(layer, property as keyof AllLayoutProperties));
  if (!spec) return raw;
  const result = createPropertyExpression(
    expressionValue(raw ?? spec.default),
    property,
    spec,
    map.getGlobalState?.(),
  );
  if (result.result === 'error') return undefined;
  const expression = result.value;
  if (!feature && (expression.kind === 'source' || expression.kind === 'composite'))
    return undefined;
  try {
    const featureState =
      feature?.id !== undefined && feature.source
        ? map.getFeatureState({
            source: feature.source,
            sourceLayer: feature.sourceLayer,
            id: feature.id,
          })
        : {};
    const geometryType = feature?.geometry.type.replace('Multi', '') || 'Point';
    const context = feature
      ? {id: feature.id, type: geometryType as 'Point', properties: feature.properties}
      : undefined;
    const value = expression.evaluate(
      {zoom, globalState: map.getGlobalState?.()},
      context,
      featureState,
      undefined,
      map.listImages(),
    );
    if (value instanceof Color || value instanceof Formatted) return value.toString();
    if (value instanceof ResolvedImage) return value.name;
    if (value instanceof Padding) return value.values;
    return value;
  } catch {
    return undefined;
  }
}

const expressionValue = (value: unknown): unknown =>
  Array.isArray(value) && !isExpression(value) ? ['literal', value] : value;

/** Keep the camera expression at the root, as required by the style specification. */
export function featureOverrides(
  base: unknown,
  features: Pick<StyleEdit, 'featureId' | 'value'>[],
): unknown {
  const hasZoom = (value: unknown): boolean =>
    Array.isArray(value) && value[0] !== 'literal' && (value[0] === 'zoom' || value.some(hasZoom));
  if (features.some((entry) => hasZoom(entry.value)))
    throw new Error(
      'Choose Entire layer to replace a zoom expression. Feature overrides accept fixed or feature-dependent values.',
    );
  const wrap = (fallback: unknown): unknown => {
    if (Array.isArray(fallback)) {
      const result = [...fallback];
      if (result[0] === 'let') {
        result[result.length - 1] = wrap(result.at(-1));
        return result;
      }
      const interpolate = typeof result[0] === 'string' && result[0].startsWith('interpolate');
      const input = result[interpolate ? 2 : 1];
      if ((interpolate || result[0] === 'step') && Array.isArray(input) && input[0] === 'zoom') {
        for (let i = interpolate ? 4 : 2; i < result.length; i += 2) result[i] = wrap(result[i]);
        return result;
      }
    }
    return [
      'case',
      ...features.flatMap((entry) => [
        ['==', ['id'], entry.featureId],
        expressionValue(entry.value),
      ]),
      expressionValue(fallback),
    ];
  };
  return wrap(base);
}

export function validateEditValue(value: unknown, spec: PropertySpec): void {
  if (Array.isArray(value)) {
    const result = createPropertyExpression(expressionValue(value), 'value', spec);
    if (result.result === 'error')
      throw new Error(result.value.map((error) => error.message).join('; '));
    return;
  }
  if (
    spec.type === 'number' &&
    (typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (spec.minimum !== undefined && value < spec.minimum) ||
      (spec.maximum !== undefined && value > spec.maximum))
  )
    throw new Error(
      `Enter a number${spec.minimum !== undefined ? ` ≥ ${spec.minimum}` : ''}${spec.maximum !== undefined ? ` ≤ ${spec.maximum}` : ''}.`,
    );
  if (spec.type === 'color' && (typeof value !== 'string' || !Color.parse(value)))
    throw new Error('Enter a valid CSS color.');
  if (spec.type === 'boolean' && typeof value !== 'boolean')
    throw new Error('Enter true or false.');
  if (
    spec.type === 'enum' &&
    !Object.prototype.hasOwnProperty.call(spec.values || {}, String(value))
  )
    throw new Error('Choose a supported value.');
  if (spec.type === 'string' && typeof value !== 'string') throw new Error('Enter a string.');
}

/** Owns original expressions, bounded history and explicit feature-vs-layer scope. */
export class StyleEdits {
  readonly entries = new Map<string, StyleEdit>();
  private readonly originals = new Map<string, unknown>();
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private batching = false;
  get undoTime() {
    return this.undoStack.at(-1)?.time ?? 0;
  }
  get redoTime() {
    return this.redoStack.at(-1)?.redoTime ?? 0;
  }
  constructor(readonly map: MapLibreMap) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  private runtimeVisibility(target: EditTarget) {
    return this.map.getLayer(target.layer)?.type === 'custom' &&
      target.section === 'layout' &&
      target.property === 'visibility'
      ? (this.map.getCanvas?.().ownerDocument.defaultView as PreviewWindow | null)
          ?.__tileflowRuntimeVisibility
      : undefined;
  }
  private baseKey(target: EditTarget) {
    return JSON.stringify([target.layer, target.section, target.property]);
  }
  key(target: EditTarget) {
    return JSON.stringify([
      target.layer,
      target.section,
      target.property,
      target.featureId ?? null,
    ]);
  }
  original(target: EditTarget) {
    const key = this.baseKey(target);
    if (!this.originals.has(key))
      this.originals.set(
        key,
        structuredClone(
          this.runtimeVisibility(target)
            ? this.runtimeVisibility(target)!(target.layer) === false
              ? 'none'
              : 'visible'
            : target.section === 'filter'
              ? this.map.getFilter(target.layer)
              : target.section === 'paint'
                ? this.map.getPaintProperty(
                    target.layer,
                    target.property as keyof AllPaintProperties,
                  )
                : this.map.getLayoutProperty(
                    target.layer,
                    target.property as keyof AllLayoutProperties,
                  ),
        ),
      );
    return this.originals.get(key);
  }
  set(target: EditTarget, value: unknown, gesture?: symbol) {
    const layer =
      this.map.getStyle().layers.find((item) => item.id === target.layer) ??
      this.map.getLayer(target.layer);
    const spec = layer && propertySpec(layer.type, target.section, target.property);
    if (!spec) throw new Error('This property is not editable.');
    if (target.featureId !== undefined && !spec.expression?.parameters.includes('feature'))
      throw new Error('This property can only be edited for the entire layer.');
    validateEditValue(value, spec);
    const key = this.key(target),
      before = this.entries.get(key);
    const original = this.original(target);
    const after = {...target, key, original, value: structuredClone(value)};
    if (!before?.disabled && JSON.stringify(before?.value) === JSON.stringify(value)) return;
    this.update(target, after, gesture);
  }
  /** Suspend a whole rule without losing its original expression or any temporary override. */
  setEnabled(target: EditTarget, enabled: boolean) {
    if (target.featureId !== undefined) throw new Error('Only entire rules can be disabled.');
    const layer =
      this.map.getStyle().layers.find((item) => item.id === target.layer) ??
      this.map.getLayer(target.layer);
    if (
      !layer ||
      (target.section !== 'filter' && !propertySpec(layer.type, target.section, target.property))
    )
      throw new Error('This property is not editable.');
    const key = this.key(target),
      before = this.entries.get(key);
    if (enabled) {
      if (!before?.disabled) return;
      // An undefined value represents an unedited declaration, with its expression in original.
      this.update(target, before.value === undefined ? undefined : {...before, disabled: false});
    } else {
      if (before?.disabled) return;
      const original = this.original(target);
      const raw =
        target.section === 'filter'
          ? this.map.getFilter(target.layer)
          : target.section === 'paint'
            ? this.map.getPaintProperty(target.layer, target.property as keyof AllPaintProperties)
            : this.map.getLayoutProperty(
                target.layer,
                target.property as keyof AllLayoutProperties,
              );
      if (raw === undefined && !before) return;
      this.update(target, {...target, key, original, value: before?.value, disabled: true});
    }
  }
  private update(target: EditTarget, after?: StyleEdit, gesture?: symbol) {
    const key = this.key(target),
      before = this.entries.get(key);
    if (after && this.entries.size >= 250 && !before)
      throw new Error('Reset some changes before adding more (250 properties maximum).');
    if (after) this.entries.set(key, after);
    else this.entries.delete(key);
    try {
      this.apply(target);
    } catch (error) {
      if (before) this.entries.set(key, before);
      else this.entries.delete(key);
      throw error;
    }
    const previous = this.undoStack.at(-1);
    if (gesture && previous?.gesture === gesture && previous.key === key && !this.redoStack.length)
      previous.after = after;
    else this.undoStack.push({key, before, after, gesture, time: performance.now()});
    if (!this.batching && this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }
  /** Visibility changes to a module are one atomic history entry. */
  batch(run: () => void) {
    const start = this.undoStack.length,
      previousRedo = [...this.redoStack];
    this.batching = true;
    try {
      run();
    } catch (error) {
      for (const op of this.undoStack.splice(start).reverse()) this.restore(op, op.before);
      this.redoStack = previousRedo;
      throw error;
    } finally {
      this.batching = false;
    }
    const batch = this.undoStack.splice(start);
    if (batch.length) this.undoStack.push({key: 'batch', batch, time: performance.now()});
    if (this.undoStack.length > 200) this.undoStack.shift();
  }
  remove(key: string) {
    const before = this.entries.get(key);
    if (!before) return;
    this.update(before);
  }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    if (op.batch) for (const item of [...op.batch].reverse()) this.restore(item, item.before);
    else this.restore(op, op.before);
    op.redoTime = performance.now();
    this.redoStack.push(op);
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    if (op.batch) for (const item of op.batch) this.restore(item, item.after);
    else this.restore(op, op.after);
    op.time = performance.now();
    this.undoStack.push(op);
  }
  reset() {
    const affected = [...this.entries.values()];
    this.entries.clear();
    for (const entry of affected) if (this.map.getLayer(entry.layer)) this.apply(entry);
    this.undoStack = [];
    this.redoStack = [];
    this.originals.clear();
  }
  private restore(op: Operation, entry?: StyleEdit) {
    if (entry) this.entries.set(op.key, entry);
    else this.entries.delete(op.key);
    this.apply((entry || op.after || op.before)!);
  }
  private apply(target: EditTarget) {
    const base = this.baseKey(target),
      layer =
        this.map.getStyle().layers.find((item) => item.id === target.layer) ??
        this.map.getLayer(target.layer);
    if (!layer) throw new Error('The selected layer no longer exists.');
    const matching = [...this.entries.values()].filter((entry) => this.baseKey(entry) === base);
    const whole = matching.find((entry) => entry.featureId === undefined);
    const features = matching.filter((entry) => entry.featureId !== undefined);
    let value = whole?.disabled ? undefined : (whole?.value ?? this.originals.get(base));
    if (!whole?.disabled && features.length) {
      const spec = propertySpec(layer.type, target.section, target.property)!;
      const expression = featureOverrides(value ?? spec.default, features);
      const result = createPropertyExpression(
        expression,
        target.property,
        spec,
        this.map.getGlobalState?.(),
      );
      if (result.result === 'error')
        throw new Error(result.value.map((error) => error.message).join('; '));
      value = expression;
    }
    if (this.runtimeVisibility(target))
      this.runtimeVisibility(target)!(target.layer, value !== 'none');
    else if (target.section === 'filter')
      this.map.setFilter(target.layer, mapValue(this.map, (value as any) ?? null));
    else if (target.section === 'paint')
      this.map.setPaintProperty(
        target.layer,
        target.property as keyof AllPaintProperties,
        mapValue(this.map, (value as any) ?? null),
      );
    else
      this.map.setLayoutProperty(
        target.layer,
        target.property as keyof AllLayoutProperties,
        mapValue(this.map, (value as any) ?? null),
      );
  }
}
