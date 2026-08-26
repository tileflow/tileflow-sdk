import {tileflowInteractionLimits, tileflowInteractionSchemaVersion} from './contracts';

/** Compact machine-readable vocabulary for agents and code generators. */
export const tileflowInteractionReference = Object.freeze({
  actions: ['open-popup', 'close-popup'],
  annotationKinds: ['marker'],
  contentKinds: ['text', 'field', 'view'],
  entrypoints: ['@tileflow/interactions', '@tileflow/interactions/maplibre'],
  eventTypes: [
    'target:enter',
    'target:leave',
    'target:focus',
    'target:blur',
    'target:activate',
    'popup:open',
    'popup:close',
  ],
  limits: tileflowInteractionLimits,
  semanticDomains: ['poi'],
  state: {popup: 'TileflowInteractionTargetRef | null'},
  targetAvailability: {
    annotation: {
      binding: 'reserved',
      inlineSurfaces: 'available',
      stateReference: 'available',
    },
    map: 'reserved',
    'semantic-feature': {availableDomains: ['poi']},
    'style-layer': 'reserved',
  },
  targetKinds: ['annotation', 'semantic-feature', 'style-layer', 'map'],
  version: tileflowInteractionSchemaVersion,
} as const);
