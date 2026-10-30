/** Small tonal variations around the ordinary buildings, shared by every authored model. */
export function streetsBuildingColors(base: string, dark: boolean) {
  const rgb = [1, 3, 5].map((offset) => parseInt(base.slice(offset, offset + 2), 16));
  const gray = rgb.reduce((sum, value) => sum + value, 0) / 3;
  const hex = (values: number[]) =>
    '#' +
    values
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  return {
    'buildings.modelSurface': base,
    'buildings.modelSecondary': hex(rgb.map((v) => v + (255 - v) * (dark ? 0.018 : 0.24))),
    'buildings.modelRoof': hex(rgb.map((v) => (v * 0.8 + gray * 0.2) * 0.97)),
    'buildings.modelAccent': hex(rgb.map((v) => v + (255 - v) * (dark ? 0.025 : 0.34))),
  };
}
