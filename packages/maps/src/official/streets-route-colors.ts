import {tileflowDefaultRouteInks} from '@tileflow/core';

/**
 * The inks of a route an application draws over Streets: the inks a theme without route tokens
 * gets, named so that the accent knob can recolour them. Time-of-day grading leaves them alone.
 */
export function streetsRouteColors(colorScheme: 'dark' | 'light') {
  const inks = tileflowDefaultRouteInks[colorScheme];
  return {
    'route.alternative': inks.alternative,
    'route.casing': inks.casing,
    'route.core': inks.core,
    'route.glow': inks.glow,
    'route.line': inks.line,
  };
}

export function streetsRouteNumbers(colorScheme: 'dark' | 'light') {
  const inks = tileflowDefaultRouteInks[colorScheme];
  return {'route.core.opacity': inks.coreOpacity, 'route.glow.opacity': inks.glowOpacity};
}
