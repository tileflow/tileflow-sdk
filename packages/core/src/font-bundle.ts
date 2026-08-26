import {z} from 'zod';
import {compareCodeUnits, serializeCanonicalJson, sha256Hex} from './icon-package';

export const tileflowFontBundleLimits = {
  maxFaceCount: 16,
  maxFileCount: 32,
  maxFontFileBytes: 1024 * 1024,
  maxLicenseFileBytes: 2 * 1024 * 1024,
  maxManifestBytes: 64 * 1024,
  maxPackageBytes: 20 * 1024 * 1024,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const fontFileNameSchema = z
  .string()
  .max(512)
  .regex(/^fonts\/[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{64}\.(?:otf|ttf|woff2)$/u);
const licenseFileNameSchema = z
  .string()
  .max(512)
  .regex(/^fonts\/licenses\/license-[a-f0-9]{64}\.txt$/u);
const fontFamilySchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) => value === value.trim() && !/[\p{Cc}\\]/u.test(value),
    'Font family must be printable, trimmed text',
  );

export const tileflowFontBundleContentHashSchema = sha256Schema;

const fontFileSchema = z
  .object({
    byteLength: z.number().int().positive().max(tileflowFontBundleLimits.maxFontFileBytes),
    contentType: z.enum(['font/otf', 'font/ttf', 'font/woff2']),
    kind: z.literal('font'),
    name: fontFileNameSchema,
    sha256: sha256Schema,
  })
  .strict();

const licenseFileSchema = z
  .object({
    byteLength: z.number().int().positive().max(tileflowFontBundleLimits.maxLicenseFileBytes),
    contentType: z.literal('text/plain; charset=utf-8'),
    kind: z.literal('license'),
    name: licenseFileNameSchema,
    sha256: sha256Schema,
  })
  .strict();

const fontFaceSchema = z
  .object({
    family: fontFamilySchema,
    file: fontFileNameSchema,
    licenseFile: licenseFileNameSchema,
    style: z.enum(['italic', 'normal', 'oblique']),
    weight: z.enum(['100', '200', '300', '400', '500', '600', '700', '800', '900']),
  })
  .strict();

export const tileflowFontBundleManifestSchema = z
  .object({
    files: z
      .array(z.discriminatedUnion('kind', [fontFileSchema, licenseFileSchema]))
      .min(2)
      .max(tileflowFontBundleLimits.maxFileCount),
    fontFaces: z.array(fontFaceSchema).min(1).max(tileflowFontBundleLimits.maxFaceCount),
    format: z.literal('tileflow-font-bundle-v1'),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sortedFiles = [...manifest.files].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    if (
      sortedFiles.some((file, index) => file.name !== manifest.files[index]?.name) ||
      new Set(manifest.files.map((file) => file.name)).size !== manifest.files.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Font bundle files must be unique and sorted by name',
        path: ['files'],
      });
    }

    const faceKey = (face: z.infer<typeof fontFaceSchema>) =>
      `${face.family}\0${face.style}\0${face.weight}`;
    const sortedFaces = [...manifest.fontFaces].sort((left, right) =>
      compareCodeUnits(faceKey(left), faceKey(right)),
    );
    if (
      sortedFaces.some((face, index) => faceKey(face) !== faceKey(manifest.fontFaces[index]!)) ||
      new Set(manifest.fontFaces.map(faceKey)).size !== manifest.fontFaces.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Font bundle faces must be unique and sorted by family, style, and weight',
        path: ['fontFaces'],
      });
    }

    const files = new Map(manifest.files.map((file) => [file.name, file]));
    const referencedFonts = new Set<string>();
    const referencedLicenses = new Set<string>();
    for (const [index, face] of manifest.fontFaces.entries()) {
      const font = files.get(face.file);
      const license = files.get(face.licenseFile);
      if (font?.kind !== 'font') {
        context.addIssue({
          code: 'custom',
          message: 'Font face must reference one declared font file',
          path: ['fontFaces', index, 'file'],
        });
      } else {
        referencedFonts.add(font.name);
        const expectedContentType = font.name.endsWith('.otf')
          ? 'font/otf'
          : font.name.endsWith('.ttf')
            ? 'font/ttf'
            : 'font/woff2';
        if (font.contentType !== expectedContentType || !font.name.includes(`-${font.sha256}.`)) {
          context.addIssue({
            code: 'custom',
            message: 'Font file name, digest, extension, and content type must agree',
            path: ['files', manifest.files.indexOf(font)],
          });
        }
      }
      if (license?.kind !== 'license') {
        context.addIssue({
          code: 'custom',
          message: 'Font face must reference one declared license file',
          path: ['fontFaces', index, 'licenseFile'],
        });
      } else {
        referencedLicenses.add(license.name);
        if (license.name !== `fonts/licenses/license-${license.sha256}.txt`) {
          context.addIssue({
            code: 'custom',
            message: 'License file name and digest must agree',
            path: ['files', manifest.files.indexOf(license)],
          });
        }
      }
    }

    if (referencedFonts.size !== manifest.fontFaces.length) {
      context.addIssue({
        code: 'custom',
        message: 'Every font face must own a distinct font file',
        path: ['fontFaces'],
      });
    }
    if (
      manifest.files.some(
        (file) =>
          (file.kind === 'font' && !referencedFonts.has(file.name)) ||
          (file.kind === 'license' && !referencedLicenses.has(file.name)),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Font bundle may not contain unreferenced files',
        path: ['files'],
      });
    }

    const totalBytes = manifest.files.reduce((total, file) => total + file.byteLength, 0);
    if (totalBytes > tileflowFontBundleLimits.maxPackageBytes) {
      context.addIssue({
        code: 'custom',
        message: `Font bundle exceeds ${tileflowFontBundleLimits.maxPackageBytes} bytes`,
        path: ['files'],
      });
    }
  });

export type TileflowFontBundleManifest = z.infer<typeof tileflowFontBundleManifestSchema>;
export type TileflowFontBundleFile = TileflowFontBundleManifest['files'][number];
export type TileflowFontBundleFontFace = TileflowFontBundleManifest['fontFaces'][number];

export function serializeTileflowFontBundleManifest(input: TileflowFontBundleManifest): string {
  const manifest = tileflowFontBundleManifestSchema.parse(input);
  const serialized = serializeCanonicalJson(manifest);
  if (new TextEncoder().encode(serialized).byteLength > tileflowFontBundleLimits.maxManifestBytes) {
    throw new Error('Font bundle manifest exceeds its safe byte limit');
  }
  return serialized;
}

export async function hashTileflowFontBundleManifest(
  input: TileflowFontBundleManifest,
): Promise<string> {
  return sha256Hex(serializeTileflowFontBundleManifest(input));
}
