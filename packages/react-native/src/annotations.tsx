import {useLayoutEffect, useState} from 'react';
import type {ReactNode} from 'react';
import type {ViewProps} from 'react-native';
import NativeMarker from './specs/TileflowMarkerViewNativeComponent';
import {useCommittedValue, useMap} from './map-context';
import type {AnnotationEvent, Coordinate, PointAnnotationProps} from './contract';
import type {NativeMarkerOptions, NativePointAnnotation} from './native-map-contract';

export function PointAnnotation(props: PointAnnotationProps) {
  const {controller, points} = useMap();
  const [owner] = useState(() => Symbol());
  const callbacks = useCommittedValue(props);
  const value: NativePointAnnotation = {
    id: props.id, coordinate: props.coordinate,
    ...(props.iconImage ? {iconImage: props.iconImage} : {}),
    ...(props.iconSize === undefined ? {} : {iconSize: props.iconSize}),
    ...(props.iconRotate === undefined ? {} : {iconRotate: props.iconRotate}),
    ...(props.iconColor ? {iconColor: props.iconColor} : {}),
    ...(props.draggable === undefined ? {} : {draggable: props.draggable}),
    ...(props.accessibilityLabel ? {accessibilityLabel: props.accessibilityLabel} : {}),
  };
  const committed = useCommittedValue(value);
  const signature = JSON.stringify(value);
  useLayoutEffect(() => {
    points.set(owner, [committed.current]);
    return () => points.set(owner);
  }, [points, owner, signature, committed]);

  useLayoutEffect(() => controller.subscribe((type, payload) => {
    if (type !== 'annotationActivated' && type !== 'annotationDragged') return;
    const value = payload as {id: string; coordinate: Coordinate; phase?: string};
    if (value.id !== callbacks.current.id) return;
    const event: AnnotationEvent = {
      type: 'Feature', id: value.id, geometry: {type: 'Point', coordinates: value.coordinate}, properties: {id: value.id},
    };
    if (type === 'annotationActivated') callbacks.current.onSelected?.(event);
    else if (value.phase === 'started') callbacks.current.onDragStart?.(event);
    else if (value.phase === 'ended' || value.phase === 'cancelled') callbacks.current.onDragEnd?.(event);
    else callbacks.current.onDrag?.(event);
  }), [controller, callbacks]);
  return null;
}

export type MarkerViewProps = ViewProps & NativeMarkerOptions & Readonly<{
  id?: string;
  children: ReactNode;
}>;

let nextMarker = 0;

export function MarkerView(props: MarkerViewProps) {
  const {controller} = useMap();
  const [id] = useState(() => 'tileflow-marker-' + (++nextMarker));
  const {coordinate, anchor, offset, allowOverlap, isSelected, priority, id: annotationId, children, style, ...view} = props;
  return <NativeMarker {...view} collapsable={false} instanceId={controller.instanceId} annotationId={annotationId ?? id}
    optionsJson={JSON.stringify({coordinate, anchor, offset, allowOverlap, isSelected, priority})}
    style={[{position: 'absolute', alignSelf: 'flex-start'}, style]}>
    {children}
  </NativeMarker>;
}
