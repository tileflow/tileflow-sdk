import {z} from 'zod';
import {tileflowMapIdSchema} from './maps/types';
import type {TileflowStyleFontFace} from './runtime';
import type {TileflowViewConfig} from './types';

export const tileflowRuntimeManifestVersion = 3 as const;
export const tileflowRuntimeManifestLimits = Object.freeze({maximumBytes: 1024 * 1024});

export type TileflowSelfHostedManifest = {
  fontFaces?: Record<string, TileflowStyleFontFace[]>;
  kind: 'self-hosted';
  maps: Record<string, string>;
  styles: Record<string, string>;
  version: typeof tileflowRuntimeManifestVersion;
  views?: Record<string, TileflowViewConfig>;
};

export type TileflowHostedManifestMap = {
  apiUrl?: string;
  environment: string;
  fontFaces?: TileflowStyleFontFace[];
  mapId: string;
  styleId?: string;
  styleUrl: string;
  usageMode?: 'session';
  view?: TileflowViewConfig;
  worldGeneration?: 'v1';
};

export type TileflowHostedManifest = {
  apiUrl: string;
  kind: 'hosted';
  maps: Record<string, TileflowHostedManifestMap>;
  styles: Record<string, string>;
  version: typeof tileflowRuntimeManifestVersion;
};

export type TileflowRuntimeManifest = TileflowSelfHostedManifest | TileflowHostedManifest;

const manifestMapIdSchema = z.string().superRefine((value, context) => {
  const parsed = tileflowMapIdSchema.safeParse(value);
  if (!parsed.success || parsed.data !== value) {
    context.addIssue({
      code: 'custom',
      message: 'Expected a canonical Tileflow map id',
    });
  }
});

const safeTextSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => value === value.trim(), 'Expected text without surrounding whitespace')
  .refine((value) => !/[\p{Cc}\\]/u.test(value), 'Expected safe text');

const publicResourceUrlSchema = safeTextSchema.refine(isPublicResourceUrl, {
  message: 'Expected an HTTP(S), root-relative, or path-relative public URL',
});

const absolutePublicUrlSchema = safeTextSchema.refine(isAbsolutePublicUrl, {
  message: 'Expected an absolute HTTP(S) public URL without credentials or a fragment',
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

const selfHostedManifestSchema = z
  .object({
    fontFaces: z.record(manifestMapIdSchema, fontFacesSchema).optional(),
    kind: z.literal('self-hosted'),
    maps: z.record(manifestMapIdSchema, publicResourceUrlSchema),
    styles: z.record(manifestMapIdSchema, publicResourceUrlSchema),
    version: z.literal(tileflowRuntimeManifestVersion),
    views: z.record(manifestMapIdSchema, viewSchema).optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateManifestCollections(manifest.maps, manifest.styles, context);
    validateCollectionSize(manifest.fontFaces, 'fontFaces', context);
    validateCollectionSize(manifest.views, 'views', context);
    validateOptionalMapCollection(manifest.fontFaces, manifest.maps, 'fontFaces', context);
    for (const mapName of Object.keys(manifest.views ?? {})) {
      if (!Object.hasOwn(manifest.maps, mapName)) {
        context.addIssue({
          code: 'custom',
          message: 'Expected a view for a declared map',
          path: ['views', mapName],
        });
      }
    }
  });

const hostedManifestMapSchema: z.ZodType<TileflowHostedManifestMap> = z
  .object({
    apiUrl: apiOriginSchema.optional(),
    environment: safeTextSchema,
    fontFaces: fontFacesSchema.optional(),
    mapId: safeTextSchema,
    styleId: safeTextSchema.optional(),
    styleUrl: absolutePublicUrlSchema,
    usageMode: z.literal('session').optional(),
    view: viewSchema.optional(),
    worldGeneration: z.literal('v1').optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if ((entry.usageMode === undefined) !== (entry.worldGeneration === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'usageMode and worldGeneration must be declared together',
      });
    }
  }) as z.ZodType<TileflowHostedManifestMap>;

const hostedManifestSchema = z
  .object({
    apiUrl: apiOriginSchema,
    kind: z.literal('hosted'),
    maps: z.record(manifestMapIdSchema, hostedManifestMapSchema),
    styles: z.record(manifestMapIdSchema, absolutePublicUrlSchema),
    version: z.literal(tileflowRuntimeManifestVersion),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateManifestCollections(
      Object.fromEntries(
        Object.entries(manifest.maps).map(([mapName, entry]) => [mapName, entry.styleUrl]),
      ),
      manifest.styles,
      context,
    );
  });

const canonicalManifestSchema = z
  .discriminatedUnion('kind', [selfHostedManifestSchema, hostedManifestSchema])
  .superRefine((manifest, context) => {
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
  });

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

/** Strict canonical schema for the current wire contract. */
export const tileflowRuntimeManifestSchema: z.ZodType<TileflowRuntimeManifest> =
  safeManifestInputSchema.pipe(canonicalManifestSchema) as z.ZodType<TileflowRuntimeManifest>;

export function parseTileflowRuntimeManifest(input: unknown): TileflowRuntimeManifest {
  return tileflowRuntimeManifestSchema.parse(input);
}

export function safeParseTileflowRuntimeManifest(input: unknown) {
  return tileflowRuntimeManifestSchema.safeParse(input);
}

function validateManifestCollections(
  maps: Record<string, string>,
  styles: Record<string, string>,
  context: z.RefinementCtx,
): void {
  validateCollectionSize(maps, 'maps', context);
  validateCollectionSize(styles, 'styles', context);
  if (Object.keys(maps).length === 0) {
    context.addIssue({code: 'custom', message: 'Expected at least one map', path: ['maps']});
  }
  for (const [mapName, styleUrl] of Object.entries(maps)) {
    if (!Object.hasOwn(styles, mapName)) {
      context.addIssue({
        code: 'custom',
        message: 'Expected a matching styles entry',
        path: ['maps', mapName],
      });
    } else if (styles[mapName] !== styleUrl) {
      context.addIssue({
        code: 'custom',
        message: 'Expected maps and styles URLs to match',
        path: ['styles', mapName],
      });
    }
  }
  for (const mapName of Object.keys(styles)) {
    if (!Object.hasOwn(maps, mapName)) {
      context.addIssue({
        code: 'custom',
        message: 'Expected a matching maps entry',
        path: ['styles', mapName],
      });
    }
  }
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

function validateCollectionSize(
  value: Record<string, unknown> | undefined,
  path: string,
  context: z.RefinementCtx,
): void {
  if (value && Object.keys(value).length > 1_000) {
    context.addIssue({code: 'too_big', maximum: 1_000, origin: 'object', path: [path]});
  }
}

function validateOptionalMapCollection(
  value: Record<string, unknown> | undefined,
  maps: Record<string, unknown>,
  path: string,
  context: z.RefinementCtx,
): void {
  for (const mapName of Object.keys(value ?? {})) {
    if (!Object.hasOwn(maps, mapName)) {
      context.addIssue({
        code: 'custom',
        message: 'Expected an entry for a declared map',
        path: [path, mapName],
      });
    }
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
