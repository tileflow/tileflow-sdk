import {roundNumber, stripUndefined} from './canonical';
import {
  type StaticCoordinate,
  type StaticOverlay,
  type StaticOverlayInput,
  staticOverlaySchema,
} from './scene-contract';

export function normalizeStaticOverlay(overlay: StaticOverlayInput): StaticOverlay {
  const parsed = staticOverlaySchema.parse(overlay);
  const normalized = stripUndefined({...parsed}) as Record<string, unknown>;

  if ('coordinate' in normalized) {
    normalized.coordinate = normalizeStaticCoordinate(normalized.coordinate as StaticCoordinate);
  }

  if ('coordinates' in normalized) {
    normalized.coordinates = normalizeStaticCoordinates(normalized.coordinates);
  }

  return normalized as StaticOverlay;
}

export function normalizeStaticCoordinate(coordinate: StaticCoordinate): StaticCoordinate {
  return [roundNumber(coordinate[0]), roundNumber(coordinate[1])];
}

function normalizeStaticCoordinates(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return normalizeStaticCoordinate(value as StaticCoordinate);
  }

  return value.map(normalizeStaticCoordinates);
}
