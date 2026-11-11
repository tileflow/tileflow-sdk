import {useLayoutEffect, useMemo, useState} from 'react';
import {
  createTileflowBrandingController,
  readTileflowBrandingSources,
  type TileflowBrandingState,
} from '@tileflow/core/native';

type Style = Parameters<typeof readTileflowBrandingSources>[0];

/** Resolve before revealing the native surface; never mount a provisional paid logo. */
export function useCatalogBranding(style: Style) {
  const sources = useMemo(() => readTileflowBrandingSources(style), [style]);
  const key = JSON.stringify(sources);
  const initial: TileflowBrandingState = sources.some((source) => source.mapId)
    ? 'pending'
    : sources.length
      ? 'required'
      : 'none';
  const [result, setResult] = useState({key, state: initial});
  useLayoutEffect(() => {
    const controller = createTileflowBrandingController({
      mobile: true,
      onChange: (state) => setResult({key, state}),
    });
    controller.update(sources);
    return () => controller.dispose();
  }, [key, sources]);
  return result.key === key ? result.state : initial;
}
