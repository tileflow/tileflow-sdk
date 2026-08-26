import {cyberpunk as cyberpunkDefinition} from './official/cyberpunk';
import {ferraris as ferrarisDefinition} from './official/ferraris';
import {freezeOfficialMap} from './official/freeze';
import {streets as streetsDefinition} from './official/streets';
import {streetsDark as streetsDarkDefinition} from './official/streets-dark';
import {verdant as verdantDefinition} from './official/verdant';

export {
  cyberpunkFonts,
  cyberpunkIcons,
  ferrarisIcons,
  streetsDarkIcons,
  streetsIcons,
  verdantIcons,
} from './assets';

/** Immutable official map singletons. `defineMap` itself remains a mutable authoring identity. */
export const streets = freezeOfficialMap(streetsDefinition);
export const ferraris = freezeOfficialMap(ferrarisDefinition);
export const streetsDark = freezeOfficialMap(streetsDarkDefinition);
export const cyberpunk = freezeOfficialMap(cyberpunkDefinition);
export const verdant = freezeOfficialMap(verdantDefinition);
