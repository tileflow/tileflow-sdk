import {defineMap, type TileflowThemeConfig} from '@tileflow/core';
import {
  defineModuleEffects,
  getResolvedModuleEffects,
  type TileflowModuleEffect,
} from '@tileflow/core/recipe';
import {streetsDarkIcons, streetsIcons} from '../assets';
import {streets, streetsTheme} from './streets';

/**
 * Midnight Graphite is a deliberately authored night palette. It keeps the
 * Streets geometry, zoom hierarchy, density, and typography intact while
 * moving every map-owned physical color into a low-chroma dark system.
 *
 * The map currently predates theme-color references in exact module styles,
 * so the official variant remaps the complete resolved Streets recipe rather
 * than pretending that `theme.mode = "dark"` can recolor those exact values.
 * Unknown colors fail closed during module initialization: a future Streets
 * color cannot silently leak into the dark map without an editorial decision.
 */
const streetsDarkColorMap = new Map<string, string>([
  ['#000000', '#E8EDF3'],
  ['#0093F659', '#05182AA8'],
  ['#0F9D82', '#55C5A7'],
  ['#0FB7FF59', '#071D32A8'],
  ['#3C3834', '#E8EDF3'],
  ['#43869A', '#75AFC4'],
  ['#48556B', '#CBD5E1'],
  ['#50AD90', '#3D806E'],
  ['#5474D4', '#8FA8FF'],
  ['#63C6FE59', '#09243AA8'],
  ['#66CC6F', '#55A86C'],
  ['#77A77E', '#203A31'],
  ['#7A45CC', '#BE9BFF'],
  ['#7D8F9B', '#9AA9B8'],
  ['#8296B0', '#38475D'],
  ['#8588AD', '#35435C'],
  ['#87B58A', '#294237'],
  ['#87BA8C', '#284236'],
  ['#8C78F6', '#A694FF'],
  ['#8F8E79', '#3A3228'],
  ['#98C399', '#314A3C'],
  ['#98C89A', '#2F4B3C'],
  ['#99DDFF', '#10324B'],
  ['#99DDFF59', '#10324BA8'],
  ['#9CE495', '#3F6C49'],
  ['#9FAAC6', '#263449'],
  ['#A1B0C4', '#687993'],
  ['#A3A6C2', '#62718F'],
  ['#AAD4A7', '#365441'],
  ['#ACADB1', '#070B12'],
  ['#B3EBAD', '#285033'],
  ['#B8DDB1', '#3C5B46'],
  ['#BDEEB4', '#294934'],
  ['#BFC2C6', '#3A4655'],
  ['#BFC6D9', '#45536A'],
  ['#C0CAD8', '#536177'],
  ['#C2C4D6', '#4F5B76'],
  ['#C2EFBE', '#20382B'],
  ['#C3F1D5', '#315444'],
  ['#C5EBC2', '#263D2C'],
  ['#C6E8D2', '#254034'],
  ['#C9C0BC', '#2C3949'],
  ['#C9F1C6', '#18353A'],
  ['#CCE2CA', '#1F352A'],
  ['#CFD5DC', '#4C5A70'],
  ['#D0F4C2', '#29452F'],
  ['#D1C7C7', '#263043'],
  ['#D3F1C6', '#253C2E'],
  ['#D7DCE1', '#445267'],
  ['#DADEE2', '#3B485D'],
  ['#DED7D3', '#202B3A'],
  ['#DEDFE7', '#283548'],
  ['#DFE3EC', '#3D4B60'],
  ['#E3F4D2', '#21382F'],
  ['#E556C2', '#E99BDB'],
  ['#E6DCC5', '#40382F'],
  ['#EF8840', '#F0A06B'],
  ['#EFEBEF', '#3A4657'],
  ['#F04455', '#FF7D8D'],
  ['#F0E6D1', '#342E27'],
  ['#F0EDED', '#222B38'],
  ['#F0FBEF', '#1B2F29'],
  ['#F3F1F4', '#465164'],
  ['#F4EBD7', '#3A3326'],
  ['#F5F1F0', '#151E2D'],
  ['#F5FAFC', '#223341'],
  ['#F8F7F8', '#424E60'],
  ['#F9F4E8', '#2D2929'],
  ['#FAFAFA', '#28313E'],
  ['#FBFAF8', '#1B2533'],
  ['#FDFDFD', '#2B3544'],
  ['#FF668C', '#9A6177'],
  ['#FF809F', '#80566C'],
  ['#FFFFFF', '#0B1220'],
  ['hsl(0, 0%, 65%)', '#68778B'],
  ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
  ['rgba(255, 255, 255, 0.5)', 'rgba(11, 18, 32, 0.78)'],
]);

const colorLiteralPattern = /^(?:#[0-9a-f]+|hsla?\(|rgba?\()/i;

function recolorStreetsValue<T>(value: T, path = 'streets'): T {
  if (typeof value === 'string') {
    const replacement = streetsDarkColorMap.get(value);
    if (replacement !== undefined) return replacement as T;
    if (colorLiteralPattern.test(value)) {
      throw new Error(`Streets Dark has no reviewed color for ${value} at ${path}.`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => recolorStreetsValue(entry, `${path}[${index}]`)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        recolorStreetsValue(entry, `${path}.${key}`),
      ]),
    ) as T;
  }

  return value;
}

const streetsDarkTheme = recolorStreetsValue({
  ...streetsTheme,
  mode: 'dark',
}) satisfies TileflowThemeConfig;

const streetsDarkModules = recolorStreetsValue(streets.modules, 'streets.modules');
const streetsDarkEffects = recolorStreetsValue<readonly TileflowModuleEffect[]>(
  getResolvedModuleEffects(streets),
  'streets.effects',
);

export const streetsDark = defineMap({
  id: 'streets-dark',
  version: 1,
  name: 'Streets Dark',
  extends: streets,
  icons: [streetsIcons, streetsDarkIcons],
  light: {
    anchor: 'viewport',
    color: '#9FB6D0',
    intensity: 0.08,
    position: [1.15, 210, 30],
  },
  theme: streetsDarkTheme,
  modules: streetsDarkModules,
  ...defineModuleEffects(streetsDarkEffects),
});
