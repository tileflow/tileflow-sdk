import {freezeOfficialMap} from './official/freeze';
import {nautical as nauticalDefinition} from './official/nautical';
import {outdoors as outdoorsDefinition} from './official/outdoors';
import {streets as streetsDefinition} from './official/streets';
import {streetsThemes} from './official/streets-themes';

export {soundingsIcons, streetsGlyphs, streetsIcons, streetsModels} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const streets = freezeOfficialMap(streetsDefinition);
export const nautical = freezeOfficialMap(nauticalDefinition);
/** @deprecated Use `nautical`. */
export const soundings = nautical;

export {streetsThemes};

export const outdoors = freezeOfficialMap(outdoorsDefinition);
export {outdoorsThemes} from './official/outdoors-themes';
export {outdoorsIcons} from './assets';
