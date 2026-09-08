import {z} from 'zod';

const controlCharacterPattern = /\p{Cc}/u;

export const geoIpLimits = Object.freeze({
  maximumLocationTextCharacters: 256,
  maximumRequestBytes: 1024,
  maximumResponseBytes: 8192,
});

const boundedText = z
  .string()
  .max(geoIpLimits.maximumLocationTextCharacters)
  .refine((value) => !controlCharacterPattern.test(value), {
    message: 'Control characters are not allowed',
  })
  .trim()
  .min(1);

const countryCode = boundedText.pipe(
  z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .refine((value) => value !== 'XX'),
);

const continentCode = boundedText.pipe(z.enum(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']));
const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);

export const geoIpPositionSchema = z.tuple([longitude, latitude]);

export const geoIpLocationSchema = z
  .object({
    city: boundedText.optional(),
    continentCode: continentCode.optional(),
    countryCode: countryCode.optional(),
    isEUCountry: z.boolean().optional(),
    position: geoIpPositionSchema.optional(),
    postalCode: boundedText.optional(),
    region: boundedText.optional(),
    regionCode: boundedText.optional(),
    timezone: boundedText.optional(),
  })
  .strip()
  .refine((location) => Object.values(location).some((value) => value !== undefined), {
    message: 'Expected at least one known location field',
  });

const geoIpUsageSchema = z.object({units: z.union([z.literal(0), z.literal(1)])}).strip();

export const geoIpAvailableResponseSchema = z
  .object({
    location: geoIpLocationSchema,
    schemaVersion: z.literal(1),
    status: z.literal('available'),
    usage: geoIpUsageSchema,
  })
  .strip();

export const geoIpUnavailableResponseSchema = z
  .object({
    location: z.null(),
    schemaVersion: z.literal(1),
    status: z.literal('unavailable'),
    usage: geoIpUsageSchema,
  })
  .strip()
  .refine((response) => response.usage.units === 0, {
    message: 'Unavailable responses must not consume units',
    path: ['usage', 'units'],
  });

export const geoIpResponseSchema = z.discriminatedUnion('status', [
  geoIpAvailableResponseSchema,
  geoIpUnavailableResponseSchema,
]);

export type GeoIpLocation = z.infer<typeof geoIpLocationSchema>;
export type GeoIpPosition = z.infer<typeof geoIpPositionSchema>;
export type GeoIpAvailableResponse = z.infer<typeof geoIpAvailableResponseSchema>;
export type GeoIpUnavailableResponse = z.infer<typeof geoIpUnavailableResponseSchema>;
export type GeoIpResponse = z.infer<typeof geoIpResponseSchema>;
