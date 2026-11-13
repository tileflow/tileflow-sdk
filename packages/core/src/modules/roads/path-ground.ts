import type {TileflowLayerFamilyIR} from '../../cartography/domain-ir';
import {dataLayer} from '../../cartography/semantic-bindings';
import type {TileflowRoadsModuleConfig} from '../../types';

// Cycleways keep their own colour on green ground: it tells riders where they can ride.
const pathFill = /^roads\.classes\.(pathway|footway|pedestrian|steps)\.surface\.fill$/;

/**
 * Draw each surface path's stretches on green ground in `greenColor`, from World's `path_ground`
 * layer, just above the path's own fill. The path itself is unchanged: data without the layer
 * draws paths as usual.
 */
export function compilePathGroundFamilies(
  input: readonly TileflowLayerFamilyIR[],
  options: TileflowRoadsModuleConfig['pathGround'],
  hasPathGroundLayer: boolean,
): readonly TileflowLayerFamilyIR[] {
  if (!options || !hasPathGroundLayer || Number(options.opacity ?? 1) === 0) return input;
  const scale = Number(options.widthScale ?? 1);
  const scaled = (value: unknown) => {
    if (scale === 1) return value;
    if (
      Array.isArray(value) &&
      value[0] === 'interpolate' &&
      Array.isArray(value[2]) &&
      value[2][0] === 'zoom'
    )
      return value.map((v, i) => (i >= 4 && i % 2 === 0 ? ['*', v, scale] : v));
    return ['*', value ?? 1, scale];
  };
  return input.flatMap((family): TileflowLayerFamilyIR[] => {
    if (!pathFill.test(family.target)) return [family];
    // The stretch keeps the path's filter, width, dash and fields, so it lies exactly on the path.
    const target = `${family.target}.onGreen`;
    const width = family.style.appearance?.['line-width'];
    const appearance = {
      ...family.style.appearance,
      'line-color': options.greenColor,
      'line-opacity': Number(options.opacity ?? 1),
      ...(width === undefined && scale === 1 ? {} : {'line-width': scaled(width)}),
    };
    // Stretches on green share one colour, so their drawing order does not matter: they need no
    // `layer` or `level`, which path_ground does not publish.
    const {'line-sort-key': _sortKey, ...placement} = family.style.placement ?? {};
    const onGreen: TileflowLayerFamilyIR = {
      ...family,
      family: undefined,
      key: `${family.key}.onGreen`,
      target,
      feature: {...family.feature, dataLayer: dataLayer('pathGround')},
      style: {
        ...family.style,
        appearance,
        ...(family.style.placement ? {placement} : {}),
      },
      origins: family.origins.map((origin) => ({...origin, target})),
    };
    return [family, onGreen];
  });
}
