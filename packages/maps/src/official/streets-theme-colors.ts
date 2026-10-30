// Legacy JPEG surface anchors, observed 2026-10-17. Retained for supplemental inks and
// decorative variations only. The active ground, building and label materials are calibrated
// independently in streets-cartography-colors.ts, including framebuffer roof measurements.
// Pool samples here are historical; water no longer inherits their preset offsets.
export type StreetsLightPreset = 'day' | 'dawn' | 'dusk' | 'night';
export type StreetsColorTheme = 'default' | 'faded' | 'monochrome';
export type StreetsSurfaceProfile = Readonly<{
  building: string;
  /** Unshadowed roof colour for the scene-sun renderer. */
  extrusion: string;
  land: string;
  commercial: string;
  road: string;
  green: string;
  sport: string;
  pool: string;
}>;

export const streetsSurfaceProfiles = {
  'default-dawn': {
    extrusion: '#F6D7B8',
    building: '#EDD6B7',
    land: '#F8E3D0',
    commercial: '#F9DEC3',
    road: '#C2BCC0',
    green: '#BEDB9B',
    sport: '#D8E5AD',
    pool: '#A7C8CD',
  },
  'default-day': {
    extrusion: '#F1E8DF',
    building: '#EEEADE',
    land: '#F4F0EF',
    commercial: '#FBEDE2',
    road: '#BFC4D7',
    green: '#BDE8B2',
    sport: '#D7F2C5',
    pool: '#A7D9FA',
  },
  'default-dusk': {
    extrusion: '#4B434E',
    building: '#333037',
    land: '#444051',
    commercial: '#574B57',
    road: '#6D7083',
    green: '#546158',
    sport: '#5C6C61',
    pool: '#2D3B56',
  },
  'default-night': {
    extrusion: '#2C2E3D',
    building: '#262932',
    land: '#2C2F42',
    commercial: '#44414C',
    road: '#616679',
    green: '#43544E',
    sport: '#4E5F55',
    pool: '#172339',
  },
  'faded-dawn': {
    extrusion: '#FAEAD3',
    building: '#F5E9D3',
    land: '#FDF1E3',
    commercial: '#FCEFDC',
    road: '#D9D7D8',
    green: '#D8EBBD',
    sport: '#EBF1CD',
    pool: '#C4E2E0',
  },
  'faded-day': {
    extrusion: '#F5F0EC',
    building: '#F4F1EA',
    land: '#F8F6F7',
    commercial: '#FBF4EC',
    road: '#D7DBE7',
    green: '#D4F0CA',
    sport: '#E8F6DC',
    pool: '#C0EAFA',
  },
  'faded-dusk': {
    extrusion: '#61606E',
    building: '#4B4B55',
    land: '#5D5E70',
    commercial: '#6F6975',
    road: '#878A9D',
    green: '#6B7A77',
    sport: '#75847F',
    pool: '#485973',
  },
  'faded-night': {
    extrusion: '#44495D',
    building: '#3D404F',
    land: '#454B61',
    commercial: '#5D5A6B',
    road: '#798093',
    green: '#5C6A6B',
    sport: '#667676',
    pool: '#2B3C5A',
  },
  'monochrome-dawn': {
    extrusion: '#EAEAEA',
    building: '#E3E3E3',
    land: '#F3F3F3',
    commercial: '#E9E9E9',
    road: '#DADADA',
    green: '#DFDFDF',
    sport: '#EBEBEB',
    pool: '#CACACA',
  },
  'monochrome-day': {
    extrusion: '#FAFAFA',
    building: '#F9F9F9',
    land: '#FFFFFF',
    commercial: '#F9F9F9',
    road: '#E6E6E6',
    green: '#EEEEEE',
    sport: '#FAFAFA',
    pool: '#D8D8D8',
  },
  'monochrome-dusk': {
    extrusion: '#4A4A4A',
    building: '#363636',
    land: '#545454',
    commercial: '#464646',
    road: '#646464',
    green: '#4F4F4F',
    sport: '#515151',
    pool: '#393939',
  },
  'monochrome-night': {
    extrusion: '#1A1A1A',
    building: '#131313',
    land: '#262626',
    commercial: '#202020',
    road: '#414141',
    green: '#242424',
    sport: '#252525',
    pool: '#0E0E0E',
  },
} as const satisfies Record<`${StreetsColorTheme}-${StreetsLightPreset}`, StreetsSurfaceProfile>;
