import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import type {TileflowAnnotation} from '@tileflow/interactions';
import {createMountedMapInteractions} from '../src/mounted-map-interactions';
import {createNativeInteractionStyleOwner} from '../src/native-interaction-style';
import {nativeMarkerModel, resolveNativeMarkerContent} from '../src/native-marker-model';

/** Element assembly only. These stubs make no claim about native layout, a11y or event ordering. */
async function fixture() {
  const effects: (() => void)[] = [];
  const source = await readFile(new URL('../src/native-marker.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = {
    exports: {} as {
      NativeAnnotationMarker: (
        props: Record<string, unknown>,
      ) => React.ReactElement<Record<string, any>>;
    },
  };
  const require = (id: string): unknown => {
    if (id === 'react')
      return {
        ...React,
        useMemo: (factory: () => unknown) => factory(),
        useLayoutEffect: (effect: () => void) => effects.push(effect),
      };
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@maplibre/maplibre-react-native') return {Marker: 'NativeMarker'};
    if (id === 'react-native')
      return {
        Pressable: 'NativePressable',
        View: 'NativeView',
        processColor: () => 0xff2563eb,
      };
    if (id === './native-marker-model') return {nativeMarkerModel, resolveNativeMarkerContent};
    throw new Error(`Unexpected marker dependency: ${id}`);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return {render: module.exports.NativeAnnotationMarker, effects};
}
const annotation: TileflowAnnotation = {
  id: 'place',
  kind: 'marker',
  coordinate: [1, 2],
  ariaLabel: 'Accessible place',
  data: {capacity: 12},
};

test('default and custom content retain one authoritative accessible activation wrapper', async () => {
  const f = await fixture();
  const custom = React.createElement('ApplicationMarker', {children: '12'});
  for (const content of [undefined, custom]) {
    const marker = f.render({
      annotation,
      state: {popup: null},
      enabled: true,
      sceneKey: 'map',
      lifecycle: {},
      renderMarker: content ? () => content : undefined,
    });
    assert.equal(marker.type, 'NativeMarker');
    assert.equal(marker.props.id, 'tileflow-annotation-place');
    assert.deepEqual(marker.props.lngLat, [1, 2]);
    const button = marker.props.children;
    assert.equal(button.type, 'NativePressable');
    assert.equal(button.props.accessible, true);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityLabel, annotation.ariaLabel);
    assert.equal(button.props.style.minWidth, 44);
    assert.equal(button.props.style.minHeight, 44);
    const wrapper = button.props.children;
    assert.equal(wrapper.props.pointerEvents, 'none');
    assert.equal(wrapper.props.accessibilityElementsHidden, true);
    assert.equal(wrapper.props.importantForAccessibility, 'no-hide-descendants');
    if (content) assert.equal(wrapper.props.children, content);
    else {
      assert.equal(wrapper.props.children.type, 'NativeView');
      assert.equal(wrapper.props.children.props.style[0].width, 18);
      assert.equal(wrapper.props.children.props.style[0].height, 18);
    }
  }
});

test('Pressable and native Marker deliveries share one activation and accessibility uses the same target', async () => {
  const f = await fixture();
  const style = {version: 8, sources: {}, layers: []};
  const proof = createNativeInteractionStyleOwner(() => undefined);
  proof.publish('map', 'style_1', style, () => true);
  const interactions = createMountedMapInteractions(proof.get, () => undefined);
  interactions.bind({key: 'map', style, current: () => true, query: async () => []});
  const events: unknown[] = [];
  interactions.update({
    annotations: [annotation],
    onInteractionEvent: (event) => events.push(event),
  });
  const current = interactions.getSnapshot()!.annotations[0]!;
  const lifecycle = {
    beginTouch: () => interactions.beginTouch(),
    claimMarker: (_key: string, value: TileflowAnnotation) => interactions.claimMarker(value),
    markerPress: (_key: string, value: TileflowAnnotation) => interactions.markerPress(value),
  };
  const marker = f.render({
    annotation: current,
    state: {popup: null},
    enabled: true,
    sceneKey: 'map',
    lifecycle,
  });
  const button = marker.props.children;
  let stopped = 0;
  const event = {
    stopPropagation() {
      stopped++;
    },
  };
  interactions.beginTouch();
  button.props.onTouchStart(event);
  marker.props.onPress(event);
  button.props.onPress(event);
  assert.equal(events.length, 1);
  assert.equal(stopped, 3);
  button.props.onAccessibilityTap();
  assert.equal(events.length, 2);
  interactions.dispose();
  marker.props.onPress(event);
  assert.equal(events.length, 2);
});

test('custom renderer diagnostics are delivered after element assembly, never during render', async () => {
  const f = await fixture();
  const diagnostics: unknown[] = [];
  const marker = f.render({
    annotation,
    state: {popup: null},
    enabled: true,
    sceneKey: 'map',
    lifecycle: {interactionDiagnostic: (_key: string, code: string) => diagnostics.push(code)},
    renderMarker() {
      throw new Error('Application rendering failure');
    },
  });
  assert.equal(diagnostics.length, 0);
  assert.equal(marker.props.children.props.children.props.children.type, 'NativeView');
  for (const effect of f.effects) effect();
  assert.deepEqual(diagnostics, ['OVERLAY_FAILURE']);
});
