import {
  expression,
  type TileflowColorStyleValue,
  type TileflowTransitModuleOptions,
  zoom,
} from '@tileflow/core';

type MapboxRailTransitStyle = Pick<
  TileflowTransitModuleOptions,
  'rail' | 'railHatching' | 'serviceRail'
>;

/**
 * Mapbox Standard railway grammar: two longitudinal rails opened with a line
 * gap, followed by a wider zoom-dependent dash layer of perpendicular sleepers.
 * Palette stays map-specific while the physical railway design stays shared.
 */
export function mapboxRailTransitStyle(color: TileflowColorStyleValue): MapboxRailTransitStyle {
  const rail = () => ({
    cap: 'butt' as const,
    color,
    gapWidth: zoom.linear([
      [15, 0],
      [16, 1],
      [18, 2],
      [22, 20],
    ]),
    join: 'miter' as const,
    minZoom: 13,
    width: zoom.exponential(1.5, [
      [14, 0.5],
      [22, 2],
    ]),
  });
  const sleepers = () => ({
    cap: 'butt' as const,
    color,
    dash: expression<readonly number[]>([
      'step',
      ['zoom'],
      ['literal', [0.1, 15]],
      16,
      ['literal', [0.1, 1]],
      18,
      ['literal', [0.05, 0.5]],
    ]),
    join: 'miter' as const,
    minZoom: 13,
    opacity: zoom.linear([
      [13.75, 0],
      [14, 1],
    ]),
    width: zoom.exponential(1.5, [
      [16, 2],
      [18, 6],
      [20, 16],
      [22, 32],
    ]),
  });

  return {
    rail: {
      bridge: rail(),
      surface: rail(),
      tunnel: {visible: false},
    },
    railHatching: {
      bridge: sleepers(),
      surface: sleepers(),
      tunnel: {visible: false},
    },
    serviceRail: {
      bridge: rail(),
      surface: rail(),
      tunnel: {visible: false},
    },
  };
}
