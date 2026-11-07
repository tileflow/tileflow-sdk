import {defineTheme, type TileflowTheme, token} from '@tileflow/core';
import {streetsThemes} from './streets-themes';

/**
 * Natural ground, relief and trail inks for one light preset. Everything else, including roads,
 * sky, lighting and POI discs, stays with the matching Streets appearance.
 */
type OutdoorsPalette = {
  contour: string;
  grass: string;
  ground: string;
  ice: string;
  meadow: string;
  overview: string;
  peak: string;
  protected: string;
  protectedEdge: string;
  rock: string;
  sand: string;
  scrub: string;
  shadow: string;
  track: string;
  trail: string;
  trailHalo: string;
  wetland: string;
  wood: string;
};

const palettes = {
  light: {
    contour: '#A9835A',
    grass: '#D6E4B8',
    ground: '#F2EEE1',
    ice: '#DDEEF7',
    meadow: '#DDE8C0',
    overview: '#F4F1E6',
    peak: '#4F3A28',
    protected: 'rgba(116, 158, 92, 0.16)',
    protectedEdge: '#5F8A4C',
    rock: '#D8D5CE',
    sand: '#EEE5C6',
    scrub: '#C8D9A8',
    shadow: '#7D7A68',
    track: '#8C6239',
    trail: '#C4471C',
    trailHalo: '#FBF8EF',
    wetland: '#C5E0D2',
    wood: '#B4D2A0',
  },
  dawn: {
    contour: '#A9805F',
    grass: '#D9DFC0',
    ground: '#F3EADF',
    ice: '#E2E8F3',
    meadow: '#E0E2C6',
    overview: '#F5EEE3',
    peak: '#523A2E',
    protected: 'rgba(132, 152, 104, 0.16)',
    protectedEdge: '#6E8A58',
    rock: '#DAD2CC',
    sand: '#F0E2C8',
    scrub: '#CCD5AE',
    shadow: '#857767',
    track: '#8E603F',
    trail: '#C64A24',
    trailHalo: '#FBF3E9',
    wetland: '#CCDCD2',
    wood: '#BBCDA6',
  },
  dusk: {
    contour: '#A08068',
    grass: '#465146',
    ground: '#3A3B41',
    ice: '#67707E',
    meadow: '#4B564A',
    overview: '#44454B',
    peak: '#E6D8C8',
    protected: 'rgba(130, 170, 118, 0.14)',
    protectedEdge: '#8FB381',
    rock: '#55545A',
    sand: '#5C5A52',
    scrub: '#4A5448',
    shadow: '#2B2A32',
    track: '#C49A72',
    trail: '#F2935C',
    trailHalo: '#34343A',
    wetland: '#465A58',
    wood: '#3D4F42',
  },
  dark: {
    contour: '#8E7259',
    grass: '#35443A',
    ground: '#26292C',
    ice: '#566270',
    meadow: '#394A3E',
    overview: '#33363A',
    peak: '#E2D8CA',
    protected: 'rgba(120, 170, 120, 0.12)',
    protectedEdge: '#86B083',
    rock: '#46484B',
    sand: '#4B4C45',
    scrub: '#384639',
    shadow: '#1B1E21',
    track: '#BC9670',
    trail: '#F08E58',
    trailHalo: '#26292C',
    wetland: '#3B504E',
    wood: '#2D4235',
  },
} as const satisfies Record<string, OutdoorsPalette>;

function outdoorsTheme(id: keyof typeof palettes, parent: TileflowTheme) {
  const palette = palettes[id];
  return defineTheme(parent, {
    id: `outdoors-${id}`,
    version: 1,
    colorScheme: id === 'dark' || id === 'dusk' ? 'dark' : 'light',
    tokens: {
      color: {
        'surface.background': palette.ground,
        'surface.background.overview': palette.overview,
        'surface.background.transition': palette.ground,
        'surface.land': palette.ground,
        'surface.park': palette.grass,
        'landcover.barren': palette.rock,
        'landcover.global.barren': palette.rock,
        'landcover.global.grass': palette.grass,
        'landcover.global.shrub': palette.scrub,
        'landcover.global.snow': palette.ice,
        'landcover.global.trees': palette.wood,
        'landcover.grass': palette.grass,
        'landcover.greenspace': palette.grass,
        'landcover.greenspaceDark': palette.grass,
        'landcover.ice': palette.ice,
        'landcover.meadow': palette.meadow,
        'landcover.protected': palette.protected,
        'landcover.recreationGround': palette.grass,
        'landcover.rock': palette.rock,
        'landcover.sand': palette.sand,
        'landcover.scrub': palette.scrub,
        'landcover.urbanPark': palette.grass,
        'landcover.villageGreen': palette.grass,
        'landcover.wetland': palette.wetland,
        'landcover.wood': palette.wood,
        'terrain.hillshade.shadow': palette.shadow,
        'terrain.contour': palette.contour,
        'labels.peak': palette.peak,
        'landcover.protectedEdge': palette.protectedEdge,
        'roads.track': palette.track,
        'roads.trail': palette.trail,
        'roads.trailHalo': palette.trailHalo,
      },
      image: {
        'outdoors.peak': id === 'dark' || id === 'dusk' ? 'outdoors-peak-dark' : 'outdoors-peak',
      },
    },
  });
}

/** Streets' four times of day, repainted for natural ground and trails. */
export const outdoorsThemes = Object.freeze({
  light: outdoorsTheme('light', streetsThemes.light),
  dawn: outdoorsTheme('dawn', streetsThemes.dawn),
  dusk: outdoorsTheme('dusk', streetsThemes.dusk),
  dark: outdoorsTheme('dark', streetsThemes.dark),
});

/** Theme references consumed by the Outdoors modules. */
export const outdoorsVisual = Object.freeze({
  contour: token.color('terrain.contour'),
  halo: token.color('labels.placeHalo'),
  peak: token.color('labels.peak'),
  peakIcon: token.image('outdoors.peak'),
  protectedEdge: token.color('landcover.protectedEdge'),
  track: token.color('roads.track'),
  trail: token.color('roads.trail'),
  trailHalo: token.color('roads.trailHalo'),
});
