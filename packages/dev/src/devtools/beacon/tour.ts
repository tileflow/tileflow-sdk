import type {Camera} from './audit';
import {percentile} from './audit';

/** Version this itinerary when coordinates, budgets or sampling rules change. */
export const activeTourProtocol = {
  id: 'active-tour-v1',
  budgetMs: 60_000,
  routeBudgetMs: 55_000,
  motionMs: 1200,
  settledMs: 2400,
  readinessMs: 2000,
} as const;
export type TourStop = {id: string; location: string; camera: Camera};
export type FrameSample = {
  frames: number;
  p95Ms?: number;
  longFrameRate?: number;
  maxMs?: number;
};
export function frameSample(frames: number[]): FrameSample {
  const values = frames.filter((n) => Number.isFinite(n) && n > 0);
  return {
    frames: values.length,
    ...(values.length >= 30
      ? {
          p95Ms: percentile(values, 0.95),
          longFrameRate: values.filter((n) => n > 50).length / values.length,
          maxMs: Math.max(...values),
        }
      : {}),
  };
}

export function activeTour(
  initial: Camera,
  limits: {
    minZoom: number;
    maxZoom: number;
    maxPitch: number;
    bounds?: [number, number, number, number];
  },
): {stops: TourStop[]; skipped: string[]} {
  const cities: {
    id: string;
    location: string;
    center: [number, number];
    overview: number;
    detail: number;
  }[] = [
    {
      id: 'current',
      location: 'Current view',
      center: initial.center,
      overview: Math.max(3, initial.zoom - 7),
      detail: initial.zoom,
    },
    {id: 'london', location: 'London · UK', center: [-0.1276, 51.5074], overview: 5, detail: 17},
    {
      id: 'new-york',
      location: 'New York · US',
      center: [-73.9857, 40.7484],
      overview: 9,
      detail: 15,
    },
    {id: 'tokyo', location: 'Tokyo · Japan', center: [139.7671, 35.6812], overview: 7, detail: 16},
    {
      id: 'nairobi',
      location: 'Nairobi · Kenya',
      center: [36.8219, -1.2921],
      overview: 10,
      detail: 14,
    },
    {
      id: 'sao-paulo',
      location: 'São Paulo · Brazil',
      center: [-46.6333, -23.5505],
      overview: 11,
      detail: 18,
    },
  ];
  const stops: TourStop[] = [],
    skipped: string[] = [];
  const zoom = (z: number) => Math.max(limits.minZoom, Math.min(limits.maxZoom, z));
  for (const [index, city] of cities.entries()) {
    const b = limits.bounds;
    if (
      index &&
      b &&
      (city.center[1] < b[1] ||
        city.center[1] > b[3] ||
        (b[0] <= b[2]
          ? city.center[0] < b[0] || city.center[0] > b[2]
          : city.center[0] < b[0] && city.center[0] > b[2]))
    ) {
      skipped.push(city.location);
      continue;
    }
    for (const [detail, z] of [
      [false, city.overview],
      [true, city.detail],
    ] as const) {
      stops.push({
        id: `${city.id}-${detail ? 'detail' : 'overview'}`,
        location: city.location,
        camera: {
          center: [...city.center],
          zoom: zoom(z),
          bearing: detail ? (index % 2 ? 25 : -25) : 0,
          pitch: detail ? Math.min(limits.maxPitch, 45) : 0,
        },
      });
    }
  }
  return {stops, skipped};
}
