import {
  defineTheme,
  resolveTileflowTheme,
  type TileflowTheme,
  type TileflowThemeLighting,
} from '@tileflow/core';
import {type Map1777Moment, map1777Pigment} from './map-1777-pigments';

const lighting: Record<Map1777Moment, TileflowThemeLighting> = {
  dawn: {
    anchor: 'map',
    color: '#FFD4A1',
    intensity: 0.3,
    position: [1.15, 110, 66],
    sun: {azimuth: 110, altitude: 24, color: '#FFD4A1', intensity: 0.44, shadowIntensity: 0.62},
    ambient: {color: '#E4C7BC', intensity: 0.72},
  },
  dusk: {
    anchor: 'map',
    color: '#FFD09A',
    intensity: 0.3,
    position: [1.15, 255, 72],
    sun: {azimuth: 255, altitude: 18, color: '#FFD09A', intensity: 0.5, shadowIntensity: 0.6},
    ambient: {color: '#B8B9D0', intensity: 0.62},
  },
  night: {
    anchor: 'map',
    color: '#B6D3F0',
    intensity: 0.3,
    position: [1.15, 300, 58],
    // Roof paint establishes darkness; a lower moon and less sky fill reveal the facades.
    sun: {azimuth: 300, altitude: 32, color: '#B6D3F0', intensity: 0.46, shadowIntensity: 0.34},
    ambient: {color: '#94AAC8', intensity: 0.3},
  },
};

/** Bind the day design first, then supply a complete explicit palette for every token. */
export function map1777TimeThemes(day: TileflowTheme) {
  const resolved = resolveTileflowTheme(day);
  const variant = (moment: Map1777Moment) =>
    defineTheme(day, {
      id: `map-1777-${moment}`,
      version: 1,
      colorScheme: moment === 'night' ? 'dark' : 'light',
      lighting: lighting[moment],
      tokens: {
        color: {
          ...Object.fromEntries(
            Object.entries(resolved.tokens.color).map(([role, color]) => [
              role,
              map1777Pigment(color, moment),
            ]),
          ),
          // Shadows and bark keep their own pigments, independent of lettering.
          'buildings.renderStack.printShadow.style.color':
            moment === 'dawn' ? '#4B3730' : moment === 'dusk' ? '#4B3544' : '#090F19',
          'vegetation.threeDimensional.barkColor':
            moment === 'dawn' ? '#7C5D4D' : moment === 'dusk' ? '#6D5141' : '#2B333D',
        },
        image: Object.fromEntries(
          Object.entries(resolved.tokens.image).map(([role, image]) => [
            role,
            image.replace(/^map-1777-/, `map-1777-${moment}-`),
          ]),
        ),
      },
    });
  return {light: day, dawn: variant('dawn'), dusk: variant('dusk'), dark: variant('night')};
}
