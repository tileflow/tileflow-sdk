import type {$RefinementCtx, $ZodType} from 'zod/v4/core';

/** Internal construction vocabulary. Rules and error messages live in the shared grammar. */
export type ManifestSchema<T = unknown> = $ZodType<T>;
export type ManifestRefinement<T> = (value: T, context: $RefinementCtx<T>) => void;

export type ManifestStringOperations = {
  string(): ManifestSchema<string>;
  minLength<T extends string | unknown[]>(
    schema: ManifestSchema<T>,
    minimum: number,
  ): ManifestSchema<T>;
  maxLength<T extends string | unknown[]>(
    schema: ManifestSchema<T>,
    maximum: number,
  ): ManifestSchema<T>;
  regex(schema: ManifestSchema<string>, pattern: RegExp, message: string): ManifestSchema<string>;
  refine<T>(
    schema: ManifestSchema<T>,
    check: (value: T) => boolean,
    message: string,
  ): ManifestSchema<T>;
};

export type ManifestSchemaOperations = ManifestStringOperations & {
  number(minimum: number, maximum: number): ManifestSchema<number>;
  unknown(): ManifestSchema;
  optional<T>(schema: ManifestSchema<T>): ManifestSchema<T | undefined>;
  array<T>(schema: ManifestSchema<T>): ManifestSchema<T[]>;
  enum<const Values extends readonly string[]>(values: Values): ManifestSchema<Values[number]>;
  literal<const Value extends string | number>(value: Value): ManifestSchema<Value>;
  tuplePair<A, B>(left: ManifestSchema<A>, right: ManifestSchema<B>): ManifestSchema<[A, B]>;
  object<T extends object>(shape: {[K in keyof T]-?: ManifestSchema<T[K]>}): ManifestSchema<T>;
  record<T>(
    key: ManifestSchema<string>,
    value: ManifestSchema<T>,
  ): ManifestSchema<Record<string, T>>;
  superRefine<T>(schema: ManifestSchema<T>, check: ManifestRefinement<T>): ManifestSchema<T>;
  pipe<T>(input: ManifestSchema, output: ManifestSchema<T>): ManifestSchema<T>;
};
