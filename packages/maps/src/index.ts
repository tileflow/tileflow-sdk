import {freezeOfficialMap} from './official/freeze';
import {soundings as soundingsDefinition} from './official/soundings';
import {streets as streetsDefinition} from './official/streets';
import {streetsThemes} from './official/streets-themes';
import {terrain as terrainDefinition} from './official/terrain';

export {soundingsIcons, streetsIcons, streetsFonts, streetsModels} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const streets = freezeOfficialMap(streetsDefinition);
export const soundings = freezeOfficialMap(soundingsDefinition);

export {streetsThemes};

export const terrain = freezeOfficialMap(terrainDefinition);
export {terrainThemes} from './official/terrain-themes';
export {terrainIcons} from './assets';
