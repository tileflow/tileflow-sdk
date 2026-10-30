import {
  expr,
  field,
  renderPass,
  type TileflowThemeImageValue,
  token,
  vegetation,
  withRenderStack,
  zoom,
} from '@tileflow/core';

// These are the top views of the map's own glTF trees, drawn as one atlas quad per mapped
// point. Core replaces the whole vegetation stack when an application shows its 3D trees.
const seed = expr.toNumber(expr.id(), 0);
const genus = expr.get(field('genus'));
const leaf = expr.get(field('leafType'));
const named = (names: readonly string[]) =>
  expr.match(
    genus,
    [{labels: names.flatMap((name) => [name, name.toLowerCase()]), value: true}],
    false,
  );
const image = (form: string) => token.image(`vegetation.tree.${form}`);
const broadleaf = expr.match(
  expr.modulo(seed, 3),
  [
    {labels: [0], value: image('round')},
    {labels: [1], value: image('open')},
  ],
  image('tall'),
);
const palm = expr.match(
  expr.modulo(seed, 2),
  [{labels: [0], value: image('palm-feather')}],
  image('palm-fan'),
);
const crownImage = expr.case<TileflowThemeImageValue>(
  [
    {
      when: expr.any(
        expr.eq(leaf, 'palm'),
        named([
          'Acoelorrhaphe',
          'Adonidia',
          'Archontophoenix',
          'Areca',
          'Bismarckia',
          'Brahea',
          'Butia',
          'Caryota',
          'Chamaedorea',
          'Chamaerops',
          'Coccothrinax',
          'Cocos',
          'Dypsis',
          'Elaeis',
          'Howea',
          'Jubaea',
          'Licuala',
          'Livistona',
          'Phoenix',
          'Pritchardia',
          'Ptychosperma',
          'Rhapis',
          'Roystonea',
          'Sabal',
          'Serenoa',
          'Syagrus',
          'Thrinax',
          'Trachycarpus',
          'Veitchia',
          'Washingtonia',
          'Wodyetia',
        ]),
      ),
      value: palm,
    },
    {when: named(['Cupressus', 'Calocedrus', 'Thuja']), value: image('columnar')},
    {
      when: expr.any(
        expr.eq(leaf, 'needleleaved'),
        named([
          'Abies',
          'Araucaria',
          'Cedrus',
          'Cryptomeria',
          'Juniperus',
          'Larix',
          'Metasequoia',
          'Picea',
          'Pinus',
          'Pseudotsuga',
          'Sequoia',
          'Sequoiadendron',
          'Taxodium',
          'Taxus',
          'Tsuga',
        ]),
      ),
      value: image('conifer'),
    },
    {
      when: named([
        'Acacia',
        'Albizia',
        'Arbutus',
        'Bursera',
        'Ceratonia',
        'Delonix',
        'Ficus',
        'Gleditsia',
        'Jacaranda',
        'Olea',
        'Quercus',
        'Robinia',
        'Schinus',
        'Sophora',
        'Styphnolobium',
        'Tamarix',
      ]),
      value: image('open'),
    },
    {
      when: named([
        'Betula',
        'Celtis',
        'Fraxinus',
        'Ginkgo',
        'Liquidambar',
        'Liriodendron',
        'Magnolia',
        'Platanus',
        'Populus',
        'Pyrus',
        'Ulmus',
        'Zelkova',
      ]),
      value: image('tall'),
    },
    {
      when: named([
        'Acer',
        'Aesculus',
        'Carpinus',
        'Castanea',
        'Catalpa',
        'Cercis',
        'Citrus',
        'Fagus',
        'Lagerstroemia',
        'Malus',
        'Melia',
        'Morus',
        'Prunus',
        'Sorbus',
        'Tilia',
      ]),
      value: image('round'),
    },
  ],
  broadleaf,
);

const diameter = expr.toNumber(expr.get(field('diameterCrown')), 0);
const crownFactor = expr.divide(
  expr.max(3, expr.min(18, expr.case([{when: expr.gt(diameter, 0), value: diameter}], 7))),
  7,
);
// The atlas leaves a six-pixel margin round the crown. With exponential interpolation the
// diameter doubles each zoom, rather than swelling at integer zoom boundaries.
const size = (divisor: number) =>
  expr.interpolate({kind: 'exponential', base: 2}, expr.zoom(), [
    [15, expr.multiply(crownFactor, 2.1 / divisor)],
    [22, expr.multiply(crownFactor, 268.8 / divisor)],
  ]);

export const streetsTrees = withRenderStack(
  vegetation({
    // Models stay 3D in overhead and tilted views; unsupported renderers omit trees.
    mode: '3d',
    fallback: 'none',
    visible: true,
    flat: {
      minZoom: 15.5,
      color: token.color('vegetation.tree.broadleaf.a'),
      radius: size(2),
      opacity: zoom.linear([
        [15.5, 0],
        [16, 0.12],
      ]),
      blur: 0.7,
      pitchAlignment: 'map',
      pitchScale: 'map',
      strokeOpacity: 0,
    },
    threeDimensional: {
      barkColor: token.color('vegetation.tree.bark'),
      broadleafColors: ['a', 'b', 'c', 'd'].map((shade) =>
        token.color(`vegetation.tree.broadleaf.${shade}`),
      ),
      coniferColors: ['a', 'b', 'c'].map((shade) =>
        token.color(`vegetation.tree.conifer.${shade}`),
      ),
      palmColors: ['a', 'b', 'c'].map((shade) => token.color(`vegetation.tree.broadleaf.${shade}`)),
      // The flat hedge's shade and fill, so a hedge keeps its colour as it rises.
      hedgeColors: [token.color('landcover.hedgeShade'), token.color('landcover.hedge')],
      crownScale: 1,
      heightScale: 1,
      minimumHeight: 6.4,
      materialVariation: 1,
      finish: 'smooth',
      edges: 0,
      forms: {
        round: {
          heightScale: 0.8,
          crownScale: 0.8,
          sizeAnchor: 8.5,
          crownAnchor: 4.8,
          sizeCompression: 0.5,
          models: ['streets-tree-round'],
        },
        open: {
          heightScale: 0.8,
          crownScale: 0.8,
          sizeAnchor: 8,
          crownAnchor: 5.2,
          sizeCompression: 0.5,
          models: ['streets-tree-open'],
        },
        tall: {
          heightScale: 0.8,
          crownScale: 0.8,
          sizeAnchor: 9.5,
          crownAnchor: 4.6,
          sizeCompression: 0.5,
          models: ['streets-tree-tall'],
        },
        conifer: {
          heightScale: 0.8,
          crownScale: 0.8,
          sizeAnchor: 9,
          crownAnchor: 4.5,
          sizeCompression: 0.5,
          models: ['streets-tree-conifer'],
        },
        columnar: {
          heightScale: 0.8,
          crownScale: 0.8,
          sizeAnchor: 10,
          crownAnchor: 2.4,
          sizeCompression: 0.5,
          models: ['streets-tree-columnar'],
        },
        palm: {
          heightScale: 0.8,
          crownScale: 0.8,
          sizeAnchor: 11,
          crownAnchor: 6,
          sizeCompression: 0.5,
          models: ['streets-tree-palm-feather', 'streets-tree-palm-fan'],
        },
      },
    },
  }),
  {
    crowns: renderPass({
      placement: {above: 'vegetation.trees'},
      // Inherit the optional tree binding from the anchor; generic OpenMapTiles omits it.
      requirements: ['vegetation'],
      renderer: 'symbol',
      selector: {kind: 'geometry', geometry: 'point'},
      style: {
        minZoom: 15.5,
        icon: {
          image: crownImage,
          size: size(52),
          opacity: zoom.linear([
            [15.5, 0],
            [16, 0.88],
            [18, 1],
          ]),
          rotate: expr.modulo(expr.multiply(seed, 137.508), 360),
          rotationAlignment: 'map',
          pitchAlignment: 'map',
          allowOverlap: true,
          ignorePlacement: true,
          padding: 0,
        },
      },
    }),
  },
);
