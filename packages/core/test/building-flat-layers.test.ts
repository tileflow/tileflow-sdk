import assert from 'node:assert/strict';
import test from 'node:test';
import {createBuildingFlatLayers} from '../src/building-flat-layers-browser';

function fixture() {
  const layers = new Map([
    ['footprint', {visibility: 'visible'}],
    ['outline::theme', {visibility: 'none'}],
    ['roads', {visibility: 'visible'}],
  ]);
  return {
    layers,
    map: {
      getLayer: (id: string) => layers.get(id),
      getStyle: () => ({}),
      getLayersOrder: () => [...layers.keys()],
      getLayoutProperty: (id: string) => layers.get(id)?.visibility,
      setLayoutProperty: (id: string, _property: string, value: unknown) => {
        layers.get(id)!.visibility = value as string;
      },
    },
  };
}
const policy = [
  {id: 'footprint', visible: true},
  {id: 'outline', visible: false},
];
test('3D suppresses only duplicate fills and restores 2D visibility, including hidden outlines', () => {
  const {map, layers} = fixture(),
    flat = createBuildingFlatLayers(map);
  flat.update(policy, true);
  assert.equal(layers.get('footprint')!.visibility, 'none');
  assert.equal(layers.get('roads')!.visibility, 'visible');
  flat.update(policy, false);
  assert.equal(layers.get('footprint')!.visibility, 'visible');
  assert.equal(layers.get('outline::theme')!.visibility, 'none');
  flat.update(policy, true);
  flat.restore();
  assert.equal(layers.get('footprint')!.visibility, 'visible');
});
test('style replacement never restores a previous layer instance into a new style', () => {
  const {map, layers} = fixture(),
    flat = createBuildingFlatLayers(map);
  flat.update(policy, true);
  layers.set('footprint', {visibility: 'none'});
  flat.restore();
  assert.equal(layers.get('footprint')!.visibility, 'none');
  layers.set('footprint', {visibility: 'visible'});
  flat.update(policy, true);
  flat.restore();
  assert.equal(layers.get('footprint')!.visibility, 'visible');
});
test('map removal forgets visibility without touching a destroyed style', () => {
  const {map} = fixture(),
    flat = createBuildingFlatLayers(map);
  flat.update(policy, true);
  flat.forget();
  map.setLayoutProperty = () => {
    throw new Error('Destroyed map');
  };
  flat.restore();
});
