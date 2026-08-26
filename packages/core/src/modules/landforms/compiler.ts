import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applySymbolStyle} from '../../cartography/layer-style';
import {labelFieldExpression} from '../../cartography/localization';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowSymbolStyle} from '../../cartography/styles';
import {expression} from '../../cartography/values';
import type {TileflowLabelLanguage} from '../../types';
import {
  type TileflowLandformClass,
  tileflowLandformClasses,
  type TileflowLandformsModuleConfig,
} from './index';

const classMinimumZoom = {
  peak: 10,
  volcano: 9,
  saddle: 13,
  ridge: 14,
  cliff: 14,
  arete: 14,
} as const satisfies Record<TileflowLandformClass, number>;

export function compileLandforms(
  request: TileflowLandformsModuleConfig | undefined,
  language: TileflowLabelLanguage,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];

  const {sourceId: source, schema} = context.data;
  const name = labelFieldExpression(language, context);
  const label =
    request?.elevation === false
      ? name
      : [
          'case',
          ['has', schema.fields.elevation],
          ['concat', name, '\n', ['to-string', ['get', schema.fields.elevation]], ' m'],
          name,
        ];
  const typography = context.typography.places;
  const baseStyle = (
    minZoom: number,
    size: NonNullable<TileflowSymbolStyle['text']>['size'],
    override?: TileflowSymbolStyle,
  ): TileflowSymbolStyle =>
    mergeTileflowDesign<TileflowSymbolStyle>(
      {
        minZoom,
        placement: 'point',
        priority: expression<number>(['-', 100, ['to-number', ['get', schema.fields.rank], 99]]),
        text: {
          allowOverlap: false,
          color: context.colors.labels.muted,
          ...typographyTextStyle(typography),
          haloColor: context.colors.labels.halo,
          haloWidth: 1.2,
          maxWidth: 9,
          optional: true,
          padding: 4,
          size,
        },
      },
      override,
      {text: {field: expression<string>(label)}},
    );

  // The default recipe shares one bucket across every landform class. Exact
  // per-class authoring still expands only when the user requests it.
  if (!request?.classes || Object.keys(request.classes).length === 0) {
    const style = baseStyle(
      9,
      expression<number>(['match', ['get', schema.fields.class], ['peak', 'volcano'], 11, 10]),
    );
    return [
      landformContribution(
        'landforms.classes',
        900,
        applySymbolStyle(
          {
            id: 'streets-landforms',
            type: 'symbol',
            source,
            'source-layer': schema.layers.mountainPeak,
            filter: landformFilter(schema.fields, tileflowLandformClasses),
          },
          style,
        ),
      ),
    ];
  }

  return tileflowLandformClasses.flatMap((landformClass, index) => {
    const style = baseStyle(
      classMinimumZoom[landformClass],
      landformClass === 'peak' || landformClass === 'volcano' ? 11 : 10,
      request?.classes?.[landformClass],
    );
    if (style.visible === false || style.text?.visible === false) return [];

    return [
      landformContribution(
        `landforms.classes.${landformClass}`,
        900 + index,
        applySymbolStyle(
          {
            id: `streets-landform-${landformClass}`,
            type: 'symbol',
            source,
            'source-layer': schema.layers.mountainPeak,
            filter: landformFilter(schema.fields, [landformClass]),
          },
          style,
        ),
      ),
    ];
  });
}

function landformFilter(
  fields: TileflowDomainCompileContext['data']['schema']['fields'],
  classes: readonly TileflowLandformClass[],
): unknown[] {
  const classFilter =
    classes.length === 1
      ? ['==', ['get', fields.class], classes[0]]
      : ['match', ['get', fields.class], classes, true, false];
  const classZoom = [
    'match',
    ['get', fields.class],
    'volcano',
    ['>=', ['zoom'], 9],
    'peak',
    ['>=', ['zoom'], 10],
    'saddle',
    ['>=', ['zoom'], 13],
    ['ridge', 'cliff', 'arete'],
    ['>=', ['zoom'], 14],
    false,
  ];
  return [
    'all',
    ['==', ['geometry-type'], 'Point'],
    ['has', fields.name],
    classFilter,
    classZoom,
    ['<=', ['to-number', ['get', fields.rank], 99], ['step', ['zoom'], 3, 12, 10, 14, 99]],
  ];
}

function landformContribution(
  target: string,
  localOrder: number,
  layer: Record<string, unknown> & {id: string; type: string},
): TileflowLayerContribution {
  return {
    kind: 'layer',
    layer,
    localOrder,
    owner: 'landforms',
    slot: 'symbols',
    target,
  };
}
