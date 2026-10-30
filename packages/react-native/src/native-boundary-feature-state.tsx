import {VectorSource, type VectorSourceRef} from '@maplibre/maplibre-react-native';
import {type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {
  createBoundaryFeatureState,
  tileflowBoundaryFamilies,
  type TileflowBoundaryFeatureState,
} from '@tileflow/core/native';
import type {MapBoundaryFeatureState} from './contract';
import {
  createNativeBoundaryFeatureStateOwner,
  declaredVectorSource,
  type NativeBoundaryStyle,
} from './native-boundary-feature-state-owner';

/**
 * Keeps `boundaryFeatureState` on the style's own Boundaries source with the same controller as the
 * web. MapLibre React Native adopts an existing style source by ID, so the source is only named
 * here, never declared again. It is mounted once a style that declares it has loaded, and stays
 * mounted across theme changes, which MapLibre React Native re-adopts after each style load.
 */
export function NativeBoundaryFeatureState({
  input,
  style,
  loaded,
}: {
  input: MapBoundaryFeatureState;
  style: NativeBoundaryStyle;
  loaded: boolean;
}): ReactElement | null {
  const family = input.family ?? 'boundaries';
  const sourceId = Object.hasOwn(tileflowBoundaryFamilies, family)
    ? tileflowBoundaryFamilies[family].sourceId
    : family;
  const owner = useMemo(() => createNativeBoundaryFeatureStateOwner(sourceId), [sourceId]);
  const [controller, setController] = useState<TileflowBoundaryFeatureState | null>(null);
  const [adopted, setAdopted] = useState(false);
  const bind = useCallback(
    (node: VectorSourceRef | null) => {
      owner.setSource(node);
      setAdopted(node !== null);
    },
    [owner],
  );

  useLayoutEffect(() => owner.setStyle(style, loaded), [owner, style, loaded]);

  const {labels, state, values} = input;
  useEffect(() => {
    const created = createBoundaryFeatureState(owner.map, {
      family,
      ...(labels === undefined ? {} : {labels}),
      ...(state === undefined ? {} : {state}),
    });
    setController(created);
    return () => {
      setController(null);
      created.dispose();
    };
  }, [owner, family, labels, state]);

  useEffect(() => {
    if (!controller) return;
    if (values) controller.set(values);
    else controller.clear();
  }, [controller, values]);

  // Mounting before the declaring style has loaded would make MapLibre create a second source.
  if (!declaredVectorSource(style, sourceId) || (!loaded && !adopted)) return null;
  const tiles = (style.sources?.[sourceId] as {tiles?: unknown}).tiles;
  // Adoption ignores `tiles`; it only keeps MapLibre from failing if a style ever omitted the source.
  return (
    <VectorSource
      id={sourceId}
      ref={bind}
      {...(Array.isArray(tiles) ? {tiles: tiles as string[]} : {})}
    />
  );
}
