import type {Spec} from '../specs/NativeTileflowServices';
import {serviceError} from './error';
import type * as T from './types';

/** The service clients over a native module; the package root binds them to the app's module. */
export function createServiceClients(module: () => Spec) {
  async function call<Answer>(
    service: T.TileflowService,
    operation: string,
    request: object,
  ): Promise<Answer> {
    const native = module();
    try {
      return (await native.call(service, operation, request)) as Answer;
    } catch (error) {
      throw serviceError(service, error);
    }
  }

  /**
   * Tileflow Search through the native client: geocoding, reverse geocoding, autocomplete, Nearby
   * and categories. It needs a credential with the Search permission in the app's native
   * configuration.
   */
  const TileflowSearch = Object.freeze({
    geocode: (request: T.GeocodeRequest) => call<T.GeocodeResponse>('search', 'geocode', request),
    reverseGeocode: (request: T.ReverseGeocodeRequest) =>
      call<T.GeocodeResponse>('search', 'reverseGeocode', request),
    autocomplete: (request: T.AutocompleteRequest) =>
      call<T.AutocompleteResponse>('search', 'autocomplete', request),
    resolveSuggestion: (request: T.ResolveSuggestionRequest) =>
      call<T.ResolveSuggestionResponse>('search', 'resolveSuggestion', request),
    searchNearby: (request: T.NearbyRequest) =>
      call<T.NearbyResponse>('search', 'searchNearby', request),
    /** The categories Nearby can filter by. Listing them uses no API units. */
    listCategories: () => call<T.SearchCategoriesResponse>('search', 'listCategories', {}),
  });

  /** Tileflow Routing through the native client: routes, isochrones, matrices, map matching and nearest roads. */
  const TileflowRouting = Object.freeze({
    route: (request: T.RouteRequest) => call<T.RouteResponse>('routing', 'route', request),
    isochrone: (request: T.IsochroneRequest) =>
      call<T.IsochroneResponse>('routing', 'isochrone', request),
    matrix: (request: T.MatrixRequest) => call<T.MatrixResponse>('routing', 'matrix', request),
    match: (request: T.MatchRequest) => call<T.MatchResponse>('routing', 'match', request),
    nearest: (request: T.NearestRequest) => call<T.NearestResponse>('routing', 'nearest', request),
  });

  /** Tileflow Elevation through the native client. */
  const TileflowElevation = Object.freeze({
    /** Heights of up to 100 positions in one request. */
    points: (positions: readonly T.Position[], unit: T.ElevationUnit = 'meters') =>
      call<T.ElevationPointsResponse>('elevation', 'points', {positions, unit}),
    /** The height at one position, or null where the dataset has none. */
    elevation: async (position: T.Position, unit: T.ElevationUnit = 'meters') =>
      (await call<{elevation: number | null}>('elevation', 'elevation', {position, unit}))
        .elevation,
    /** Heights of any number of positions, in requests of up to 100. */
    batch: (positions: readonly T.Position[], unit: T.ElevationUnit = 'meters') =>
      call<T.ElevationBatch>('elevation', 'batch', {positions, unit}),
    profile: (request: T.ElevationProfileRequest) =>
      call<T.ElevationProfile>('elevation', 'profile', request),
  });

  /** Approximate location of the device's network connection, anonymously. */
  const TileflowGeoIP = Object.freeze({
    locate: () => call<T.GeoIPResponse>('geoip', 'locate', {}),
  });

  /** Which services have a credential in the app's native configuration. Never returns credentials. */
  function configuredServices(): Readonly<Record<T.TileflowService | 'map', boolean>> {
    return module().configuredServices() as Record<T.TileflowService | 'map', boolean>;
  }

  return {TileflowSearch, TileflowRouting, TileflowElevation, TileflowGeoIP, configuredServices};
}
