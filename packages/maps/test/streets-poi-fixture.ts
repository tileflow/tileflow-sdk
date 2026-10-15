import {streetsPoiPictograms} from '../src/official/streets-poi';

/** Every Streets POI image across the category-color and monochrome theme variants. */
export const streetsPoiImageIds: readonly string[] = Object.keys(streetsPoiPictograms).flatMap(
  (id) => [id, `${id}-dark`, `${id}-monochrome`, `${id}-monochrome-dark`],
);
