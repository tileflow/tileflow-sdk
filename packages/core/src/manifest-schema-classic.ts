import {z} from 'zod';
import type {
	ManifestSchema,
	ManifestSchemaOperations,
	ManifestStringOperations,
} from './manifest-schema-operations';
import {strictNativeObject} from './native-zod-object';

/** Each adapter receives only the schemas it constructed; no native schema crosses into Classic. */
function classic<T>(schema: ManifestSchema<T>): z.ZodType<T> {
	return schema as z.ZodType<T>;
}

export const classicManifestStringOperations: ManifestStringOperations = {
	string: () => z.string(),
	minLength<T extends string | unknown[]>(schema: ManifestSchema<T>, minimum: number) {
		return (schema as unknown as z.ZodString | z.ZodArray).min(minimum) as unknown as ManifestSchema<T>;
	},
	maxLength<T extends string | unknown[]>(schema: ManifestSchema<T>, maximum: number) {
		return (schema as unknown as z.ZodString | z.ZodArray).max(maximum) as unknown as ManifestSchema<T>;
	},
	regex: (schema, pattern, message) => (schema as z.ZodString).regex(pattern, {message}),
	refine: (schema, check, message) => classic(schema).refine(check, message),
};

/** Host schemas keep the original Classic classes, methods, issue construction and ZodError. */
export const classicManifestSchemaOperations: ManifestSchemaOperations = {
	...classicManifestStringOperations,
	number: (minimum, maximum) => z.number().finite().min(minimum).max(maximum),
	unknown: () => z.unknown(),
	optional: (schema) => classic(schema).optional(),
	array: (schema) => z.array(classic(schema)),
	enum<const Values extends readonly string[]>(values: Values) {
		return z.enum(values) as unknown as ManifestSchema<Values[number]>;
	},
	literal: (value) => z.literal(value),
	tuplePair<A, B>(left: ManifestSchema<A>, right: ManifestSchema<B>) {
		return z.tuple([classic(left), classic(right)]) as unknown as ManifestSchema<[A, B]>;
	},
	object<T extends object>(shape: {[K in keyof T]-?: ManifestSchema<T[K]>}) {
		return strictNativeObject(shape) as unknown as ManifestSchema<T>;
	},
	record<T>(key: ManifestSchema<string>, value: ManifestSchema<T>) {
		return z.record(classic(key), classic(value)) as unknown as ManifestSchema<Record<string, T>>;
	},
	superRefine: (schema, check) => classic(schema).superRefine(check),
	pipe: (input, output) => classic(input).pipe(classic(output)),
};
