import {isTileflowThemeName} from './portable-identity-rules';

/** Artistic presets; selecting one never starts a clock or moves the real sun. */
export const tileflowTimesOfDay = ['day', 'dawn', 'dusk', 'night'] as const;
export type TileflowTimeOfDay = (typeof tileflowTimesOfDay)[number];

/** A named theme family points to complete, already compiled themes. */
export type TileflowTimeOfDayVariants = Readonly<
  Record<string, Readonly<Partial<Record<TileflowTimeOfDay, string>>>>
>;

export function isTileflowTimeOfDay(value: unknown): value is TileflowTimeOfDay {
  return typeof value === 'string' && tileflowTimesOfDay.includes(value as TileflowTimeOfDay);
}

/** Shared authoring/runtime validation; callers attach these paths to their schema diagnostics. */
export function validateTileflowTimeOfDayVariants(
  variants: TileflowTimeOfDayVariants,
  themes: Readonly<Record<string, unknown>>,
): Array<{path: string[]; message: string}> {
  const issues: Array<{path: string[]; message: string}> = [];
  const owners = new Map<string, string>();
  const families = Object.entries(variants);
  for (const [family, moments] of families) {
    if (!isTileflowThemeName(family) || !Object.hasOwn(themes, family)) {
      issues.push({path: [family], message: 'Time-of-day family must name an existing theme'});
    }
    if (!Object.values(moments).includes(family)) {
      issues.push({path: [family], message: 'A family must include its own theme in its presets'});
    }
    for (const [moment, name] of Object.entries(moments)) {
      if (name === undefined) continue;
      if (
        !isTileflowTimeOfDay(moment) ||
        !isTileflowThemeName(name) ||
        !Object.hasOwn(themes, name)
      ) {
        issues.push({
          path: [family, moment],
          message: 'Expected a supported moment and an existing theme',
        });
      }
      const owner = owners.get(name);
      if (owner !== undefined && owner !== family) {
        issues.push({
          path: [family, moment],
          message: `Theme "${name}" already belongs to family "${owner}"`,
        });
      }
      owners.set(name, family);
    }
  }
  return issues;
}

/** Concrete variant names are aliases for their family when a moment is explicitly requested. */
export function resolveTileflowTimeOfDayTheme(
  variants: TileflowTimeOfDayVariants | undefined,
  theme: string,
  timeOfDay: TileflowTimeOfDay | undefined,
): string {
  if (timeOfDay === undefined || variants === undefined) return theme;
  if (!isTileflowTimeOfDay(timeOfDay)) throw new TypeError('Expected day, dawn, dusk, or night');
  const family = Object.hasOwn(variants, theme)
    ? variants[theme]
    : Object.values(variants).find((moments) => Object.values(moments).includes(theme));
  // A theme without this capability is unaffected, including in mixed catalogs.
  if (!family) return theme;
  const result = family[timeOfDay];
  if (result === undefined) {
    throw new Error(
      `Theme "${theme}" does not offer timeOfDay="${timeOfDay}". Available: ${Object.keys(family).join(', ')}.`,
    );
  }
  return result;
}
