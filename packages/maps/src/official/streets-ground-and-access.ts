import {expr, field, renderPass, token, zoom} from '@tileflow/core';

// Keep continental ground quiet; introduce warmer open ground at local scales.
export const streetsDayGroundColors = {
  'surface.background': '#F5F0E5',
  'surface.background.overview': '#F8F7F3',
  'surface.land': '#F8F7F3',
  'landcover.global.barren': '#F8F7F3',
  'landcover.barren': '#F5F0E5',
  'landcover.rock': '#EEE9DF',
  'landcover.farmland': '#F0EDE2',
  'landcover.orchard': '#DDEAD4',
  'landcover.nursery': '#D6E8D2',
  'landcover.global.crop': '#EFF1E6',
  'landcover.global.urban': '#F5F3F3',
  'landuse.residential': '#F5F3F3',
  'landuse.civic': '#F5F3F3',
  'landuse.education': '#EFEEEC',
  'landuse.government': '#F5F3F3',
  'landuse.military': '#F5F3F3',
  'roads.accessOverview': '#D7D3CE',
} as const;

// Agricultural land use does not imply bare soil. Preserve mapped tree crops
// and nurseries without guessing vegetation for unspecified farmland.
export const streetsAgriculturalColor = expr.match(
  expr.get(field('subclass')),
  [
    {labels: 'orchard', value: token.color('landcover.orchard')},
    {labels: 'plant_nursery', value: token.color('landcover.nursery')},
  ],
  token.color('landcover.farmland'),
);

export const streetsGroundBackground = zoom.linear([
  [10, token.color('surface.background.overview')],
  [13, token.color('surface.background.transition')],
  [14, token.color('surface.background')],
]);

// Existing detailed roads take over at z15. Keep access roads subordinate to local streets.
export const streetsAccessOverview = renderPass({
  placement: {below: 'roads.classes.minor.surface.fill'},
  feature: 'road',
  renderer: 'line',
  selector: {
    kind: 'all',
    selectors: [
      {kind: 'geometry', geometry: 'line'},
      {kind: 'in', field: 'class', values: ['track', 'service']},
      {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'tunnel'},
    ],
  },
  style: {
    minZoom: 12,
    maxZoom: 15,
    cap: 'round',
    join: 'round',
    color: zoom.linear([
      [14, token.color('roads.accessOverview')],
      [15, token.color('roads.default')],
    ]),
    opacity: zoom.linear([
      [12, 0.35],
      [13, 0.8],
      [14, 1],
    ]),
    width: zoom.linear([
      [12, 0.35],
      [13, 0.55],
      [14, 0.85],
      [15, 2.2857142857142856],
    ]),
  },
});
