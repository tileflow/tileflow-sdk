/** Display names only. Compiled theme IDs remain stable for URLs, configs and capture commands. */
export const themeLabels: Readonly<Record<string, string>> = {
  light: 'Light',
  default: 'Default',
  faded: 'Faded',
  monochrome: 'Monochrome',
};

export const defaultPaletteMapIds = ['streets', 'map-1777'] as const;

export function themeLabel(name: string, metadata?: unknown): string {
  const map = metadata as Record<string, unknown> | undefined;
  if (
    name === 'light' &&
    defaultPaletteMapIds.some(
      (id) =>
        map?.['tileflow:map'] === id ||
        (Array.isArray(map?.['tileflow:extends']) && map['tileflow:extends'].includes(id)),
    )
  )
    return 'Default';
  return Object.hasOwn(themeLabels, name) ? themeLabels[name] : name.replace(/[-_]/g, ' ');
}

export function themeVariantLabel(
  variant: {palette: string; timeOfDay?: string},
  metadata?: unknown,
): string {
  const moment = variant.timeOfDay;
  return `${themeLabel(variant.palette, metadata)}${moment ? ` · ${moment[0].toUpperCase()}${moment.slice(1)}` : ''}`;
}
