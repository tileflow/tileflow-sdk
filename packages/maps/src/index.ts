import {baedeker as baedekerDefinition} from './official/baedeker';
import {blueprint as blueprintDefinition} from './official/blueprint';
import {civica as civicaDefinition} from './official/civica';
import {cyberpunk as cyberpunkDefinition} from './official/cyberpunk';
import {ferraris as ferrarisDefinition} from './official/ferraris';
import {freezeOfficialMap} from './official/freeze';
import {harad as haradDefinition} from './official/harad';
import {matrix as matrixDefinition} from './official/matrix';
import {siegfried as siegfriedDefinition} from './official/siegfried';
import {soundings as soundingsDefinition} from './official/soundings';
import {streets as streetsDefinition} from './official/streets';
import {streetsThemes} from './official/streets-themes';
import {superTileWorld as superTileWorldDefinition} from './official/super-tile-world';
import {verdant as verdantDefinition} from './official/verdant';

export {
  baedekerFonts,
  baedekerIcons,
  blueprintIcons,
  civicaFonts,
  civicaIcons,
  cyberpunkFonts,
  cyberpunkIcons,
  ferrarisIcons,
  haradIcons,
  matrixFonts,
  matrixIcons,
  sanFrancistoIcons,
  siegfriedFonts,
  siegfriedIcons,
  soundingsIcons,
  streetsIcons,
  superTileWorldFonts,
  superTileWorldIcons,
  verdantIcons,
} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const baedeker = freezeOfficialMap(baedekerDefinition);
export const civica = freezeOfficialMap(civicaDefinition);
export const streets = freezeOfficialMap(streetsDefinition);
export const ferraris = freezeOfficialMap(ferrarisDefinition);
export const harad = freezeOfficialMap(haradDefinition);
/** @deprecated Use `terminal` from the GitHub-distributed @tileflow/community-maps package. */
export const matrix = freezeOfficialMap(matrixDefinition);
export const blueprint = freezeOfficialMap(blueprintDefinition);
/** @deprecated Use `blueprint`. This alias preserves the same map and stable identifiers. */
export const sanFrancisto = blueprint;
export const siegfried = freezeOfficialMap(siegfriedDefinition);
export const soundings = freezeOfficialMap(soundingsDefinition);
/** @deprecated Use `neonGrid` from the GitHub-distributed @tileflow/community-maps package. */
export const cyberpunk = freezeOfficialMap(cyberpunkDefinition);
export const verdant = freezeOfficialMap(verdantDefinition);
export const superTileWorld = freezeOfficialMap(superTileWorldDefinition);

export {streetsThemes};
export {siegfriedThemes} from './official/siegfried-themes';
