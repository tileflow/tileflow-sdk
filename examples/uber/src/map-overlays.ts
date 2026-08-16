import maplibregl, {type Map as MapLibreMap, type Marker, type MarkerOptions} from 'maplibre-gl';
import type {Coordinate, RideScene, RideVehicle} from './scenes';

const routeSourceId = 'uber-route';

export function installRideOverlays(map: MapLibreMap, scene: RideScene): () => void {
  const markers: Marker[] = [];

  map.addSource(routeSourceId, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: scene.route.map(([longitude, latitude]) => [longitude, latitude]),
          },
        },
      ],
    },
  });
  map.addLayer({
    id: 'uber-route-halo',
    type: 'line',
    source: routeSourceId,
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {
      'line-color': '#FFFFFF',
      'line-opacity': 0.92,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 15, 9],
    },
  });
  map.addLayer({
    id: 'uber-route-line',
    type: 'line',
    source: routeSourceId,
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {
      'line-color': '#101213',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5],
    },
  });

  for (const vehicle of scene.vehicles) {
    markers.push(addMarker(map, vehicle.coordinate, createVehicle(vehicle)));
  }

  markers.push(
    addMarker(
      map,
      scene.destination.coordinate,
      createDestination(scene.destination.kind),
      scene.destination.kind === 'flag' ? 'bottom-left' : 'bottom',
    ),
  );

  if (scene.pickup) {
    markers.push(addMarker(map, scene.pickup, createPickup(), 'bottom'));
  }

  if (scene.tripCard) {
    markers.push(
      addMarker(
        map,
        scene.tripCard.coordinate,
        createTripCard(scene.tripCard.minutes, scene.tripCard.destination),
        'right',
        [-18, 35],
      ),
    );
  }

  const dispose = () => {
    for (const marker of markers) marker.remove();
    if (map.getLayer('uber-route-line')) map.removeLayer('uber-route-line');
    if (map.getLayer('uber-route-halo')) map.removeLayer('uber-route-halo');
    if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
  };
  map.once('remove', dispose);
  return dispose;
}

function addMarker(
  map: MapLibreMap,
  [longitude, latitude]: Coordinate,
  element: HTMLElement,
  anchor: NonNullable<MarkerOptions['anchor']> = 'center',
  offset?: [number, number],
): Marker {
  return new maplibregl.Marker({anchor, element, ...(offset ? {offset} : {})})
    .setLngLat([longitude, latitude])
    .addTo(map);
}

function createVehicle(vehicle: RideVehicle): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ride-vehicle';
  root.setAttribute('aria-label', vehicle.label ? `Vehicle ${vehicle.label.text}` : 'Vehicle');

  const car = document.createElement('span');
  car.className = 'ride-vehicle__car';
  car.style.rotate = `${vehicle.bearing}deg`;
  car.style.scale = String(vehicle.scale ?? 1);
  car.append(createPart('ride-vehicle__cabin'), createPart('ride-vehicle__shine'));
  root.append(car);

  if (vehicle.label) {
    const badge = document.createElement('span');
    badge.className = `ride-vehicle__label ride-vehicle__label--${vehicle.label.tone ?? 'dark'}`;
    badge.textContent = vehicle.label.text;
    badge.style.translate = `${vehicle.label.offset[0]}px ${vehicle.label.offset[1]}px`;
    root.append(badge);
  }

  return root;
}

function createDestination(kind: RideScene['destination']['kind']): HTMLElement {
  const element = document.createElement('div');
  element.className = `ride-destination ride-destination--${kind}`;
  element.setAttribute('aria-label', kind === 'home' ? 'Home destination' : 'Destination');

  if (kind === 'home') {
    element.append(createPart('ride-destination__center'));
  } else {
    element.append(createPart('ride-destination__flag'));
  }

  return element;
}

function createPickup(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'ride-pickup';
  element.setAttribute('aria-label', 'Pickup');
  element.append(createPart('ride-pickup__center'));
  return element;
}

function createTripCard(minutes: number, destination: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'trip-card';
  card.setAttribute('aria-label', `${minutes} minutes to ${destination}`);

  const eta = document.createElement('span');
  eta.className = 'trip-card__eta';
  eta.innerHTML = `<strong>${minutes}</strong><small>MIN</small>`;

  const label = document.createElement('span');
  label.className = 'trip-card__label';
  label.textContent = destination;

  const arrow = document.createElement('span');
  arrow.className = 'trip-card__arrow';
  arrow.setAttribute('aria-hidden', 'true');

  card.append(eta, label, arrow);
  return card;
}

function createPart(className: string): HTMLSpanElement {
  const part = document.createElement('span');
  part.className = className;
  return part;
}
