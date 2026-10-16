import type {Map as MapLibreMap} from 'maplibre-gl';

/** MapLibre's worker serializer requires plain objects from the map's own iframe realm. */
export function mapValue<T>(map: MapLibreMap, value: T): T {
  if (value === undefined) return value;
  const realm = map.getContainer?.()?.ownerDocument?.defaultView as
    (Window & {JSON: JSON}) | null | undefined;
  return (realm?.JSON ?? JSON).parse(JSON.stringify(value)) as T;
}
