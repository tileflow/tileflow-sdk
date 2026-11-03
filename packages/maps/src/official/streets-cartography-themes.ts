import {defineTheme, type TileflowTheme, token} from '@tileflow/core';
import {streetsBuildingColors} from './streets-building-colors';
import {streetsDayColors, streetsDayImages} from './streets-day-colors';
import {streetsDayGroundColors} from './streets-ground-and-access';
import {streetsNetworkDayColors} from './streets-network-overview';

const palettes = {
  day: ['#E8EAED', '#F3E9DF', '#D5D8DD', '#DDCCC0'],
  dawn: ['#E9E6E8', '#F6EDDF', '#D7D2D5', '#E2D4C2'],
  dusk: ['#383B46', '#474238', '#494D59', '#605746'],
  night: ['#2B2F3A', '#37352F', '#3A404D', '#4D483C'],
} as const;

function colors(name: string) {
  const preset = name.startsWith('dark')
    ? 'night'
    : name.startsWith('dusk')
      ? 'dusk'
      : name.startsWith('dawn')
        ? 'dawn'
        : 'day';
  const values = palettes[preset].map((hex) => {
    let rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    if (name.includes('monochrome')) {
      const gray = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      rgb = [gray, gray, gray];
    } else if (name.includes('faded')) {
      rgb = rgb.map((value) => value + (255 - value) * 0.08);
    }
    return '#' + rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('');
  });
  return Object.fromEntries(
    ['neutral', 'active', 'neutralOutline', 'activeOutline'].map((role, index) => [
      `buildings.flat.${role}`,
      values[index],
    ]),
  );
}

export function streetsCartographyThemes(base: Record<string, TileflowTheme>) {
  return Object.fromEntries(
    Object.entries(base).map(([name, theme]) => [
      name,
      defineTheme(theme, {
        id: `streets-${name}`,
        version: 1,
        colorScheme: theme.colorScheme,
        tokens: {
          color: {
            ...colors(name),
            ...(name === 'light' ? streetsDayColors : {}),
            'roads.accessOverview': colors(name)['buildings.flat.neutral'],
            'roads.path.ground': token.color('roads.path'),
            'roads.path.green': '#FFFFFF',
            'surface.background.transition': token.color(
              name === 'light' ? 'surface.background' : 'surface.background.overview',
            ),
            'vegetation.tree.outline': name === 'light' ? '#A0E5B5' : token.color('surface.park'),
            'landcover.orchard': token.color('landcover.farmland'),
            'landcover.nursery': token.color('landcover.farmland'),
            'roads.overview.casing': token.color('roads.detail.casing'),
            'roads.overview.major': token.color('roads.motorway'),
            'roads.overview.majorClose': token.color('roads.motorway'),
            'roads.overview.casingClose': token.color('roads.detail.casing'),
            ...(name === 'light' ? streetsDayGroundColors : {}),
            ...(name === 'light' ? streetsNetworkDayColors : {}),
            // Daylight 3D stone is a soft ivory, still cooler than active buildings.
            'buildings.raised.neutral':
              name === 'light' ? '#EDEDE7' : colors(name)['buildings.flat.neutral'],
            ...streetsBuildingColors(
              name === 'light' ? '#EDEDE7' : colors(name)['buildings.flat.neutral']!,
              theme.colorScheme === 'dark',
            ),
            ...(name === 'light'
              ? {
                  'vegetation.tree.bark': '#C6B493',
                  'buildings.modelWood': '#C6B493',
                  'buildings.flat.neutralOutline': '#B9BFBA',
                  'buildings.flat.activeOutline': '#B9BFBA',
                  'roads.path.ground': '#D5DAD7',
                  'landcover.global.crop': 'rgba(0, 0, 0, 0)',
                }
              : {}),
          },
          image: name === 'light' ? streetsDayImages : {},
          number: Object.fromEntries([
            ['roads.path.groundOpacity', name === 'light' ? 1 : 0],
            ['labels.shield.spacing11', name === 'light' ? 420 : 220],
            ['labels.shield.spacing13', name === 'light' ? 480 : 300],
            ...[100, 85, 78, 55, 25].map((value) => [
              `land.climate.opacity${value === 100 ? '' : value}`,
              name === 'light' ? value / 100 : 0,
            ]),
          ]),
        },
      }),
    ]),
  );
}
