import type {z} from 'zod';
import {roundNumber} from './canonical';
import {normalizeStaticOverlay} from './overlay-normalization';
import {
  circleOverlaySchema,
  lineOverlaySchema,
  markerOverlaySchema,
  polygonOverlaySchema,
  type StaticOverlay,
  type StaticOverlayPlacement,
  symbolOverlaySchema,
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

export function symbol(input: Omit<z.input<typeof symbolOverlaySchema>, 'type'>): StaticOverlay {
  return normalizeStaticOverlay({...input, type: 'symbol'});
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
  const placements: Record<string, StaticOverlayPlacement> = {};
  const symbols: Array<{imageId: string; overlayIndex: number}> = [];

  const pushLayer = (layer: Record<string, unknown>, overlay: StaticOverlay) => {
    const layerId = String(layer.id);
    layers.push(layer);
    placements[layerId] = overlay.placement ?? 'above-labels';
  };

  for (const [index, overlay] of overlays.entries()) {
    const longitudeOffset = options.longitudeOffsets?.[index] ?? 0;
    const id = safeLayerId(`tileflow-static-overlay-${index + 1}-${overlay.id ?? overlay.type}`);
    const sourceId = `${id}-source`;

    if (overlay.type === 'line') {
      sources[sourceId] = {
        data: feature('LineString', shiftLongitudes(overlay.coordinates, longitudeOffset)),
        type: 'geojson',
      };
      pushLayer(
        {
          id,
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': overlay.color,
            'line-opacity': overlay.opacity,
            'line-width': overlay.width,
          },
          source: sourceId,
          type: 'line',
        },
        overlay,
      );
      continue;
    }

    if (overlay.type === 'polygon') {
      sources[sourceId] = {
        data: feature('Polygon', shiftLongitudes(overlay.coordinates, longitudeOffset)),
        type: 'geojson',
      };
      pushLayer(
        {
          id,
          paint: {
            'fill-color': overlay.fill,
            'fill-opacity': overlay.opacity,
          },
          source: sourceId,
          type: 'fill',
        },
        overlay,
      );

      if (overlay.stroke && overlay.strokeWidth > 0) {
        pushLayer(
          {
            id: `${id}-stroke`,
            layout: {'line-cap': 'round', 'line-join': 'round'},
            paint: {
              'line-color': overlay.stroke,
              'line-width': overlay.strokeWidth,
            },
            source: sourceId,
            type: 'line',
          },
          overlay,
        );
      }
      continue;
    }

    sources[sourceId] = {
      data: feature('Point', shiftLongitudes(overlay.coordinate, longitudeOffset)),
      type: 'geojson',
    };

    if (overlay.type === 'symbol') {
      const composed = overlay.label !== undefined;
      const imageId = composed
        ? safeLayerId(`__tileflow-static-symbol-${index + 1}-${overlay.id}`)
        : overlay.icon!;
      const alwaysVisible = overlay.collision === 'always-visible';
      const iconSize = composed ? 1 : overlay.scale;
      const iconOffset = composed
        ? overlay.offset
        : overlay.offset.map((value) => roundNumber(value / overlay.scale));

      pushLayer(
        {
          id,
          layout: {
            'icon-allow-overlap': alwaysVisible,
            'icon-anchor': overlay.anchor,
            'icon-ignore-placement': alwaysVisible,
            'icon-image': imageId,
            'icon-offset': iconOffset,
            'icon-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport',
            'icon-size': iconSize,
            'symbol-placement': 'point',
            'symbol-z-order': 'source',
          },
          paint: {'icon-opacity': overlay.opacity},
          source: sourceId,
          type: 'symbol',
        },
        overlay,
      );
      symbols.push({imageId, overlayIndex: index});
      continue;
    }

    pushLayer(
      {
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
      },
      overlay,
    );
  }

  return {layers, placements, sources, symbols};
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
