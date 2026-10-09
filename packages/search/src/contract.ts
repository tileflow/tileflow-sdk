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
  maximumSuggestionTokenCharacters: 2048,
  maximumDetailEntries: 100,
  maximumOpeningHoursEntries: 20,
  maximumOpeningHoursLines: 50,
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

export const geocodingRetentionModes = ['temporary'] as const;

export const geocodingBoundsSchema = z
  .tuple([longitude, latitude, longitude, latitude])
  .refine(([west, , east]) => west < east, {message: 'West must be less than east'})
  .refine(([, south, , north]) => south < north, {
    message: 'South must be less than north',
  });

/**
 * Optional place details. Requesting any of them makes the operation an extended one with a
 * higher unit weight. Contacts and opening hours need a text search inside bounds, Nearby or an
 * explicit resolution; time zones and access points are available to every place operation.
 */
export const searchPlaceDetails = ['contacts', 'openingHours', 'timeZone', 'accessPoints'] as const;
export const searchPlaceDetailSchema = z.enum(searchPlaceDetails);
export const searchPlaceDetailsSchema = z
  .array(searchPlaceDetailSchema)
  .min(1)
  .max(searchPlaceDetails.length)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Place details must be unique',
  });

export const geocodingForwardRequestSchema = z
  .object({
    bounds: geocodingBoundsSchema.optional(),
    include: searchPlaceDetailsSchema.optional(),
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

/** Autocomplete returns each suggestion's place, with its position, when `place` is included. */
export const autocompleteIncludeSchema = z.tuple([z.literal('place')]);

export const autocompleteRequestSchema = z
  .object({
    bounds: geocodingBoundsSchema.optional(),
    include: autocompleteIncludeSchema.optional(),
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
      .default(geocodingLimits.defaultLimit),
    proximity: geocodingPositionSchema.optional(),
    query: boundedText(geocodingLimits.maximumQueryCharacters),
  })
  .strict()
  .refine((request) => request.bounds === undefined || request.proximity === undefined, {
    message: 'Bounds and proximity are mutually exclusive',
    path: ['proximity'],
  });

export const reverseGeocodingKindSchema = z.enum(['address', 'street', 'locality', 'place']);

export const geocodingReverseRequestSchema = z
  .object({
    include: searchPlaceDetailsSchema.optional(),
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

export const searchLiteralText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\p{Cc}\p{Cs}]/u.test(value));

export const searchCategoryIdSchema = searchLiteralText(100);
export const searchCategorySchema = z
  .object({
    id: searchCategoryIdSchema,
    name: searchLiteralText(100),
    localizedName: searchLiteralText(100).optional(),
    primary: z.boolean().optional(),
  })
  .strict();

export const searchPlaceMetadata = {
  name: searchLiteralText(200).optional(),
  categories: z.array(searchCategorySchema).min(1).max(100).optional(),
  foodTypes: z.array(searchCategorySchema).min(1).max(100).optional(),
  businessChains: z
    .array(z.object({id: searchLiteralText(100), name: searchLiteralText(100)}).strict())
    .min(1)
    .max(100)
    .optional(),
};

const contactListSchema = z
  .array(
    z
      .object({
        value: searchLiteralText(2048),
        label: searchLiteralText(256).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(geocodingLimits.maximumDetailEntries);

/** Contact values are provider text, not validated links: check a scheme before linking one. */
export const searchContactsSchema = z
  .object({
    phones: contactListSchema.optional(),
    websites: contactListSchema.optional(),
    emails: contactListSchema.optional(),
  })
  .strict();

export const searchOpeningHoursSchema = z
  .array(
    z
      .object({
        display: z
          .array(searchLiteralText(256))
          .min(1)
          .max(geocodingLimits.maximumOpeningHoursLines)
          .optional(),
        openNow: z.boolean().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(geocodingLimits.maximumOpeningHoursEntries);

export const searchTimeZoneSchema = z
  .object({
    name: searchLiteralText(64),
    utcOffsetSeconds: z.number().int().min(-86_400).max(86_400).optional(),
  })
  .strict();

export const searchPlaceDetailFields = {
  distanceMeters: z.number().finite().nonnegative().optional(),
  contacts: searchContactsSchema.optional(),
  openingHours: searchOpeningHoursSchema.optional(),
  timeZone: searchTimeZoneSchema.optional(),
  accessPoints: z
    .array(z.object({position: geocodingPositionSchema}).strict())
    .min(1)
    .max(geocodingLimits.maximumDetailEntries)
    .optional(),
};

export const geocodingResultSchema = z
  .object({
    ...searchPlaceMetadata,
    ...searchPlaceDetailFields,
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

const placeOperationUnitsSchema = z.union([z.literal(25), z.literal(75)]);

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
    usage: z.object({units: placeOperationUnitsSchema}).strict(),
  })
  .strict();

export const geocodingReverseResponseSchema = geocodingForwardResponseSchema;

export const geocodingSuggestionSchema = z
  .object({
    kind: z.enum(geocodingResultKinds),
    label: boundedText(512),
    addressLabel: boundedText(512).optional(),
    place: geocodingResultSchema.optional(),
    token: z
      .string()
      .min(1)
      .max(geocodingLimits.maximumSuggestionTokenCharacters)
      .regex(/^[\x21-\x7e]+$/u),
  })
  .strict();

export const autocompleteResponseSchema = z
  .object({
    attribution: z
      .array(geocodingAttributionSchema)
      .min(1)
      .max(geocodingLimits.maximumAttributionEntries),
    schemaVersion: z.literal(1),
    source: geocodingSourceSchema,
    suggestions: z.array(geocodingSuggestionSchema).max(geocodingLimits.maximumLimit),
    usage: z.object({units: z.union([z.literal(10), z.literal(25)])}).strict(),
  })
  .strict();

export const resolveSuggestionRequestSchema = z
  .object({
    include: searchPlaceDetailsSchema.optional(),
    retention: z.enum(geocodingRetentionModes).default('temporary'),
    token: z
      .string()
      .min(1)
      .max(geocodingLimits.maximumSuggestionTokenCharacters)
      .regex(/^[\x21-\x7e]+$/u),
  })
  .strict();

export const resolveSuggestionResponseSchema = z
  .object({
    attribution: z
      .array(geocodingAttributionSchema)
      .min(1)
      .max(geocodingLimits.maximumAttributionEntries),
    result: geocodingResultSchema,
    schemaVersion: z.literal(1),
    source: geocodingSourceSchema,
    usage: z.object({units: placeOperationUnitsSchema}).strict(),
  })
  .strict();

export type GeocodingForwardRequest = z.input<typeof geocodingForwardRequestSchema>;
export type NormalizedGeocodingForwardRequest = z.output<typeof geocodingForwardRequestSchema>;
export type ReverseGeocodingKind = z.infer<typeof reverseGeocodingKindSchema>;
export type GeocodingReverseRequest = z.input<typeof geocodingReverseRequestSchema>;
export type NormalizedGeocodingReverseRequest = z.output<typeof geocodingReverseRequestSchema>;
export type GeocodingResult = z.infer<typeof geocodingResultSchema>;
export type SearchPlaceDetail = z.infer<typeof searchPlaceDetailSchema>;
export type SearchContacts = z.infer<typeof searchContactsSchema>;
export type SearchOpeningHours = z.infer<typeof searchOpeningHoursSchema>;
export type SearchTimeZone = z.infer<typeof searchTimeZoneSchema>;
export type GeocodingForwardResponse = z.infer<typeof geocodingForwardResponseSchema>;
export type GeocodingReverseResponse = GeocodingForwardResponse;
export type AutocompleteRequest = z.input<typeof autocompleteRequestSchema>;
export type NormalizedAutocompleteRequest = z.output<typeof autocompleteRequestSchema>;
export type GeocodingSuggestion = z.infer<typeof geocodingSuggestionSchema>;
export type AutocompleteResponse = z.infer<typeof autocompleteResponseSchema>;
export type ResolveSuggestionRequest = z.input<typeof resolveSuggestionRequestSchema>;
export type NormalizedResolveSuggestionRequest = z.output<typeof resolveSuggestionRequestSchema>;
export type ResolveSuggestionResponse = z.infer<typeof resolveSuggestionResponseSchema>;

function isCredentialFreeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export const nearbyLimits = Object.freeze({
  defaultLimit: 20,
  maximumLimit: 100,
  maximumRadiusMeters: 21_000_000,
  maximumCategoryCharacters: 100,
  maximumFilterCategories: 10,
  maximumCountries: 100,
  maximumCursorCharacters: 8_192,
  maximumRequestBytes: 32 * 1024,
  maximumResponseBytes: 512 * 1024,
});

export const nearbyCursorSchema = z
  .string()
  .min(1)
  .max(nearbyLimits.maximumCursorCharacters)
  .regex(/^[\x21-\x7e]+$/u);

const categoryFilter = z
  .array(searchCategoryIdSchema)
  .min(1)
  .max(nearbyLimits.maximumFilterCategories);

export const nearbyRequestSchema = z
  .object({
    position: geocodingPositionSchema,
    radiusMeters: z.number().int().min(1).max(nearbyLimits.maximumRadiusMeters).optional(),
    bounds: geocodingBoundsSchema.optional(),
    includeCategories: categoryFilter.optional(),
    excludeCategories: categoryFilter.optional(),
    countries: z
      .array(z.string().regex(/^(?:[A-Z]{2}|[A-Z]{3})$/u))
      .min(1)
      .max(nearbyLimits.maximumCountries)
      .optional(),
    language: geocodingForwardRequestSchema.shape.language,
    include: searchPlaceDetailsSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(nearbyLimits.maximumLimit)
      .default(nearbyLimits.defaultLimit),
    cursor: nearbyCursorSchema.optional(),
  })
  .strict();

export const nearbyPlaceSchema = geocodingResultSchema
  .omit({sourceRef: true})
  .extend({
    kind: z.literal('place'),
    token: geocodingSuggestionSchema.shape.token.optional(),
  })
  .strict();

export const nearbyResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('aws'),
    results: z.array(nearbyPlaceSchema).max(nearbyLimits.maximumLimit),
    nextCursor: nearbyCursorSchema.optional(),
    source: geocodingSourceSchema,
    attribution: geocodingForwardResponseSchema.shape.attribution,
    usage: z.object({units: placeOperationUnitsSchema}).strict(),
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      nearbyLimits.maximumResponseBytes,
    {message: 'Nearby response exceeds the encoded byte limit'},
  );

export const searchCategoriesResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('aws'),
    categories: z.array(searchCategorySchema).min(1).max(2_000),
    source: geocodingSourceSchema,
    attribution: geocodingForwardResponseSchema.shape.attribution,
    usage: z.object({units: z.literal(0)}).strict(),
  })
  .strict();

export const resolvePlaceRequestSchema = resolveSuggestionRequestSchema;
export const resolvePlaceResponseSchema = resolveSuggestionResponseSchema;
export type NearbyRequest = z.input<typeof nearbyRequestSchema>;
export type NormalizedNearbyRequest = z.output<typeof nearbyRequestSchema>;
export type NearbyPlace = z.infer<typeof nearbyPlaceSchema>;
export type NearbyResponse = z.infer<typeof nearbyResponseSchema>;
export type SearchCategory = z.infer<typeof searchCategorySchema>;
export type SearchCategoriesResponse = z.infer<typeof searchCategoriesResponseSchema>;
export type ResolvePlaceRequest = ResolveSuggestionRequest;
export type ResolvePlaceResponse = ResolveSuggestionResponse;

/** Place details that need a provider text search or a selected place: not geocoding. */
export const searchContactDetails: readonly SearchPlaceDetail[] = ['contacts', 'openingHours'];

/**
 * The shared API units a completed Search operation consumes. Autocomplete uses 10, or 25 with
 * its places; every other place operation uses 25, or 75 with any place detail. Category
 * discovery uses none.
 */
export function searchOperationUnits(
  operation: 'autocomplete' | 'forward' | 'reverse' | 'resolve' | 'nearby' | 'categories',
  include?: readonly string[],
): 0 | 10 | 25 | 75 {
  if (operation === 'categories') return 0;
  if (operation === 'autocomplete') return include?.length ? 25 : 10;
  return include?.length ? 75 : 25;
}
