import {defineTheme, token} from '@tileflow/core';
import {streetsBuildingColors} from './streets-building-colors';
import {streetsCartographyColors} from './streets-cartography-colors';
import {streetsCartographyThemes} from './streets-cartography-themes';
import {streetsLighting} from './streets-lighting';
import {streetsModelLighting} from './streets-model-lighting';
import {streetsPoiImageTokens} from './streets-poi';
import {streetsDayRoadFillColors, streetsRoadCasingProfiles} from './streets-road-colors';
import {streetsSkyTokens} from './streets-sky';
import {
  type StreetsColorTheme,
  type StreetsLightPreset,
  streetsSurfaceProfiles,
} from './streets-theme-colors';
import {streetsTreeProfiles} from './streets-tree-colors';

// Legacy decorative inks and species variations retain their semantic roles. Ground,
// building, road and foreground materials are overridden by the independently evaluated
// sRGB palette in streets-cartography-colors.ts; they do not inherit family-wide offsets.
/**
 * Streets' public visual vocabulary. Token IDs describe cartographic roles,
 * never physical layer IDs, so agents can edit the design without knowing the
 * compiler's layer topology.
 */
const streetsLightColors = {
  'labels.address': '#808080',
  'boundaries.admin': '#CE9298',
  'boundaries.default': '#CE9298',
  'boundaries.disputed': '#CE9298',
  'boundaries.halo': '#F5F1F0',
  'boundaries.major': '#CE9298',
  'boundaries.maritime': '#648AA4',
  'boundaries.regional': '#CE9698',
  'buildings.active': '#EFEADD',
  'buildings.businessCorridor': '#F4E6D8',
  'buildings.businessCorridorOutline': '#DCCFC3',
  'buildings.civic': '#EFEADD',
  'buildings.commercial': '#EFEADD',
  'buildings.destination': '#EFEADD',
  'buildings.extrusion': '#EEE4DA',
  'buildings.contactShadow': '#8C8178',
  'buildings.fill': '#EFEADD',
  'buildings.generic': '#EFEADD',
  'buildings.industrial': '#EFEADD',
  'buildings.outline': '#E0CDA5',
  'buildings.residential': '#EFEADD',
  'buildings.shadow': '#BDB7B1',
  // Low-zoom bathymetry is composited over the ocean fill. These values are
  // deliberately pre-compensated so the rendered result, rather than the raw
  // paint token, matches Standard's more chromatic world-view water.
  'hydro.depth.m0': '#99DDFF59',
  'hydro.depth.m200': '#6ECEFE59',
  'hydro.depth.m2000': '#29B5FD59',
  'hydro.depth.m7000': '#15AFFA59',
  'hydro.ferry': '#479CEB',
  'hydro.label': '#5A88A9',
  'hydro.ocean': '#98DCFE',
  'hydro.water': '#98DCFE',
  'hydro.waterway': '#98DCFE',
  'labels.aerodrome': '#5C74D6',
  'labels.country': '#000000',
  'labels.ferry': '#2682D9',
  'labels.ferryHalo': '#98DCFE',
  'labels.halo': '#F5F1F0',
  'labels.placeHalo': '#FFFFFF',
  'labels.roadHalo': '#F2F2F2',
  'labels.muted': '#6D6E6C',
  'labels.neighborhood': '#626361',
  'labels.overview': '#5B5C5A',
  'labels.poi': '#555654',
  'labels.primary': '#5B5C5A',
  'labels.road': '#404040',
  'labels.settlement': '#000000',
  'labels.shield.dark': '#1B1D27',
  'labels.shield.light': '#FFFFFF',
  'labels.strong': '#505050',
  'labels.water': '#5A88A9',
  'labels.waterHalo': 'rgba(244, 240, 239, 0.72)',
  'landcover.barren': '#F1EEE9',
  'landcover.farmland': '#D2F0C2',
  'landcover.flowerbed': '#BFE6AE',
  'landcover.global.barren': '#F2F0EB',
  'landcover.global.crop': '#D3F1C5',
  'landcover.global.grass': '#E2F3D1',
  'landcover.global.shrub': '#D4F0C5',
  'landcover.global.snow': '#F4F7F8',
  'landcover.global.trees': '#C1EFBE',
  'landcover.global.urban': '#F5F1F0',
  // Mapbox Standard's fences, and its hedges: the park green 25 points less saturated and 14
  // points darker.
  'land.fence': '#D9D9D9',
  'land.wall': '#CBC6C1',
  'landcover.hedge': '#90C58A',
  'landcover.hedgeShade': '#6F9F69',
  'landcover.grass': '#C2EEBE',
  'landcover.greenspace': '#B3EAAD',
  'landcover.greenspaceDark': '#B8E0AE',
  'landcover.ice': '#F4F7F8',
  'landcover.meadow': '#C2EEBE',
  'landcover.protected': '#D5E8D0',
  'landcover.recreationGround': '#B3EAAD',
  'landcover.rock': '#E9E8ED',
  'landcover.sand': '#F0ECC6',
  'landcover.scrub': '#D2EEC6',
  'landcover.urbanPark': '#B3EAAD',
  'landcover.villageGreen': '#C2E7B5',
  'landcover.wetland': '#D7E9DE',
  'landcover.wood': '#A7DFA0',
  'landuse.businessCorridor': '#FBEDE2',
  'landuse.businessCorridorOutline': '#E6D8CA',
  'landuse.cemetery': '#CCE5C6',
  'landuse.civic': '#F5F1F0',
  'landuse.commercial': '#FBEDE2',
  'landuse.education': '#ECE4D2',
  'landuse.government': '#F5F1F0',
  'landuse.industrial': '#E8E8F0',
  'landuse.medical': '#EEE0DF',
  'landuse.military': '#F5F1F0',
  'landuse.parking': '#E9E6E7',
  'landuse.parkingOutline': '#C8C8CF',
  'landuse.railway': '#E8E8F0',
  'landuse.recreation': '#B3EAAD',
  'landuse.recreationOutline': '#AED7A5',
  'landuse.residential': '#F5F0EF',
  'poi.arts-entertainment': '#F042B6',
  'poi.education': '#916130',
  'poi.food-drink': '#F57A00',
  'poi.halo': '#FFFFFF',
  'poi.icon': '#777876',
  'poi.label': '#555654',
  'poi.landmark': '#F042B6',
  'poi.lodging': '#664CE6',
  'poi.medical': '#F53D3D',
  'poi.park-nature': '#267915',
  'poi.public-services': '#586E84',
  'poi.religion': '#586E84',
  'poi.retail': '#2D87E1',
  'poi.sport-leisure': '#1891AA',
  'poi.transport': '#3359CC',
  'poi.visitor-amenity': '#586E84',
  'roads.bridge': '#BEC5D8',
  'roads.casing': '#9EA9C4',
  'roads.city.casing': '#9EA9C4',
  'roads.city.minor': '#BEC5D8',
  'roads.city.primary': '#BEC5D8',
  'roads.city.secondary': '#BEC5D8',
  'roads.city.tertiary': '#BEC5D8',
  'roads.city.tunnel': '#E0E0E5',
  'roads.city.tunnelCasing': '#C5C5CF',
  'roads.cycleway': '#67AD73',
  'roads.default': '#BEC5D8',
  'roads.default.casing': '#9EA9C4',
  'roads.default.tunnel': '#DEE0E8',
  'roads.ferry': '#479CEB',
  'roads.major': '#A1B0C4',
  'roads.minor': '#BEC5D8',
  'roads.motorway': '#A1B0C4',
  'roads.motorway.casing': '#8D9EAE',
  'roads.motorway.tunnel': '#BEC8D6',
  'roads.parkPath': '#D8E1D8',
  'roads.path': '#EFECEF',
  'roads.path.casing': '#D1C7C7',
  'roads.path.transition': '#F8F6F8',
  'roads.path.tunnel': '#E4E1E5',
  'roads.pedestrian.surface': '#F7F5F5',
  'roads.primary': '#BEC5D8',
  'roads.rail': '#8B8E99',
  'roads.railTransit': '#8E909D',
  'roads.secondary': '#BEC5D8',
  'roads.sidewalk.surface': 'rgba(0, 0, 0, 0.06)',
  'roads.trunk': '#A3A6C2',
  'roads.trunk.casing': '#8F91AA',
  'roads.trunk.tunnel': '#C6C8D4',
  'roads.tunnel': '#DEE0E8',
  'surface.background': '#F5F1F0',
  'surface.building': '#EFEADD',
  'surface.land': '#F5F1F0',
  'surface.park': '#B3EAAD',
  'surface.water': '#98DCFE',
  'terrain.hillshade.accent': '#A6AB91',
  'terrain.hillshade.highlight': '#FFFFFF',
  'terrain.hillshade.shadow': '#727B64',
  'transit.primary': '#5C74D6',
  'vegetation.tree.bark': '#918878',
  'vegetation.tree.broadleaf.a': '#77AA88',
  'vegetation.tree.broadleaf.b': '#91BA8D',
  'vegetation.tree.broadleaf.c': '#A6C682',
  'vegetation.tree.broadleaf.d': '#AECFA2',
  'vegetation.tree.conifer.a': '#729B78',
  'vegetation.tree.conifer.b': '#81A880',
  'vegetation.tree.conifer.c': '#91B68B',
} as const;

const streetsDarkColors = {
  'labels.address': '#808080',
  'boundaries.admin': '#9A6177',
  'boundaries.default': '#9A6177',
  'boundaries.disputed': '#9A6177',
  'boundaries.halo': '#252839',
  'boundaries.major': '#9A6177',
  'boundaries.maritime': '#8192B3',
  'boundaries.regional': '#76586D',
  'buildings.active': '#373743',
  'buildings.businessCorridor': '#45424E',
  'buildings.businessCorridorOutline': '#56515A',
  'buildings.civic': '#2C2E3D',
  'buildings.commercial': '#2C2E3D',
  'buildings.destination': '#3A3947',
  'buildings.extrusion': '#343646',
  'buildings.contactShadow': '#121522',
  'buildings.fill': '#2C2E3D',
  'buildings.generic': '#2C2E3D',
  'buildings.industrial': '#2C2E3D',
  'buildings.outline': '#3A3C49',
  'buildings.residential': '#2C2E3D',
  'buildings.shadow': '#121522',
  'hydro.depth.m0': '#13192FA8',
  'hydro.depth.m200': '#0F162CA8',
  'hydro.depth.m2000': '#0B1328A8',
  'hydro.depth.m7000': '#081022A8',
  'hydro.ferry': '#8799BE',
  'hydro.label': '#8799BE',
  'hydro.ocean': '#13192F',
  'hydro.water': '#18223B',
  'hydro.waterway': '#18223B',
  'labels.aerodrome': '#8296E6',
  'labels.country': '#A6A7AC',
  'labels.ferry': '#8799BE',
  'labels.ferryHalo': '#18223B',
  'labels.halo': '#252839',
  'labels.placeHalo': '#252839',
  'labels.roadHalo': '#252839',
  'labels.muted': '#8F9098',
  'labels.neighborhood': '#8F9098',
  'labels.overview': '#B2B1B7',
  'labels.poi': '#B8B7BD',
  'labels.primary': '#A6A7AC',
  'labels.road': '#D0D0D6',
  'labels.settlement': '#A6A7AC',
  'labels.shield.dark': '#1B1D27',
  'labels.shield.light': '#FFFFFF',
  'labels.strong': '#D0D0D6',
  'labels.water': '#8799BE',
  'labels.waterHalo': 'rgba(37, 40, 57, 0.82)',
  'landcover.barren': '#303344',
  'landcover.farmland': '#3B4943',
  'landcover.flowerbed': '#4D5D54',
  'landcover.global.barren': '#303344',
  'landcover.global.crop': '#3B4943',
  'landcover.global.grass': '#3E4B47',
  'landcover.global.shrub': '#374440',
  'landcover.global.snow': '#3A4550',
  'landcover.global.trees': '#34453F',
  'landcover.global.urban': '#2D3043',
  'land.fence': '#55595C',
  'land.wall': '#5E6164',
  'landcover.hedge': '#3B4943',
  'landcover.hedgeShade': '#303E38',
  'landcover.grass': '#3E4B47',
  'landcover.greenspace': '#4D5D54',
  'landcover.greenspaceDark': '#44504C',
  'landcover.ice': '#3A4550',
  'landcover.meadow': '#3E4B47',
  'landcover.protected': '#394842',
  'landcover.recreationGround': '#485650',
  'landcover.rock': '#343646',
  'landcover.sand': '#52503E',
  'landcover.scrub': '#374440',
  'landcover.urbanPark': '#4D5D54',
  'landcover.villageGreen': '#46564D',
  'landcover.wetland': '#33474A',
  'landcover.wood': '#34453F',
  'landuse.businessCorridor': '#45424E',
  'landuse.businessCorridorOutline': '#5A5561',
  'landuse.cemetery': '#45534D',
  'landuse.civic': '#2D3043',
  'landuse.commercial': '#45424E',
  'landuse.education': '#434247',
  'landuse.government': '#2D3043',
  'landuse.industrial': '#2A314B',
  'landuse.medical': '#453D48',
  'landuse.military': '#2D3043',
  'landuse.parking': '#393B49',
  'landuse.parkingOutline': '#555867',
  'landuse.railway': '#2A314B',
  'landuse.recreation': '#485650',
  'landuse.recreationOutline': '#63756A',
  'landuse.residential': '#2D3043',
  'poi.arts-entertainment': '#C786BC',
  'poi.education': '#B6A783',
  'poi.food-drink': '#D8BD65',
  'poi.halo': '#252839',
  'poi.icon': '#8F9098',
  'poi.label': '#B8B7BD',
  'poi.landmark': '#C786BC',
  'poi.lodging': '#AA94DA',
  'poi.medical': '#DC7C89',
  'poi.park-nature': '#89B871',
  'poi.public-services': '#8F9098',
  'poi.religion': '#9DAAB0',
  'poi.retail': '#94BCE3',
  'poi.sport-leisure': '#89B871',
  'poi.transport': '#8296E6',
  'poi.visitor-amenity': '#8F9098',
  'roads.bridge': '#636779',
  'roads.casing': '#454A59',
  'roads.city.casing': '#373B49',
  'roads.city.minor': '#4C505E',
  'roads.city.primary': '#636779',
  'roads.city.secondary': '#565A68',
  'roads.city.tertiary': '#505462',
  'roads.city.tunnel': '#464A57',
  'roads.city.tunnelCasing': '#393D4B',
  'roads.cycleway': '#5F9169',
  'roads.default': '#636779',
  'roads.default.casing': '#454A59',
  'roads.default.tunnel': '#525664',
  'roads.ferry': '#8799BE',
  'roads.major': '#70768A',
  'roads.minor': '#636779',
  'roads.motorway': '#70768A',
  'roads.motorway.casing': '#454A59',
  'roads.motorway.tunnel': '#5F6475',
  'roads.parkPath': '#4D5852',
  'roads.path': '#454956',
  'roads.path.casing': '#373A46',
  'roads.path.transition': '#4E5260',
  'roads.path.tunnel': '#3D414D',
  'roads.pedestrian.surface': '#434856',
  'roads.primary': '#636779',
  'roads.rail': '#7C7F8C',
  'roads.railTransit': '#777B89',
  'roads.secondary': '#636779',
  'roads.sidewalk.surface': 'rgba(255, 255, 255, 0.06)',
  'roads.trunk': '#6F7188',
  'roads.trunk.casing': '#505264',
  'roads.trunk.tunnel': '#5B5D70',
  'roads.tunnel': '#525664',
  'surface.background': '#2D3043',
  'surface.building': '#2C2E3D',
  'surface.land': '#2D3043',
  'surface.park': '#34453F',
  'surface.water': '#18223B',
  'terrain.hillshade.accent': '#252D36',
  'terrain.hillshade.highlight': '#576374',
  'terrain.hillshade.shadow': '#101827',
  'transit.primary': '#8296E6',
  'vegetation.tree.bark': '#52483D',
  'vegetation.tree.broadleaf.a': '#35473F',
  'vegetation.tree.broadleaf.b': '#3D5047',
  'vegetation.tree.broadleaf.c': '#45594E',
  'vegetation.tree.broadleaf.d': '#4D6255',
  'vegetation.tree.conifer.a': '#304139',
  'vegetation.tree.conifer.b': '#384A40',
  'vegetation.tree.conifer.c': '#405348',
} as const;

type StreetsColor = {a: number; b: number; g: number; r: number};
type StreetsColorSet = Readonly<Record<string, string>>;

function parseStreetsColor(value: string): StreetsColor {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!;
    const expanded =
      digits.length < 5 ? [...digits].map((digit) => digit + digit).join('') : digits;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i.exec(
      value,
    );
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  throw new Error(`Unsupported Streets theme color: ${value}`);
}

function formatStreetsColor({a, b, g, r}: StreetsColor, format: string): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  if (format.startsWith('rgba')) {
    return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Number(a.toFixed(3))})`;
  }
  const hex = (value: number) => channel(value).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}${format.length === 9 ? hex(a * 255) : ''}`;
}

function adjustStreetsColors(
  colors: StreetsColorSet,
  transform: (role: string, color: StreetsColor) => StreetsColor,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colors).map(([role, value]) => [
      role,
      formatStreetsColor(transform(role, parseStreetsColor(value)), value),
    ]),
  );
}

function grayscale(color: StreetsColor): StreetsColor {
  const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  return {...color, r: gray, g: gray, b: gray};
}

function isDarkStreetsPreset(preset: StreetsLightPreset): boolean {
  return preset === 'dusk' || preset === 'night';
}

/** Keep the differences within a cartographic family around its observed surface anchor. */
function transferStreetsColor(
  color: StreetsColor,
  from: string,
  to: string,
  monochrome: boolean,
): StreetsColor {
  const source = parseStreetsColor(from);
  const target = parseStreetsColor(to);
  if (monochrome) {
    const gray = grayscale(color).r + target.r - grayscale(source).r;
    return {...color, r: gray, g: gray, b: gray};
  }
  return {
    ...color,
    r: color.r + target.r - source.r,
    g: color.g + target.g - source.g,
    b: color.b + target.b - source.b,
  };
}

function calibratedStreetsColors(
  preset: StreetsLightPreset,
  theme: StreetsColorTheme,
): Record<string, string> {
  const dark = isDarkStreetsPreset(preset);
  const base = dark ? streetsDarkColors : streetsLightColors;
  const profile = streetsSurfaceProfiles[`${theme}-${preset}`];
  const trees = streetsTreeProfiles[`${theme}-${preset}`];
  const roadCasings = streetsRoadCasingProfiles[`${theme}-${preset}`];
  const baseline = streetsSurfaceProfiles[dark ? 'default-night' : 'default-day'];
  const monochrome = theme === 'monochrome';
  const colors = adjustStreetsColors(base, (role, color) => {
    // White/black sign artwork and the translucent pavement overlay are authored inks,
    // not ground surfaces. A surface offset would discolor signs and turn black overlays gray.
    if (role.startsWith('labels.shield.') || role === 'roads.sidewalk.surface') return color;
    const shift = (from: string, to: string) => transferStreetsColor(color, from, to, monochrome);
    const foreground = () => (monochrome ? grayscale(color) : color);
    const water = () => shift(baseline.pool, profile.pool);
    if (role === 'vegetation.tree.bark') return {...parseStreetsColor(trees.bark), a: color.a};
    if (role.startsWith('vegetation.tree.')) {
      const anchor = parseStreetsColor(trees.crown);
      const varied = shift(base['vegetation.tree.broadleaf.b'], trees.crown);
      // Compress species variation near black instead of clipping the darkest conifers
      // to black. Every crown retains detail in the independently dark night profiles.
      const variation = Math.min(1, Math.min(anchor.r, anchor.g, anchor.b) / 20);
      return {
        ...varied,
        r: anchor.r + (varied.r - anchor.r) * variation,
        g: anchor.g + (varied.g - anchor.g) * variation,
        b: anchor.b + (varied.b - anchor.b) * variation,
      };
    }
    if (role === 'buildings.extrusion')
      return {...parseStreetsColor(profile.extrusion), a: color.a};
    if (role.startsWith('buildings.businessCorridor'))
      return shift(base['landuse.commercial'], profile.commercial);
    if (role.startsWith('buildings.') || role === 'surface.building')
      return shift(base['buildings.fill'], profile.building);
    if (role === 'labels.ferryHalo') return water();
    if (
      (role.startsWith('hydro.') && !['hydro.ferry', 'hydro.label'].includes(role)) ||
      role === 'surface.water'
    )
      return water();
    if (
      role === 'poi.halo' ||
      role === 'boundaries.halo' ||
      role === 'labels.halo' ||
      role.endsWith('Halo')
    )
      // Halos are independent foreground aids. Transfer the observed preset change,
      // preserving their established day/night inks instead of treating them as ground.
      return shift(baseline.land, profile.land);
    if (
      role.startsWith('labels.') ||
      role.startsWith('poi.') ||
      role.startsWith('boundaries.') ||
      role === 'hydro.ferry' ||
      role === 'hydro.label' ||
      role === 'roads.ferry' ||
      role.startsWith('transit.')
    )
      return foreground();
    if (role === 'roads.pedestrian.surface') return shift(baseline.land, profile.land);
    // Border appearance depends on its own zero-emission lighting, not the fill's offset.
    if (role === 'roads.motorway.casing')
      return {...parseStreetsColor(roadCasings.motorway), a: color.a};
    if (role === 'roads.trunk.casing') return {...parseStreetsColor(roadCasings.trunk), a: color.a};
    if (role === 'roads.path.casing') return {...parseStreetsColor(roadCasings.path), a: color.a};
    if (
      [
        'roads.casing',
        'roads.default.casing',
        'roads.city.casing',
        'roads.city.tunnelCasing',
      ].includes(role)
    )
      return {...parseStreetsColor(roadCasings.generic), a: color.a};
    if (role.startsWith('roads.')) return shift(base['roads.default'], profile.road);
    if (role.startsWith('landuse.recreation'))
      return shift(base['landuse.recreation'], profile.sport);
    if (role.startsWith('landuse.businessCorridor') || role === 'landuse.commercial')
      return shift(base['landuse.commercial'], profile.commercial);
    const green =
      role.startsWith('landcover.') && !/(?:^|\.)(?:barren|ice|rock|sand|snow|urban)$/.test(role);
    if (green || role === 'surface.park' || role === 'landuse.cemetery')
      return shift(base['landcover.urbanPark'], profile.green);
    if (
      role.startsWith('surface.') ||
      role.startsWith('landuse.') ||
      role.startsWith('landcover.') ||
      role.startsWith('land.')
    )
      return shift(base['surface.background'], profile.land);
    return foreground();
  });
  return {...colors, 'roads.detail.casing': roadCasings.hd};
}

function streetsPaletteColors(preset: StreetsLightPreset, colorTheme: StreetsColorTheme) {
  const palette: Record<string, string> = {
    ...calibratedStreetsColors(preset, colorTheme),
    ...streetsCartographyColors(colorTheme, preset),
    ...(colorTheme === 'default' && preset === 'day' ? streetsDayRoadFillColors : {}),
  };
  return {
    ...palette,
    // The parts building models name water, vegetation and wood take the map's water and trees.
    'buildings.modelWater': palette['hydro.water']!,
    'buildings.modelVegetation': palette['vegetation.tree.broadleaf.b']!,
    'buildings.modelWood': palette['vegetation.tree.bark']!,
    'buildings.floodLight': !isDarkStreetsPreset(preset)
      ? '#FFFFFF'
      : colorTheme === 'monochrome'
        ? '#E5E5E5'
        : colorTheme === 'faded'
          ? '#F8E4C4'
          : '#F5CFA8',
    ...streetsModelLighting(preset, colorTheme).colors,
    ...streetsBuildingColors(palette['buildings.extrusion']!, isDarkStreetsPreset(preset)),
    ...streetsSkyTokens(preset, colorTheme).colors,
  };
}

function streetsLightingNumbers(preset: StreetsLightPreset, colorTheme: StreetsColorTheme) {
  const dark = isDarkStreetsPreset(preset);
  return {
    'buildings.floodLight.intensity': dark && colorTheme !== 'monochrome' ? 0.3 : 0,
    // Light colours already include the Faded lookup table; lamp activation uses the
    // corresponding untransformed brightness, independently of that appearance change.
    'buildings.floodLight.brightnessScale':
      colorTheme === 'faded'
        ? {day: 1, dawn: 0.9203658119566795, dusk: 0.47333738050439994, night: 0.42688225390661877}[
            preset
          ]
        : 1,
    ...streetsModelLighting(preset, colorTheme).numbers,
    ...streetsSkyTokens(preset, colorTheme).numbers,
  };
}

const streetsFonts = {
  default: 'Noto Sans Regular',
  navigation: 'DINish Medium',
  shield: 'DINish Bold',
  places: 'Noto Sans Bold',
  regular: 'Noto Sans Regular',
  water: 'Noto Sans Italic',
} as const;

const streetsImages = {
  ...Object.fromEntries(
    ['round', 'open', 'tall', 'conifer', 'columnar', 'palm-feather', 'palm-fan'].map((form) => [
      `vegetation.tree.${form}`,
      `streets-tree-${form}`,
    ]),
  ),
  'roads.crosswalk': 'crosswalk',
  'roads.oneway': 'oneway',
  'roads.shield.circleNeutral': 'road-shield-circle-neutral',
  'roads.shield.rectangleBlue': 'road-shield-rectangle-blue',
  'roads.shield.rectangleGreen': 'road-shield-rectangle-green',
  'roads.shield.rectangleNeutral': 'road-shield-rectangle-neutral',
  'roads.shield.rectangleOrange': 'road-shield-rectangle-orange',
  'roads.shield.rectangleRed': 'road-shield-rectangle-red',
  'roads.shield.rectangleYellow': 'road-shield-rectangle-yellow',
  'roads.sidewalkPattern': 'sidewalk-dot',
} as const;

const streetsLightTheme = defineTheme({
  id: 'streets-light',
  version: 1,
  colorScheme: 'light',
  tokens: {
    color: streetsPaletteColors('day', 'default'),
    number: streetsLightingNumbers('day', 'default'),
    font: streetsFonts,
    image: {...streetsImages, ...streetsPoiImageTokens('light')},
  },
  typography: {
    font: token.font('default'),
    places: {font: token.font('places')},
    poi: {font: token.font('default')},
    roads: {font: token.font('default')},
    water: {font: token.font('default')},
  },
  lighting: {
    ...streetsLighting.default.day,
    // Retain a gentle native-extrusion fallback; the scene uses sun and ambient.
    anchor: 'map',
    color: '#FFFFFF',
    intensity: 0.08,
    position: [1.15, 180, 20],
  },
});
const streetsDarkTheme = defineTheme({
  id: 'streets-dark',
  version: 1,
  colorScheme: 'dark',
  tokens: {
    color: streetsPaletteColors('night', 'default'),
    number: streetsLightingNumbers('night', 'default'),
    font: streetsFonts,
    image: {
      ...streetsImages,
      ...streetsPoiImageTokens('dark'),
      ...Object.fromEntries(
        Object.entries(streetsImages)
          .filter(([role]) => role.startsWith('vegetation.tree.'))
          .map(([role, image]) => [role, `${image}-dark`]),
      ),
      'roads.sidewalkPattern': 'sidewalk-dot-dark',
    },
  },
  typography: {
    font: token.font('default'),
    places: {font: token.font('places')},
    poi: {font: token.font('default')},
    roads: {font: token.font('default')},
    water: {font: token.font('default')},
  },
  lighting: {
    ...streetsLighting.default.night,
    // Keep the native-extrusion fallback neutral: its shading does not normalize
    // illumination against authored paint as the custom scene renderer does.
    anchor: 'map',
    color: '#FFFFFF',
    intensity: 0.08,
    position: [1.15, 270, 20],
  },
});

function defineStreetsPaletteTheme(
  name: string,
  preset: StreetsLightPreset,
  colorTheme: StreetsColorTheme,
) {
  const isDark = isDarkStreetsPreset(preset);
  const imageVariant =
    colorTheme === 'monochrome' ? (isDark ? 'monochrome-dark' : 'monochrome') : undefined;
  return defineTheme(isDark ? streetsDarkTheme : streetsLightTheme, {
    id: `streets-${name}`,
    version: 1,
    colorScheme: isDark ? 'dark' : 'light',
    lighting: streetsLighting[colorTheme][preset],
    tokens: {
      color: streetsPaletteColors(preset, colorTheme),
      number: streetsLightingNumbers(preset, colorTheme),
      ...(imageVariant ? {image: streetsPoiImageTokens(imageVariant)} : {}),
    },
  });
}

// Mapbox exposes lighting presets and color themes as independent controls. Tileflow themes are
// complete snapshots, so include each combination while keeping the familiar light/dark names.
export const streetsThemes = Object.freeze(
  streetsCartographyThemes({
    light: streetsLightTheme,
    dark: streetsDarkTheme,
    dawn: defineStreetsPaletteTheme('dawn', 'dawn', 'default'),
    dusk: defineStreetsPaletteTheme('dusk', 'dusk', 'default'),
    faded: defineStreetsPaletteTheme('faded', 'day', 'faded'),
    monochrome: defineStreetsPaletteTheme('monochrome', 'day', 'monochrome'),
    'dawn-faded': defineStreetsPaletteTheme('dawn-faded', 'dawn', 'faded'),
    'dawn-monochrome': defineStreetsPaletteTheme('dawn-monochrome', 'dawn', 'monochrome'),
    'dusk-faded': defineStreetsPaletteTheme('dusk-faded', 'dusk', 'faded'),
    'dusk-monochrome': defineStreetsPaletteTheme('dusk-monochrome', 'dusk', 'monochrome'),
    'dark-faded': defineStreetsPaletteTheme('dark-faded', 'night', 'faded'),
    'dark-monochrome': defineStreetsPaletteTheme('dark-monochrome', 'night', 'monochrome'),
  }),
);

/** Theme references consumed by the shared Streets semantic modules. */
export const streetsVisual = {
  boundary: {
    admin: token.color('boundaries.admin'),
    halo: token.color('boundaries.halo'),
    regional: token.color('boundaries.regional'),
    overviewLabel: token.color('labels.overview'),
  },
  building: {
    contactShadow: token.color('buildings.contactShadow'),
    extrusion: token.color('buildings.extrusion'),
    fill: token.color('buildings.fill'),
    outline: token.color('buildings.outline'),
    shadow: token.color('buildings.shadow'),
  },
  terrain: {
    accent: token.color('terrain.hillshade.accent'),
    highlight: token.color('terrain.hillshade.highlight'),
    shadow: token.color('terrain.hillshade.shadow'),
  },
  hydro: {
    depth0: token.color('hydro.depth.m0'),
    depth200: token.color('hydro.depth.m200'),
    depth2000: token.color('hydro.depth.m2000'),
    depth7000: token.color('hydro.depth.m7000'),
    ocean: token.color('hydro.ocean'),
    water: token.color('hydro.water'),
    overview: token.color('hydro.water.overview'),
    regional: token.color('hydro.water.regional'),
    waterway: token.color('hydro.waterway'),
  },
  label: {
    address: token.color('labels.address'),
    aerodrome: token.color('labels.aerodrome'),
    country: token.color('labels.country'),
    ferry: token.color('labels.ferry'),
    ferryHalo: token.color('labels.ferryHalo'),
    halo: token.color('labels.halo'),
    muted: token.color('labels.muted'),
    neighborhood: token.color('labels.neighborhood'),
    overview: token.color('labels.overview'),
    poi: token.color('labels.poi'),
    primary: token.color('labels.primary'),
    road: token.color('labels.road'),
    settlement: token.color('labels.settlement'),
    shieldDark: token.color('labels.shield.dark'),
    shieldLight: token.color('labels.shield.light'),
    strong: token.color('labels.strong'),
    water: token.color('labels.water'),
    waterHalo: token.color('labels.waterHalo'),
    placeHalo: token.color('labels.placeHalo'),
    roadHalo: token.color('labels.roadHalo'),
  },
  landcover: Object.fromEntries(
    [
      'barren',
      'farmland',
      'flowerbed',
      'grass',
      'greenspace',
      'greenspaceDark',
      'ice',
      'meadow',
      'protected',
      'recreationGround',
      'rock',
      'sand',
      'scrub',
      'urbanPark',
      'villageGreen',
      'wetland',
      'wood',
    ].map((name) => [name, token.color(`landcover.${name}`)]),
  ),
  globalLandcover: Object.fromEntries(
    ['barren', 'crop', 'grass', 'shrub', 'snow', 'trees', 'urban'].map((name) => [
      name,
      token.color(`landcover.global.${name}`),
    ]),
  ),
  landuse: Object.fromEntries(
    [
      'businessCorridor',
      'businessCorridorOutline',
      'cemetery',
      'civic',
      'commercial',
      'education',
      'government',
      'industrial',
      'medical',
      'military',
      'parking',
      'parkingOutline',
      'railway',
      'recreation',
      'recreationOutline',
      'residential',
    ].map((name) => [name, token.color(`landuse.${name}`)]),
  ),
  poi: Object.fromEntries(
    [
      'arts-entertainment',
      'education',
      'food-drink',
      'halo',
      'icon',
      'label',
      'landmark',
      'lodging',
      'medical',
      'park-nature',
      'public-services',
      'religion',
      'retail',
      'sport-leisure',
      'transport',
      'visitor-amenity',
    ].map((name) => [name, token.color(`poi.${name}`)]),
  ),
  road: {
    casing: token.color('roads.default.casing'),
    detailCasing: token.color('roads.detail.casing'),
    cityCasing: token.color('roads.city.casing'),
    cityMinor: token.color('roads.city.minor'),
    cityPrimary: token.color('roads.city.primary'),
    citySecondary: token.color('roads.city.secondary'),
    cityTertiary: token.color('roads.city.tertiary'),
    cityTunnel: token.color('roads.city.tunnel'),
    cityTunnelCasing: token.color('roads.city.tunnelCasing'),
    cycleway: token.color('roads.cycleway'),
    default: token.color('roads.default'),
    ferry: token.color('roads.ferry'),
    motorway: token.color('roads.motorway'),
    motorwayCasing: token.color('roads.motorway.casing'),
    motorwayTunnel: token.color('roads.motorway.tunnel'),
    parkPath: token.color('roads.parkPath'),
    path: token.color('roads.path'),
    pathCasing: token.color('roads.path.casing'),
    pathTransition: token.color('roads.path.transition'),
    pathTunnel: token.color('roads.path.tunnel'),
    pedestrianSurface: token.color('roads.pedestrian.surface'),
    primary: token.color('roads.primary'),
    rail: token.color('roads.rail'),
    railTransit: token.color('roads.railTransit'),
    sidewalkSurface: token.color('roads.sidewalk.surface'),
    trunk: token.color('roads.trunk'),
    trunkCasing: token.color('roads.trunk.casing'),
    trunkTunnel: token.color('roads.trunk.tunnel'),
    tunnel: token.color('roads.default.tunnel'),
  },
  surface: {
    background: token.color('surface.background'),
    backgroundOverview: token.color('surface.background.overview'),
    building: token.color('surface.building'),
    land: token.color('surface.land'),
    park: token.color('surface.park'),
    water: token.color('surface.water'),
  },
  transit: token.color('transit.primary'),
  barrier: {
    fence: token.color('land.fence'),
    hedge: token.color('landcover.hedge'),
    hedgeShade: token.color('landcover.hedgeShade'),
    wall: token.color('land.wall'),
  },
  tree: {
    bark: token.color('vegetation.tree.bark'),
    broadleaf: ['a', 'b', 'c', 'd'].map((suffix) =>
      token.color(`vegetation.tree.broadleaf.${suffix}`),
    ),
    conifer: ['a', 'b', 'c'].map((suffix) => token.color(`vegetation.tree.conifer.${suffix}`)),
  },
  image: {
    crosswalk: token.image('roads.crosswalk'),
    oneway: token.image('roads.oneway'),
    shieldCircleNeutral: token.image('roads.shield.circleNeutral'),
    shieldRectangleBlue: token.image('roads.shield.rectangleBlue'),
    shieldRectangleGreen: token.image('roads.shield.rectangleGreen'),
    shieldRectangleNeutral: token.image('roads.shield.rectangleNeutral'),
    shieldRectangleOrange: token.image('roads.shield.rectangleOrange'),
    shieldRectangleRed: token.image('roads.shield.rectangleRed'),
    shieldRectangleYellow: token.image('roads.shield.rectangleYellow'),
    sidewalkPattern: token.image('roads.sidewalkPattern'),
  },
  font: {
    default: token.font('default'),
    navigation: token.font('navigation'),
    shield: token.font('shield'),
    places: token.font('places'),
    regular: token.font('regular'),
    water: token.font('water'),
  },
} as const;
