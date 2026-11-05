import {forwardRef, useImperativeHandle, useLayoutEffect, useState} from 'react';
import {useCommittedValue, useMap} from './map-context';
import type {LocationEvent, LocationPermission, UserLocationProps, UserLocationRef} from './contract';

export const UserLocation = forwardRef<UserLocationRef, UserLocationProps>(function UserLocation(props, ref) {
  const {controller, setLocation} = useMap();
  const [owner] = useState(() => Symbol());
  const callback = useCommittedValue(props.onUpdate);
  const visible = props.visible ?? true;
  const emitsUpdates = props.onUpdate !== undefined;
  const heading = props.showsUserHeadingIndicator;

  useLayoutEffect(() => {
    setLocation(owner, {visible, emitsUpdates, ...(heading === undefined ? {} : {showsUserHeadingIndicator: heading})});
    return () => setLocation(owner);
  }, [setLocation, owner, visible, emitsUpdates, heading]);

  useLayoutEffect(() => controller.subscribe((type, payload) => {
    if (type === 'locationUpdated') callback.current?.(payload as LocationEvent);
  }), [controller, callback]);

  useImperativeHandle(ref, () => ({requestPermission: async () => await controller.call('requestLocationPermission', {}) as LocationPermission}), [controller]);
  return null;
});
