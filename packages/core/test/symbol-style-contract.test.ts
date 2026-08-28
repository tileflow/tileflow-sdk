import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labels,
  nautical,
  parseTileflowMap,
  poi,
  resolveTileflowData,
  type TileflowCircleStyle,
  type TileflowIconStyle,
  type TileflowMarkerSymbolStyle,
  type TileflowSymbolStyle,
  type TileflowTextStyle,
} from '../src';
import {applySymbolStyle} from '../src/cartography/layer-style';
import {compilePoi} from '../src/modules/poi/compiler';
import {resolveColors} from '../src/themes';
import {extendStreets} from './map-fixture';

type ContractCase = {
  authored: TileflowSymbolStyle;
  baseline?: TileflowSymbolStyle;
  diagnostic?: RegExp;
};

const symbolCases = {
  icon: {authored: {icon: {image: 'contract-icon'}}},
  maxZoom: {authored: {maxZoom: 14}},
  minZoom: {authored: {minZoom: 4}},
  placement: {authored: {placement: 'line-center'}},
  priority: {authored: {priority: 37}},
  priorityOrder: {
    authored: {priority: 37, priorityOrder: 'lower-first'},
    baseline: {priority: 37, priorityOrder: 'higher-first'},
  },
  spacing: {authored: {spacing: 333}},
  text: {authored: {text: {color: '#123456'}}},
  visible: {authored: {visible: false}},
  zOrder: {authored: {zOrder: 'source'}},
} satisfies Record<keyof TileflowSymbolStyle, ContractCase>;

const textCases = {
  allowOverlap: textCase({allowOverlap: true}),
  anchor: textCase({anchor: 'bottom-left'}),
  color: textCase({color: '#123456'}),
  fallbacks: textCase({fallbacks: ['Noto Sans Regular']}),
  field: textCase({field: 'contract-label'}),
  font: textCase({font: 'Noto Sans Regular'}),
  haloBlur: textCase({haloBlur: 0.75}),
  haloColor: textCase({haloColor: '#234567'}),
  haloWidth: textCase({haloWidth: 2.25}),
  ignorePlacement: textCase({ignorePlacement: true}),
  justify: textCase({justify: 'left'}),
  keepUpright: textCase({keepUpright: false}),
  letterSpacing: textCase({letterSpacing: 0.18}),
  lineHeight: textCase({lineHeight: 1.7}),
  maxAngle: textCase({maxAngle: 28}),
  maxWidth: textCase({maxWidth: 17}),
  maxZoom: textCase({maxZoom: 14}),
  minZoom: textCase({minZoom: 4}),
  offset: textCase({offset: [1, 2]}),
  opacity: textCase({opacity: 0.42}),
  optional: textCase({optional: false}),
  padding: textCase({padding: 11}),
  pitchAlignment: textCase({pitchAlignment: 'map'}),
  radialOffset: textCase({radialOffset: 1.25}),
  rotate: textCase({rotate: 17}),
  rotationAlignment: textCase({rotationAlignment: 'viewport'}),
  size: textCase({size: 19}),
  transform: textCase({transform: 'uppercase'}),
  variableAnchors: textCase({variableAnchors: ['top-left', 'bottom-right']}),
  visible: textCase({visible: false}),
} satisfies Record<keyof TileflowTextStyle, ContractCase>;

const iconCases = {
  allowOverlap: iconCase({allowOverlap: true}),
  anchor: iconCase({anchor: 'bottom-right'}),
  color: iconCase({color: '#345678'}),
  haloBlur: iconCase({haloBlur: 0.65}),
  haloColor: iconCase({haloColor: '#456789'}),
  haloWidth: iconCase({haloWidth: 1.75}),
  ignorePlacement: iconCase({ignorePlacement: true}),
  image: iconCase({image: 'contract-icon-authored'}, {image: 'contract-icon-baseline'}),
  keepUpright: iconCase({keepUpright: false}),
  maxZoom: iconCase({maxZoom: 14}),
  minZoom: iconCase({minZoom: 4}),
  offset: iconCase({offset: [2, 3]}),
  opacity: iconCase({opacity: 0.38}),
  optional: iconCase({optional: false}),
  padding: iconCase({padding: 9}),
  pitchAlignment: iconCase({pitchAlignment: 'map'}),
  rotate: iconCase({rotate: 23}),
  rotationAlignment: iconCase({rotationAlignment: 'viewport'}),
  size: iconCase({size: 1.6}),
  textFit: iconCase({textFit: 'width'}),
  textFitPadding: iconCase({textFitPadding: [1, 2, 3, 4]}),
  visible: iconCase({visible: false}),
} satisfies Record<keyof TileflowIconStyle, ContractCase>;

type MarkerContractCase = {
  authored: TileflowCircleStyle;
  baseline: TileflowCircleStyle;
};

const markerCases = {
  blur: markerCase({blur: 0.8}, {blur: 0.1}),
  color: markerCase({color: '#56789A'}, {color: '#102030'}),
  maxZoom: markerCase({maxZoom: 13}, {maxZoom: 14}),
  minZoom: markerCase({minZoom: 8}, {minZoom: 5}),
  opacity: markerCase({opacity: 0.35}, {opacity: 0.9}),
  pitchAlignment: markerCase({pitchAlignment: 'viewport'}, {pitchAlignment: 'map'}),
  pitchScale: markerCase({pitchScale: 'viewport'}, {pitchScale: 'map'}),
  priority: markerCase({priority: 37}, {priority: 12}),
  priorityOrder: markerCase(
    {priority: 37, priorityOrder: 'lower-first'},
    {priority: 37, priorityOrder: 'higher-first'},
  ),
  radius: markerCase({radius: 8}, {radius: 4}),
  strokeColor: markerCase({strokeColor: '#6789AB'}, {strokeColor: '#203040'}),
  strokeOpacity: markerCase({strokeOpacity: 0.4}, {strokeOpacity: 0.95}),
  strokeWidth: markerCase({strokeWidth: 3}, {strokeWidth: 1}),
  visible: markerCase({visible: false}, {visible: true}),
} satisfies Record<
  Exclude<keyof TileflowCircleStyle, 'translate' | 'translateAnchor'>,
  MarkerContractCase
>;

test('every schema-accepted TileflowSymbolStyle property is observable or diagnosed', () => {
  const silent: string[] = [];

  for (const [path, contract] of contractCases()) {
    assertSchemaAccepts(path, contract.baseline ?? {});
    assertSchemaAccepts(path, contract.authored);

    const authored = compileSymbolStyle(contract.authored);
    if (authored.error !== undefined) {
      assert.ok(
        contract.diagnostic?.test(authored.error),
        `${path} produced an undocumented diagnostic: ${authored.error}`,
      );
      continue;
    }

    const baseline = compileSymbolStyle(contract.baseline ?? {});
    assert.equal(
      baseline.error,
      undefined,
      `${path} baseline unexpectedly produced a diagnostic: ${baseline.error ?? ''}`,
    );
    if (authored.serialized === baseline.serialized) silent.push(path);
  }

  assert.deepEqual(
    silent,
    [],
    `Schema-accepted symbol properties were silently ignored: ${silent.join(', ')}`,
  );
});

test('marker is explicit to marker-capable POI and nautical point styles', () => {
  const markerStyle = {marker: {radius: 7}} satisfies TileflowMarkerSymbolStyle;

  assert.doesNotThrow(() =>
    parseTileflowMap(
      extendStreets({
        modules: {
          nautical: nautical({aids: markerStyle}),
          poi: poi({styles: {'arts-entertainment': markerStyle}}),
        },
      }),
    ),
  );
  assert.throws(
    () =>
      parseTileflowMap(
        extendStreets({
          modules: {
            labels: labels({
              places: 'all',
              styles: {
                places: {city: markerStyle as unknown as TileflowSymbolStyle},
              },
            }),
          },
        }),
      ),
    /marker|unrecognized/iu,
  );
  assert.throws(
    () =>
      parseTileflowMap(
        extendStreets({
          modules: {
            nautical: nautical({
              labels: {
                coverage: markerStyle as unknown as TileflowSymbolStyle,
              },
            }),
          },
        }),
      ),
    /marker|unrecognized/iu,
  );
});

test('every schema-accepted marker property produces an observable POI contribution', () => {
  const silent: string[] = [];

  for (const [property, contract] of Object.entries(markerCases)) {
    assertPoiSchemaAccepts(contract.baseline);
    assertPoiSchemaAccepts(contract.authored);
    if (compilePoiMarker(contract.authored) === compilePoiMarker(contract.baseline)) {
      silent.push(`poi.marker.${property}`);
    }
  }

  assert.deepEqual(
    silent,
    [],
    `Schema-accepted marker properties were ignored: ${silent.join(', ')}`,
  );
});

function textCase(
  authored: TileflowTextStyle,
  baseline: TileflowTextStyle = {},
  diagnostic?: RegExp,
): ContractCase {
  return {
    authored: {text: {font: 'Noto Sans Bold', ...authored}},
    baseline: {text: {font: 'Noto Sans Bold', ...baseline}},
    diagnostic,
  };
}

function iconCase(
  authored: TileflowIconStyle,
  baseline: TileflowIconStyle = {},
  diagnostic?: RegExp,
): ContractCase {
  return {
    authored: {icon: {image: 'contract-icon', ...authored}},
    baseline: {icon: {image: 'contract-icon', ...baseline}},
    diagnostic,
  };
}

function markerCase(
  authored: TileflowCircleStyle,
  baseline: TileflowCircleStyle = {},
): MarkerContractCase {
  return {
    authored: {radius: 4, ...authored},
    baseline: {radius: 4, ...baseline},
  };
}

function contractCases(): Array<[string, ContractCase]> {
  return [
    ...Object.entries(symbolCases).map(
      ([property, contract]) => [`symbol.${property}`, contract] as [string, ContractCase],
    ),
    ...Object.entries(textCases).map(
      ([property, contract]) => [`symbol.text.${property}`, contract] as [string, ContractCase],
    ),
    ...Object.entries(iconCases).map(
      ([property, contract]) => [`symbol.icon.${property}`, contract] as [string, ContractCase],
    ),
  ];
}

function assertPoiSchemaAccepts(marker: TileflowCircleStyle): void {
  assert.doesNotThrow(() =>
    parseTileflowMap(
      extendStreets({
        modules: {
          poi: poi({
            categories: ['arts-entertainment'],
            styles: {'arts-entertainment': {marker}},
          }),
        },
      }),
    ),
  );
}

function compilePoiMarker(marker: TileflowCircleStyle): string {
  const contribution = compilePoi(
    poi({
      categories: ['arts-entertainment'],
      icons: false,
      labels: false,
      styles: {'arts-entertainment': {marker}},
    }),
    {
      colors: resolveColors(),
      data: resolveTileflowData(undefined),
      images: {},
      typography: {
        font: 'Noto Sans Regular',
        places: {font: 'Noto Sans Bold'},
        poi: {font: 'Noto Sans Regular'},
        roads: {font: 'Noto Sans Regular'},
        water: {font: 'Noto Sans Regular'},
      },
    },
  ).find((entry) => entry.target === 'poi.arts-entertainment.marker');
  return JSON.stringify(contribution ?? null);
}

function assertSchemaAccepts(path: string, style: TileflowSymbolStyle): void {
  assert.doesNotThrow(
    () =>
      parseTileflowMap(
        extendStreets({
          modules: {
            labels: labels({places: 'all', styles: {places: {city: style}}}),
          },
        }),
      ),
    `${path} is part of the public type but was rejected by the resolved-map schema`,
  );
}

function compileSymbolStyle(style: TileflowSymbolStyle): {
  error?: string;
  serialized?: string;
} {
  try {
    const layer = applySymbolStyle({id: 'contract-symbol', type: 'symbol'}, style);
    return {serialized: JSON.stringify(layer)};
  } catch (error) {
    return {error: error instanceof Error ? error.message : String(error)};
  }
}
