import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {OverdrawHeatmap} from '../src/inspector/overdraw';

class SvgElement {
  id = '';
  attributes = new Map<string, string>();
  style = {cssText: ''};
  children: SvgElement[] = [];
  removed = false;
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  append(child: SvgElement) {
    this.children.push(child);
  }
  remove() {
    this.removed = true;
  }
}

function fixture() {
  const body = new SvgElement();
  const styles = new Map<string, {value: string; priority: string}>();
  const canvas = {
    ownerDocument: {body, createElementNS: () => new SvgElement()},
    style: {
      getPropertyValue: (name: string) => styles.get(name)?.value ?? '',
      getPropertyPriority: (name: string) => styles.get(name)?.priority ?? '',
      setProperty: (name: string, value: string, priority = '') => {
        styles.set(name, {value, priority});
      },
      removeProperty: (name: string) => styles.delete(name),
    },
  };
  const map = {
    getCanvas: () => canvas,
    showOverdrawInspector: false,
  } as unknown as MapLibreMap;
  return {body, canvas, map};
}

test('overdraw can be enabled before map readiness and restores canvas rendering on disable', () => {
  const {map, canvas, body} = fixture();
  canvas.style.setProperty('filter', 'contrast(1.1)', 'important');
  const heatmap = new OverdrawHeatmap();
  heatmap.setEnabled(true);
  heatmap.setMap(map);
  assert.equal(map.showOverdrawInspector, true);
  const svg = body.children[0];
  const filter = svg.children[0].children[0];
  assert.equal(canvas.style.getPropertyValue('filter'), `url("#${filter.id}")`);
  assert.equal(filter.attributes.get('color-interpolation-filters'), 'sRGB');
  const channels = filter.children[0].children.map((component) =>
    component.attributes.get('tableValues')!.split(' ').map(Number),
  );
  const colorAt = (count: number) => channels.map((values) => Math.round(values[count] * 255));
  assert.deepEqual(colorAt(0), [21, 27, 39]);
  assert.deepEqual(colorAt(1), [37, 99, 235]);
  assert.deepEqual(colorAt(4), [250, 204, 21]);
  assert.deepEqual(colorAt(8), [239, 68, 68]);
  heatmap.setEnabled(true);
  heatmap.setMap(map);
  assert.equal(body.children.length, 1, 'polling does not allocate new filters');
  heatmap.setEnabled(false);
  assert.equal(map.showOverdrawInspector, false);
  assert.equal(svg.removed, true);
  assert.equal(canvas.style.getPropertyValue('filter'), 'contrast(1.1)');
  assert.equal(canvas.style.getPropertyPriority('filter'), 'important');
});

test('overdraw follows map replacement and clears all temporary rendering on disposal', () => {
  const first = fixture();
  const second = fixture();
  const heatmap = new OverdrawHeatmap();
  heatmap.setMap(first.map);
  assert.equal(first.body.children.length, 0, 'disabled inspector leaves the canvas alone');
  heatmap.setEnabled(true);
  heatmap.setMap(undefined);
  assert.equal(first.map.showOverdrawInspector, false);
  assert.equal(first.canvas.style.getPropertyValue('filter'), '');
  assert.equal(first.body.children[0].removed, true);
  // Preserve a pre-existing native inspector when relinquishing ownership.
  second.map.showOverdrawInspector = true;
  heatmap.setMap(second.map);
  assert.equal(second.body.children.length, 1);
  heatmap.dispose();
  heatmap.dispose();
  assert.equal(second.map.showOverdrawInspector, true);
  assert.equal(second.canvas.style.getPropertyValue('filter'), '');
  assert.equal(second.body.children[0].removed, true);
});
