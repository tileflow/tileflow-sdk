import {isValidElement, type ReactElement} from 'react';
import type {
	TileflowAnnotation,
	TileflowInteractionDiagnosticCode,
	TileflowInteractionState,
	TileflowResolvedAnnotationTarget,
} from '@tileflow/interactions';
import type {MapMarkerRenderContext, MapMarkerRenderer} from './interaction-contract';

/** Consumes only the Stage A snapshot. React keys implement its stable-ID annotation plan. */
export function nativeMarkerModel<TAnnotation extends TileflowAnnotation>(
	annotation: TAnnotation,
	state: TileflowInteractionState,
	enabled: boolean,
) {
	const lngLat: [number, number] = [annotation.coordinate[0], annotation.coordinate[1]];
	Object.freeze(lngLat);
	const target: TileflowResolvedAnnotationTarget<TAnnotation> = Object.freeze({
		kind: 'annotation', annotation, coordinate: annotation.coordinate,
	});
	const content = annotation.marker?.content;
	const context: MapMarkerRenderContext<TAnnotation> = Object.freeze({
		annotation, target,
		...(content ? {content} : {}),
		...(content?.kind === 'view' ? {viewName: content.name} : {}),
	});
	return Object.freeze({
		key: annotation.id,
		lngLat,
		context,
		accessibility: Object.freeze({
			accessible: true,
			accessibilityRole: 'button' as const,
			accessibilityLabel: annotation.ariaLabel,
			accessibilityState: Object.freeze({
				selected: state.popup?.kind === 'annotation' && state.popup.id === annotation.id,
				disabled: !enabled,
			}),
		}),
	});
}

export function resolveNativeMarkerContent<TAnnotation extends TileflowAnnotation>(
	context: MapMarkerRenderContext<TAnnotation>,
	render?: MapMarkerRenderer<TAnnotation>,
): Readonly<{content?: ReactElement; diagnostic?: TileflowInteractionDiagnosticCode}> {
	if (render === undefined) return Object.freeze({});
	try {
		const content = render(context);
		if (isValidElement(content)) return Object.freeze({content});
		// A JavaScript consumer may accidentally return a rejected promise instead of an element.
		void Promise.resolve(content).catch(() => undefined);
		return Object.freeze({diagnostic: 'MISSING_VIEW'});
	} catch {
		return Object.freeze({diagnostic: 'OVERLAY_FAILURE'});
	}
}
