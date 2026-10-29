import {z} from 'zod';

const finite = z.number().finite();

/**
 * A regional credit of a downloaded release, shown while one of its boxes is in view. The native
 * host passes them when a Hosted map opens from its downloaded regions.
 */
export const creditSchema = z.strictObject({
  id: z.string().min(1).max(192),
  text: z.string().min(1).max(1024),
  href: z
    .string()
    .max(2048)
    .regex(/^https:\/\/[^\s"<>]+$/u),
  regions: z
    .array(
      z.tuple([
        finite.min(-180).max(180),
        finite.min(-90).max(90),
        finite.min(-180).max(180),
        finite.min(-90).max(90),
      ]),
    )
    .min(1)
    .max(256),
});
export type Credit = z.infer<typeof creditSchema>;

export type Bounds = {west: number; south: number; east: number; north: number};

/**
 * The credits with a box that intersects the view. The view's longitudes may run past ±180°, as
 * a camera over the antimeridian sees world copies; a view wider than the world sees every box.
 */
export function visibleCredits(credits: readonly Credit[], view: Bounds): Credit[] {
  const wide = view.east - view.west >= 360;
  return credits.filter((credit) =>
    credit.regions.some(([west, south, east, north]) => {
      if (south > view.north || north < view.south) return false;
      if (wide) return true;
      return [-360, 0, 360].some((shift) => west + shift <= view.east && east + shift >= view.west);
    }),
  );
}

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escape = (value: string) => value.replace(/[&<>"']/gu, (character) => escapes[character]!);

/** The attribution entry of a credit: its exact text, linked to its page. */
export function creditHtml(credit: Credit): string {
  return `<a href="${escape(credit.href)}" target="_blank" rel="noopener">${escape(credit.text)}</a>`;
}
