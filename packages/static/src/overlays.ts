import type {z} from 'zod';
import {roundNumber} from './canonical';
import {normalizeStaticOverlay} from './overlay-normalization';
import {
  circleOverlaySchema,
  lineOverlaySchema,
  markerOverlaySchema,
  polygonOverlaySchema,
  type StaticOverlay,
} from './scene-contract';

export {staticOverlaySchema} from './scene-contract';
export type {StaticOverlay, StaticOverlayInput} from './scene-contract';

export function line(input: Omit<z.input<typeof lineOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeStaticOverlay({...input, type: 'line'});
}

export function circle(input: Omit<z.input<typeof circleOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeStaticOverlay({...input, type: 'circle'});
}

export function marker(input: Omit<z.input<typeof markerOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeStaticOverlay({...input, type: 'marker'});
}

export function polygon(input: Omit<z.input<typeof polygonOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeStaticOverlay({...input, type: 'polygon'});
}

export function compileStaticOverlays(
  overlays: StaticOverlay[],
  options: {longitudeOffsets?: readonly number[]} = {},
) {
  if (
    options.longitudeOffsets !== undefined &&
    (options.longitudeOffsets.length !== overlays.length ||
      options.longitudeOffsets.some(
        (offset) => !Number.isInteger(offset) || Math.abs(offset) > 360 || offset % 360 !== 0,
      ))
  ) {
    throw new Error(
      'Static overlay longitude offsets must contain one -360, 0, or 360 per overlay',
    );
  }

  const sources: Record<string, Record<string, unknown>> = {};
  const layers: Array<Record<string, unknown>> = [];

  for (const [index, overlay] of overlays.entries()) {
    const longitudeOffset = options.longitudeOffsets?.[index] ?? 0;
    const id = safeLayerId(`overlay-${index + 1}-${overlay.id ?? overlay.type}`);
    const sourceId = `${id}-source`;

    if (overlay.type === 'line') {
      sources[sourceId] = {
        data: feature('LineString', shiftLongitudes(overlay.coordinates, longitudeOffset)),
        type: 'geojson',
      };
      layers.push({
        id,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {
          'line-color': overlay.color,
          'line-opacity': overlay.opacity,
          'line-width': overlay.width,
        },
        source: sourceId,
        type: 'line',
      });
      continue;
    }

    if (overlay.type === 'polygon') {
      sources[sourceId] = {
        data: feature('Polygon', shiftLongitudes(overlay.coordinates, longitudeOffset)),
        type: 'geojson',
      };
      layers.push({
        id,
        paint: {
          'fill-color': overlay.fill,
          'fill-opacity': overlay.opacity,
        },
        source: sourceId,
        type: 'fill',
      });

      if (overlay.stroke && overlay.strokeWidth > 0) {
        layers.push({
          id: `${id}-stroke`,
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': overlay.stroke,
            'line-width': overlay.strokeWidth,
          },
          source: sourceId,
          type: 'line',
        });
      }
      continue;
    }

    sources[sourceId] = {
      data: feature('Point', shiftLongitudes(overlay.coordinate, longitudeOffset)),
      type: 'geojson',
    };
    layers.push({
      id,
      paint: {
        'circle-color': overlay.color,
        'circle-opacity': overlay.type === 'circle' ? overlay.opacity : 1,
        'circle-radius': overlay.radius,
        'circle-stroke-color': overlay.strokeColor ?? overlay.color,
        'circle-stroke-width': overlay.strokeWidth,
      },
      source: sourceId,
      type: 'circle',
    });
  }

  return {layers, sources};
}

function shiftLongitudes(value: unknown, offset: number): unknown {
  if (!Array.isArray(value)) return value;

  if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [roundNumber(value[0] + offset), value[1]];
  }

  return value.map((entry) => shiftLongitudes(entry, offset));
}

function feature(type: string, coordinates: unknown) {
  return {
    geometry: {coordinates, type},
    properties: {},
    type: 'Feature',
  };
}

function safeLayerId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}
