import {z} from 'zod';

const coordinate = z.number().int().nonnegative().max(2048);
const regions = z
  .array(z.tuple([coordinate, coordinate]))
  .min(1)
  .max(2048);

export const tileflowIconLayoutFields = {
  stretchX: regions.optional(),
  stretchY: regions.optional(),
  content: z.tuple([coordinate, coordinate, coordinate, coordinate]).optional(),
};

/** Asset-owned geometry in logical pixels; sprite indexes scale it by pixelRatio. */
export const tileflowIconLayoutSchema = z
  .object(tileflowIconLayoutFields)
  .strict()
  .superRefine((layout, context) => {
    if (!Object.values(layout).some((value) => value !== undefined))
      context.addIssue({
        code: 'custom',
        message: 'Icon layout must declare stretch regions or content',
      });

    for (const axis of ['stretchX', 'stretchY'] as const) {
      let end = 0;
      for (const [index, [from, to]] of (layout[axis] ?? []).entries()) {
        if (from >= to || from < end)
          context.addIssue({
            code: 'custom',
            path: [axis, index],
            message: 'Stretch regions must be positive, ordered and non-overlapping',
          });
        end = to;
      }
    }

    if (layout.content) {
      const [left, top, right, bottom] = layout.content;
      if (left >= right || top >= bottom)
        context.addIssue({
          code: 'custom',
          path: ['content'],
          message: 'Icon content must have positive dimensions',
        });
      for (const [axis, low, high] of [
        ['stretchX', left, right],
        ['stretchY', top, bottom],
      ] as const) {
        if (layout[axis] && !layout[axis].some(([from, to]) => from < high && to > low))
          context.addIssue({
            code: 'custom',
            path: [axis],
            message: 'Stretch regions must overlap the content area',
          });
      }
    }
  });

export type TileflowIconLayoutMetadata = z.infer<typeof tileflowIconLayoutSchema>;

export function assertTileflowIconLayoutBounds(
  layout: TileflowIconLayoutMetadata,
  width: number,
  height: number,
): void {
  const checked = tileflowIconLayoutSchema.parse(layout);
  if (
    checked.stretchX?.some(([, end]) => end > width) ||
    checked.stretchY?.some(([, end]) => end > height) ||
    (checked.content && (checked.content[2] > width || checked.content[3] > height))
  )
    throw new Error('Icon layout must stay inside its cell dimensions');
}

/** Read only native layout fields; other sprite fields retain their own validation. */
export function readTileflowIconLayout(
  entry: Partial<TileflowIconLayoutMetadata>,
): TileflowIconLayoutMetadata | undefined {
  const fields = Object.fromEntries(
    ['stretchX', 'stretchY', 'content'].flatMap((key) => {
      const value = entry[key as keyof TileflowIconLayoutMetadata];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  return Object.keys(fields).length ? tileflowIconLayoutSchema.parse(fields) : undefined;
}

export function scaleTileflowIconLayout(
  layout: TileflowIconLayoutMetadata,
  scale: number,
): TileflowIconLayoutMetadata {
  return tileflowIconLayoutSchema.parse({
    ...(layout.stretchX
      ? {stretchX: layout.stretchX.map((range) => range.map((value) => value * scale))}
      : {}),
    ...(layout.stretchY
      ? {stretchY: layout.stretchY.map((range) => range.map((value) => value * scale))}
      : {}),
    ...(layout.content ? {content: layout.content.map((value) => value * scale)} : {}),
  });
}
