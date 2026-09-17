import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import type {TileflowAnnotation} from '@tileflow/interactions';
import {nativeMarkerModel, resolveNativeMarkerContent} from '../src/native-marker-model';
import {prepareNativeInteractionInputs, planNativeAnnotations} from '../src/native-interaction-input';

const annotation: TileflowAnnotation = {
	id: 'place', kind: 'marker', coordinate: [1, 2], ariaLabel: 'Accessible place', data: {capacity: 12},
	marker: {content: {kind: 'view', name: 'capacity'}},
};

test('default marker model has an authoritative accessible button wrapper and portable context', () => {
	const model = nativeMarkerModel(annotation, {popup: null}, true);
	assert.equal(model.key, 'place');
	assert.deepEqual(model.lngLat, [1, 2]);
	assert.notEqual(model.lngLat, annotation.coordinate);
	assert.equal(model.accessibility.accessible, true);
	assert.equal(model.accessibility.accessibilityRole, 'button');
	assert.equal(model.accessibility.accessibilityLabel, annotation.ariaLabel);
	assert.deepEqual(model.accessibility.accessibilityState, {selected: false, disabled: false});
	assert.equal(model.context.annotation, annotation);
	assert.equal(model.context.viewName, 'capacity');
	assert.equal('close' in model.context, false);
	assert.equal('nativeMap' in model.context, false);
	assert.equal(resolveNativeMarkerContent(model.context).content, undefined);
});

test('custom content receives annotation data without owning activation or accessibility', () => {
	const model = nativeMarkerModel(annotation, {popup: {kind: 'annotation', id: 'place'}}, true);
	const content = createElement('marker-content', {children: '12'});
	const result = resolveNativeMarkerContent(model.context, (context) => {
		assert.equal(context.annotation.data, annotation.data);
		assert.equal(context.target.kind, 'annotation');
		return content;
	});
	assert.equal(result.content, content);
	assert.equal(result.diagnostic, undefined);
	assert.equal(model.accessibility.accessibilityState.selected, true);
	assert.equal(nativeMarkerModel(annotation, {popup: null}, false).accessibility.accessibilityState.disabled, true);
});

test('renderer failures use a bounded fallback rather than leaking a raw exception', () => {
	const context = nativeMarkerModel(annotation, {popup: null}, true).context;
	assert.deepEqual(resolveNativeMarkerContent(context, () => { throw new Error('private'); }),
		{diagnostic: 'OVERLAY_FAILURE'});
	assert.deepEqual(resolveNativeMarkerContent(context, (() => 'invalid') as never),
		{diagnostic: 'MISSING_VIEW'});
});

test('stable-ID plans keep marker keys through edits, reordering and removal', () => {
	const first = prepareNativeInteractionInputs({annotations: [annotation, {...annotation, id: 'other'}]});
	const next = prepareNativeInteractionInputs({annotations: [
		{...annotation, id: 'other'}, {...annotation, coordinate: [3, 4], ariaLabel: 'Updated place'},
	]}, first);
	const plan = planNativeAnnotations(first.annotations, next.annotations);
	assert.deepEqual(plan.order, ['other', 'place']);
	assert.deepEqual(plan.retain, ['other']);
	assert.equal(plan.update[0]?.id, 'place');
	const before = nativeMarkerModel(first.annotations[0]!, first.state, true);
	const after = nativeMarkerModel(next.annotations[1]!, next.state, true);
	assert.equal(before.key, after.key);
	assert.deepEqual(after.lngLat, [3, 4]);
	assert.equal(after.accessibility.accessibilityLabel, 'Updated place');
	assert.deepEqual(planNativeAnnotations(next.annotations, []).remove, ['other', 'place']);
});
