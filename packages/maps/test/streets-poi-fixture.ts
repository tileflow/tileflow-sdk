import {streetsDayImages} from '../src/official/streets-day-colors';
import {streetsPoiPictograms} from '../src/official/streets-poi';
import {streetsTransitNetworks} from '../src/official/streets-transit-icons';

/** Every Streets POI image across the category-color and monochrome theme variants. */
export const streetsPoiImageIds: readonly string[] = [
  ...Object.keys(streetsPoiPictograms).flatMap((id) => [
    id,
    `${id}-dark`,
    `${id}-monochrome`,
    `${id}-monochrome-dark`,
  ]),
  ...new Set(Object.values(streetsDayImages)),
  ...streetsTransitNetworks.map(({id}) => id),
];
