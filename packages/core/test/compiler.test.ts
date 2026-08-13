import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  createStyleFromProject,
  defineTileflow,
  getDefaultColors,
  labels,
  osm,
  parseTileflowProject,
  poi,
  roads,
  styleOverride,
  validateConfig,
} from '../src/index';

const standardModules = [roads({extras: {ferry: true, paths: true, rail: true}})];

const project = defineTileflow({
  themes: {
    light: {
      colors: {
        park: '#C3F1D5',
        road: '#D8E0E7',
        text: '#566371',
        water: '#8ED6E8',
      },
      fonts: {
        body: 'Inter',
      },
    },
  },
  maps: {
    madrid: {
      basemap: osm(),
      modules: standardModules,
      renderer: 'generated',
      theme: 'light',
      view: {
        center: [-3.7038, 40.4168],
        zoom: 12,
      },
    },
  },
});

const osmBrightStyle = createStyle({
  basemap: osm(),
  theme: 'light',
});

test('validates project config and emits default/template styles', () => {
  const validation = validateConfig(project);
  assert.equal(validation.valid, true);
  assert.deepEqual(parseTileflowProject(project).maps.madrid.view, {
    center: [-3.7038, 40.4168],
    zoom: 12,
  });

  const osmBrightStyle = createStyle({
    basemap: osm(),
    theme: 'light',
  });
  assert.equal(osmBrightStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.equal(osmBrightStyle.metadata?.['tileflow:theme'], 'light');
  assert.equal(
    osmBrightStyle.sources.tileflow.url,
    'https://api.tileflow.dev/tiles/world/tiles.json',
  );
  assert.ok(osmBrightStyle.layers.length > 100);
  assert.equal(
    osmBrightStyle.layers.some((layer) => layer.source === 'openmaptiles'),
    false,
  );
  assert.ok(
    osmBrightStyle.layers.some(
      (layer) => layer.source === 'tileflow' && layer['source-layer'] === 'transportation',
    ),
  );

  const osmDarkStyle = createStyle({
    basemap: osm(),
    theme: 'dark',
  });
  const osmDarkBackgroundLayer = osmDarkStyle.layers.find((layer) => layer.id === 'background');
  assert.equal(osmDarkBackgroundLayer?.paint?.['background-color'], '#1C2228');

  const emptyThemeStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        light: {
          colors: {},
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'light',
        },
      },
    }),
    'madrid',
  );
  assert.deepEqual(
    emptyThemeStyle.layers.find((layer) => layer.id === 'background')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'background')?.paint,
  );
  assert.deepEqual(
    emptyThemeStyle.layers.find((layer) => layer.id === 'water')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'water')?.paint,
  );

  const defaultColors = getDefaultColors();
  defaultColors.water = '#000000';
  assert.notEqual(getDefaultColors().water, '#000000');

  const terrainStyle = createStyle({
    terrain: 'hillshade',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(terrainStyle.sources['tileflow-terrain'], 'attribution'),
    false,
  );

  const projectOsmBrightStyle = createStyleFromProject(
    defineTileflow({
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'light',
        },
      },
    }),
    'madrid',
  );
  assert.equal(projectOsmBrightStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.ok(projectOsmBrightStyle.layers.length > 100);

  const style = createStyleFromProject(project, 'madrid');
  assert.equal(style.version, 8);
  assert.equal(style.metadata?.['tileflow:basemap'], 'osm');
  assert.equal(style.metadata?.['tileflow:theme'], 'light');
  assert.equal(style.metadata?.['tileflow:themeMode'], 'light');
  assert.deepEqual(style.metadata?.['tileflow:modules'], ['roads']);
  assert.equal(style.metadata?.['tileflow:roads'], 'standard');
  assert.deepEqual(style.metadata?.['tileflow:typography'], {
    font: 'Inter',
    fontFamily: 'Inter',
    weight: 'regular',
  });
  assert.deepEqual(style.metadata?.['tileflow:view'], {
    center: [-3.7038, 40.4168],
    zoom: 12,
  });

  const waterLayer = style.layers.find((layer) => layer.id === 'water');
  assert.equal(waterLayer?.paint?.['fill-color'], '#8ED6E8');

  const parksLayer = style.layers.find((layer) => layer.id === 'parks');
  assert.equal(parksLayer?.paint?.['fill-color'], '#C3F1D5');
});

test('selects renderer explicitly when requested', () => {
  assert.equal(osmBrightStyle.metadata?.['tileflow:renderer'], 'osm-bright');
  assert.equal(osmBrightStyle.metadata?.['tileflow:rendererPreference'], 'auto');

  const generatedStyle = createStyle({
    basemap: osm(),
    renderer: 'generated',
    theme: 'light',
  });
  assert.equal(generatedStyle.metadata?.['tileflow:renderer'], 'generated');
  assert.equal(generatedStyle.metadata?.['tileflow:rendererPreference'], 'generated');
  assert.equal(generatedStyle.metadata?.['tileflow:template'], undefined);

  const forcedTemplateStyle = createStyle({
    basemap: osm(),
    renderer: 'osm-bright',
    theme: 'light',
  });
  assert.equal(forcedTemplateStyle.metadata?.['tileflow:renderer'], 'osm-bright');
  assert.equal(forcedTemplateStyle.metadata?.['tileflow:rendererPreference'], 'osm-bright');
  assert.equal(forcedTemplateStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');

  const autoGeneratedStyle = createStyle({
    basemap: osm(),
    density: 'dense',
    theme: 'light',
  });
  assert.equal(autoGeneratedStyle.metadata?.['tileflow:renderer'], 'generated');
  assert.equal(autoGeneratedStyle.metadata?.['tileflow:rendererPreference'], 'auto');

  assert.throws(
    () =>
      createStyle({
        basemap: osm(),
        density: 'dense',
        renderer: 'osm-bright',
        theme: 'light',
      }),
    /renderer "osm-bright" is not compatible/,
  );
});

test('resolves explicit road controls consistently across renderers', () => {
  const standardRoadsStyle = createStyle({
    basemap: osm(),
    modules: [roads()],
    theme: 'light',
  });
  assert.equal(standardRoadsStyle.metadata?.['tileflow:renderer'], 'osm-bright');
  assert.equal(standardRoadsStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.deepEqual(
    standardRoadsStyle.layers.find((layer) => layer.id === 'water')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'water')?.paint,
  );
  assert.equal(
    standardRoadsStyle.layers.find((layer) => layer.id === 'highway-minor')?.minzoom,
    12,
  );
  assert.equal(
    standardRoadsStyle.layers.find((layer) => layer.id === 'highway-path')?.layout?.['visibility'],
    'none',
  );
  assert.deepEqual(standardRoadsStyle.metadata?.['tileflow:roadsModule'], {
    detail: 'streets',
    extras: {ferry: false, paths: false, rail: false},
    hierarchy: 'clear',
    outline: 'subtle',
    weight: 'regular',
  });

  const hierarchyStyle = createStyle({
    basemap: osm(),
    modules: [roads({hierarchy: 'strong'})],
    renderer: 'generated',
  });
  assert.equal(
    hierarchyStyle.layers.find((layer) => layer.id === 'roads-major')?.paint?.['line-opacity'],
    0.92,
  );
  assert.equal(
    hierarchyStyle.layers.find((layer) => layer.id === 'roads-minor')?.paint?.['line-opacity'],
    0.52,
  );

  const highwaysStyle = createStyle({
    basemap: osm(),
    modules: [roads({detail: 'highways'})],
    renderer: 'generated',
  });
  assert.equal(
    highwaysStyle.layers.some((layer) => layer.id === 'roads-minor'),
    false,
  );
  assert.equal(
    highwaysStyle.layers.some((layer) => layer.id === 'roads-service'),
    false,
  );

  const templateHighwaysStyle = createStyle({
    basemap: osm(),
    modules: [roads({detail: 'highways'})],
    theme: 'light',
  });
  assert.equal(templateHighwaysStyle.metadata?.['tileflow:renderer'], 'osm-bright');
  assert.equal(
    templateHighwaysStyle.layers.find((layer) => layer.id === 'highway-primary')?.layout?.[
      'visibility'
    ],
    'none',
  );
  const templateSharedLink = templateHighwaysStyle.layers.find(
    (layer) => layer.id === 'highway-link',
  );
  assert.equal(templateSharedLink?.layout?.['visibility'], 'visible');
  assert.equal(
    JSON.stringify(templateSharedLink?.filter).includes(
      JSON.stringify(['in', 'class', 'motorway', 'trunk']),
    ),
    true,
  );

  const allRoadsStyle = createStyle({
    basemap: osm(),
    modules: [roads({detail: 'all'})],
    renderer: 'generated',
  });
  assert.equal(allRoadsStyle.layers.find((layer) => layer.id === 'roads-minor')?.minzoom, 12);
  assert.equal(allRoadsStyle.layers.find((layer) => layer.id === 'roads-service')?.minzoom, 14);

  const explicitOverridesStyle = createStyle({
    basemap: osm(),
    modules: [
      roads({
        detail: 'major',
        extras: {rail: true},
        hierarchy: 'strong',
        outline: 'none',
        weight: 'bold',
      }),
    ],
    renderer: 'generated',
  });
  assert.equal(
    explicitOverridesStyle.layers.some((layer) => layer.id === 'roads-casing'),
    false,
  );
  assert.equal(
    explicitOverridesStyle.layers.some((layer) => layer.id === 'roads-minor'),
    false,
  );
  assert.equal(
    explicitOverridesStyle.layers.some((layer) => layer.id === 'roads-rail'),
    true,
  );
  assert.deepEqual(explicitOverridesStyle.metadata?.['tileflow:roadsModule'], {
    detail: 'major',
    extras: {ferry: false, paths: false, rail: true},
    hierarchy: 'strong',
    outline: 'none',
    weight: 'bold',
  });

  const templateWithoutOutlines = createStyle({
    basemap: osm(),
    modules: [roads({outline: 'none'})],
    theme: 'light',
  });
  assert.equal(
    templateWithoutOutlines.layers.find((layer) => layer.id === 'highway-primary-casing')?.layout?.[
      'visibility'
    ],
    'none',
  );

  const hiddenRoadsStyle = createStyle({
    basemap: osm(),
    modules: [roads({detail: 'none'})],
    renderer: 'generated',
  });
  assert.equal(
    hiddenRoadsStyle.layers.some((layer) => String(layer.id).startsWith('roads')),
    false,
  );

  const jsonModuleStyle = createStyle({
    basemap: osm(),
    modules: [{type: 'roads', detail: 'highways'}],
  });
  assert.deepEqual(jsonModuleStyle.metadata?.['tileflow:roadsModule'], {
    detail: 'highways',
    extras: {ferry: false, paths: false, rail: false},
    hierarchy: 'clear',
    outline: 'subtle',
    weight: 'regular',
  });

  for (const renderer of ['osm-bright', 'generated'] as const) {
    const semanticRoadStyle = createStyle({
      basemap: osm(),
      modules: [
        roads({
          detail: 'all',
          oneWayMarkers: true,
          widthScale: {motorway: 1.8, minor: 0.7, service: 0.5},
        }),
        labels({roadClasses: ['motorway', 'primary', 'minor'], roads: 'all'}),
      ],
      renderer,
      typography: {roads: {weight: 'bold'}},
    });
    const markers = semanticRoadStyle.layers.find((layer) => layer.id === 'road-oneway-markers');
    assert.ok(markers);
    assert.deepEqual(markers.layout?.['text-font'], ['Noto Sans Bold']);
    assert.ok(expressionContains(markers.filter, 'oneway'));
    assert.deepEqual(
      renderer === 'generated'
        ? generatedRoadLabelClasses(semanticRoadStyle)
        : osmBrightRoadLabelClasses(semanticRoadStyle),
      ['minor', 'motorway', 'primary'],
    );
    const roadLayer = semanticRoadStyle.layers.find((layer) =>
      renderer === 'generated' ? layer.id === 'roads-major' : layer.id === 'highway-motorway',
    );
    assert.ok(expressionContains(roadLayer?.paint?.['line-width'], 1.8));
    assert.deepEqual(semanticRoadStyle.metadata?.['tileflow:roadsModule'], {
      detail: 'all',
      extras: {ferry: false, paths: false, rail: false},
      hierarchy: 'clear',
      outline: 'subtle',
      weight: 'regular',
      oneWayMarkers: true,
      widthScale: {
        motorway: 1.8,
        trunk: 1,
        primary: 1,
        secondary: 1,
        tertiary: 1,
        minor: 0.7,
        service: 0.5,
        track: 1,
        path: 1,
      },
    });
  }
});

test('resolves custom project themes without undefined fonts', () => {
  const darkProjectStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        dark: {
          colors: {
            canvas: '#101820',
            text: '#F4F7FA',
          },
          fonts: {
            labels: 'Inter',
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'dark',
        },
      },
    }),
    'madrid',
  );
  const darkProjectBackgroundLayer = darkProjectStyle.layers.find(
    (layer) => layer.id === 'background',
  );
  assert.equal(darkProjectStyle.metadata?.['tileflow:themeMode'], 'dark');
  assert.equal(darkProjectBackgroundLayer?.paint?.['background-color'], '#101820');
  assert.deepEqual(darkProjectStyle.metadata?.['tileflow:typography'], {
    font: 'Inter',
    fontFamily: 'Inter',
    weight: 'regular',
  });

  const colorsOnlyProjectStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        light: {
          colors: {
            water: '#8ED6E8',
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'light',
        },
      },
    }),
    'madrid',
  );
  assert.equal(hasUndefinedTextFont(colorsOnlyProjectStyle.layers), false);
  assert.equal(
    colorsOnlyProjectStyle.layers.find((layer) => layer.id === 'water')?.paint?.['fill-color'],
    '#8ED6E8',
  );
  assert.deepEqual(
    colorsOnlyProjectStyle.layers.find((layer) => layer.id === 'background')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'background')?.paint,
  );

  const minimalRoadsStyle = createStyle({
    basemap: osm(),
    modules: [roads({hierarchy: 'subtle', weight: 'thin'})],
  });
  assert.equal(minimalRoadsStyle.metadata?.['tileflow:roads'], 'soft');
});

test('resolves labels, poi, icon sets, and road behavior modules', () => {
  const labelsPoiTemplateStyle = createStyle({
    basemap: osm(),
    icons: {
      sprite: '/tileflow/icons/madrid/sprite',
    },
    modules: [
      labels({
        language: 'local',
        places: 'major',
        roads: 'none',
        water: 'all',
      }),
      poi({
        categories: ['food', 'coffee', 'culture'],
        icons: 'essential',
        minZoom: 14,
        preset: 'balanced',
      }),
    ],
  });
  assert.equal(labelsPoiTemplateStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.ok(labelsPoiTemplateStyle.layers.length > 100);
  assert.deepEqual(labelsPoiTemplateStyle.metadata?.['tileflow:modules'], ['labels', 'poi']);
  assert.equal(labelsPoiTemplateStyle.metadata?.['tileflow:labels'], 'balanced');
  assert.deepEqual(labelsPoiTemplateStyle.metadata?.['tileflow:labelsModule'], {
    language: 'local',
    places: 'major',
    roads: 'none',
    water: 'all',
  });
  assert.equal(labelsPoiTemplateStyle.metadata?.['tileflow:poi'], 'balanced');
  assert.deepEqual(labelsPoiTemplateStyle.sprite, [
    {
      id: 'default',
      url: 'https://api.tileflow.dev/sprites/osm-bright/sprite',
    },
    {
      id: 'tileflow',
      url: '/tileflow/icons/madrid/sprite',
    },
  ]);
  assert.equal(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'highway-name-major')?.layout?.[
      'visibility'
    ],
    'none',
  );
  assert.equal(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'highway-shield')?.layout?.[
      'text-field'
    ],
    '{ref}',
  );
  assert.equal(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'highway-shield')?.layout?.[
      'visibility'
    ],
    'none',
  );
  assert.equal(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'place-village')?.layout?.[
      'visibility'
    ],
    'none',
  );
  assert.deepEqual(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'poi-level-1')?.filter,
    [
      'all',
      [
        'all',
        ['==', '$type', 'Point'],
        ['<=', 'rank', 14],
        ['has', 'name'],
        ['any', ['!has', 'level'], ['==', 'level', 0]],
      ],
      [
        'any',
        [
          'in',
          'class',
          'restaurant',
          'fast_food',
          'bar',
          'pub',
          'biergarten',
          'cafe',
          'museum',
          'gallery',
          'art_gallery',
          'theatre',
          'cinema',
          'library',
          'attraction',
          'garden',
          'monument',
        ],
        [
          'in',
          'subclass',
          'restaurant',
          'fast_food',
          'bar',
          'pub',
          'biergarten',
          'cafe',
          'museum',
          'gallery',
          'art_gallery',
          'theatre',
          'cinema',
          'library',
          'attraction',
          'garden',
          'monument',
        ],
      ],
    ],
  );
  assert.ok(
    expressionContains(
      labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'poi-level-1')?.layout?.[
        'icon-image'
      ],
      'tileflow:food',
    ),
  );

  const lodgingFromOfficialTaxonomy = createStyle({
    basemap: osm(),
    modules: [poi({categories: ['lodging'], icons: 'essential', preset: 'full'})],
    renderer: 'generated',
  });
  const lodgingLayer = lodgingFromOfficialTaxonomy.layers.find(
    (layer) => layer.id === 'poi-labels',
  );
  assert.ok(
    JSON.stringify(lodgingLayer?.filter).includes(
      JSON.stringify(['in', 'subclass', 'lodging', 'hotel', 'motel', 'hostel', 'guest_house']),
    ),
  );
  assert.ok(expressionContains(lodgingLayer?.layout?.['icon-image'], 'lodging_11'));

  assert.throws(
    () =>
      createStyle({
        basemap: osm(),
        typography: {font: 'Noto Sans', weight: 'medium'},
      }),
    /Tileflow-hosted Noto Sans does not provide the medium weight/,
  );
  const customMediumGlyphs = createStyle({
    basemap: osm(),
    glyphs: 'https://fonts.example.com/{fontstack}/{range}.pbf',
    typography: {font: 'Noto Sans', weight: 'medium'},
  });
  assert.equal(customMediumGlyphs.glyphs, 'https://fonts.example.com/{fontstack}/{range}.pbf');
  assert.equal(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'airport-label-major')?.minzoom,
    10,
  );
  assert.equal(
    labelsPoiTemplateStyle.layers.find((layer) => layer.id === 'airport-label-major')?.layout?.[
      'icon-image'
    ],
    'airport_11',
  );

  const defaultLabelsStyle = createStyle({
    basemap: osm(),
    modules: [labels()],
    theme: 'light',
  });
  assert.deepEqual(defaultLabelsStyle.metadata?.['tileflow:labelsModule'], {
    language: 'auto',
    places: 'major',
    roads: 'major',
    water: 'major',
  });
  assert.equal(defaultLabelsStyle.metadata?.['tileflow:labels'], 'essential');

  const jsonLabelsStyle = createStyle({
    basemap: osm(),
    modules: [{type: 'labels'}],
    theme: 'light',
  });
  assert.deepEqual(
    jsonLabelsStyle.metadata?.['tileflow:labelsModule'],
    defaultLabelsStyle.metadata?.['tileflow:labelsModule'],
  );
  assert.equal(
    defaultLabelsStyle.layers.find((layer) => layer.id === 'highway-name-minor')?.layout?.[
      'visibility'
    ],
    'none',
  );
  assert.equal(
    JSON.stringify(
      defaultLabelsStyle.layers.find((layer) => layer.id === 'waterway-name')?.filter,
    ).includes(JSON.stringify(['==', 'class', 'river'])),
    true,
  );

  const generatedLabelsStyle = createStyle({
    basemap: osm(),
    modules: [
      labels({language: 'en', places: 'all', roads: 'all', water: 'all'}),
      roads({detail: 'streets'}),
    ],
    renderer: 'generated',
  });
  assert.equal(
    generatedLabelsStyle.layers.some((layer) => layer.id === 'road-labels-major'),
    true,
  );
  assert.equal(
    generatedLabelsStyle.layers.some((layer) => layer.id === 'road-labels-minor'),
    true,
  );
  assert.equal(
    JSON.stringify(
      generatedLabelsStyle.layers.find((layer) => layer.id === 'road-labels-minor')?.filter,
    ).includes('service'),
    false,
  );
  assert.equal(
    generatedLabelsStyle.layers.find((layer) => layer.id === 'road-labels-major')?.['source-layer'],
    'transportation_name',
  );
  assert.equal(
    generatedLabelsStyle.layers.find((layer) => layer.id === 'water-labels')?.['source-layer'],
    'water_name',
  );
  assert.equal(
    generatedLabelsStyle.layers.find((layer) => layer.id === 'waterway-labels')?.['source-layer'],
    'waterway',
  );

  const highwaysWithAllLabels = createStyle({
    basemap: osm(),
    modules: [labels({roads: 'all'}), roads({detail: 'highways'})],
    theme: 'light',
  });
  assert.equal(
    highwaysWithAllLabels.layers.find((layer) => layer.id === 'highway-name-minor')?.layout?.[
      'visibility'
    ],
    'none',
  );
  assert.equal(
    JSON.stringify(
      highwaysWithAllLabels.layers.find((layer) => layer.id === 'highway-name-major')?.filter,
    ).includes(JSON.stringify(['in', 'class', 'motorway', 'trunk'])),
    true,
  );

  const generatedPoiIconsStyle = createStyle({
    basemap: osm(),
    icons: {
      sprite: '/tileflow/icons/madrid/sprite',
    },
    modules: [roads(), poi({icons: 'essential', preset: 'full'})],
    renderer: 'generated',
  });
  assert.ok(
    expressionContains(
      generatedPoiIconsStyle.layers.find((layer) => layer.id === 'poi-labels')?.layout?.[
        'icon-image'
      ],
      'tileflow:food',
    ),
  );

  const rootIconSetStyle = createStyleFromProject(
    defineTileflow({
      icons: {
        brand: {
          mapping: {
            food: 'brand-food',
          },
          sprite: 'https://cdn.example.com/tileflow/brand/sprite',
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          icons: 'brand',
          modules: [poi({categories: ['food'], icons: 'essential', preset: 'balanced'})],
        },
      },
    }),
    'madrid',
  );
  assert.deepEqual(rootIconSetStyle.sprite, [
    {
      id: 'default',
      url: 'https://api.tileflow.dev/sprites/osm-bright/sprite',
    },
    {
      id: 'tileflow',
      url: 'https://cdn.example.com/tileflow/brand/sprite',
    },
  ]);
  assert.ok(
    expressionContains(
      rootIconSetStyle.layers.find((layer) => layer.id === 'poi-level-1')?.layout?.['icon-image'],
      'tileflow:brand-food',
    ),
  );
  assert.equal(
    validateConfig(
      defineTileflow({
        icons: {
          brand: {
            extends: 'brand',
          },
        },
        maps: {
          madrid: {
            basemap: osm(),
            icons: 'brand',
          },
        },
      }),
    ).valid,
    false,
  );

  const denseRoadsStyle = createStyle({
    basemap: osm(),
    modules: [roads({hierarchy: 'strong'})],
  });
  assert.equal(denseRoadsStyle.metadata?.['tileflow:roads'], 'detailed');
});

test('resolves semantic POI policy consistently across renderers', () => {
  for (const renderer of ['osm-bright', 'generated'] as const) {
    const style = createStyle({
      basemap: osm(),
      modules: [
        poi({
          categories: ['food', 'lodging'],
          classMapping: {food: ['bakery']},
          color: 'category',
          density: 'sparse',
          icons: 'essential',
          placement: {
            coupleIconAndLabel: true,
            iconPadding: 7,
            textPadding: 5,
          },
          preset: 'full',
        }),
      ],
      renderer,
    });
    const layer = style.layers.find((candidate) =>
      renderer === 'generated' ? candidate.id === 'poi-labels' : candidate.id === 'poi-level-1',
    );

    assert.ok(layer);
    assert.ok(expressionContains(layer.filter, 'bakery'));
    assert.ok(expressionContains(layer.filter, 'hotel'));
    assert.ok(expressionContains(layer.filter, 6));
    const resolvedColors = style.metadata?.['tileflow:colors'] as {
      poi: {food: string};
    };
    assert.ok(expressionContains(layer.paint?.['text-color'], resolvedColors.poi.food));
    assert.ok(expressionContains(layer.layout?.['icon-image'], 'lodging_11'));
    assert.equal(layer.layout?.['icon-optional'], false);
    assert.equal(layer.layout?.['icon-padding'], 7);
    assert.equal(layer.layout?.['text-padding'], 5);
    assert.ok(Array.isArray(layer.layout?.['symbol-sort-key']));

    const metadata = style.metadata?.['tileflow:poiModule'] as Record<string, unknown> | undefined;
    assert.ok(metadata);
    assert.equal(metadata.color, 'category');
    assert.equal(metadata.density, 'sparse');
    assert.deepEqual((metadata.classMapping as Record<string, string[]>).food, [
      'restaurant',
      'fast_food',
      'bar',
      'pub',
      'biergarten',
      'bakery',
    ]);
  }

  const legacy = createStyle({
    basemap: osm(),
    modules: [poi({preset: 'balanced'})],
    renderer: 'generated',
  });
  const legacyLayer = legacy.layers.find((candidate) => candidate.id === 'poi-labels');
  assert.equal(legacyLayer?.layout?.['symbol-sort-key'], undefined);
  assert.equal(legacyLayer?.filter, undefined);
});

test('inherits and applies domain typography across renderers', () => {
  for (const renderer of ['osm-bright', 'generated'] as const) {
    const style = createStyle({
      basemap: osm(),
      glyphs: 'https://fonts.example.com/{fontstack}/{range}.pbf',
      modules: [poi({preset: 'full'})],
      renderer,
      typography: {
        font: 'Inter',
        places: {weight: 'bold'},
        poi: {font: 'Brand Sans', weight: 'semibold'},
        roads: {fontFamily: 'Road Sans'},
        water: {font: 'Water Sans', weight: 'medium'},
      },
    });
    const typography = style.metadata?.['tileflow:typography'] as Record<string, unknown>;
    assert.deepEqual(typography.places, {
      font: 'Inter',
      fontFamily: 'Inter',
      weight: 'bold',
    });
    assert.deepEqual(typography.roads, {
      font: 'Road Sans',
      fontFamily: 'Road Sans',
      weight: 'regular',
    });
    assert.deepEqual(typography.water, {
      font: 'Water Sans',
      fontFamily: 'Water Sans',
      weight: 'medium',
    });
    assert.deepEqual(typography.poi, {
      font: 'Brand Sans',
      fontFamily: 'Brand Sans',
      weight: 'semibold',
    });

    const layerIds =
      renderer === 'generated'
        ? {
            places: 'place-labels',
            roads: 'road-labels-major',
            water: 'water-labels',
            poi: 'poi-labels',
          }
        : {
            places: 'place-city',
            roads: 'highway-name-major',
            water: 'water-name-ocean',
            poi: 'poi-level-1',
          };
    const expectedFonts = {
      places: ['Inter Bold'],
      roads: ['Road Sans Regular'],
      water: ['Water Sans Medium'],
      poi: ['Brand Sans Semibold'],
    };
    for (const domain of ['places', 'roads', 'water', 'poi'] as const) {
      assert.deepEqual(
        style.layers.find((layer) => layer.id === layerIds[domain])?.layout?.['text-font'],
        expectedFonts[domain],
        `${renderer}/${domain}`,
      );
    }
  }

  assert.throws(
    () =>
      createStyle({
        basemap: osm(),
        typography: {roads: {font: 'Noto Sans', weight: 'semibold'}},
      }),
    /semibold weight for roads typography/,
  );
});

test('resolves every road label level and intersects it with visible roads', () => {
  const roadClassLevels = {
    none: [],
    highways: ['motorway', 'trunk'],
    major: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
    streets: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'],
    all: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track'],
  } as const;
  const labelLevels = Object.keys(roadClassLevels) as Array<keyof typeof roadClassLevels>;
  const renderers = ['osm-bright', 'generated'] as const;

  for (const labelLevel of labelLevels) {
    assert.deepEqual(labels({roads: labelLevel}), {type: 'labels', roads: labelLevel});

    const helperStyle = createStyle({
      basemap: osm(),
      modules: [labels({roads: labelLevel}), roads({detail: 'all'})],
      renderer: 'generated',
    });
    const jsonStyle = createStyle({
      basemap: osm(),
      modules: [
        {type: 'labels', roads: labelLevel},
        {type: 'roads', detail: 'all'},
      ],
      renderer: 'generated',
    });

    assert.deepEqual(
      jsonStyle.metadata?.['tileflow:labelsModule'],
      helperStyle.metadata?.['tileflow:labelsModule'],
    );
    assert.deepEqual(generatedRoadLabelClasses(jsonStyle), generatedRoadLabelClasses(helperStyle));

    const templateStyle = createStyle({
      basemap: osm(),
      modules: [labels({roads: labelLevel})],
      renderer: 'osm-bright',
    });
    const expectedTemplateClasses = [
      ...roadClassLevels[labelLevel],
      ...(labelLevel === 'all' ? ['path'] : []),
    ].sort();

    assert.deepEqual(
      osmBrightRoadLabelClasses(templateStyle),
      expectedTemplateClasses,
      `osm-bright without roads(): labels.roads=${labelLevel}`,
    );
  }

  for (const renderer of renderers) {
    for (const labelLevel of labelLevels) {
      for (const roadLevel of labelLevels) {
        const style = createStyle({
          basemap: osm(),
          modules: [labels({roads: labelLevel}), roads({detail: roadLevel})],
          renderer,
        });
        const requestedClasses = new Set<string>(roadClassLevels[labelLevel]);
        const expectedClasses = roadClassLevels[roadLevel].filter((roadClass) =>
          requestedClasses.has(roadClass),
        );
        const actualClasses =
          renderer === 'generated'
            ? generatedRoadLabelClasses(style)
            : osmBrightRoadLabelClasses(style);

        assert.deepEqual(
          actualClasses,
          [...expectedClasses].sort(),
          `${renderer}: labels.roads=${labelLevel}, roads.detail=${roadLevel}`,
        );
      }
    }
  }

  for (const renderer of renderers) {
    const style = createStyle({
      basemap: osm(),
      modules: [labels({roads: 'all'}), roads({detail: 'highways', extras: {paths: true}})],
      renderer,
    });
    const actualClasses =
      renderer === 'generated'
        ? generatedRoadLabelClasses(style)
        : osmBrightRoadLabelClasses(style);

    assert.deepEqual(
      actualClasses,
      ['motorway', 'path', 'trunk'],
      `${renderer}: enabled paths remain eligible with highways-only road detail`,
    );
  }
});

test('resolves base, legacy, and module color overrides', () => {
  const brandProject = defineTileflow({
    themes: {
      brand: {
        extends: 'light',
        colors: {
          roadMajor: '#123456',
        },
        modules: {
          roads: {
            primary: '#ABCDEF',
          },
          labels: {
            halo: '#FEDCBA',
          },
        },
        typography: {
          fontFamily: 'Inter',
        },
      },
    },
    maps: {
      madrid: {
        basemap: osm(),
        modules: standardModules,
        renderer: 'generated',
        theme: 'brand',
      },
    },
  });
  assert.equal(validateConfig(brandProject).valid, true);
  const brandStyle = createStyleFromProject(brandProject, 'madrid');
  const brandRoadLayer = brandStyle.layers.find((layer) => layer.id === 'roads-major');
  const brandPlaceLabelLayer = brandStyle.layers.find((layer) => layer.id === 'place-labels');
  assert.equal(brandStyle.metadata?.['tileflow:theme'], 'brand');
  assert.equal(matchExpressionValue(brandRoadLayer?.paint?.['line-color'], 'primary'), '#ABCDEF');
  assert.equal(brandPlaceLabelLayer?.paint?.['text-halo-color'], '#FEDCBA');
  assert.deepEqual(brandStyle.metadata?.['tileflow:themeModules'], ['labels', 'roads']);

  const legacyNestedColorProject = defineTileflow({
    themes: {
      brand: {
        colors: {
          labels: {
            halo: '#ABC123',
          },
          roads: {
            primary: '#654321',
          },
        },
      },
    },
    maps: {
      madrid: {
        basemap: osm(),
        modules: standardModules,
        renderer: 'generated',
        theme: 'brand',
      },
    },
  });
  assert.equal(validateConfig(legacyNestedColorProject).valid, true);
  const legacyNestedColorStyle = createStyleFromProject(legacyNestedColorProject, 'madrid');
  assert.equal(
    matchExpressionValue(
      legacyNestedColorStyle.layers.find((layer) => layer.id === 'roads-major')?.paint?.[
        'line-color'
      ],
      'primary',
    ),
    '#654321',
  );
  assert.equal(
    legacyNestedColorStyle.layers.find((layer) => layer.id === 'place-labels')?.paint?.[
      'text-halo-color'
    ],
    '#ABC123',
  );

  const baseRoadColorStyle = createStyle({
    theme: {
      colors: {
        road: '#FFFFFF',
        roadMajor: '#F5D58A',
      },
    },
  });
  assert.equal(baseRoadColorStyle.metadata?.['tileflow:colors']?.roads.motorway, '#F5D58A');

  const legacyAccentStyle = createStyle({
    theme: {
      colors: {
        accent: '#FF0000',
      },
    },
  });
  assert.deepEqual(
    legacyAccentStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint,
  );

  const legacyMapAccentStyle = createStyle({
    basemap: osm(),
    colors: {
      accent: '#FF0000',
    },
  });
  assert.equal(legacyMapAccentStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.deepEqual(
    legacyMapAccentStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint,
  );

  const emptyMapColorsStyle = createStyle({
    basemap: osm(),
    colors: {},
  });
  assert.equal(emptyMapColorsStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.deepEqual(
    emptyMapColorsStyle.layers.find((layer) => layer.id === 'background')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'background')?.paint,
  );

  const mapEffectiveColorStyle = createStyle({
    basemap: osm(),
    colors: {
      roadMajor: '#123456',
      water: '#A9D3F5',
    },
  });
  assert.equal(
    mapEffectiveColorStyle.layers.find((layer) => layer.id === 'water')?.paint?.['fill-color'],
    '#A9D3F5',
  );
  assert.equal(
    matchExpressionValue(
      mapEffectiveColorStyle.layers.find((layer) => layer.id === 'roads-major')?.paint?.[
        'line-color'
      ],
      'primary',
    ),
    '#123456',
  );

  const modularBaseRoadsStyle = createStyle({
    basemap: osm(),
    modules: standardModules,
    renderer: 'generated',
    theme: 'light',
  });
  const modularAccentRoadsStyle = createStyle({
    basemap: osm(),
    modules: standardModules,
    renderer: 'generated',
    theme: {
      colors: {
        accent: '#FF0000',
      },
    },
  });
  const modularBaseRoadMajorColor = modularBaseRoadsStyle.layers.find(
    (layer) => layer.id === 'roads-major',
  )?.paint?.['line-color'];
  const modularAccentRoadMajorColor = modularAccentRoadsStyle.layers.find(
    (layer) => layer.id === 'roads-major',
  )?.paint?.['line-color'];
  assert.equal(
    matchExpressionValue(modularAccentRoadMajorColor, 'primary'),
    matchExpressionValue(modularBaseRoadMajorColor, 'primary'),
  );
  assert.equal(
    matchExpressionValue(modularAccentRoadMajorColor, 'motorway'),
    matchExpressionValue(modularBaseRoadMajorColor, 'motorway'),
  );
  assert.equal(expressionContainsColor(modularAccentRoadMajorColor, '#FF0000'), false);

  const modularMapAccentRoadsStyle = createStyle({
    basemap: osm(),
    colors: {
      accent: '#FF0000',
    },
    modules: standardModules,
    renderer: 'generated',
    theme: 'light',
  });
  const modularMapAccentRoadMajorColor = modularMapAccentRoadsStyle.layers.find(
    (layer) => layer.id === 'roads-major',
  )?.paint?.['line-color'];
  assert.equal(
    matchExpressionValue(modularMapAccentRoadMajorColor, 'primary'),
    matchExpressionValue(modularBaseRoadMajorColor, 'primary'),
  );
  assert.equal(expressionContainsColor(modularMapAccentRoadMajorColor, '#FF0000'), false);

  const conservativeRoadThemeStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          colors: {
            roadMajor: '#123456',
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    conservativeRoadThemeStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint?.[
      'line-color'
    ],
    '#123456',
  );
  assert.deepEqual(
    conservativeRoadThemeStyle.layers.find((layer) => layer.id === 'highway-primary-casing')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'highway-primary-casing')?.paint,
  );

  const partialRoadModuleThemeStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          modules: {
            roads: {
              rail: '#556677',
            },
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.deepEqual(
    partialRoadModuleThemeStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint,
  );
  assert.equal(
    partialRoadModuleThemeStyle.layers.find((layer) => layer.id === 'railway')?.paint?.[
      'line-color'
    ],
    '#556677',
  );

  const combinedRoadBaseAndModuleStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          colors: {
            roadMajor: '#123456',
          },
          modules: {
            roads: {
              rail: '#556677',
            },
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    combinedRoadBaseAndModuleStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint?.[
      'line-color'
    ],
    '#123456',
  );
  assert.equal(
    combinedRoadBaseAndModuleStyle.layers.find((layer) => layer.id === 'railway')?.paint?.[
      'line-color'
    ],
    '#556677',
  );

  const primaryOnlyRoadModuleStyle = createStyle({
    basemap: osm(),
    theme: {
      modules: {
        roads: {
          primary: '#112233',
        },
      },
    },
  });
  assert.equal(
    primaryOnlyRoadModuleStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint?.[
      'line-color'
    ],
    '#112233',
  );
  assert.deepEqual(
    primaryOnlyRoadModuleStyle.layers.find((layer) => layer.id === 'highway-trunk')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'highway-trunk')?.paint,
  );

  const tunnelRoadModuleStyle = createStyle({
    basemap: osm(),
    theme: {
      modules: {
        roads: {
          tunnel: '#010203',
        },
      },
    },
  });
  assert.equal(
    tunnelRoadModuleStyle.layers.find((layer) => layer.id === 'tunnel-minor')?.paint?.[
      'line-color'
    ],
    '#010203',
  );
  assert.equal(
    tunnelRoadModuleStyle.layers.find((layer) => layer.id === 'tunnel-path')?.paint?.['line-color'],
    '#010203',
  );
  assert.equal(
    tunnelRoadModuleStyle.layers.find((layer) => layer.id === 'tunnel-railway')?.paint?.[
      'line-color'
    ],
    '#010203',
  );

  const bridgeRoadModuleStyle = createStyle({
    basemap: osm(),
    theme: {
      modules: {
        roads: {
          bridge: '#020304',
        },
      },
    },
  });
  assert.equal(
    bridgeRoadModuleStyle.layers.find((layer) => layer.id === 'bridge-minor')?.paint?.[
      'line-color'
    ],
    '#020304',
  );
  assert.equal(
    bridgeRoadModuleStyle.layers.find((layer) => layer.id === 'bridge-path')?.paint?.['line-color'],
    '#020304',
  );
  assert.equal(
    bridgeRoadModuleStyle.layers.find((layer) => layer.id === 'bridge-railway')?.paint?.[
      'line-color'
    ],
    '#020304',
  );

  const haloOnlyLabelModuleStyle = createStyle({
    basemap: osm(),
    theme: {
      modules: {
        labels: {
          halo: '#FEDCBA',
        },
      },
    },
  });
  assert.deepEqual(
    haloOnlyLabelModuleStyle.layers.find((layer) => layer.id === 'place-city')?.paint?.[
      'text-color'
    ],
    osmBrightStyle.layers.find((layer) => layer.id === 'place-city')?.paint?.['text-color'],
  );
  assert.equal(
    haloOnlyLabelModuleStyle.layers.find((layer) => layer.id === 'place-city')?.paint?.[
      'text-halo-color'
    ],
    '#FEDCBA',
  );

  const partialHydroModuleStyle = createStyle({
    basemap: osm(),
    theme: {
      modules: {
        hydro: {
          waterway: '#334455',
        },
      },
    },
  });
  assert.deepEqual(
    partialHydroModuleStyle.layers.find((layer) => layer.id === 'water')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'water')?.paint,
  );
  assert.equal(
    partialHydroModuleStyle.layers.find((layer) => layer.id === 'waterway-river')?.paint?.[
      'line-color'
    ],
    '#334455',
  );

  const generatedRoadModuleColorsStyle = createStyle({
    basemap: osm(),
    modules: standardModules,
    renderer: 'generated',
    theme: {
      modules: {
        roads: {
          ferry: '#667788',
          motorway: '#FF0000',
          path: '#778899',
          rail: '#556677',
          secondary: '#00FF00',
          trunk: '#0000FF',
        },
      },
    },
  });
  const generatedRoadMajorColor = generatedRoadModuleColorsStyle.layers.find(
    (layer) => layer.id === 'roads-major',
  )?.paint?.['line-color'];
  assert.equal(matchExpressionValue(generatedRoadMajorColor, 'motorway'), '#FF0000');
  assert.equal(matchExpressionValue(generatedRoadMajorColor, 'trunk'), '#0000FF');
  assert.equal(matchExpressionValue(generatedRoadMajorColor, 'secondary'), '#00FF00');
  assert.equal(
    generatedRoadModuleColorsStyle.layers.find((layer) => layer.id === 'roads-rail')?.paint?.[
      'line-color'
    ],
    '#556677',
  );
  assert.equal(
    generatedRoadModuleColorsStyle.layers.find((layer) => layer.id === 'roads-paths')?.paint?.[
      'line-color'
    ],
    '#778899',
  );
  assert.equal(
    generatedRoadModuleColorsStyle.layers.find((layer) => layer.id === 'roads-ferry')?.paint?.[
      'line-color'
    ],
    '#667788',
  );

  const generatedCasingOnlyRoadStyle = createStyle({
    basemap: osm(),
    modules: standardModules,
    renderer: 'generated',
    theme: {
      modules: {
        roads: {
          casing: '#FF0000',
        },
      },
    },
  });
  assert.equal(
    generatedCasingOnlyRoadStyle.layers.find((layer) => layer.id === 'roads-casing')?.paint?.[
      'line-color'
    ],
    '#FF0000',
  );
  assert.equal(
    generatedCasingOnlyRoadStyle.layers.find((layer) => layer.id === 'roads-tunnels-casing')
      ?.paint?.['line-color'],
    modularBaseRoadsStyle.layers.find((layer) => layer.id === 'roads-tunnels-casing')?.paint?.[
      'line-color'
    ],
  );

  const baseRoadThemeStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          colors: {
            road: '#111111',
            roadCasing: '#333333',
            roadMajor: '#222222',
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    baseRoadThemeStyle.layers.find((layer) => layer.id === 'highway-minor')?.paint?.['line-color'],
    '#111111',
  );
  assert.equal(
    baseRoadThemeStyle.layers.find((layer) => layer.id === 'highway-primary')?.paint?.[
      'line-color'
    ],
    '#222222',
  );
  assert.equal(
    baseRoadThemeStyle.layers.find((layer) => layer.id === 'highway-primary-casing')?.paint?.[
      'line-color'
    ],
    '#333333',
  );
  assert.deepEqual(
    baseRoadThemeStyle.layers.find((layer) => layer.id === 'highway-path-steps-casing')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'highway-path-steps-casing')?.paint,
  );
  assert.deepEqual(
    baseRoadThemeStyle.layers.find((layer) => layer.id === 'ferry')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'ferry')?.paint,
  );
  assert.deepEqual(
    baseRoadThemeStyle.layers.find((layer) => layer.id === 'railway')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'railway')?.paint,
  );

  const moduleRoadThemeStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          modules: {
            roads: {
              bridge: '#223344',
              casing: '#8899AA',
              ferry: '#667788',
              minor: '#445566',
              path: '#778899',
              primary: '#112233',
              rail: '#556677',
              secondary: '#BBCCDD',
              tunnel: '#010203',
            },
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'tunnel-minor')?.paint?.['line-color'],
    '#010203',
  );
  assert.equal(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'highway-link')?.paint?.['line-color'],
    '#112233',
  );
  assert.equal(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'bridge-minor')?.paint?.['line-color'],
    '#223344',
  );
  assert.equal(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'railway')?.paint?.['line-color'],
    '#556677',
  );
  assert.equal(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'ferry')?.paint?.['line-color'],
    '#667788',
  );
  assert.equal(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'highway-path')?.paint?.['line-color'],
    '#778899',
  );
  assert.deepEqual(
    moduleRoadThemeStyle.layers.find((layer) => layer.id === 'cablecar')?.paint,
    osmBrightStyle.layers.find((layer) => layer.id === 'cablecar')?.paint,
  );
});

test('compiles semantic landuse, landcover, and building height bands', () => {
  const style = createStyle({
    basemap: osm(),
    buildingStyle: {
      fillOpacity: 0.9,
      heightThreshold: 12,
      outlineOpacity: 0.65,
      outlineWidth: 0.75,
    },
    buildings: 'flat',
    density: 'dense',
    renderer: 'generated',
    theme: {
      extends: 'light',
      modules: {
        buildings: {
          highRise: '#E8E9ED',
          highRiseOutline: '#D4DBE4',
          lowRise: '#FAF5EC',
          lowRiseOutline: '#EADFCD',
        },
        landcover: {
          grass: '#C3F1D5',
          protected: '#B7E9CC',
          wood: '#AFE0C7',
        },
        landuse: {
          civic: '#F5F6F8',
          commercial: '#FFF5E9',
          industrial: '#EEF0F4',
          residential: '#FFF8F0',
        },
      },
    },
  });
  const landuse = style.layers.find((layer) => layer.id === 'landuse');
  const landcover = style.layers.find((layer) => layer.id === 'landcover');
  const buildings = style.layers.find((layer) => layer.id === 'buildings');
  const outline = style.layers.find((layer) => layer.id === 'buildings-outline');

  assert.ok(expressionContains(landuse?.paint?.['fill-color'], '#FFF5E9'));
  assert.ok(expressionContains(landuse?.paint?.['fill-color'], '#EEF0F4'));
  assert.ok(expressionContains(landcover?.paint?.['fill-color'], '#AFE0C7'));
  assert.ok(expressionContains(landcover?.paint?.['fill-color'], '#B7E9CC'));
  assert.ok(expressionContains(buildings?.paint?.['fill-color'], '#E8E9ED'));
  assert.ok(expressionContains(buildings?.paint?.['fill-color'], '#FAF5EC'));
  assert.ok(expressionContains(buildings?.paint?.['fill-color'], 12));
  assert.equal(buildings?.paint?.['fill-opacity'], 0.9);
  assert.ok(expressionContains(outline?.paint?.['line-color'], '#D4DBE4'));
  assert.ok(expressionContains(outline?.paint?.['line-color'], '#EADFCD'));
  assert.equal(outline?.paint?.['line-opacity'], 0.65);
  assert.equal(outline?.paint?.['line-width'], 0.75);
  assert.deepEqual(style.metadata?.['tileflow:buildingStyle'], {
    fillOpacity: 0.9,
    heightThreshold: 12,
    outlineOpacity: 0.65,
    outlineWidth: 0.75,
  });

  assert.throws(
    () =>
      createStyle({
        basemap: osm(),
        buildingStyle: {heightThreshold: 12},
        renderer: 'osm-bright',
      }),
    /renderer "osm-bright" is not compatible/,
  );
});

test('pins portable tile-source versions in URLs and metadata', () => {
  const direct = createStyle({
    basemap: osm({url: 'https://tiles.example.com/world.json?language=en'}),
    tiles: {version: '2026-08-13.1'},
  });
  assert.equal(
    direct.sources.tileflow.url,
    'https://tiles.example.com/world.json?language=en&archiveVersion=2026-08-13.1',
  );
  assert.equal(direct.metadata?.['tileflow:tilesetVersion'], '2026-08-13.1');

  const inherited = createStyleFromProject(
    defineTileflow({
      tilesets: {
        world: {
          id: 'public-world',
          version: 'archive_42',
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          tileset: 'world',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    inherited.sources.tileflow.url,
    'https://api.tileflow.dev/tiles/public-world/tiles.json?archiveVersion=archive_42',
  );
  assert.equal(inherited.metadata?.['tileflow:tilesetVersion'], 'archive_42');

  const overridden = createStyleFromProject(
    defineTileflow({
      tilesets: {world: {version: 'tileset-version'}},
      maps: {
        madrid: {
          basemap: osm({version: 'basemap-version'}),
          tiles: {version: 'map-version'},
          tileset: 'world',
        },
      },
    }),
    'madrid',
  );
  assert.match(String(overridden.sources.tileflow.url), /archiveVersion=map-version/);
  assert.equal(overridden.metadata?.['tileflow:tilesetVersion'], 'map-version');

  assert.equal(
    validateConfig(
      defineTileflow({maps: {madrid: {tiles: {version: 'unsafe/version?token=secret'}}}}),
    ).valid,
    false,
  );
});

test('applies style overrides, layer precedence, source layers, and legacy roads', () => {
  const overrideStyle = createStyle({
    basemap: osm(),
    modules: [
      styleOverride({
        layers: {
          background: {
            paint: {
              'background-color': '#000000',
            },
          },
        },
      }),
    ],
    theme: 'light',
  });
  const overrideBackgroundLayer = overrideStyle.layers.find((layer) => layer.id === 'background');
  assert.equal(overrideStyle.metadata?.['tileflow:template'], 'openmaptiles-osm-bright');
  assert.deepEqual(overrideStyle.metadata?.['tileflow:modules'], ['styleOverride']);
  assert.equal(overrideBackgroundLayer?.paint?.['background-color'], '#000000');

  const themeLayerStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          layers: {
            background: {
              paint: {
                'background-color': '#101010',
              },
            },
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    themeLayerStyle.layers.find((layer) => layer.id === 'background')?.paint?.['background-color'],
    '#101010',
  );

  const mapLayerStyle = createStyle({
    layers: {
      background: {
        paint: {
          'background-color': '#202020',
        },
      },
    },
    theme: 'light',
  });
  assert.equal(
    mapLayerStyle.layers.find((layer) => layer.id === 'background')?.paint?.['background-color'],
    '#202020',
  );

  const layerPrecedenceStyle = createStyleFromProject(
    defineTileflow({
      themes: {
        brand: {
          extends: 'light',
          layers: {
            background: {
              paint: {
                'background-color': '#101010',
              },
            },
          },
        },
      },
      maps: {
        madrid: {
          basemap: osm(),
          layers: {
            background: {
              paint: {
                'background-color': '#202020',
              },
            },
          },
          modules: [
            styleOverride({
              layers: {
                background: {
                  paint: {
                    'background-color': '#303030',
                  },
                },
              },
            }),
          ],
          theme: 'brand',
        },
      },
    }),
    'madrid',
  );
  assert.equal(
    layerPrecedenceStyle.layers.find((layer) => layer.id === 'background')?.paint?.[
      'background-color'
    ],
    '#303030',
  );

  const basemapProject = defineTileflow({
    tilesets: {
      regional: {
        id: 'regional-prod',
        attribution: 'Regional tiles',
        sourceLayers: {
          park: 'green_areas',
          road: 'transport',
          roadName: 'transport_names',
          waterName: 'water_names',
          waterway: 'waterways',
        },
      },
    },
    maps: {
      madrid: {
        basemap: osm({
          attribution: 'Basemap attribution',
          sourceLayers: {
            road: 'basemap_roads',
            roadName: 'basemap_road_names',
          },
          tileset: 'regional',
        }),
        modules: standardModules,
      },
    },
  });
  const basemapStyle = createStyleFromProject(basemapProject, 'madrid');
  assert.equal(basemapStyle.sources.tileflow.attribution, 'Basemap attribution');
  const basemapRoadLayer = basemapStyle.layers.find((layer) => layer.id === 'roads-major');
  assert.equal(basemapRoadLayer?.['source-layer'], 'basemap_roads');
  const basemapParkLayer = basemapStyle.layers.find((layer) => layer.id === 'parks');
  assert.equal(basemapParkLayer?.['source-layer'], 'green_areas');
  assert.equal(
    basemapStyle.layers.find((layer) => layer.id === 'road-labels-major')?.['source-layer'],
    'basemap_road_names',
  );
  assert.equal(
    basemapStyle.layers.find((layer) => layer.id === 'water-labels')?.['source-layer'],
    'water_names',
  );
  assert.equal(
    basemapStyle.layers.find((layer) => layer.id === 'waterway-labels')?.['source-layer'],
    'waterways',
  );

  const legacyStyle = createStyle({
    colors: {
      water: '#A9D3F5',
    },
    roads: 'hidden',
  });
  assert.equal(legacyStyle.metadata?.['tileflow:roads'], 'hidden');
  assert.equal(
    legacyStyle.layers.some((layer) => String(layer.id).startsWith('roads')),
    false,
  );
});

test('reports semantic and schema validation failures', () => {
  const invalidTheme = validateConfig(
    defineTileflow({
      maps: {
        madrid: {
          theme: 'missing-theme',
        },
      },
    }),
  );
  assert.equal(invalidTheme.valid, false);
  assert.equal(invalidTheme.messages[0]?.path, 'maps.madrid.theme');

  const invalidProjectThemeExtends = validateConfig({
    themes: {
      brand: {
        extends: 'missing-theme',
        colors: {
          water: '#8ED6E8',
        },
      },
    },
    maps: {
      madrid: {
        theme: 'brand',
      },
    },
  });
  assert.equal(invalidProjectThemeExtends.valid, false);
  assert.equal(invalidProjectThemeExtends.messages[0]?.path, 'themes.brand.extends');

  const invalidThemeModuleColor = validateConfig({
    themes: {
      brand: {
        modules: {
          roads: {
            primary: 'gold',
          },
        },
      },
    },
    maps: {
      madrid: {
        theme: 'brand',
      },
    },
  });
  assert.equal(invalidThemeModuleColor.valid, false);
  assert.equal(invalidThemeModuleColor.messages[0]?.path, 'themes.brand.modules.roads.primary');

  const validLayerShortcut = validateConfig({
    maps: {
      madrid: {
        layers: {
          background: {
            paint: {
              'background-color': '#202020',
            },
          },
        },
      },
    },
  });
  assert.equal(validLayerShortcut.valid, true);

  const removedRoadOptions = validateConfig({
    maps: {
      madrid: {
        modules: [
          {
            type: 'roads',
            preset: 'standard',
            density: 'dense',
            casing: 'strong',
          },
        ],
      },
    },
  });
  assert.equal(removedRoadOptions.valid, false);
  assert.match(removedRoadOptions.messages[0]?.message ?? '', /Unrecognized keys/);

  const highwaysRoadDetail = validateConfig({
    maps: {
      madrid: {
        modules: [{type: 'roads', detail: 'highways'}],
      },
    },
  });
  assert.equal(highwaysRoadDetail.valid, true);

  const removedLabelOptions = validateConfig({
    maps: {
      madrid: {
        modules: [{type: 'labels', preset: 'essential', roads: 'minimal'}],
      },
    },
  });
  assert.equal(removedLabelOptions.valid, false);

  for (const roadLabelDetail of ['none', 'highways', 'major', 'streets', 'all']) {
    const explicitLabelDetails = validateConfig({
      maps: {
        madrid: {
          modules: [{type: 'labels', places: 'none', roads: roadLabelDetail, water: 'all'}],
        },
      },
    });
    assert.equal(explicitLabelDetails.valid, true, `labels.roads=${roadLabelDetail}`);
  }

  const invalidRoadLabelDetail = validateConfig({
    maps: {
      madrid: {
        modules: [{type: 'labels', roads: 'local'}],
      },
    },
  });
  assert.equal(invalidRoadLabelDetail.valid, false);

  const typoConfig = validateConfig({
    maps: {
      madrid: {
        lables: 'full',
      },
    },
  });
  assert.equal(typoConfig.valid, false);

  const invalidMapName = validateConfig({
    maps: {
      '../oops': {},
    },
  });
  assert.equal(invalidMapName.valid, false);
});

function hasUndefinedTextFont(layers: Array<Record<string, unknown>>): boolean {
  return layers.some((layer) => {
    const layout = layer.layout;

    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      return false;
    }

    const textFont = (layout as Record<string, unknown>)['text-font'];

    return Array.isArray(textFont) && textFont.some((font) => String(font).includes('undefined'));
  });
}

function matchExpressionValue(expression: unknown, key: string): unknown {
  if (!Array.isArray(expression) || expression[0] !== 'match') {
    return undefined;
  }

  for (let index = 2; index < expression.length - 1; index += 2) {
    if (expression[index] === key) {
      return expression[index + 1];
    }
  }

  return undefined;
}

function expressionContainsColor(expression: unknown, color: string): boolean {
  return JSON.stringify(expression).includes(JSON.stringify(color));
}

function expressionContains(expression: unknown, value: string): boolean {
  return JSON.stringify(expression).includes(JSON.stringify(value));
}

function generatedRoadLabelClasses(style: ReturnType<typeof createStyle>): string[] {
  const classes = style.layers
    .filter((layer) => {
      const id = String(layer.id);

      return id.startsWith('road-label') || id === 'road-shields';
    })
    .flatMap((layer) => classNamesFromMatchFilter(layer.filter));

  return [...new Set(classes)].sort();
}

function osmBrightRoadLabelClasses(style: ReturnType<typeof createStyle>): string[] {
  const classes = style.layers
    .filter((layer) => {
      const id = String(layer.id);
      const layout = layer.layout as Record<string, unknown> | undefined;

      return (
        (layer['source-layer'] === 'transportation_name' ||
          id.includes('highway-name') ||
          id.includes('highway-shield')) &&
        layout?.visibility !== 'none'
      );
    })
    .flatMap((layer) => {
      const gate = appendedRoadClassGate(layer.filter);
      assert.ok(gate, `${String(layer.id)} is visible without a road-class gate`);

      return gate;
    });

  return [...new Set(classes)].sort();
}

function classNamesFromMatchFilter(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  if (
    value[0] === 'match' &&
    Array.isArray(value[1]) &&
    value[1][0] === 'get' &&
    value[1][1] === 'class' &&
    Array.isArray(value[2])
  ) {
    return value[2].filter((roadClass): roadClass is string => typeof roadClass === 'string');
  }

  return value.flatMap((entry) => classNamesFromMatchFilter(entry));
}

function appendedRoadClassGate(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value[0] !== 'all') return undefined;

  const candidate = value.at(-1);
  if (!Array.isArray(candidate) || candidate[0] !== 'in' || candidate[1] !== 'class') {
    return undefined;
  }

  return candidate
    .slice(2)
    .filter((roadClass): roadClass is string => typeof roadClass === 'string');
}
