import {baedeker as baedekerDefinition} from './official/baedeker';
import {blueprint as blueprintDefinition} from './official/blueprint';
import {civica as civicaDefinition} from './official/civica';
import {ferraris as ferrarisDefinition} from './official/ferraris';
import {freezeOfficialMap} from './official/freeze';
import {harad as haradDefinition} from './official/harad';
import {siegfried as siegfriedDefinition} from './official/siegfried';
import {soundings as soundingsDefinition} from './official/soundings';
import {streets as streetsDefinition} from './official/streets';
import {streetsThemes} from './official/streets-themes';

export {
  baedekerFonts,
  baedekerIcons,
  blueprintIcons,
  civicaFonts,
  civicaIcons,
  ferrarisIcons,
  haradIcons,
  siegfriedFonts,
  siegfriedIcons,
  soundingsIcons,
  streetsIcons,
} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const baedeker = freezeOfficialMap(baedekerDefinition);
export const civica = freezeOfficialMap(civicaDefinition);
export const streets = freezeOfficialMap(streetsDefinition);
export const ferraris = freezeOfficialMap(ferrarisDefinition);
export const harad = freezeOfficialMap(haradDefinition);
export const blueprint = freezeOfficialMap(blueprintDefinition);
export const siegfried = freezeOfficialMap(siegfriedDefinition);
export const soundings = freezeOfficialMap(soundingsDefinition);

export {streetsThemes};
export {siegfriedThemes} from './official/siegfried-themes';
