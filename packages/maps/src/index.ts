import {cyberpunk as cyberpunkDefinition} from './official/cyberpunk';
import {ferraris as ferrarisDefinition} from './official/ferraris';
import {freezeOfficialMap} from './official/freeze';
import {harad as haradDefinition} from './official/harad';
import {matrix as matrixDefinition} from './official/matrix';
import {siegfried as siegfriedDefinition} from './official/siegfried';
import {soundings as soundingsDefinition} from './official/soundings';
import {streets as streetsDefinition} from './official/streets';
import {streetsThemes} from './official/streets-themes';
import {verdant as verdantDefinition} from './official/verdant';

export {
  cyberpunkFonts,
  cyberpunkIcons,
  ferrarisIcons,
  haradIcons,
  matrixFonts,
  matrixIcons,
  siegfriedFonts,
  siegfriedIcons,
  soundingsIcons,
  streetsIcons,
  verdantIcons,
} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const streets = freezeOfficialMap(streetsDefinition);
export const ferraris = freezeOfficialMap(ferrarisDefinition);
export const harad = freezeOfficialMap(haradDefinition);
export const matrix = freezeOfficialMap(matrixDefinition);
export const siegfried = freezeOfficialMap(siegfriedDefinition);
export const soundings = freezeOfficialMap(soundingsDefinition);
export const cyberpunk = freezeOfficialMap(cyberpunkDefinition);
export const verdant = freezeOfficialMap(verdantDefinition);

export {streetsThemes};
export {siegfriedThemes} from './official/siegfried-themes';
