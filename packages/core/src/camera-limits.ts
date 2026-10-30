/**
 * The steepest camera pitch Tileflow supports, in degrees from looking straight down. Every
 * portable view admits pitch 0–85, and Tileflow's maps raise MapLibre's own default of 60 to this,
 * so a street-level view looks along the street to the sky. A map's `mapOptions.maxPitch` lowers it.
 */
export const tileflowMaxPitch = 85;
