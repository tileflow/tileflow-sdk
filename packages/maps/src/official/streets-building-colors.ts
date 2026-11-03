/** A shared stone, smoked-glass and roof palette; the model assigns each material to its parts. */
export function streetsBuildingColors(base: string, dark: boolean, monochrome = false) {
  const rgb = [1, 3, 5].map((offset) => parseInt(base.slice(offset, offset + 2), 16));
  const hex = (values: number[]) =>
    '#' +
    values
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  return {
    'buildings.modelSurface': base,
    'buildings.modelGlass': hex(
      rgb.map((v, channel) => v * (monochrome ? 0.86 : [0.78, 0.88, 0.95][channel]!)),
    ),
    'buildings.modelSecondary': hex(rgb.map((v) => v + (255 - v) * (dark ? 0.018 : 0.2))),
    'buildings.modelRoof': hex(
      rgb.map((v, channel) => v * (monochrome ? 0.92 : [0.94, 0.92, 0.9][channel]!)),
    ),
    'buildings.modelAccent': hex(rgb.map((v) => v + (255 - v) * (dark ? 0.025 : 0.4))),
  };
}
