import {defineTheme, token} from '@tileflow/core';
import {streetsPoiDiscColors, streetsPoiImageTokens} from './streets-poi';

// Tileflow-owned semantic colors, calibrated from rendered Mapbox Standard
// default/day and default/night references on 2026-10-14. Standard is evergreen;
// this dated snapshot keeps our public themes deterministic.
// Day surfaces use lossless 2D reference captures with buildings and trees
// disabled. Compare flat interiors separately from borders and translucent
// tunnels; browser screenshot JPEGs can shift the apparent surface palette.
/**
 * Streets' public visual vocabulary. Token IDs describe cartographic roles,
 * never physical layer IDs, so agents can edit the design without knowing the
 * compiler's layer topology.
 */
const streetsLightColors = {
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
  'vegetation.tree.broadleaf.a': '#83AD83',
  'vegetation.tree.broadleaf.b': '#91BA8D',
  'vegetation.tree.broadleaf.c': '#A1C99B',
  'vegetation.tree.broadleaf.d': '#AFD4A7',
  'vegetation.tree.conifer.a': '#729B78',
  'vegetation.tree.conifer.b': '#81A880',
  'vegetation.tree.conifer.c': '#91B68B',
} as const;

const streetsDarkColors = {
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
type StreetsLightPreset = 'day' | 'dawn' | 'dusk' | 'night';
type StreetsColorTheme = 'default' | 'faded' | 'monochrome';

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
  const hex = (value: number) => channel(value).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${format.length === 9 ? hex(a * 255) : ''}`;
}

function mixStreetsColor(color: StreetsColor, tint: string, amount: number): StreetsColor {
  const target = parseStreetsColor(tint);
  return {
    r: color.r + (target.r - color.r) * amount,
    g: color.g + (target.g - color.g) * amount,
    b: color.b + (target.b - color.b) * amount,
    a: color.a,
  };
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

function applyStreetsLightPreset(
  colors: StreetsColorSet,
  preset: StreetsLightPreset,
): Record<string, string> {
  if (preset === 'day' || preset === 'night') return {...colors};

  const dawn = preset === 'dawn';
  return adjustStreetsColors(colors, (role, color) => {
    if (
      role.startsWith('hydro.') ||
      role === 'boundaries.maritime' ||
      role === 'surface.water' ||
      role === 'labels.water' ||
      role === 'labels.waterHalo' ||
      role === 'labels.ferry' ||
      role === 'labels.ferryHalo'
    ) {
      return mixStreetsColor(color, dawn ? '#8EA9B8' : '#7893AA', dawn ? 0.24 : 0.2);
    }
    if (role.startsWith('roads.')) {
      return mixStreetsColor(color, dawn ? '#B8AEB0' : '#9698A8', dawn ? 0.17 : 0.2);
    }
    const greenLandcover =
      role.startsWith('landcover.') && !/(?:^|\.)(?:barren|ice|rock|sand|snow|urban)$/.test(role);
    if (
      greenLandcover ||
      role.startsWith('vegetation.tree.') ||
      role === 'surface.park' ||
      role === 'landuse.cemetery' ||
      role === 'landuse.recreation' ||
      role === 'landuse.recreationOutline'
    ) {
      return mixStreetsColor(color, dawn ? '#B9D5AB' : '#A6BDA8', dawn ? 0.13 : 0.17);
    }
    const halo = role === 'labels.halo' || role.endsWith('Halo') || role === 'poi.halo';
    if (role.startsWith('labels.') && !halo) {
      return mixStreetsColor(color, dawn ? '#514B48' : '#494A54', dawn ? 0.06 : 0.08);
    }
    if (halo) {
      return mixStreetsColor(color, dawn ? '#F2E3D7' : '#E5DFE4', dawn ? 0.23 : 0.18);
    }
    if (role.startsWith('landuse.parking')) {
      return mixStreetsColor(color, dawn ? '#D7D6D5' : '#CECFD7', dawn ? 0.16 : 0.2);
    }
    if (
      role.startsWith('buildings.') ||
      role.startsWith('landuse.') ||
      role.startsWith('surface.') ||
      role === 'boundaries.halo'
    ) {
      return mixStreetsColor(color, dawn ? '#F2E3D7' : '#E5DFE4', dawn ? 0.23 : 0.18);
    }
    return color;
  });
}

function applyStreetsColorTheme(
  colors: StreetsColorSet,
  theme: StreetsColorTheme,
  isDark: boolean,
): Record<string, string> {
  if (theme === 'default') return {...colors};
  if (theme === 'monochrome') {
    return adjustStreetsColors(colors, (_role, color) => {
      const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      return {...color, r: gray, g: gray, b: gray};
    });
  }

  const background = isDark ? '#292C3A' : '#F1F0ED';
  return adjustStreetsColors(colors, (_role, color) => {
    const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    const desaturated = {
      ...color,
      r: gray + (color.r - gray) * 0.52,
      g: gray + (color.g - gray) * 0.52,
      b: gray + (color.b - gray) * 0.52,
    };
    return mixStreetsColor(desaturated, background, isDark ? 0.08 : 0.12);
  });
}

// Keep category hue in the lettering without inheriting the brighter marker-disc ink.
// Apply after time/palette transforms so faded and dawn/dusk keep the same contrast budget.
function readableLabelColors(colors: StreetsColorSet): Record<string, string> {
  const result = {...colors};
  const luminance = (value: string) => {
    const color = parseStreetsColor(value);
    const linear = (v: number) =>
      v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
    return linear(color.r) * 0.2126 + linear(color.g) * 0.7152 + linear(color.b) * 0.0722;
  };
  const pairs = [
    ...Object.keys(streetsPoiDiscColors.light).map(
      (category) => [`poi.${category}`, 'poi.halo'] as const,
    ),
    ['labels.aerodrome', 'labels.halo'] as const,
  ];
  for (const [role, halo] of pairs) {
    const background = luminance(colors[halo]!);
    const contrast = (value: string) => {
      const foreground = luminance(value);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    };
    const toward = contrast('#000000') > contrast('#ffffff') ? '#000000' : '#ffffff';
    const value = colors[role];
    if (!value || contrast(value) >= 4.5) continue;
    const original = parseStreetsColor(value);
    for (let step = 1; step <= 100; step++) {
      const candidate = formatStreetsColor(mixStreetsColor(original, toward, step / 100), value);
      if (contrast(candidate) >= 4.6) {
        result[role] = candidate;
        break;
      }
    }
  }
  return result;
}

function streetsPaletteColors(preset: StreetsLightPreset, colorTheme: StreetsColorTheme) {
  const isDark = preset === 'night';
  const base = isDark ? streetsDarkColors : streetsLightColors;
  return readableLabelColors(
    applyStreetsColorTheme(applyStreetsLightPreset(base, preset), colorTheme, isDark),
  );
}

const streetsFonts = {
  // DIN Pro Medium has much lighter strokes than Noto Sans Bold. Of the
  // hosted Noto faces, Regular is the closer match for navigation and POIs.
  default: 'Noto Sans Regular',
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
    color: readableLabelColors(streetsLightColors),
    number: {},
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
    // A broad, high light keeps warm roofs bright and facades softly shaded.
    // Anchor it to the map so rotating the camera does not move the light.
    anchor: 'map',
    color: '#FFFFFF',
    intensity: 0.08,
    position: [1.15, 210, 30],
  },
});
const streetsDarkTheme = defineTheme({
  id: 'streets-dark',
  version: 1,
  colorScheme: 'dark',
  tokens: {
    color: readableLabelColors(streetsDarkColors),
    number: {},
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
    anchor: 'viewport',
    color: '#9FB6D0',
    intensity: 0.08,
    position: [1.15, 210, 30],
  },
});

function defineStreetsPaletteTheme(
  name: string,
  preset: StreetsLightPreset,
  colorTheme: StreetsColorTheme,
) {
  const isDark = preset === 'night';
  const imageVariant =
    colorTheme === 'monochrome' ? (isDark ? 'monochrome-dark' : 'monochrome') : undefined;
  return defineTheme(isDark ? streetsDarkTheme : streetsLightTheme, {
    id: `streets-${name}`,
    version: 1,
    colorScheme: isDark ? 'dark' : 'light',
    tokens: {
      color: streetsPaletteColors(preset, colorTheme),
      ...(imageVariant ? {image: streetsPoiImageTokens(imageVariant)} : {}),
    },
  });
}

// Mapbox exposes lighting presets and color themes as independent controls. Tileflow themes are
// complete snapshots, so include each combination while keeping the familiar light/dark names.
export const streetsThemes = Object.freeze({
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
});

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
  },
  label: {
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
    building: token.color('surface.building'),
    land: token.color('surface.land'),
    park: token.color('surface.park'),
    water: token.color('surface.water'),
  },
  transit: token.color('transit.primary'),
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
    places: token.font('places'),
    regular: token.font('regular'),
    water: token.font('water'),
  },
} as const;
