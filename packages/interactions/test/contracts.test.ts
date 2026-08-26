import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type TileflowInteractionContent,
  tileflowInteractionContentSchema,
  type TileflowInteractionTarget,
  type TileflowInteractionTargetRef,
  tileflowInteractionTargetRefSchema,
  tileflowInteractionTargetSchema,
  type TileflowAnnotation,
  tileflowAnnotationSchema,
  tileflowInteractionActionSchema,
  type TileflowInteractionBinding,
  tileflowInteractionBindingSchema,
  type TileflowInteractionState,
  tileflowInteractionStateSchema,
  tileflowInteractionReference,
} from '../src/index';

test('publishes machine-readable target availability for coding agents', () => {
  assert.deepEqual(tileflowInteractionReference.semanticDomains, ['poi']);
  assert.deepEqual(tileflowInteractionReference.targetAvailability, {
    annotation: {
      binding: 'reserved',
      inlineSurfaces: 'available',
      stateReference: 'available',
    },
    map: 'reserved',
    'semantic-feature': {availableDomains: ['poi']},
    'style-layer': 'reserved',
  });
});

test('accepts the three portable content descriptors', () => {
  const contents = [
    {kind: 'text', text: 'EUR 320,000'},
    {fallback: 'Unnamed', field: 'properties.name', kind: 'field'},
    {kind: 'view', name: 'property-card'},
  ] satisfies TileflowInteractionContent[];

  for (const content of contents) {
    assert.deepEqual(tileflowInteractionContentSchema.parse(content), content);
  }
});

test('accepts a typed JSON annotation with optional marker, tooltip, and popup', () => {
  type Property = {
    address: string;
    available: boolean;
    price: number;
  };

  const annotation = {
    ariaLabel: 'Apartment in Madrid',
    coordinate: [-3.7, 40.4],
    data: {address: 'Calle Mayor', available: true, price: 320_000},
    id: 'property-42',
    kind: 'marker',
    marker: {color: '#C6A15B', content: {kind: 'field', field: 'price'}},
    popup: {content: {kind: 'view', name: 'property-card'}},
    tooltip: {content: {kind: 'text', text: 'EUR 320,000'}},
  } satisfies TileflowAnnotation<Property>;

  assert.deepEqual(tileflowAnnotationSchema.parse(annotation), annotation);
});

// @ts-expect-error annotation data is constrained to the portable JSON contract.
type NonJsonAnnotation = TileflowAnnotation<Date>;
void (undefined as unknown as NonJsonAnnotation);

interface InterfaceProperty {
  price: number;
  title: string;
}
const interfaceDataAnnotation: TileflowAnnotation<InterfaceProperty> = {
  ariaLabel: 'Typed interface data',
  coordinate: [0, 0],
  data: {price: 1, title: 'One'},
  id: 'interface-data',
  kind: 'marker',
};
void interfaceDataAnnotation;

test('keeps annotation data optional while requiring an accessible name', () => {
  assert.equal(
    tileflowAnnotationSchema.safeParse({
      ariaLabel: 'Madrid',
      coordinate: [-3.7, 40.4],
      id: 'madrid',
      kind: 'marker',
    }).success,
    true,
  );
  assert.equal(
    tileflowAnnotationSchema.safeParse({
      coordinate: [-3.7, 40.4],
      id: 'madrid',
      kind: 'marker',
    }).success,
    false,
  );
});

test('rejects unsafe field selectors, non-JSON data, extra keys, and invalid coordinates', () => {
  for (const input of [
    {kind: 'field', field: '__proto__.polluted'},
    {kind: 'field', field: 'properties.constructor.name'},
  ]) {
    assert.equal(tileflowInteractionContentSchema.safeParse(input).success, false);
  }

  const base = {
    ariaLabel: 'Marker',
    coordinate: [0, 0],
    id: 'marker',
    kind: 'marker',
  } as const;
  assert.equal(
    tileflowAnnotationSchema.safeParse({...base, data: {value: undefined}}).success,
    false,
  );
  assert.equal(tileflowAnnotationSchema.safeParse({...base, extra: true}).success, false);
  assert.equal(tileflowAnnotationSchema.safeParse({...base, coordinate: [181, 0]}).success, false);
  assert.equal(
    tileflowAnnotationSchema.safeParse({
      ...base,
      marker: {color: 'url(https://example.invalid/tracker)'},
    }).success,
    false,
  );
});

test('accepts all selector targets and bindings without physical-layer knowledge by default', () => {
  const targets = [
    {id: 'property-42', kind: 'annotation'},
    {categories: ['restaurant', 'cafe'], domain: 'poi', kind: 'semantic-feature'},
    {kind: 'style-layer', layerId: 'application-owned-pois'},
    {kind: 'map'},
  ] satisfies TileflowInteractionTarget[];

  for (const target of targets) {
    assert.deepEqual(tileflowInteractionTargetSchema.parse(target), target);
  }

  const binding = {
    id: 'poi-details',
    popup: {content: {kind: 'view', name: 'poi-card'}},
    target: targets[1]!,
    tooltip: {content: {field: 'name', kind: 'field'}},
  } satisfies TileflowInteractionBinding;
  assert.deepEqual(tileflowInteractionBindingSchema.parse(binding), binding);
});

test('accepts all four stable target references used by popup state', () => {
  const targets = [
    {id: 'property-42', kind: 'annotation'},
    {domain: 'poi', featureId: 42, kind: 'semantic-feature'},
    {featureId: 'poi-42', kind: 'style-feature', layerId: 'pois'},
    {coordinate: [-3.7, 40.4], kind: 'map'},
  ] satisfies TileflowInteractionTargetRef[];

  for (const target of targets) {
    assert.deepEqual(tileflowInteractionTargetRefSchema.parse(target), target);
    const state = {popup: target} satisfies TileflowInteractionState;
    assert.deepEqual(tileflowInteractionStateSchema.parse(state), state);
    assert.equal(
      tileflowInteractionActionSchema.safeParse({target, type: 'open-popup'}).success,
      true,
    );
  }

  assert.equal(
    tileflowInteractionTargetRefSchema.safeParse({kind: 'semantic-feature', domain: 'poi'}).success,
    false,
  );
  assert.equal(
    tileflowInteractionTargetRefSchema.safeParse({kind: 'style-feature', layerId: 'pois'}).success,
    false,
  );
});
