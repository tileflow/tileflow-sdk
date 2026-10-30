import {baedeker as baedekerDefinition} from './official/baedeker';
import {blueprint as blueprintDefinition} from './official/blueprint';
import {civica as civicaDefinition} from './official/civica';
import {freezeOfficialMap} from './official/freeze';
import {map1777 as map1777Definition} from './official/map-1777';
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
  map1777Fonts,
  map1777Icons,
  siegfriedFonts,
  siegfriedIcons,
  soundingsIcons,
  streetsIcons,
  streetsFonts,
  streetsModels,
} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const baedeker = freezeOfficialMap(baedekerDefinition);
export const civica = freezeOfficialMap(civicaDefinition);
export const streets = freezeOfficialMap(streetsDefinition);
export const map1777 = freezeOfficialMap(map1777Definition);
export const blueprint = freezeOfficialMap(blueprintDefinition);
export const siegfried = freezeOfficialMap(siegfriedDefinition);
export const soundings = freezeOfficialMap(soundingsDefinition);

export {streetsThemes};
export {siegfriedThemes} from './official/siegfried-themes';
