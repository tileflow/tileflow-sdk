import {Map, type TileflowMapOptions} from '@tileflow/react';
import {useCallback, useEffect, useState} from 'react';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {installRideOverlays} from './map-overlays';
import {type RideScene, rideScenes, sceneFromPath} from './scenes';

const mapOptions = {
  bearing: 0,
  cooperativeGestures: false,
  fadeDuration: 0,
  maxPitch: 0,
  pitch: 0,
  transformRequest(url: string) {
    const hostname = new URL(url, window.location.href).hostname;
    return hostname === 'dev-tiles.tileflow.dev' ? {credentials: 'include', url} : {url};
  },
} satisfies TileflowMapOptions;

export function App() {
  const [scene, setScene] = useState(() => sceneFromPath(window.location.pathname));

  useEffect(() => {
    const syncScene = () => setScene(sceneFromPath(window.location.pathname));
    window.addEventListener('popstate', syncScene);
    return () => window.removeEventListener('popstate', syncScene);
  }, []);

  const selectScene = useCallback((nextScene: RideScene) => {
    window.history.pushState({}, '', nextScene.path);
    setScene(nextScene);
  }, []);

  const handleLoad = useCallback(
    (map: MapLibreMap) => {
      installRideOverlays(map, scene);
    },
    [scene],
  );

  return (
    <main className={`ride-map ride-map--${scene.id}`}>
      <Map
        captureId={scene.id}
        center={[...scene.center]}
        height="100dvh"
        key={scene.id}
        map="uber"
        mapOptions={mapOptions}
        onLoad={handleLoad}
        styleBaseUrl="/tileflow"
        zoom={scene.zoom}
      />

      {scene.id === 'uber-nyc' ? (
        <button
          aria-label="Show Los Angeles"
          className="back-control"
          onClick={() => selectScene(rideScenes[0])}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
      ) : null}

      <nav aria-label="Ride map examples" className="scene-picker">
        {rideScenes.map((candidate) => (
          <button
            aria-current={candidate.id === scene.id ? 'page' : undefined}
            key={candidate.id}
            onClick={() => selectScene(candidate)}
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </nav>
    </main>
  );
}
