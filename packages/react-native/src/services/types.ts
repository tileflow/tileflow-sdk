// Requests and answers of the native Search, Routing, Elevation and GeoIP clients, as they cross
// the bridge. Field names follow the native clients; positions are `[longitude, latitude]` and
// bounding boxes `[west, south, east, north]`, as in the JavaScript service packages.

export type Position = readonly [longitude: number, latitude: number];
export type BoundingBox = readonly [west: number, south: number, east: number, north: number];

export type TileflowService = 'search' | 'routing' | 'elevation' | 'geoip';

// MARK: Search

export type PlaceDetail = 'contacts' | 'openingHours' | 'timeZone' | 'accessPoints';
export type ReverseGeocodingKind = 'address' | 'street' | 'locality' | 'place';
/** `address`, `street`, `locality`, `district`, `county`, `region`, `country`, `place` or `unknown`; kinds added later arrive as their own values. */
export type PlaceKind = string;

export type GeocodeRequest = {
  query: string;
  language?: string;
  limit?: number;
  /** Restricts results to a box. Exclusive with `proximity`. */
  bounds?: BoundingBox;
  /** Ranks nearer matches first. */
  proximity?: Position;
  include?: readonly PlaceDetail[];
};

export type ReverseGeocodeRequest = {
  position: Position;
  kinds?: readonly ReverseGeocodingKind[];
  language?: string;
  limit?: number;
  include?: readonly PlaceDetail[];
};

export type AutocompleteRequest = {
  query: string;
  language?: string;
  limit?: number;
  bounds?: BoundingBox;
  proximity?: Position;
  includesPlaces?: boolean;
};

export type ResolveSuggestionRequest = {token: string; include?: readonly PlaceDetail[]};

export type NearbyRequest = {
  position: Position;
  radiusMeters?: number;
  bounds?: BoundingBox;
  includeCategories?: readonly string[];
  excludeCategories?: readonly string[];
  countries?: readonly string[];
  language?: string;
  include?: readonly PlaceDetail[];
  limit?: number;
  cursor?: string;
};

export type Address = {
  name?: string;
  houseNumber?: string;
  street?: string;
  locality?: string;
  district?: string;
  city?: string;
  county?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
};

export type SearchCategory = {id: string; name: string; localizedName?: string; primary?: boolean};
export type Contact = {value: string; label?: string};

export type Place = {
  kind: PlaceKind;
  label: string;
  position: Position;
  address: Address;
  bounds?: BoundingBox;
  sourceRef?: string;
  name?: string;
  categories: SearchCategory[];
  foodTypes: SearchCategory[];
  businessChains: {id: string; name: string}[];
  distanceMeters?: number;
  contacts?: {phones: Contact[]; websites: Contact[]; emails: Contact[]};
  openingHours: {display: string[]; openNow?: boolean}[];
  timeZone?: {name: string; utcOffsetSeconds?: number};
  accessPoints: Position[];
  /** Nearby results only: resolves the place with `resolveSuggestion`. */
  token?: string;
};

export type SearchSource = {id: string; revision?: string};
export type SearchAttribution = {text: string; url?: string};
type SearchAnswer = {source: SearchSource; attribution: SearchAttribution[]; units: number};

export type GeocodeResponse = SearchAnswer & {queryId: string; results: Place[]};
export type Suggestion = {
  kind: PlaceKind;
  label: string;
  addressLabel?: string;
  place?: Place;
  token: string;
};
export type AutocompleteResponse = SearchAnswer & {suggestions: Suggestion[]};
export type ResolveSuggestionResponse = SearchAnswer & {result: Place};
export type NearbyResponse = SearchAnswer & {results: Place[]; nextCursor?: string};
export type SearchCategoriesResponse = Omit<SearchAnswer, 'units'> & {
  categories: SearchCategory[];
};

// MARK: Routing

export type RoutingMode = 'driving' | 'walking' | 'cycling' | 'truck';
export type RoutingAvoidance = 'tolls' | 'highways' | 'ferries';
export type RoutingTraffic = 'none';
/** A BCP 47 tag the service supports, such as `en-US` or `es-ES`. */
export type RoutingLanguage = string;

export type Vehicle = {
  heightMeters?: number;
  widthMeters?: number;
  lengthMeters?: number;
  weightTonnes?: number;
  axleLoadTonnes?: number;
  axleCount?: number;
  hazardousMaterials?: boolean;
};

type RoutingOptions = {
  mode: RoutingMode;
  vehicle?: Vehicle;
  avoid?: readonly RoutingAvoidance[];
  traffic?: RoutingTraffic;
};

export type RouteRequest = RoutingOptions & {
  locations: readonly Position[];
  alternatives?: number;
  language?: RoutingLanguage;
};
export type IsochroneRequest = RoutingOptions & {location: Position; minutes: readonly number[]};
export type MatrixRequest = RoutingOptions & {
  sources: readonly Position[];
  targets: readonly Position[];
};
export type MatchRequest = {
  trace: readonly Position[];
  mode: RoutingMode;
  /** Seconds since the epoch, one per trace position. */
  timestamps?: readonly number[];
  accuracy?: number;
  vehicle?: Vehicle;
};
export type NearestRequest = {location: Position; mode: RoutingMode};

type RoutingAnswer = {
  network: {releaseId: string};
  attribution: string;
  traffic: string;
  units: number;
};

export type RouteStep = {
  maneuver: string;
  instruction: string;
  names: string[];
  exit?: string;
  toward: string[];
  roundaboutExit?: number;
  distance: number;
  duration: number;
  location: Position;
};
export type Route = {
  distance: number;
  duration: number;
  hasTolls: boolean;
  hasHighways: boolean;
  hasFerries: boolean;
  geometry: Position[];
  legs: {distance: number; duration: number; steps: RouteStep[]}[];
};
export type Road = {
  names: string[];
  wayId?: number;
  roadClass: string;
  surface?: string;
  lanes?: number;
  speedLimit?: {kmh: number; source: string};
  toll: boolean;
  bridge: boolean;
  tunnel: boolean;
  roundabout: boolean;
  length: number;
};

export type RouteResponse = RoutingAnswer & {routes: Route[]};
export type IsochroneResponse = RoutingAnswer & {
  isochrones: {minutes: number; polygons: Position[][][]}[];
};
export type MatrixResponse = RoutingAnswer & {
  durations: (number | null)[][];
  distances: (number | null)[][];
};
export type MatchResponse = RoutingAnswer & {
  distance: number;
  duration: number;
  geometry: Position[];
  points: ({location: Position; distance: number} | null)[];
  roads: Road[];
};
export type NearestResponse = RoutingAnswer & {location: Position; distance: number; road: Road};

// MARK: Elevation

export type ElevationUnit = 'meters' | 'feet';
export type ElevationLine =
  | {type: 'LineString'; coordinates: readonly Position[]}
  | {type: 'MultiLineString'; coordinates: readonly (readonly Position[])[]}
  | {type: 'Polyline'; encoded: string; precision?: number};

export type ElevationProfileRequest = {
  line: ElevationLine;
  interval?: number;
  maxSamples?: number;
  climbThreshold?: number;
  unit?: ElevationUnit;
};

export type ElevationDataset = {releaseId: string; zoom: number};
/** `elevation` is absent where the dataset has no height. */
export type ElevatedPosition = {position: Position; elevation?: number};
export type ElevationPointsResponse = {
  positions: ElevatedPosition[];
  unit: ElevationUnit;
  dataset: ElevationDataset;
  attribution: string;
  units: number;
};
export type ElevationBatch = {
  positions: ElevatedPosition[];
  unit: ElevationUnit;
  attribution: string;
  units: number;
};
export type ElevationProfile = {
  unit: ElevationUnit;
  dataset: ElevationDataset;
  attribution: string;
  units: number;
  interval: number;
  samples: {position: Position; elevation?: number; distance: number}[];
  /** Each input line's first and last sample index. */
  lines: [first: number, last: number][];
  summary: {
    distance: number;
    ascent?: number;
    descent?: number;
    minElevation?: number;
    maxElevation?: number;
    startElevation?: number;
    endElevation?: number;
    maxGrade?: number;
    minGrade?: number;
  };
};

// MARK: GeoIP

export type GeoIPResponse = {
  location?: {
    city?: string;
    continentCode?: string;
    countryCode?: string;
    isEuCountry?: boolean;
    position?: Position;
    postalCode?: string;
    region?: string;
    regionCode?: string;
    timezone?: string;
  };
  units: number;
};
