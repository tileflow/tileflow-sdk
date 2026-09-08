import {z} from 'zod';

const controlCharacterPattern = /\p{Cc}/u;
const languagePattern = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const sourceReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const queryIdPattern = /^gq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const geocodingLimits = Object.freeze({
  defaultLimit: 5,
  defaultReverseLimit: 1,
  maximumAddressPartCharacters: 256,
  maximumAttributionEntries: 8,
  maximumAttributionTextCharacters: 512,
  maximumLanguageCharacters: 35,
  maximumLimit: 10,
  maximumQueryCharacters: 200,
  maximumResponseBytes: 64 * 1024,
  maximumSafeErrorBytes: 8 * 1024,
  maximumSourceCharacters: 128,
});

const boundedText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !controlCharacterPattern.test(value), {
      message: 'Control characters are not allowed',
    });

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);

export const geocodingPositionSchema = z.tuple([longitude, latitude]);

export const geocodingRetentionModes = ['temporary', 'persistent'] as const;

export const geocodingBoundsSchema = z
  .tuple([longitude, latitude, longitude, latitude])
  .refine(([west, south, east]) => west < east, {message: 'West must be less than east'})
  .refine(([, south, , north]) => south < north, {
    message: 'South must be less than north',
  });

export const geocodingForwardRequestSchema = z
  .object({
    bounds: geocodingBoundsSchema.optional(),
    language: z
      .string()
      .max(geocodingLimits.maximumLanguageCharacters)
      .regex(languagePattern)
      .optional(),
    limit: z.number().int().min(1).max(geocodingLimits.maximumLimit).optional(),
    proximity: geocodingPositionSchema.optional(),
    query: boundedText(geocodingLimits.maximumQueryCharacters),
    retention: z.enum(geocodingRetentionModes).default('temporary'),
  })
  .strict()
  .refine((request) => request.bounds === undefined || request.proximity === undefined, {
    message: 'Bounds and proximity are mutually exclusive',
    path: ['proximity'],
  });

export const reverseGeocodingKindSchema = z.enum(['address', 'street', 'locality', 'place']);

export const geocodingReverseRequestSchema = z
  .object({
    kinds: z.array(reverseGeocodingKindSchema).min(1).max(4).optional(),
    language: z
      .string()
      .max(geocodingLimits.maximumLanguageCharacters)
      .regex(languagePattern)
      .optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(geocodingLimits.maximumLimit)
      .default(geocodingLimits.defaultReverseLimit),
    position: geocodingPositionSchema,
    retention: z.enum(geocodingRetentionModes).default('temporary'),
  })
  .strict();

export const geocodingResultKinds = [
  'address',
  'street',
  'locality',
  'district',
  'county',
  'region',
  'country',
  'place',
  'unknown',
] as const;

const addressPart = boundedText(geocodingLimits.maximumAddressPartCharacters);

export const geocodingAddressSchema = z
  .object({
    city: addressPart.optional(),
    country: addressPart.optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .optional(),
    county: addressPart.optional(),
    district: addressPart.optional(),
    houseNumber: addressPart.optional(),
    locality: addressPart.optional(),
    name: addressPart.optional(),
    postalCode: addressPart.optional(),
    region: addressPart.optional(),
    street: addressPart.optional(),
  })
  .strict();

export const geocodingResultSchema = z
  .object({
    address: geocodingAddressSchema,
    bounds: geocodingBoundsSchema.optional(),
    kind: z.enum(geocodingResultKinds),
    label: boundedText(512),
    position: geocodingPositionSchema,
    sourceRef: z.string().regex(sourceReferencePattern).optional(),
  })
  .strict();

export const geocodingSourceSchema = z
  .object({
    id: boundedText(geocodingLimits.maximumSourceCharacters),
    revision: boundedText(geocodingLimits.maximumSourceCharacters).nullable(),
  })
  .strict();

export const geocodingAttributionSchema = z
  .object({
    text: boundedText(geocodingLimits.maximumAttributionTextCharacters),
    url: z
      .string()
      .max(2048)
      .refine((value) => !controlCharacterPattern.test(value), {
        message: 'Control characters are not allowed',
      })
      .url()
      .refine(isCredentialFreeHttpsUrl, {
        message: 'Expected an HTTPS URL without credentials',
      })
      .optional(),
  })
  .strict();

export const geocodingForwardResponseSchema = z
  .object({
    attribution: z
      .array(geocodingAttributionSchema)
      .min(1)
      .max(geocodingLimits.maximumAttributionEntries),
    queryId: z.string().regex(queryIdPattern),
    results: z.array(geocodingResultSchema).max(geocodingLimits.maximumLimit),
    schemaVersion: z.literal(1),
    source: geocodingSourceSchema,
    usage: z.object({units: z.literal(1)}).strict(),
  })
  .strict();

export const geocodingReverseResponseSchema = geocodingForwardResponseSchema;

export type GeocodingForwardRequest = z.input<typeof geocodingForwardRequestSchema>;
export type NormalizedGeocodingForwardRequest = z.output<typeof geocodingForwardRequestSchema>;
export type ReverseGeocodingKind = z.infer<typeof reverseGeocodingKindSchema>;
export type GeocodingReverseRequest = z.input<typeof geocodingReverseRequestSchema>;
export type NormalizedGeocodingReverseRequest = z.output<typeof geocodingReverseRequestSchema>;
export type GeocodingResult = z.infer<typeof geocodingResultSchema>;
export type GeocodingForwardResponse = z.infer<typeof geocodingForwardResponseSchema>;
export type GeocodingReverseResponse = GeocodingForwardResponse;

function isCredentialFreeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
