import {z} from 'zod';
import type {TileflowIconDirectory} from './maps/assets';

export const tileflowIconSourceLimit = 32;
export type TileflowIconSetReference = `@${string}/${string}`;

const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
export const tileflowIconSetReferenceSchema = z
  .string()
  .max(130)
  .regex(
    new RegExp(`^@${slug}/${slug}$`, 'u'),
    'Expected a canonical @team/set reference without a version suffix',
  )
  .refine(
    (value) =>
      value
        .slice(1)
        .split('/')
        .every((part) => part.length <= 64),
    'Team and set slugs must contain at most 64 characters',
  );

export const tileflowIconSetSourceSchema = z
  .object({
    kind: z.literal('icon-set'),
    reference: tileflowIconSetReferenceSchema,
  })
  .strict();

export type TileflowIconSetSource = Readonly<{
  kind: 'icon-set';
  reference: TileflowIconSetReference;
}>;
export type TileflowIconSource = TileflowIconDirectory | TileflowIconSetSource;

/** Declare a dependency. This function never resolves a version or performs I/O. */
export function iconSet(reference: TileflowIconSetReference): TileflowIconSetSource {
  return Object.freeze(
    tileflowIconSetSourceSchema.parse({kind: 'icon-set', reference}),
  ) as TileflowIconSetSource;
}

export function isTileflowIconSetSource(value: unknown): value is TileflowIconSetSource {
  return tileflowIconSetSourceSchema.safeParse(value).success;
}

export const tileflowIconSetIdSchema = z.string().regex(/^ics_[A-Za-z0-9_-]{16}$/u);
export const tileflowIconSetVersionIdSchema = z.string().regex(/^icv_[A-Za-z0-9_-]{16}$/u);
export const tileflowIconSetPackageIdSchema = z.string().regex(/^icp_[A-Za-z0-9_-]{16,64}$/u);
export const tileflowIconSetTeamIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);

export type TileflowIconSetErrorCode =
  | 'ICON_SET_INVALID'
  | 'ICON_LOCK_INVALID'
  | 'ICON_LOCK_MISSING'
  | 'ICON_LOCK_CONFLICT'
  | 'ICON_CACHE_MISS'
  | 'ICON_CACHE_UNSAFE'
  | 'ICON_DOWNLOAD_FAILED'
  | 'ICON_PACKAGE_INTEGRITY'
  | 'ICON_COMPOSITION_INVALID';

export class TileflowIconSetError extends Error {
  readonly phase = 'icon-resolution' as const;
  constructor(
    readonly code: TileflowIconSetErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TileflowIconSetError';
  }
}

/** Validate the dependency sequence without consulting a lock or registry. */
export function collectTileflowIconSetReferences(
  sources: readonly TileflowIconSource[],
): TileflowIconSetReference[] {
  if (sources.length > tileflowIconSourceLimit) {
    throw new TileflowIconSetError(
      'ICON_SET_INVALID',
      `A map supports at most ${tileflowIconSourceLimit} icon contributors`,
    );
  }
  const references: TileflowIconSetReference[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (typeof source !== 'object' || source === null || source.kind !== 'icon-set') continue;
    const parsed = tileflowIconSetSourceSchema.safeParse(source);
    if (!parsed.success || seen.has(source.reference)) {
      throw new TileflowIconSetError(
        'ICON_SET_INVALID',
        'Icon set references must be canonical and unique within a map',
      );
    }
    seen.add(source.reference);
    references.push(source.reference);
  }
  return references;
}
