import type {StreetsColorTheme, StreetsLightPreset} from './streets-theme-colors';

// Architectural role profiles observed in Mapbox Standard, 2026-10-20.
// https://docs.mapbox.com/style-spec/reference/layers/#model
// Brightness is measured before the colour-theme transform.
export function streetsModelLighting(preset: StreetsLightPreset, family: StreetsColorTheme) {
  const mono = family === 'monochrome';
  const dark = preset === 'dusk' || preset === 'night';
  const brightness = mono
    ? {day: 0.5027777777777778, dawn: 0.41869713699376476, dusk: 0.01331186036230345, night: 0}[
        preset
      ]
    : {
        day: 0.4777777777777778,
        dawn: 0.3964860412365071,
        dusk: 0.026970197755280183,
        night: 0.013517295842482737,
      }[preset];
  const share = (low: number, high: number) =>
    Math.min(1, Math.max(0, (brightness - low) / (high - low)));
  const day = share(0.2, 0.4),
    window = share(0, 0.15),
    neutral = share(0.16, 0.4);
  const wall = !dark
    ? '#FFFFFF'
    : mono
      ? preset === 'dusk'
        ? '#F1F1F1'
        : '#F0F0F0'
      : family === 'faded'
        ? preset === 'dusk'
          ? '#FDF0DD'
          : '#FDEFD9'
        : preset === 'dusk'
          ? '#FDE6CD'
          : '#FDE4C8';
  return {
    colors: {
      'buildings.modelEmission': wall,
      'buildings.modelRoof': mono ? '#F3F3F3' : family === 'faded' ? '#FDF5EF' : '#FDF1E9',
    },
    numbers: {
      'buildings.modelEmission.strength': (0.1 + 0.7 * share(0.45, 0.5)) * (mono && dark ? 0.5 : 1),
      'buildings.modelEmission.start': 0.5 * (1 - day),
      'buildings.modelEmission.end': day,
      'buildings.modelEmission.curve': 0.8 - 0.2 * day,
      'buildings.modelDoor.strength': (mono ? 0.2 : 1.5) * (1 - day) + 2.5 * day,
      'buildings.modelLogo.mix': 0.3 * day,
      'buildings.modelWindow.strength': (mono ? 0.1 : 0.5) * (1 - day) + 0.4 * day,
      'buildings.modelWindow.variation': 0.3 * (1 - day),
      'buildings.modelWindow.hueLow': 200 * window,
      'buildings.modelWindow.hueHigh': 90 + 125 * window,
      'buildings.modelWindow.saturationLow': mono ? 0 : 20 + 80 * window,
      'buildings.modelWindow.saturationHigh': mono ? 0 : 100,
      'buildings.modelWindow.lightnessLow': 87 - 17 * window,
      'buildings.modelWindow.lightnessHigh': 87 - 7 * window,
      'buildings.modelOther.saturation': mono ? 0 : 55 * (1 - neutral),
      'buildings.modelOther.lightnessLow': 80 + 20 * neutral,
      'buildings.modelOther.lightnessHigh': 90 + 10 * neutral,
    },
  };
}
