import {z} from 'zod/mini';

export const tileflowInteractionSchemaVersion = 1;

export const tileflowInteractionLimits = {
  maxAnnotations: 1000,
  maxAriaLabelLength: 256,
  maxBindings: 100,
  maxCategories: 32,
  maxColorLength: 64,
  maxContentTextLength: 4096,
  maxDocumentBytes: 256_000,
  maxDocumentDepth: 64,
  maxDocumentNodes: 20_000,
  maxDocumentProperties: 50_000,
  maxFeatureIdLength: 128,
  maxFieldSelectorLength: 128,
  maxIdLength: 64,
  maxTargetNameLength: 128,
  maxViewNameLength: 64,
} as const;

export type TileflowJsonDocumentAuditFailureReason =
  | 'bytes'
  | 'depth'
  | 'invalid'
  | 'nodes'
  | 'properties';

export type TileflowJsonDocumentAuditResult =
  | {bytes: number; ok: true}
  | {ok: false; reason: TileflowJsonDocumentAuditFailureReason};

type TileflowJsonDocumentStackEntry = {depth: number; value: unknown};

/** @internal Shared non-recursive perimeter for schemas and public boundary validators. */
export function auditTileflowInteractionJsonDocument(
  input: unknown,
): TileflowJsonDocumentAuditResult {
  try {
    const stack: TileflowJsonDocumentStackEntry[] = [{depth: 0, value: input}];
    const seen = new WeakSet<object>();
    if (isObject(input)) seen.add(input);

    let bytes = 0;
    let nodes = 1;
    let properties = 0;

    const consumeBytes = (addition: number): boolean => {
      if (
        !Number.isSafeInteger(addition) ||
        addition < 0 ||
        addition > tileflowInteractionLimits.maxDocumentBytes - bytes
      ) {
        return false;
      }
      bytes += addition;
      return true;
    };

    const enqueue = (
      value: unknown,
      depth: number,
    ): TileflowJsonDocumentAuditFailureReason | undefined => {
      if (depth > tileflowInteractionLimits.maxDocumentDepth) return 'depth';
      if (isObject(value)) {
        if (seen.has(value)) return 'invalid';
        seen.add(value);
      }
      stack.push({depth, value});
      return undefined;
    };

    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) return {ok: false, reason: 'invalid'};
      const {depth, value} = entry;

      if (value === null) {
        if (!consumeBytes(4)) return {ok: false, reason: 'bytes'};
        continue;
      }
      if (typeof value === 'boolean') {
        if (!consumeBytes(value ? 4 : 5)) return {ok: false, reason: 'bytes'};
        continue;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return {ok: false, reason: 'invalid'};
        const length = value === 0 ? 1 : String(value).length;
        if (!consumeBytes(length)) return {ok: false, reason: 'bytes'};
        continue;
      }
      if (typeof value === 'string') {
        const length = jsonStringByteLength(
          value,
          tileflowInteractionLimits.maxDocumentBytes - bytes,
        );
        if (length === undefined) return {ok: false, reason: 'bytes'};
        bytes += length;
        continue;
      }
      if (!isObject(value)) return {ok: false, reason: 'invalid'};

      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value) as object | null;
      if (
        array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
      ) {
        return {ok: false, reason: 'invalid'};
      }

      if (array) {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
        if (
          !lengthDescriptor ||
          !('value' in lengthDescriptor) ||
          typeof lengthDescriptor.value !== 'number' ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0
        ) {
          return {ok: false, reason: 'invalid'};
        }
        const length = lengthDescriptor.value;
        if (length > tileflowInteractionLimits.maxDocumentProperties - properties) {
          return {ok: false, reason: 'properties'};
        }
        properties += length;
        if (length > 0 && depth >= tileflowInteractionLimits.maxDocumentDepth) {
          return {ok: false, reason: 'depth'};
        }

        const syntaxBytes = length === 0 ? 2 : length + 1;
        if (!consumeBytes(syntaxBytes)) return {ok: false, reason: 'bytes'};

        const keys = Reflect.ownKeys(value);
        const children: unknown[] = [];
        let sawLength = false;
        for (const key of keys) {
          if (typeof key !== 'string') return {ok: false, reason: 'invalid'};
          if (key === 'length') {
            sawLength = true;
            continue;
          }
          if (!isCanonicalArrayIndex(key, length)) return {ok: false, reason: 'invalid'};
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!isEnumerableDataDescriptor(descriptor)) return {ok: false, reason: 'invalid'};
          children.push(descriptor.value);
        }
        if (!sawLength || children.length > length) return {ok: false, reason: 'invalid'};
        if (children.length > tileflowInteractionLimits.maxDocumentNodes - nodes) {
          return {ok: false, reason: 'nodes'};
        }
        nodes += children.length;
        const holes = length - children.length;
        if (!consumeBytes(holes * 4)) return {ok: false, reason: 'bytes'};
        for (const child of children) {
          const failure = enqueue(child, depth + 1);
          if (failure) return {ok: false, reason: failure};
        }
        continue;
      }

      const keys = Reflect.ownKeys(value);
      if (keys.length > tileflowInteractionLimits.maxDocumentProperties - properties) {
        return {ok: false, reason: 'properties'};
      }
      if (keys.length > tileflowInteractionLimits.maxDocumentNodes - nodes) {
        return {ok: false, reason: 'nodes'};
      }
      if (keys.length > 0 && depth >= tileflowInteractionLimits.maxDocumentDepth) {
        return {ok: false, reason: 'depth'};
      }
      properties += keys.length;
      nodes += keys.length;
      if (!consumeBytes(keys.length === 0 ? 2 : keys.length * 2 + 1)) {
        return {ok: false, reason: 'bytes'};
      }

      const children: unknown[] = [];
      for (const key of keys) {
        if (
          typeof key !== 'string' ||
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype'
        ) {
          return {ok: false, reason: 'invalid'};
        }
        const keyBytes = jsonStringByteLength(
          key,
          tileflowInteractionLimits.maxDocumentBytes - bytes,
        );
        if (keyBytes === undefined) return {ok: false, reason: 'bytes'};
        bytes += keyBytes;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!isEnumerableDataDescriptor(descriptor)) return {ok: false, reason: 'invalid'};
        children.push(descriptor.value);
      }
      for (const child of children) {
        const failure = enqueue(child, depth + 1);
        if (failure) return {ok: false, reason: failure};
      }
    }

    return {bytes, ok: true};
  } catch {
    return {ok: false, reason: 'invalid'};
  }
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & {value: unknown} {
  return Boolean(descriptor?.enumerable && 'value' in descriptor);
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function jsonStringByteLength(value: string, maximum: number): number | undefined {
  let bytes = 2;
  if (bytes > maximum) return undefined;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let addition: number;
    if (code === 0x22 || code === 0x5c) addition = 2;
    else if (code <= 0x1f) {
      addition =
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    } else if (code <= 0x7f) addition = 1;
    else if (code <= 0x7ff) addition = 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addition = 4;
        index += 1;
      } else addition = 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) addition = 6;
    else addition = 3;

    if (addition > maximum - bytes) return undefined;
    bytes += addition;
  }

  return bytes;
}

export type TileflowInteractionJsonPrimitive = boolean | null | number | string;
export type TileflowInteractionJsonValue =
  | TileflowInteractionJsonPrimitive
  | readonly TileflowInteractionJsonValue[]
  | {readonly [key: string]: TileflowInteractionJsonValue};

export type TileflowInteractionCoordinate = readonly [longitude: number, latitude: number];

export type TileflowInteractionTextContent = {
  kind: 'text';
  text: string;
};

export type TileflowInteractionFieldContent = {
  fallback?: string;
  field: string;
  kind: 'field';
};

export type TileflowInteractionViewContent = {
  kind: 'view';
  name: string;
};

export type TileflowInteractionContent =
  | TileflowInteractionTextContent
  | TileflowInteractionFieldContent
  | TileflowInteractionViewContent;

export type TileflowAnnotationMarker = {
  color?: string;
  content?: TileflowInteractionContent;
};

export type TileflowAnnotationSurface = {
  content: TileflowInteractionContent;
};

export type TileflowAnnotation<
  TData extends TileflowInteractionJsonValue = TileflowInteractionJsonValue,
> = {
  ariaLabel: string;
  coordinate: TileflowInteractionCoordinate;
  data?: TData;
  id: string;
  kind: 'marker';
  marker?: TileflowAnnotationMarker;
  popup?: TileflowAnnotationSurface;
  tooltip?: TileflowAnnotationSurface;
};

export type TileflowInteractionTarget =
  | {id: string; kind: 'annotation'}
  | {categories?: readonly string[]; domain: string; kind: 'semantic-feature'}
  | {kind: 'style-layer'; layerId: string}
  | {kind: 'map'};

export type TileflowInteractionBinding = {
  id: string;
  popup?: TileflowAnnotationSurface;
  target: TileflowInteractionTarget;
  tooltip?: TileflowAnnotationSurface;
};

export type TileflowInteractionTargetRef =
  | {id: string; kind: 'annotation'}
  | {domain: string; featureId: number | string; kind: 'semantic-feature'}
  | {featureId: number | string; kind: 'style-feature'; layerId: string}
  | {coordinate: TileflowInteractionCoordinate; kind: 'map'};

export type TileflowInteractionState = {
  popup: TileflowInteractionTargetRef | null;
};

export type TileflowInteractionAction =
  | {target: TileflowInteractionTargetRef; type: 'open-popup'}
  | {type: 'close-popup'};

export type TileflowInteractionInputModality = 'keyboard' | 'pointer' | 'programmatic' | 'touch';

export type TileflowResolvedAnnotationTarget<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = {
  annotation: TAnnotation;
  bindingId?: string;
  coordinate: TAnnotation['coordinate'];
  kind: 'annotation';
};

export type TileflowResolvedSemanticFeature = {
  category?: string;
  id?: number | string;
  properties: Readonly<Record<string, TileflowInteractionJsonValue>>;
};

export type TileflowResolvedSemanticFeatureTarget = {
  bindingId?: string;
  coordinate: TileflowInteractionCoordinate;
  domain: string;
  feature: TileflowResolvedSemanticFeature;
  kind: 'semantic-feature';
};

export type TileflowResolvedStyleFeatureTarget = {
  bindingId?: string;
  coordinate: TileflowInteractionCoordinate;
  feature: {
    id?: number | string;
    properties: Readonly<Record<string, TileflowInteractionJsonValue>>;
  };
  kind: 'style-feature';
  layerId: string;
};

export type TileflowResolvedMapTarget = {
  bindingId?: string;
  coordinate: TileflowInteractionCoordinate;
  kind: 'map';
};

export type TileflowResolvedInteractionTarget<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> =
  | TileflowResolvedAnnotationTarget<TAnnotation>
  | TileflowResolvedSemanticFeatureTarget
  | TileflowResolvedStyleFeatureTarget
  | TileflowResolvedMapTarget;

export type TileflowAnnotationViewContext<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = {
  annotation: TAnnotation;
  close: () => void;
  content?: TileflowInteractionContent;
  target: TileflowResolvedAnnotationTarget<TAnnotation>;
  viewName?: string;
};

export type TileflowInteractionViewContext<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> =
  | TileflowAnnotationViewContext<TAnnotation>
  | {
      close: () => void;
      content?: TileflowInteractionContent;
      target: Exclude<
        TileflowResolvedInteractionTarget<TAnnotation>,
        TileflowResolvedAnnotationTarget<TAnnotation>
      >;
      viewName?: string;
    };

export type TileflowInteractionEventType =
  | 'popup:close'
  | 'popup:open'
  | 'target:activate'
  | 'target:blur'
  | 'target:enter'
  | 'target:focus'
  | 'target:leave';

export type TileflowInteractionEvent<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  {
    bindingId?: string;
    coordinate: TileflowInteractionCoordinate;
    inputModality?: TileflowInteractionInputModality;
    target: TileflowResolvedInteractionTarget<TAnnotation>;
    type: TileflowInteractionEventType;
  };

export type TileflowAnnotationInteractionEvent<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Omit<TileflowInteractionEvent<TAnnotation>, 'target'> & {
  target: TileflowResolvedAnnotationTarget<TAnnotation>;
};

const portableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const semanticDomainPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u;
const fieldSelectorPattern = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/u;
const unsafeFieldSegments = new Set(['__proto__', 'constructor', 'prototype']);
const safeCssColorPattern =
  /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|[a-z]+|(?:color|hsla?|hwb|lab|lch|oklab|oklch|rgba?)\([A-Za-z0-9.,%+\- /]+\))$/iu;

const portableIdSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(tileflowInteractionLimits.maxIdLength),
    z.regex(portableIdPattern, 'Expected a portable identifier'),
  );

const targetNameSchema = z.string().check(
  z.trim(),
  z.minLength(1),
  z.maxLength(tileflowInteractionLimits.maxTargetNameLength),
  z.refine((value) => !hasControlCharacters(value), {
    message: 'Target names may not contain control characters',
  }),
);

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

const coordinateSchema = z.tuple([z.number(), z.number()]).check(
  z.refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
    message: 'Expected [longitude, latitude] within world bounds',
  }),
);

const featureIdSchema = z.union([
  z.int(),
  z.string().check(z.minLength(1), z.maxLength(tileflowInteractionLimits.maxFeatureIdLength)),
]);

export const tileflowInteractionJsonValueSchema: z.ZodMiniType<TileflowInteractionJsonValue> =
  z.custom<TileflowInteractionJsonValue>(
    (value) => auditTileflowInteractionJsonDocument(value).ok,
    'Expected a bounded, finite JSON value',
  );

const textContentSchema = z.strictObject({
  kind: z.literal('text'),
  text: z.string().check(z.maxLength(tileflowInteractionLimits.maxContentTextLength)),
});

const fieldContentSchema = z.strictObject({
  fallback: z.optional(
    z.string().check(z.maxLength(tileflowInteractionLimits.maxContentTextLength)),
  ),
  field: z.string().check(
    z.minLength(1),
    z.maxLength(tileflowInteractionLimits.maxFieldSelectorLength),
    z.regex(fieldSelectorPattern, 'Expected a dotted declarative field selector'),
    z.refine((field) => field.split('.').every((segment) => !unsafeFieldSegments.has(segment)), {
      message: 'Field selectors may not contain unsafe object keys',
    }),
  ),
  kind: z.literal('field'),
});

const viewContentSchema = z.strictObject({
  kind: z.literal('view'),
  name: z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(tileflowInteractionLimits.maxViewNameLength),
      z.regex(portableIdPattern, 'Expected a portable view name'),
    ),
});

export const tileflowInteractionContentSchema = z.discriminatedUnion('kind', [
  textContentSchema,
  fieldContentSchema,
  viewContentSchema,
]);

const annotationMarkerSchema = z.strictObject({
  color: z.optional(
    z
      .string()
      .check(
        z.trim(),
        z.minLength(1),
        z.maxLength(tileflowInteractionLimits.maxColorLength),
        z.regex(safeCssColorPattern, 'Expected a bounded CSS color without URL or variable input'),
      ),
  ),
  content: z.optional(tileflowInteractionContentSchema),
});

const annotationSurfaceSchema = z.strictObject({content: tileflowInteractionContentSchema});

export const tileflowAnnotationSchema = z.strictObject({
  ariaLabel: z
    .string()
    .check(z.trim(), z.minLength(1), z.maxLength(tileflowInteractionLimits.maxAriaLabelLength)),
  coordinate: coordinateSchema,
  data: z.optional(tileflowInteractionJsonValueSchema),
  id: portableIdSchema,
  kind: z.literal('marker'),
  marker: z.optional(annotationMarkerSchema),
  popup: z.optional(annotationSurfaceSchema),
  tooltip: z.optional(annotationSurfaceSchema),
});

export const tileflowAnnotationsSchema = z
  .array(tileflowAnnotationSchema)
  .check(z.maxLength(tileflowInteractionLimits.maxAnnotations));

const annotationTargetSelectorSchema = z.strictObject({
  id: portableIdSchema,
  kind: z.literal('annotation'),
});

const semanticFeatureTargetSelectorSchema = z.strictObject({
  categories: z.optional(
    z
      .array(portableIdSchema)
      .check(z.minLength(1), z.maxLength(tileflowInteractionLimits.maxCategories)),
  ),
  domain: z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(tileflowInteractionLimits.maxTargetNameLength),
      z.regex(semanticDomainPattern, 'Expected a dotted semantic domain'),
    ),
  kind: z.literal('semantic-feature'),
});

const styleLayerTargetSelectorSchema = z.strictObject({
  kind: z.literal('style-layer'),
  layerId: targetNameSchema,
});

const mapTargetSelectorSchema = z.strictObject({kind: z.literal('map')});

export const tileflowInteractionTargetSchema = z.discriminatedUnion('kind', [
  annotationTargetSelectorSchema,
  semanticFeatureTargetSelectorSchema,
  styleLayerTargetSelectorSchema,
  mapTargetSelectorSchema,
]);

export const tileflowInteractionBindingSchema = z.strictObject({
  id: portableIdSchema,
  popup: z.optional(annotationSurfaceSchema),
  target: tileflowInteractionTargetSchema,
  tooltip: z.optional(annotationSurfaceSchema),
});

export const tileflowInteractionBindingsSchema = z
  .array(tileflowInteractionBindingSchema)
  .check(z.maxLength(tileflowInteractionLimits.maxBindings));

const annotationTargetSchema = z.strictObject({
  id: portableIdSchema,
  kind: z.literal('annotation'),
});

const semanticFeatureTargetSchema = z.strictObject({
  domain: z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(tileflowInteractionLimits.maxTargetNameLength),
      z.regex(semanticDomainPattern, 'Expected a dotted semantic domain'),
    ),
  featureId: featureIdSchema,
  kind: z.literal('semantic-feature'),
});

const styleFeatureTargetSchema = z.strictObject({
  featureId: featureIdSchema,
  kind: z.literal('style-feature'),
  layerId: targetNameSchema,
});

const mapTargetSchema = z.strictObject({coordinate: coordinateSchema, kind: z.literal('map')});

export const tileflowInteractionTargetRefSchema = z.discriminatedUnion('kind', [
  annotationTargetSchema,
  semanticFeatureTargetSchema,
  styleFeatureTargetSchema,
  mapTargetSchema,
]);

export const tileflowInteractionStateSchema = z.strictObject({
  popup: z.nullable(tileflowInteractionTargetRefSchema),
});

export const tileflowInteractionActionSchema = z.discriminatedUnion('type', [
  z.strictObject({target: tileflowInteractionTargetRefSchema, type: z.literal('open-popup')}),
  z.strictObject({type: z.literal('close-popup')}),
]);
