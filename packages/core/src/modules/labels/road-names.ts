// Match whole road-type words only. Names, accents, route references and unsupported
// languages remain untouched; the caller has already selected the label language.
const prefixes = [
  ['Avenida ', 'Av. '],
  ['Calle ', 'C. '],
  ['Carretera ', 'Ctra. '],
  ['Paseo ', 'Pso. '],
  ['Plaza ', 'Pl. '],
  ['Ronda ', 'Rda. '],
  ['Boulevard ', 'Bd '],
  ['Avenue ', 'Av. '],
  ['Allée ', 'All. '],
  ['Chemin ', 'Chem. '],
  ['Route ', 'Rte '],
] as const;

const suffixes = [
  [' Street', ' St'],
  [' Avenue', ' Ave'],
  [' Boulevard', ' Blvd'],
  [' Road', ' Rd'],
  [' Drive', ' Dr'],
  [' Lane', ' Ln'],
  [' Highway', ' Hwy'],
  [' Parkway', ' Pkwy'],
  [' Court', ' Ct'],
  [' Place', ' Pl'],
  [' Terrace', ' Ter'],
] as const;

// Numeric street grids commonly shorten directions (West 34th Street -> W 34th St).
// Do not shorten proper names such as West End Avenue or North Road.
const directions = [
  ['North ', 'N '],
  ['South ', 'S '],
  ['East ', 'E '],
  ['West ', 'W '],
] as const;

/** A MapLibre expression, evaluated after localization and before text-transform. */
export function compactRoadNameExpression(name: readonly unknown[]): unknown[] {
  const value = ['var', 'road_name'];
  const upper = ['upcase', value];
  const length = ['length', value];
  const numberedValue = ['var', 'numbered_road_name'];
  const numberedName = [
    'case',
    ...directions.flatMap(([word, abbreviation]) => [
      [
        'all',
        ['==', ['slice', upper, 0, word.length], word.toUpperCase()],
        [
          'in',
          ['slice', value, word.length, word.length + 1],
          ['literal', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']],
        ],
      ],
      ['concat', abbreviation, ['slice', value, word.length]],
    ]),
    value,
  ];
  return [
    'let',
    'road_name',
    ['to-string', name],
    [
      'let',
      'numbered_road_name',
      numberedName,
      [
        'case',
        ...prefixes.flatMap(([word, abbreviation]) => [
          ['==', ['slice', upper, 0, word.length], word.toUpperCase()],
          ['concat', abbreviation, ['slice', value, word.length]],
        ]),
        ...suffixes.flatMap(([word, abbreviation]) => [
          ['==', ['slice', upper, ['max', 0, ['-', length, word.length]]], word.toUpperCase()],
          [
            'concat',
            ['slice', numberedValue, 0, ['-', ['length', numberedValue], word.length]],
            abbreviation,
          ],
        ]),
        value,
      ],
    ],
  ];
}
