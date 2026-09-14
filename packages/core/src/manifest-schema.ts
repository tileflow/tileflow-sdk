import type {
  ManifestRefinement,
  ManifestSchema,
  ManifestSchemaOperations,
} from './manifest-schema-operations';
import {
  type TileflowRuntimeManifest,
  tileflowRuntimeManifestLimits,
  type TileflowRuntimeManifestMapEntry,
  type TileflowRuntimeManifestTheme,
  tileflowRuntimeManifestVersion,
} from './manifest-types';
import {createPortableIdentitySchemas} from './portable-identity-schema';
import type {TileflowStyleFontFace} from './runtime';
import {createTileflowRuntimeViewSchema} from './runtime-view-schema';
import {tileflowThemeLimits} from './themes/model';

/** Private primitives, not a second manifest wire format or a consumer configuration API. */
export type TileflowManifestPrimitives = {
  parseUrl(
    value: string,
    base?: string,
  ): {
    protocol: string;
    username: string;
    password: string;
    hash: string;
    pathname: string;
    search: string;
    origin: string;
  };
  utf8ByteLength(value: string): number;
};

/** Canonical version-1 grammar; adapters only delegate constructors and checks to Zod. */
export function createTileflowRuntimeManifestSchema(
  primitives: TileflowManifestPrimitives,
  operations: ManifestSchemaOperations,
  identities = createPortableIdentitySchemas(operations),
): ManifestSchema<TileflowRuntimeManifest> {
  const {tileflowPortableIdSchema, tileflowThemeNameSchema} = identities;
  const safeTextSchema = operations.refine(
    operations.refine(
      operations.maxLength(operations.minLength(operations.string(), 1), 2_048),
      (value) => value === value.trim(),
      'Expected text without surrounding whitespace',
    ),
    (value) => !/[\p{Cc}\\]/u.test(value),
    'Expected safe text',
  );
  const publicResourceUrlSchema = operations.refine(
    safeTextSchema,
    isPublicResourceUrl,
    'Expected an HTTP(S), root-relative, or path-relative public URL',
  );
  const apiOriginSchema = operations.refine(
    safeTextSchema,
    isApiOrigin,
    'Expected an absolute HTTP(S) origin without path, credentials, query, or fragment',
  );
  const viewSchema = createTileflowRuntimeViewSchema(operations);
  const fontFaceSchema = operations.object<TileflowStyleFontFace>({
    family: operations.maxLength(safeTextSchema, 100),
    source: publicResourceUrlSchema,
    style: operations.optional(operations.enum(['italic', 'normal', 'oblique'])),
    weight: operations.optional(
      operations.enum(['100', '200', '300', '400', '500', '600', '700', '800', '900']),
    ),
  });
  const fontFacesSchema = operations.superRefine(
    operations.maxLength(operations.array(fontFaceSchema), 16),
    validateUniqueFontFaces,
  );
  const manifestThemeSchema = operations.object<TileflowRuntimeManifestTheme>({
    colorScheme: operations.enum(['dark', 'light']),
    fontFaces: operations.optional(fontFacesSchema),
    revision: operations.optional(operations.maxLength(safeTextSchema, 128)),
    styleId: operations.optional(operations.maxLength(safeTextSchema, 128)),
    styleUrl: publicResourceUrlSchema,
  });
  const manifestMapSchema = operations.superRefine(
    operations.object<TileflowRuntimeManifestMapEntry>({
      apiUrl: operations.optional(apiOriginSchema),
      defaultTheme: tileflowThemeNameSchema,
      environment: operations.optional(operations.maxLength(safeTextSchema, 128)),
      mapId: operations.optional(operations.maxLength(safeTextSchema, 128)),
      systemThemes: operations.optional(
        operations.object<{dark: string; light: string}>({
          dark: tileflowThemeNameSchema,
          light: tileflowThemeNameSchema,
        }),
      ),
      themes: operations.record(tileflowThemeNameSchema, manifestThemeSchema),
      usageMode: operations.optional(operations.literal('session')),
      view: operations.optional(viewSchema),
      worldGeneration: operations.optional(operations.literal('v1')),
    }),
    (entry, context) => {
      const names = Object.keys(entry.themes);
      if (names.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Expected at least one theme',
          path: ['themes'],
        });
      }
      if (names.length > tileflowThemeLimits.maxThemes) {
        context.addIssue({
          code: 'too_big',
          maximum: tileflowThemeLimits.maxThemes,
          origin: 'object',
          path: ['themes'],
        });
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
    },
  );

  const canonicalManifestSchema = operations.superRefine(
    operations.object<TileflowRuntimeManifest>({
      apiUrl: operations.optional(apiOriginSchema),
      maps: operations.record(tileflowPortableIdSchema, manifestMapSchema),
      version: operations.literal(tileflowRuntimeManifestVersion),
    }),
    (manifest, context) => {
      const mapCount = Object.keys(manifest.maps).length;
      if (mapCount === 0) {
        context.addIssue({code: 'custom', message: 'Expected at least one map', path: ['maps']});
      }
      if (mapCount > 1_000) {
        context.addIssue({code: 'too_big', maximum: 1_000, origin: 'object', path: ['maps']});
      }
      if (
        primitives.utf8ByteLength(JSON.stringify(manifest)) >
        tileflowRuntimeManifestLimits.maximumBytes
      ) {
        context.addIssue({
          code: 'too_big',
          maximum: tileflowRuntimeManifestLimits.maximumBytes,
          origin: 'string',
          message: 'Manifest JSON exceeds the 1 MiB limit',
        });
      }
    },
  );

  const safeManifestInputSchema = operations.superRefine(operations.unknown(), (input, context) => {
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

  function validateUniqueFontFaces(
    fontFaces: TileflowStyleFontFace[],
    context: Parameters<ManifestRefinement<TileflowStyleFontFace[]>>[1],
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
      const url = primitives.parseUrl(value);
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
      const url = primitives.parseUrl(value, 'https://manifest.invalid/owner/manifest.json');
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
      const url = primitives.parseUrl(value);
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
    const pending: Array<{path: Array<string | number>; value: object}> = [
      {path: [], value: input},
    ];
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

  return operations.pipe(safeManifestInputSchema, canonicalManifestSchema);
}
