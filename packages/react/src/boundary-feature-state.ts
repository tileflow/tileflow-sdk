'use client';

import {useEffect, useState} from 'react';
import type {Map as MapLibreMap} from 'maplibre-gl';
import type {TileflowBoundaryValues} from '@tileflow/core';
import {
  createBoundaryFeatureState,
  type CreateBoundaryFeatureStateOptions,
  type TileflowBoundaryFeatureState,
} from '@tileflow/core/browser';

/**
 * Keep a map's Boundaries feature-state equal to `values`. Pass the map from `<Map onLoad>` and
 * memoize `values`; each new object replaces the previous values. `null` clears them.
 */
export function useBoundaryFeatureState(
  map: MapLibreMap | null | undefined,
  values: TileflowBoundaryValues | null | undefined,
  options: CreateBoundaryFeatureStateOptions = {},
): void {
  const {family, labels, state} = options;
  const [controller, setController] = useState<TileflowBoundaryFeatureState | null>(null);

  useEffect(() => {
    if (!map) return undefined;
    const created = createBoundaryFeatureState(map, {
      ...(family === undefined ? {} : {family}),
      ...(labels === undefined ? {} : {labels}),
      ...(state === undefined ? {} : {state}),
    });
    setController(created);
    return () => {
      setController(null);
      created.dispose();
    };
  }, [map, family, labels, state]);

  useEffect(() => {
    if (!controller) return;
    if (values) controller.set(values);
    else controller.clear();
  }, [controller, values]);
}
