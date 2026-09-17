import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowAnnotation, TileflowInteractionEvent} from '@tileflow/interactions';
import {createMountedMapInteractions, type NativeInteractionHost} from '../src/mounted-map-interactions';
import {createNativeInteractionStyleOwner} from '../src/native-interaction-style';
import {poiBinding, poiStyle, touch} from './native-interaction-fixture';

const annotation: TileflowAnnotation = {
	id: 'place', kind: 'marker', coordinate: [1, 2], ariaLabel: 'Place',
};
function fixture() {
	const style = poiStyle();
	style.layers.reverse();
	for (const layer of style.metadata['tileflow:interaction-manifest'].domains.poi.layers)
		layer.priority = style.layers.findIndex((physical) => physical.id === layer.layerId);
	const proofs = createNativeInteractionStyleOwner(() => undefined);
	proofs.publish('map', 'style_1', style, () => true);
	let queries = 0;
	const host: NativeInteractionHost = {
		key: 'map', style, current: () => true,
		async query() { queries++; return []; },
	};
	const owner = createMountedMapInteractions(proofs.get, () => undefined);
	owner.bind(host);
	const events: TileflowInteractionEvent[] = [];
	owner.update({annotations: [annotation], interactions: [poiBinding], onInteractionEvent: (event) => events.push(event)});
	return {owner, proofs, host, events, queries: () => queries};
}

test('background and style retirement require a fresh gesture before accepting another press', async () => {
	for (const retirement of ['background', 'style', 'host'] as const) {
		const f = fixture();
		const marker = f.owner.getSnapshot()!.annotations[0]!;
		f.owner.beginTouch();
		if (retirement === 'background') {
			f.owner.background();
			f.owner.resume();
		} else if (retirement === 'style') {
			f.proofs.retire();
			f.owner.sync();
			f.proofs.publish('map', 'style_2', f.host.style, () => true);
			f.owner.sync();
		} else {
			f.owner.unbind(f.host);
			f.owner.bind(f.host);
		}
		f.owner.markerPress(marker);
		await f.owner.mapPress(touch);
		assert.equal(f.events.length, 0);
		assert.equal(f.queries(), 0);
		f.owner.beginTouch();
		f.owner.markerPress(marker);
		assert.equal(f.events.filter((event) => event.type === 'target:activate').length, 1);
	}
});

test('duplicate marker delivery does not cancel a newer query initiated by an activation observer', async () => {
	const f = fixture();
	const marker = f.owner.getSnapshot()!.annotations[0]!;
	f.owner.beginTouch();
	f.owner.markerPress(marker);
	f.owner.markerPress(marker);
	await f.owner.mapPress(touch);
	assert.equal(f.events.filter((event) => event.type === 'target:activate').length, 1);
	assert.equal(f.queries(), 0);
});

test('a reentrant diagnostic observer can retire the host without the old bind resurrecting it', () => {
	const f = fixture();
	const invalid = {...f.host, style: {version: 8, sources: {}, layers: []}};
	f.owner.update({interactions: [poiBinding], onInteractionDiagnostic() { f.owner.dispose(); }});
	f.proofs.publish('map', 'style_2', invalid.style, () => true);
	f.owner.bind(invalid);
	assert.equal(f.owner.ready, false);
	assert.equal(f.owner.getSnapshot()?.disposed, true);
});
