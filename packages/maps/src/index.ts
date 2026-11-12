import {freezeOfficialMap} from './official/freeze';
import {outdoors as outdoorsDefinition} from './official/outdoors';
import {soundings as soundingsDefinition} from './official/soundings';
import {streets as streetsDefinition} from './official/streets';
import {streetsThemes} from './official/streets-themes';

export {soundingsIcons, streetsGlyphs, streetsIcons, streetsModels} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const streets = freezeOfficialMap(streetsDefinition);
export const soundings = freezeOfficialMap(soundingsDefinition);

export {streetsThemes};

export const outdoors = freezeOfficialMap(outdoorsDefinition);
export {outdoorsThemes} from './official/outdoors-themes';
export {outdoorsIcons} from './assets';
