import {defineTheme, type TileflowTheme, token} from '@tileflow/core';
import {streetsThemes} from './streets-themes';

/**
 * Natural ground, relief and trail inks for one light preset. Everything else, including roads,
 * sky, lighting and POI discs, stays with the matching Streets appearance.
 */
type OutdoorsPalette = {
  boundary: string;
  boundaryHalo: string;
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
    boundary: '#A65966',
    boundaryHalo: '#FCC5CE',
    contour: '#626250',
    grass: '#D0E1B1',
    ground: '#E1E3D4',
    ice: '#E9F0F6',
    meadow: '#DDE8C0',
    overview: '#F4F1E6',
    peak: '#6B575E',
    protected: 'rgba(116, 158, 92, 0.16)',
    protectedEdge: '#5F8A4C',
    rock: '#D8D9D3',
    sand: '#EEE5C6',
    scrub: '#C8D9A8',
    shadow: '#676B5C',
    track: '#B0986B',
    trail: '#DC8B18',
    trailHalo: '#F2F2F2',
    wetland: '#C5E0D2',
    wood: '#A7CA87',
  },
  dawn: {
    boundary: '#AD7380',
    boundaryHalo: '#F8D9DB',
    contour: '#7E705E',
    grass: '#D9DFC0',
    ground: '#F3EADF',
    ice: '#E2E8F3',
    meadow: '#E0E2C6',
    overview: '#F5EEE3',
    peak: '#79675F',
    protected: 'rgba(132, 152, 104, 0.16)',
    protectedEdge: '#6E8A58',
    rock: '#DAD2CC',
    sand: '#F0E2C8',
    scrub: '#CCD5AE',
    shadow: '#857767',
    track: '#B49B78',
    trail: '#CA984D',
    trailHalo: '#F5EEE4',
    wetland: '#CCDCD2',
    wood: '#BBCDA6',
  },
  dusk: {
    boundary: '#AA8093',
    boundaryHalo: '#5F485D',
    contour: '#A0907E',
    grass: '#465146',
    ground: '#3A3B41',
    ice: '#67707E',
    meadow: '#4B564A',
    overview: '#44454B',
    peak: '#C2B5B9',
    protected: 'rgba(130, 170, 118, 0.14)',
    protectedEdge: '#8FB381',
    rock: '#55545A',
    sand: '#5C5A52',
    scrub: '#4A5448',
    shadow: '#2B2A32',
    track: '#927D61',
    trail: '#B99054',
    trailHalo: '#D8CEBC',
    wetland: '#465A58',
    wood: '#3D4F42',
  },
  dark: {
    boundary: '#937384',
    boundaryHalo: '#443944',
    contour: '#938675',
    grass: '#35443A',
    ground: '#26292C',
    ice: '#566270',
    meadow: '#394A3E',
    overview: '#33363A',
    peak: '#BDC2C0',
    protected: 'rgba(120, 170, 120, 0.12)',
    protectedEdge: '#86B083',
    rock: '#46484B',
    sand: '#4B4C45',
    scrub: '#384639',
    shadow: '#1B1E21',
    track: '#7F7059',
    trail: '#A98750',
    trailHalo: '#BEBCA9',
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
        'boundaries.admin': palette.boundary,
        'boundaries.regional': palette.boundary,
        'boundaries.halo': palette.boundaryHalo,
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
        'landforms.peak': id === 'dark' || id === 'dusk' ? 'outdoors-peak-dark' : 'outdoors-peak',
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
  peakIcon: token.image('landforms.peak'),
  protectedEdge: token.color('landcover.protectedEdge'),
  track: token.color('roads.track'),
  trail: token.color('roads.trail'),
  trailHalo: token.color('roads.trailHalo'),
});
