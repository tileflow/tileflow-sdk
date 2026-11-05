import type {CameraPadding, MapSource} from './native-map-contract';

export function padding(
  value?: number | readonly number[] | CameraPadding,
): CameraPadding | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number')
    return {paddingTop: value, paddingRight: value, paddingBottom: value, paddingLeft: value};
  if (!Array.isArray(value)) return value as CameraPadding;
  if (![1, 2, 4].includes(value.length) || value.some((item) => !Number.isFinite(item) || item < 0))
    throw new Error('Padding requires one, two or four non-negative numbers.');
  const [top, right = top, bottom = top, left = right] = value;
  return {paddingTop: top!, paddingRight: right!, paddingBottom: bottom!, paddingLeft: left!};
}

export function sourceJson(source: MapSource): string {
  if ('mapId' in source) return JSON.stringify({mapId: source.mapId});
  return JSON.stringify({
    map: source.map,
    manifestUrl: source.manifestUrl,
    ...(source.resourceOrigins ? {resourceOrigins: source.resourceOrigins} : {}),
    ...(source.allowsLoopbackHttp === undefined
      ? {}
      : {allowsLoopbackHttp: source.allowsLoopbackHttp}),
  });
}
