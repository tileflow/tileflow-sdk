import type {StreetsColorTheme, StreetsLightPreset} from './streets-theme-colors';

// Authored materials calibrated against the 2026-10-18 tilted Standard references.
// Bark is independent of foliage and ground vegetation. These are shader inputs, not
// screenshot RGB: vertical trunks lose more light than upward-facing crown facets.
// Crown is the broadleaf B shade; the theme retains its species and per-tree variation.
export const streetsTreeProfiles = {
  'default-day': {bark: '#C3D3B1', crown: '#96C498'},
  'default-dawn': {bark: '#BCBC94', crown: '#97B37F'},
  'default-dusk': {bark: '#564B43', crown: '#3D4538'},
  'default-night': {bark: '#0E1D28', crown: '#0E1D24'},
  'faded-day': {bark: '#DBE3CC', crown: '#ACD0B1'},
  'faded-dawn': {bark: '#D2D3B7', crown: '#ADCA9B'},
  'faded-dusk': {bark: '#686A63', crown: '#535E57'},
  'faded-night': {bark: '#232D44', crown: '#22333E'},
  'monochrome-day': {bark: '#E5E5E5', crown: '#CBCBCB'},
  'monochrome-dawn': {bark: '#CFCFCF', crown: '#C3C3C3'},
  'monochrome-dusk': {bark: '#353535', crown: '#323232'},
  'monochrome-night': {bark: '#0E0E0E', crown: '#0C0C0C'},
} as const satisfies Record<
  `${StreetsColorTheme}-${StreetsLightPreset}`,
  Readonly<{bark: string; crown: string}>
>;
