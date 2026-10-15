import {
  expr,
  field,
  type TileflowPoiCategory,
  type TileflowThemeImageValue,
  token,
} from '@tileflow/core';

type StreetsPoiPictogram = Readonly<{
  /** The disc takes this category's theme color. */
  category: TileflowPoiCategory;
  /** The CC0 Maki 8.2.0 icon the white pictogram is adapted from. */
  maki: string;
  title: string;
}>;

/**
 * Streets' POI pictograms. Each image is a disc in its category's color with a white pictogram;
 * the dark theme uses `<id>-dark`, a pale disc with a dark pictogram. The SVGs under
 * `assets/streets/icons` are generated from this table by
 * `scripts/generate-streets-poi-icons.ts`.
 */
export const streetsPoiPictograms = Object.freeze({
  'major-transit': {category: 'transport', maki: 'rail-metro', title: 'Metro'},
  rail: {category: 'transport', maki: 'rail', title: 'Railway station'},
  'rail-light': {category: 'transport', maki: 'rail-light', title: 'Tram or light rail'},
  bus: {category: 'transport', maki: 'bus', title: 'Bus'},
  ferry: {category: 'transport', maki: 'ferry', title: 'Ferry'},
  aerialway: {category: 'transport', maki: 'aerialway', title: 'Aerial cableway'},
  airport: {category: 'transport', maki: 'airport', title: 'Airport'},

  food: {category: 'food-drink', maki: 'restaurant', title: 'Restaurant'},
  coffee: {category: 'food-drink', maki: 'cafe', title: 'Cafe'},
  bar: {category: 'food-drink', maki: 'bar', title: 'Bar'},
  'fast-food': {category: 'food-drink', maki: 'fast-food', title: 'Fast food'},

  entertainment: {category: 'arts-entertainment', maki: 'star', title: 'Entertainment venue'},
  culture: {category: 'arts-entertainment', maki: 'museum', title: 'Museum'},
  'art-gallery': {category: 'arts-entertainment', maki: 'art-gallery', title: 'Art gallery'},
  theatre: {category: 'arts-entertainment', maki: 'theatre', title: 'Theatre'},
  cinema: {category: 'arts-entertainment', maki: 'cinema', title: 'Cinema'},
  music: {category: 'arts-entertainment', maki: 'music', title: 'Music venue'},
  nightclub: {category: 'arts-entertainment', maki: 'nightclub', title: 'Nightclub'},
  zoo: {category: 'arts-entertainment', maki: 'zoo', title: 'Zoo'},
  aquarium: {category: 'arts-entertainment', maki: 'aquarium', title: 'Aquarium'},
  'amusement-park': {
    category: 'arts-entertainment',
    maki: 'amusement-park',
    title: 'Amusement park',
  },
  casino: {category: 'arts-entertainment', maki: 'casino', title: 'Casino'},

  landmark: {category: 'landmark', maki: 'landmark', title: 'Landmark'},
  monument: {category: 'landmark', maki: 'monument', title: 'Monument'},
  castle: {category: 'landmark', maki: 'castle', title: 'Castle'},
  historic: {category: 'landmark', maki: 'historic', title: 'Historic site'},
  viewpoint: {category: 'landmark', maki: 'viewpoint', title: 'Viewpoint'},
  cemetery: {category: 'landmark', maki: 'cemetery', title: 'Cemetery'},
  'street-art': {category: 'landmark', maki: 'paint', title: 'Street art'},

  lodging: {category: 'lodging', maki: 'lodging', title: 'Lodging'},
  campsite: {category: 'lodging', maki: 'campsite', title: 'Campsite'},

  health: {category: 'medical', maki: 'hospital', title: 'Hospital'},
  doctor: {category: 'medical', maki: 'doctor', title: 'Clinic'},
  dentist: {category: 'medical', maki: 'dentist', title: 'Dentist'},
  pharmacy: {category: 'medical', maki: 'pharmacy', title: 'Pharmacy'},

  park: {category: 'park-nature', maki: 'park', title: 'Park'},
  garden: {category: 'park-nature', maki: 'garden', title: 'Garden'},
  playground: {category: 'park-nature', maki: 'playground', title: 'Playground'},
  'dog-park': {category: 'park-nature', maki: 'dog-park', title: 'Dog park'},
  beach: {category: 'park-nature', maki: 'beach', title: 'Beach'},
  mountain: {category: 'park-nature', maki: 'mountain', title: 'Mountain'},
  waterfall: {category: 'park-nature', maki: 'waterfall', title: 'Waterfall'},
  natural: {category: 'park-nature', maki: 'natural', title: 'Natural feature'},

  'town-hall': {category: 'public-services', maki: 'town-hall', title: 'Government'},
  police: {category: 'public-services', maki: 'police', title: 'Police'},
  'fire-station': {category: 'public-services', maki: 'fire-station', title: 'Fire station'},
  post: {category: 'public-services', maki: 'post', title: 'Post office'},
  embassy: {category: 'public-services', maki: 'embassy', title: 'Embassy'},
  prison: {category: 'public-services', maki: 'prison', title: 'Prison'},
  community: {category: 'public-services', maki: 'building', title: 'Community center'},
  plaza: {category: 'public-services', maki: 'landmark', title: 'Public square'},

  worship: {category: 'religion', maki: 'place-of-worship', title: 'Place of worship'},
  christian: {category: 'religion', maki: 'religious-christian', title: 'Church'},
  muslim: {category: 'religion', maki: 'religious-muslim', title: 'Mosque'},
  jewish: {category: 'religion', maki: 'religious-jewish', title: 'Synagogue'},
  buddhist: {category: 'religion', maki: 'religious-buddhist', title: 'Buddhist temple'},

  shopping: {category: 'retail', maki: 'shop', title: 'Shop'},
  clothing: {category: 'retail', maki: 'clothing-store', title: 'Clothing store'},
  grocery: {category: 'retail', maki: 'grocery', title: 'Grocery'},
  convenience: {category: 'retail', maki: 'convenience', title: 'Convenience store'},
  car: {category: 'retail', maki: 'car', title: 'Car dealer'},
  'car-repair': {category: 'retail', maki: 'car-repair', title: 'Car parts'},
  bookstore: {category: 'retail', maki: 'library', title: 'Bookstore'},
  florist: {category: 'retail', maki: 'florist', title: 'Florist'},
  hardware: {category: 'retail', maki: 'hardware', title: 'Hardware store'},
  electronics: {category: 'retail', maki: 'mobile-phone', title: 'Electronics store'},
  beauty: {category: 'retail', maki: 'hairdresser', title: 'Beauty'},

  sport: {category: 'sport-leisure', maki: 'pitch', title: 'Sport'},
  stadium: {category: 'sport-leisure', maki: 'stadium', title: 'Stadium'},
  golf: {category: 'sport-leisure', maki: 'golf', title: 'Golf course'},
  swimming: {category: 'sport-leisure', maki: 'swimming', title: 'Swimming pool'},
  fitness: {category: 'sport-leisure', maki: 'fitness-centre', title: 'Fitness'},

  services: {category: 'visitor-amenity', maki: 'information', title: 'Information'},
  parking: {category: 'visitor-amenity', maki: 'parking', title: 'Parking'},
  'parking-garage': {category: 'visitor-amenity', maki: 'parking-garage', title: 'Parking garage'},
  toilet: {category: 'visitor-amenity', maki: 'toilet', title: 'Toilets'},
  bank: {category: 'visitor-amenity', maki: 'bank', title: 'Bank or cash machine'},
  fuel: {category: 'visitor-amenity', maki: 'fuel', title: 'Fuel'},
  'charging-station': {
    category: 'visitor-amenity',
    maki: 'charging-station',
    title: 'Charging station',
  },
  'drinking-water': {category: 'visitor-amenity', maki: 'drinking-water', title: 'Drinking water'},
  harbor: {category: 'visitor-amenity', maki: 'harbor', title: 'Marina'},
  laundry: {category: 'visitor-amenity', maki: 'laundry', title: 'Laundry'},

  education: {category: 'education', maki: 'school', title: 'School'},
  college: {category: 'education', maki: 'college', title: 'College or university'},
  library: {category: 'education', maki: 'library', title: 'Library'},
} as const satisfies Record<string, StreetsPoiPictogram>);

export type StreetsPoiPictogramId = keyof typeof streetsPoiPictograms;

/** World `mode` on transport POIs, which separates metro, rail, tram and bus stations. */
const pictogramsByMode: Readonly<Partial<Record<StreetsPoiPictogramId, readonly string[]>>> = {
  'major-transit': ['subway'],
  rail: ['train', 'funicular'],
  'rail-light': ['light_rail', 'tram', 'monorail'],
  bus: ['bus'],
  ferry: ['ferry'],
  aerialway: ['aerialway'],
};

/** World `type` values with their own pictogram. Each type belongs to one category. */
const pictogramsByType: Readonly<Partial<Record<StreetsPoiPictogramId, readonly string[]>>> = {
  airport: ['airport'],
  bus: ['bus_station', 'bus_stop'],
  ferry: ['ferry_terminal'],
  rail: ['train_station'],
  'rail-light': ['tram_stop'],

  bar: ['alcoholic_beverage_venue', 'bar', 'brewery', 'distillery', 'lounge', 'winery'],
  coffee: ['cafe', 'coffee_shop', 'non_alcoholic_beverage_venue', 'smoothie_juice_bar'],
  'fast-food': ['fast_food_restaurant', 'food_court', 'food_truck_stand'],

  culture: ['museum', 'planetarium', 'science_attraction'],
  'art-gallery': ['art_gallery', 'arts_and_crafts_space'],
  theatre: ['comedy_club', 'performing_arts_venue', 'theatre_venue'],
  cinema: ['movie_theater'],
  music: ['music_venue'],
  nightclub: ['dance_club'],
  zoo: ['animal_attraction', 'zoo'],
  aquarium: ['aquarium'],
  'amusement-park': ['amusement_attraction', 'amusement_park', 'fairgrounds'],
  casino: ['casino'],

  monument: ['monument', 'sculpture_statue'],
  castle: ['castle'],
  historic: ['historic_site'],
  viewpoint: ['scenic_viewpoint'],
  cemetery: ['cemetery'],
  'street-art': ['street_art'],

  campsite: ['campground', 'rv_park'],

  health: [
    'emergency_department',
    'emergency_or_urgent_care_facility',
    'hospital',
    'specialty_hospital',
  ],
  dentist: ['dental_clinic'],
  pharmacy: ['pharmacy'],

  garden: ['garden'],
  playground: ['playground'],
  'dog-park': ['dog_park'],
  beach: ['beach'],
  mountain: ['mountain'],
  waterfall: ['waterfall'],
  natural: ['canyon', 'hot_springs', 'island', 'valley'],

  police: ['police_station', 'public_safety_service'],
  'fire-station': ['fire_station'],
  post: ['post_office'],
  embassy: ['embassy'],
  prison: ['jail_or_prison'],
  community: ['community_center', 'food_bank', 'social_or_community_service'],
  plaza: ['public_plaza'],

  christian: ['christian_place_of_worship'],
  muslim: ['muslim_place_of_worship'],
  jewish: ['jewish_place_of_worship'],
  buddhist: ['buddhist_place_of_worship'],

  clothing: ['fashion_and_apparel_store'],
  grocery: [
    'farmers_market',
    'food_and_beverage_store',
    'market',
    'superstore',
    'warehouse_club_store',
  ],
  convenience: ['convenience_store', 'kiosk'],
  car: ['auto_dealer', 'vehicle_dealer'],
  'car-repair': ['vehicle_parts_store'],
  bookstore: ['books_music_and_video_store'],
  florist: ['flowers_and_gifts_store'],
  hardware: ['hardware_home_and_garden_store'],
  electronics: ['electronics_store'],
  beauty: ['personal_care_and_beauty_store'],

  stadium: ['stadium_arena'],
  golf: ['golf_course'],
  swimming: ['swimming_pool'],
  fitness: ['fitness_studio', 'gym'],

  parking: ['parking', 'parking_lot'],
  'parking-garage': ['parking_garage'],
  toilet: ['public_restroom'],
  bank: ['atm', 'bank'],
  fuel: ['fueling_station', 'gas_station'],
  'charging-station': ['ev_charging_station'],
  'drinking-water': ['drinking_water', 'public_fountain'],
  harbor: ['marina'],
  laundry: ['laundry'],

  college: ['college_university', 'research_institute'],
  library: ['library'],
};

/**
 * The pictogram of a category's other types. Streets themes bind it to Core's `poi.<category>` image
 * role, so a theme that replaces that role replaces the category's default pictogram.
 */
export const streetsPoiCategoryPictograms = Object.freeze({
  'arts-entertainment': 'entertainment',
  education: 'education',
  'food-drink': 'food',
  landmark: 'landmark',
  lodging: 'lodging',
  medical: 'doctor',
  'park-nature': 'park',
  'public-services': 'town-hall',
  religion: 'worship',
  retail: 'shopping',
  'sport-leisure': 'sport',
  transport: 'major-transit',
  'visitor-amenity': 'services',
} as const satisfies Record<TileflowPoiCategory, StreetsPoiPictogramId>);

/** The theme image token of one pictogram. */
export function streetsPoiPictogramToken(id: StreetsPoiPictogramId) {
  return token.image(`poi.pictogram.${id}`);
}

/** Image tokens for one theme: the light theme uses `<id>`, the dark theme `<id>-dark`. */
export function streetsPoiImageTokens(variant: 'dark' | 'light'): Record<string, string> {
  const image = (id: string) => (variant === 'dark' ? `${id}-dark` : id);
  return Object.fromEntries([
    ...Object.entries(streetsPoiCategoryPictograms).map(([category, id]) => [
      `poi.${category}`,
      image(id),
    ]),
    ...Object.keys(streetsPoiPictograms).map((id) => [`poi.pictogram.${id}`, image(id)]),
  ]);
}

/**
 * Streets' pictogram for a POI: its transport mode first, then its World type, then its
 * category. World's own `icon` field is coarser than its type (one `shop` for every store, one
 * `transport` for metro, bus and cable car), so Streets reads the type instead.
 */
export function streetsPoiImage() {
  const categoryBranches = Object.keys(streetsPoiCategoryPictograms).map((category) => {
    const types = Object.entries(pictogramsByType)
      .filter(([id]) => streetsPoiPictograms[id as StreetsPoiPictogramId].category === category)
      .map(([id, labels]) => ({
        labels: [...labels!],
        value: streetsPoiPictogramToken(id as StreetsPoiPictogramId),
      }));
    const [first, ...rest] = types;
    const categoryRole = token.image(`poi.${category}`);
    return {
      labels: category,
      value: first
        ? expr.match<string, TileflowThemeImageValue>(
            expr.get(field('poiType')),
            [first, ...rest],
            categoryRole,
          )
        : categoryRole,
    };
  });
  const [firstCategory, ...otherCategories] = categoryBranches;
  const [firstMode, ...otherModes] = Object.entries(pictogramsByMode).map(([id, labels]) => ({
    labels: [...labels!],
    value: streetsPoiPictogramToken(id as StreetsPoiPictogramId),
  }));
  return expr.match<string, TileflowThemeImageValue>(
    expr.get(field('mode')),
    [firstMode!, ...otherModes],
    expr.match<string, TileflowThemeImageValue>(
      expr.get(field('poiCategory')),
      [firstCategory!, ...otherCategories],
      token.image('poi.landmark'),
    ),
  );
}
