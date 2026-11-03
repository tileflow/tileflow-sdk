import type {TileflowLayerFamilyIR} from '../../cartography/domain-ir';
import type {TileflowRoadsModuleConfig} from '../../types';

const pathTarget =
  /^roads\.classes\.(pathway|footway|pedestrian|steps|cycleway)\.(surface|bridge|tunnel)\.(fill|casing|shadow)$/;
export function compilePathGroundFamilies(
  input: readonly TileflowLayerFamilyIR[],
  options: TileflowRoadsModuleConfig['pathGround'],
) {
  if (!options || Number(options.opacity ?? 1) === 0) return {families: input, active: false};
  const scale = Number(options.widthScale ?? 1);
  const scaled = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value[0] === 'interpolate' &&
      Array.isArray(value[2]) &&
      value[2][0] === 'zoom'
    )
      return value.map((v, i) => (i >= 4 && i % 2 === 0 ? ['*', v, scale] : v));
    return ['*', value ?? 1, scale];
  };
  let active = false;
  let families = input.flatMap((family): TileflowLayerFamilyIR[] => {
    const match = pathTarget.exec(family.target);
    if (!match || match[2] !== 'surface') return [family];
    const [, kind, , phase] = match;
    const appearance = {...family.style.appearance};
    if (phase === 'casing') appearance['line-opacity'] = 0;
    else {
      appearance['line-color'] = options.groundColor;
      appearance['line-width'] = scaled(appearance['line-width']);
      appearance['line-opacity'] =
        kind === 'cycleway' && phase === 'fill' ? 0 : Number(options.opacity ?? 1);
    }
    const base = {...family, style: {...family.style, appearance}};
    if (phase === 'casing' || (kind === 'cycleway' && phase === 'fill')) return [base];
    active = true;
    // Each derived line retains the same filter and physical road fields. Only its
    // geometry is clipped to green polygons; the complete ground-coloured path stays below.
    const overlay: TileflowLayerFamilyIR = {
      ...base,
      family: undefined,
      key: base.key + '.onGreen',
      target: base.target + '.onGreen',
      feature: {...base.feature, dataSource: 'tileflow-path-ground'},
      style: {...base.style, appearance: {...appearance, 'line-color': options.greenColor}},
      origins: base.origins.map((origin) => ({...origin, target: base.target + '.onGreen'})),
    };
    return [base, overlay];
  });
  // Keep path strokes under carriageway casings within their own structure. All
  // vehicle fills still follow their casings, so their joins remain open.
  for (const structure of ['surface', 'bridge', 'tunnel']) {
    const move = (family: TileflowLayerFamilyIR) => {
      const match = pathTarget.exec(family.target.replace(/\.onGreen$/, ''));
      return (
        match?.[2] === structure &&
        (match[3] === 'fill' || (structure === 'surface' && match[3] === 'shadow'))
      );
    };
    const paths = families.filter(move);
    families = families.filter((f) => !move(f));
    const anchor = families.findIndex((f) =>
      new RegExp(
        `^roads\\.classes\\.(track|service|minor|tertiary|secondary|primary|trunk|motorway)\\.${structure}\\.casing$`,
      ).test(f.target),
    );
    if (anchor >= 0) families.splice(anchor, 0, ...paths);
    else families.push(...paths);
  }
  return {families, active};
}
