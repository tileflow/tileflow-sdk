import {z} from 'zod';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';
import type {TileflowStyleFontFace} from './runtime';
import type {TileflowViewConfig} from './types';

/** The first and only public multi-theme runtime manifest contract. */
export const tileflowRuntimeManifestVersion = 1 as const;
export const tileflowRuntimeManifestLimits = Object.freeze({maximumBytes: 1024 * 1024});

export type TileflowRuntimeColorScheme = 'dark' | 'light';

export type TileflowRuntimeManifestTheme = {
  colorScheme: TileflowRuntimeColorScheme;
  /** Complete font closure for this compiled theme. */
  fontFaces?: TileflowStyleFontFace[];
  /** Content or deployment revision used for cache identity and receipts. */
  revision?: string;
  /** Hosted style identity, when different from the logical map identity. */
  styleId?: string;
  styleUrl: string;
};

export type TileflowRuntimeSystemThemes = {
  dark: string;
  light: string;
};

export type TileflowRuntimeManifestMapEntry = {
  apiUrl?: string;
  defaultTheme: string;
  environment?: string;
  mapId?: string;
  systemThemes?: TileflowRuntimeSystemThemes;
  themes: Record<string, TileflowRuntimeManifestTheme>;
  usageMode?: 'session';
  view?: TileflowViewConfig;
  worldGeneration?: 'v1';
};

/**
 * One logical map catalog for local and Hosted delivery.
 *
 * Delivery-specific fields are optional metadata on a map. The wire shape never forks into
 * self-hosted and Hosted variants, so every runtime follows the same theme resolution path.
 */
export type TileflowRuntimeManifest = {
  apiUrl?: string;
  maps: Record<string, TileflowRuntimeManifestMapEntry>;
  version: typeof tileflowRuntimeManifestVersion;
};

const safeTextSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => value === value.trim(), 'Expected text without surrounding whitespace')
  .refine((value) => !/[\p{Cc}\\]/u.test(value), 'Expected safe text');

const publicResourceUrlSchema = safeTextSchema.refine(isPublicResourceUrl, {
  message: 'Expected an HTTP(S), root-relative, or path-relative public URL',
});

const apiOriginSchema = safeTextSchema.refine(isApiOrigin, {
  message: 'Expected an absolute HTTP(S) origin without path, credentials, query, or fragment',
});

const viewSchema: z.ZodType<TileflowViewConfig> = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    center: z
      .tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
      .optional(),
    pitch: z.number().finite().min(0).max(85).optional(),
    zoom: z.number().finite().min(0).max(24).optional(),
  })
  .strict() as z.ZodType<TileflowViewConfig>;

const fontFaceSchema: z.ZodType<TileflowStyleFontFace> = z
  .object({
    family: safeTextSchema.max(100),
    source: publicResourceUrlSchema,
    style: z.enum(['italic', 'normal', 'oblique']).optional(),
    weight: z.enum(['100', '200', '300', '400', '500', '600', '700', '800', '900']).optional(),
  })
  .strict() as z.ZodType<TileflowStyleFontFace>;

const fontFacesSchema = z.array(fontFaceSchema).max(16).superRefine(validateUniqueFontFaces);

const manifestThemeSchema: z.ZodType<TileflowRuntimeManifestTheme> = z
  .object({
    colorScheme: z.enum(['dark', 'light']),
    fontFaces: fontFacesSchema.optional(),
    revision: safeTextSchema.max(128).optional(),
    styleId: safeTextSchema.max(128).optional(),
    styleUrl: publicResourceUrlSchema,
  })
  .strict() as z.ZodType<TileflowRuntimeManifestTheme>;

const manifestMapSchema: z.ZodType<TileflowRuntimeManifestMapEntry> = z
  .object({
    apiUrl: apiOriginSchema.optional(),
    defaultTheme: tileflowThemeNameSchema,
    environment: safeTextSchema.max(128).optional(),
    mapId: safeTextSchema.max(128).optional(),
    systemThemes: z
      .object({dark: tileflowThemeNameSchema, light: tileflowThemeNameSchema})
      .strict()
      .optional(),
    themes: z.record(tileflowThemeNameSchema, manifestThemeSchema),
    usageMode: z.literal('session').optional(),
    view: viewSchema.optional(),
    worldGeneration: z.literal('v1').optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    const names = Object.keys(entry.themes);
    if (names.length === 0) {
      context.addIssue({code: 'custom', message: 'Expected at least one theme', path: ['themes']});
    }
    if (names.length > 64) {
      context.addIssue({code: 'too_big', maximum: 64, origin: 'object', path: ['themes']});
    }
    if (!Object.hasOwn(entry.themes, entry.defaultTheme)) {
      context.addIssue({
        code: 'custom',
        message: 'defaultTheme must name a declared theme',
        path: ['defaultTheme'],
      });
    }
    if (entry.systemThemes) {
      for (const colorScheme of ['light', 'dark'] as const) {
        const name = entry.systemThemes[colorScheme];
        const theme = entry.themes[name];
        if (!theme) {
          context.addIssue({
            code: 'custom',
            message: `systemThemes.${colorScheme} must name a declared theme`,
            path: ['systemThemes', colorScheme],
          });
        } else if (theme.colorScheme !== colorScheme) {
          context.addIssue({
            code: 'custom',
            message: `systemThemes.${colorScheme} must reference a ${colorScheme} theme`,
            path: ['systemThemes', colorScheme],
          });
        }
      }
    }
    if ((entry.usageMode === undefined) !== (entry.worldGeneration === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'usageMode and worldGeneration must be declared together',
      });
    }
  }) as z.ZodType<TileflowRuntimeManifestMapEntry>;

const canonicalManifestSchema: z.ZodType<TileflowRuntimeManifest> = z
  .object({
    apiUrl: apiOriginSchema.optional(),
    maps: z.record(tileflowPortableIdSchema, manifestMapSchema),
    version: z.literal(tileflowRuntimeManifestVersion),
  })
  .strict()
  .superRefine((manifest, context) => {
    const mapCount = Object.keys(manifest.maps).length;
    if (mapCount === 0) {
      context.addIssue({code: 'custom', message: 'Expected at least one map', path: ['maps']});
    }
    if (mapCount > 1_000) {
      context.addIssue({code: 'too_big', maximum: 1_000, origin: 'object', path: ['maps']});
    }
    if (
      new TextEncoder().encode(JSON.stringify(manifest)).byteLength >
      tileflowRuntimeManifestLimits.maximumBytes
    ) {
      context.addIssue({
        code: 'too_big',
        maximum: tileflowRuntimeManifestLimits.maximumBytes,
        origin: 'string',
        message: 'Manifest JSON exceeds the 1 MiB limit',
      });
    }
  }) as z.ZodType<TileflowRuntimeManifest>;

const safeManifestInputSchema = z.unknown().superRefine((input, context) => {
  const unsafe = findUnsafeManifestStructure(input);
  if (unsafe) {
    context.addIssue({
      code: 'custom',
      message:
        unsafe.reason === 'prototype'
          ? 'Expected plain manifest objects'
          : 'Expected no prototype-mutating keys',
      path: unsafe.path,
    });
  }
});

export const tileflowRuntimeManifestSchema: z.ZodType<TileflowRuntimeManifest> =
  safeManifestInputSchema.pipe(canonicalManifestSchema) as z.ZodType<TileflowRuntimeManifest>;

export function parseTileflowRuntimeManifest(input: unknown): TileflowRuntimeManifest {
  return tileflowRuntimeManifestSchema.parse(input);
}

export function safeParseTileflowRuntimeManifest(input: unknown) {
  return tileflowRuntimeManifestSchema.safeParse(input);
}

function validateUniqueFontFaces(
  fontFaces: TileflowStyleFontFace[],
  context: z.RefinementCtx,
): void {
  const seen = new Map<string, number>();
  for (const [index, fontFace] of fontFaces.entries()) {
    const identity = `${fontFace.family}\0${fontFace.style ?? 'normal'}\0${fontFace.weight ?? '400'}`;
    const first = seen.get(identity);
    if (first !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate font face identity; first declared at index ${first}`,
        path: [index],
      });
      continue;
    }
    seen.set(identity, index);
  }
}

function isPublicResourceUrl(value: string): boolean {
  if (value.startsWith('//')) return false;
  if (
    !value.startsWith('/') &&
    !value.startsWith('./') &&
    !value.startsWith('../') &&
    !isAbsolutePublicUrl(value)
  ) {
    return false;
  }
  return isSafeResolvedPublicUrl(value);
}

function isAbsolutePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !hasEncodedPathSeparator(value)
    );
  } catch {
    return false;
  }
}

function isSafeResolvedPublicUrl(value: string): boolean {
  try {
    const url = new URL(value, 'https://manifest.invalid/owner/manifest.json');
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !hasEncodedPathSeparator(value)
    );
  } catch {
    return false;
  }
}

function hasEncodedPathSeparator(value: string): boolean {
  return /%(?:2f|5c)/iu.test(value);
}

function isApiOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      isAbsolutePublicUrl(value) &&
      url.pathname === '/' &&
      !url.search &&
      value.replace(/\/$/u, '') === url.origin
    );
  } catch {
    return false;
  }
}

function findUnsafeManifestStructure(
  input: unknown,
): {path: Array<string | number>; reason: 'key' | 'prototype'} | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const pending: Array<{path: Array<string | number>; value: object}> = [{path: [], value: input}];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    if (!Array.isArray(current.value)) {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) {
        return {path: current.path, reason: 'prototype'};
      }
    }
    for (const key of Object.keys(current.value)) {
      const path = [...current.path, Array.isArray(current.value) ? Number(key) : key];
      if (key === '__proto__') return {path, reason: 'key'};
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (
        descriptor &&
        'value' in descriptor &&
        descriptor.value &&
        typeof descriptor.value === 'object'
      ) {
        pending.push({path, value: descriptor.value});
      }
    }
  }
  return undefined;
}
