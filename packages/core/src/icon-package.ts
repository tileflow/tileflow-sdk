import {z} from 'zod';

export const tileflowIconPackageFileNames = [
  'sprite.json',
  'sprite.png',
  'sprite@2x.json',
  'sprite@2x.png',
] as const;

export type TileflowIconPackageFileName = (typeof tileflowIconPackageFileNames)[number];

/** Canonical sprite ID shared by authoring, generated manifests, diffs, and runtime indexes. */
export const tileflowIconIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const tileflowIconPackageLimits = {
  decodeConcurrency: 4,
  maxAtlasDimension: 2_048,
  maxDecodedPixelsPerIcon: 4_194_304,
  maxGeneratedFileBytes: 4 * 1024 * 1024,
  maxGeneratedPackageBytes: 8 * 1024 * 1024,
  maxIconCount: 256,
  maxSourceBytes: 32 * 1024 * 1024,
  maxSourceFileBytes: 1024 * 1024,
} as const;

/**
 * Portable compatibility values shared by the public CLI and hosted policy.
 * Commercial entitlements still belong to the database package.
 */
export const tileflowHostedAlphaCompatibility = {
  iconPackages: {
    maxGeneratedBytesPerProject: 64 * 1024 * 1024,
    maxRetainedPerProject: 24,
  },
  maxMapsPerDeploy: 20,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const tileflowIconPackageContentHashSchema = sha256Schema;

export const tileflowIconIdSchema = z.string().max(64).regex(tileflowIconIdPattern);

export const tileflowRenderedIconManifestEntrySchema = z
  .object({
    name: tileflowIconIdSchema,
    pixelSha256: z
      .object({
        oneX: sha256Schema,
        twoX: sha256Schema,
      })
      .strict(),
  })
  .strict();

export const tileflowIconPackageLabelSchema = z.string().superRefine((value, context) => {
  if (value !== value.trim() || value.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Icon package labels must be non-empty and have no surrounding whitespace',
    });
  }

  if (Array.from(value).length > 64) {
    context.addIssue({
      code: 'custom',
      message: 'Icon package labels must contain at most 64 Unicode characters',
    });
  }

  if (!isWellFormedUnicode(value) || containsControlCharacter(value)) {
    context.addIssue({
      code: 'custom',
      message: 'Icon package labels must contain printable, well-formed Unicode',
    });
  }
});

const spriteDimensionsSchema = z
  .object({
    height: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    pixelRatio: z.union([z.literal(1), z.literal(2)]),
    width: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
  })
  .strict();

function iconPackageFileSchema(
  name: TileflowIconPackageFileName,
  contentType: 'application/json' | 'image/png',
) {
  return z
    .object({
      byteLength: z
        .number()
        .int()
        .nonnegative()
        .max(tileflowIconPackageLimits.maxGeneratedFileBytes),
      contentType: z.literal(contentType),
      name: z.literal(name),
      sha256: sha256Schema,
    })
    .strict();
}

export const tileflowIconPackageManifestSchema = z
  .object({
    files: z.tuple([
      iconPackageFileSchema('sprite.json', 'application/json'),
      iconPackageFileSchema('sprite.png', 'image/png'),
      iconPackageFileSchema('sprite@2x.json', 'application/json'),
      iconPackageFileSchema('sprite@2x.png', 'image/png'),
    ]),
    format: z.literal('tileflow-icon-package-v1'),
    iconNames: z.array(tileflowIconIdSchema).min(1).max(tileflowIconPackageLimits.maxIconCount),
    renderedIcons: z
      .array(tileflowRenderedIconManifestEntrySchema)
      .min(1)
      .max(tileflowIconPackageLimits.maxIconCount),
    sprites: z
      .object({
        oneX: spriteDimensionsSchema.extend({pixelRatio: z.literal(1)}),
        twoX: spriteDimensionsSchema.extend({pixelRatio: z.literal(2)}),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sortedNames = [...manifest.iconNames].sort(compareCodeUnits);

    if (
      sortedNames.some((name, index) => name !== manifest.iconNames[index]) ||
      new Set(manifest.iconNames).size !== manifest.iconNames.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Icon names must be unique and sorted by Unicode code unit',
        path: ['iconNames'],
      });
    }

    if (
      manifest.renderedIcons.length !== manifest.iconNames.length ||
      manifest.renderedIcons.some((entry, index) => entry.name !== manifest.iconNames[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Rendered icon entries must exactly match iconNames in sorted order',
        path: ['renderedIcons'],
      });
    }

    const totalBytes = manifest.files.reduce((total, file) => total + file.byteLength, 0);

    if (totalBytes > tileflowIconPackageLimits.maxGeneratedPackageBytes) {
      context.addIssue({
        code: 'custom',
        message: `Generated icon package exceeds ${tileflowIconPackageLimits.maxGeneratedPackageBytes} bytes`,
        path: ['files'],
      });
    }

    if (
      manifest.sprites.twoX.width !== manifest.sprites.oneX.width * 2 ||
      manifest.sprites.twoX.height !== manifest.sprites.oneX.height * 2
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The @2x sprite dimensions must be exactly twice the 1x dimensions',
        path: ['sprites', 'twoX'],
      });
    }
  });

export type TileflowIconPackageManifest = z.infer<typeof tileflowIconPackageManifestSchema>;
export type TileflowRenderedIconManifestEntry = z.infer<
  typeof tileflowRenderedIconManifestEntrySchema
>;

export function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function serializeCanonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function serializeTileflowIconPackageManifest(input: TileflowIconPackageManifest): string {
  const manifest = tileflowIconPackageManifestSchema.parse(input);
  return serializeCanonicalJson(manifest);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashTileflowIconPackageManifest(
  input: TileflowIconPackageManifest,
): Promise<string> {
  return sha256Hex(serializeTileflowIconPackageManifest(input));
}

/**
 * Hashes the delivered pixels of one rendered icon without including its name.
 *
 * The v1 binary frame is the UTF-8 domain `tileflow-rendered-icon-pixels-v1\0`, followed by one
 * byte for the pixel ratio, unsigned 32-bit big-endian width and height, then row-major RGBA.
 * Fully transparent pixels have their RGB channels zeroed in a copy before hashing so invisible
 * decoder data cannot create a visual difference.
 */
export async function hashTileflowRenderedIconPixels(input: {
  height: number;
  pixelRatio: 1 | 2;
  rgba: Uint8Array;
  width: number;
}): Promise<string> {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.width > tileflowIconPackageLimits.maxAtlasDimension ||
    input.height > tileflowIconPackageLimits.maxAtlasDimension
  ) {
    throw new Error('Rendered icon dimensions are invalid');
  }

  if (input.pixelRatio !== 1 && input.pixelRatio !== 2) {
    throw new Error('Rendered icon pixel ratio must be 1 or 2');
  }

  const pixelCount = input.width * input.height;
  const expectedBytes = pixelCount * 4;

  if (
    pixelCount > tileflowIconPackageLimits.maxDecodedPixelsPerIcon ||
    input.rgba.byteLength !== expectedBytes
  ) {
    throw new Error(`Rendered icon RGBA must contain exactly ${expectedBytes} bytes`);
  }

  const normalized = new Uint8Array(input.rgba);

  for (let offset = 0; offset < normalized.byteLength; offset += 4) {
    if (normalized[offset + 3] === 0) {
      normalized[offset] = 0;
      normalized[offset + 1] = 0;
      normalized[offset + 2] = 0;
    }
  }

  const domain = new TextEncoder().encode('tileflow-rendered-icon-pixels-v1\0');
  const frame = new Uint8Array(domain.byteLength + 9 + normalized.byteLength);
  frame.set(domain);
  frame[domain.byteLength] = input.pixelRatio;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(domain.byteLength + 1, input.width);
  view.setUint32(domain.byteLength + 5, input.height);
  frame.set(normalized, domain.byteLength + 9);

  return sha256Hex(frame);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }

  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }

      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}
