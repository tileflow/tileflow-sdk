import {streetsPoiPictograms} from '../src/official/streets-poi';

/** Every Streets POI image: each pictogram's light disc and its `-dark` variant. */
export const streetsPoiImageIds: readonly string[] = Object.keys(streetsPoiPictograms).flatMap(
  (id) => [id, `${id}-dark`],
);
