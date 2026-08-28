import {streetsThemes} from '@tileflow/maps';

export const fixtureLightTheme = streetsThemes.light;

export const fixtureThemeFields = {
  defaultTheme: 'light',
  themes: {light: fixtureLightTheme},
} as const;
