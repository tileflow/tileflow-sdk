import {
  array,
  enum as enumeration,
  gte,
  literal,
  lte,
  maxLength,
  minLength,
  number,
  optional,
  pipe,
  record,
  refine,
  regex,
  strictObject,
  string,
  superRefine,
  tuple,
  unknown,
  type ZodMiniType,
} from 'zod/mini';
import type {ManifestSchema, ManifestSchemaOperations} from './manifest-schema-operations';

function mini<T>(schema: ManifestSchema<T>): ZodMiniType<T> {
  return schema as ZodMiniType<T>;
}

/** Mini delegates to the same Zod Core parsers/checks without Classic's fluent method graph. */
export const miniManifestSchemaOperations: ManifestSchemaOperations = {
  string: () => string(),
  minLength: (schema, minimum) => mini(schema).check(minLength(minimum)),
  maxLength: (schema, maximum) => mini(schema).check(maxLength(maximum)),
  regex: (schema, pattern, message) => mini(schema).check(regex(pattern, {message})),
  refine: (schema, check, message) => mini(schema).check(refine(check, message)),
  // Zod 4's number parser rejects NaN and infinities; Classic finite() is a no-op.
  number: (minimum, maximum) => number().check(gte(minimum), lte(maximum)),
  unknown: () => unknown(),
  optional: (schema) => optional(schema),
  array: (schema) => array(schema),
  enum<const Values extends readonly string[]>(values: Values) {
    return enumeration(values) as unknown as ManifestSchema<Values[number]>;
  },
  literal: (value) => literal(value),
  tuplePair<A, B>(left: ManifestSchema<A>, right: ManifestSchema<B>) {
    return tuple([left, right]) as unknown as ManifestSchema<[A, B]>;
  },
  // ZodMiniObject uses the interpreted $ZodObject, not the Classic object JIT constructor.
  object<T extends object>(shape: {[K in keyof T]-?: ManifestSchema<T[K]>}) {
    return strictObject(shape) as unknown as ManifestSchema<T>;
  },
  record<T>(key: ManifestSchema<string>, value: ManifestSchema<T>) {
    return record(key, value) as unknown as ManifestSchema<Record<string, T>>;
  },
  superRefine: (schema, check) => mini(schema).check(superRefine(check)),
  pipe: (input, output) => pipe(input, output),
};
