import {forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState} from 'react';
import {useCommittedValue, useMap} from './map-context';
import {mapError} from './map-error';
import {padding} from './map-input';
import type {CameraProps, CameraRef, CameraStop} from './contract';

export const Camera = forwardRef<CameraRef, CameraProps>(function Camera(props, ref) {
  const {controller, setCamera} = useMap();
  const [owner] = useState(() => Symbol());
  const committed = useCommittedValue(props);
  const previous = useRef<{instance: string; controlled: string} | undefined>(undefined);
  const controlled: CameraStop = {
    ...(props.centerCoordinate ? {centerCoordinate: props.centerCoordinate} : {}),
    ...(props.bounds ? {bounds: props.bounds} : {}),
    ...(props.zoomLevel === undefined ? {} : {zoomLevel: props.zoomLevel}),
    ...(props.heading === undefined ? {} : {heading: props.heading}),
    ...(props.pitch === undefined ? {} : {pitch: props.pitch}),
    ...(props.padding ? {padding: props.padding} : {}),
    ...(props.animationMode ? {animationMode: props.animationMode} : {}),
    ...(props.animationDuration === undefined ? {} : {animationDuration: props.animationDuration}),
  };
  const controlledSignature = JSON.stringify(controlled);
  const optionsSignature = JSON.stringify(props);
  const settings = useCommittedValue(controlled);

  useLayoutEffect(() => {
    setCamera(owner, committed.current);
    return () => setCamera(owner);
  }, [setCamera, owner, optionsSignature, committed]);

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = {instance: controller.instanceId, controlled: controlledSignature};
    if (old?.instance !== controller.instanceId || old.controlled === controlledSignature || controlledSignature === '{}') return;
    void controller.call('setCamera', settings.current).catch((error: unknown) => {
      if (!controller.isDisposed) controller.report(mapError(error));
    });
  }, [controller, controlledSignature, settings]);

  useImperativeHandle(ref, () => ({
    setCamera: async (value) => { await controller.call('setCamera', value); },
    fitBounds: async (ne, sw, paddingConfig, animationDuration) => {
      await controller.call('setCamera', {bounds: {ne, sw},
        ...(paddingConfig === undefined ? {} : {padding: padding(paddingConfig)}),
        ...(animationDuration === undefined ? {} : {animationDuration}),
      });
    },
    flyTo: async (centerCoordinate, animationDuration) => { await controller.call('setCamera', {
      centerCoordinate, animationMode: 'flyTo', ...(animationDuration === undefined ? {} : {animationDuration}),
    }); },
    moveTo: async (centerCoordinate, animationDuration = 0) => { await controller.call('setCamera', {
      centerCoordinate, animationMode: animationDuration > 0 ? 'easeTo' : 'moveTo', animationDuration,
    }); },
    zoomTo: async (zoomLevel, animationDuration) => { await controller.call('setCamera', {
      zoomLevel, animationMode: 'easeTo', ...(animationDuration === undefined ? {} : {animationDuration}),
    }); },
    stop: async () => { await controller.call('stopCamera', {}); },
  }), [controller]);
  return null;
});
