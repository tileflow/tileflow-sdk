import type {StreetsColorTheme, StreetsLightPreset} from './streets-theme-colors';

// Standard's 2026-10-08 style, evaluated 2026-10-18 with its theme LUT and unshadowed
// ground lighting. These are displayed colors, not the reference's raw paint values:
// carriageway borders have zero emissive strength, unlike the brighter road interiors.
// Paths retain their separate emissive treatment. The independent test fixture records
// the inputs and equations. HD casing is shared by carriageway classes from zoom 15.
const standardRoadCasingProfiles = {
  'default-dawn': {
    generic: '#A49CA0',
    motorway: '#86898E',
    trunk: '#887D8D',
    hd: '#999695',
    path: '#D6B9A7',
  },
  'default-day': {
    generic: '#9EA9C5',
    motorway: '#8195AF',
    trunk: '#8387AD',
    hd: '#93A3B7',
    path: '#D0C6C6',
  },
  'default-dusk': {
    generic: '#2D2D45',
    motorway: '#24283D',
    trunk: '#25243C',
    hd: '#292C40',
    path: '#514B59',
  },
  'default-night': {
    generic: '#1C2137',
    motorway: '#171D31',
    trunk: '#171B30',
    hd: '#1A2033',
    path: '#3E3F4D',
  },
  'faded-dawn': {
    generic: '#BFBEC2',
    motorway: '#A4ABB2',
    trunk: '#A69FB0',
    hd: '#B5B8B8',
    path: '#EAD7C8',
  },
  'faded-day': {
    generic: '#BAC4DA',
    motorway: '#9FB0C8',
    trunk: '#A0A4C6',
    hd: '#AFBECF',
    path: '#E4DCDC',
  },
  'faded-dusk': {
    generic: '#454B66',
    motorway: '#3B445D',
    trunk: '#3B3F5C',
    hd: '#414961',
    path: '#6A6978',
  },
  'faded-night': {
    generic: '#333B58',
    motorway: '#2B3551',
    trunk: '#2C3250',
    hd: '#303954',
    path: '#575A6D',
  },
  'monochrome-dawn': {
    generic: '#C5C5C5',
    motorway: '#B2B2B2',
    trunk: '#B4B4B4',
    hd: '#BBBBBB',
    path: '#D6D6D6',
  },
  'monochrome-day': {
    generic: '#D3D3D3',
    motorway: '#BEBEBE',
    trunk: '#C0C0C0',
    hd: '#C8C8C8',
    path: '#E5E5E5',
  },
  'monochrome-dusk': {
    generic: '#3E3E3E',
    motorway: '#383838',
    trunk: '#393939',
    hd: '#3B3B3B',
    path: '#434343',
  },
  'monochrome-night': {
    generic: '#161616',
    motorway: '#141414',
    trunk: '#141414',
    hd: '#151515',
    path: '#181818',
  },
} as const satisfies Record<
  `${StreetsColorTheme}-${StreetsLightPreset}`,
  Readonly<Record<'generic' | 'motorway' | 'trunk' | 'hd' | 'path', string>>
>;

export const streetsRoadCasingProfiles = standardRoadCasingProfiles;
