import {tileflowColourChannels} from './theme-blend';

/** MapLibre's extrusion light in tile coordinates (x east, y south, z up). */
export function tileflowBuildingStyleLight(value: unknown, bearing: number) {
  const light = (typeof value === 'object' && value !== null ? value : {}) as {
    anchor?: unknown;
    position?: unknown;
    color?: unknown;
    intensity?: unknown;
  };
  const position =
    Array.isArray(light.position) &&
    light.position.length === 3 &&
    light.position.every((part) => typeof part === 'number' && Number.isFinite(part))
      ? (light.position as [number, number, number])
      : [1.15, 210, 30];
  const [radius, azimuth, polar] = position as [number, number, number];
  const radians = Math.PI / 180;
  // Viewport-anchored light rotates with the map, just as native extrusions do.
  const angle = (azimuth + 90 + (light.anchor === 'map' ? 0 : bearing)) * radians;
  const horizontal = radius * Math.sin(polar * radians);
  const colour = typeof light.color === 'string' ? tileflowColourChannels(light.color) : null;
  return {
    position: [
      horizontal * Math.cos(angle),
      horizontal * Math.sin(angle),
      radius * Math.cos(polar * radians),
    ],
    colour: colour ? colour.slice(0, 3) : [1, 1, 1],
    intensity:
      typeof light.intensity === 'number' && Number.isFinite(light.intensity)
        ? Math.max(0, Math.min(1, light.intensity))
        : 0.5,
  };
}
