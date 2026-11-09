import {featureTooLarge, maximumFeaturePositions, TilesetBuildError} from './errors';
import type {FeatureIngest} from './ingest';
import {documentVocabulary, readXml, TextCapture, type XmlHandler} from './read-xml';

type GpxFeature = {
  kind: 'rte' | 'trk' | 'wpt';
  lines: number[][][];
  point: number[] | null;
  positions: number;
  properties: Record<string, unknown>;
};

const maximumFieldCharacters = 1024 * 1024;
const textFields = new Set(['cmt', 'desc', 'name', 'sym', 'src', 'time', 'type']);
const numericFields = new Set(['ele', 'number']);
const locations = {rte: 'route', trk: 'track', wpt: 'waypoint'} as const;

/** GPX coordinates are WGS84 by definition. Waypoints, routes and tracks each become a feature. */
export async function readGpx(source: AsyncIterable<Buffer>, ingest: FeatureIngest): Promise<void> {
  const reader = new GpxReader(ingest);
  await readXml(source, reader);
  reader.finish();
}

class GpxReader implements XmlHandler {
  readonly #resolve = documentVocabulary('gpx', 'a GPX document');
  readonly #path: string[] = [];
  readonly #counts = {rte: 0, trk: 0, wpt: 0};
  #feature: GpxFeature | null = null;
  #capture: Readonly<{depth: number; field: string; text: TextCapture}> | null = null;
  #pointDetailIgnored = false;

  constructor(private readonly ingest: FeatureIngest) {}

  readonly open = (raw: string, attributes: ReadonlyMap<string, string>): void => {
    const name = this.#resolve(raw, attributes);
    const parent = this.#path.at(-1) ?? '';
    this.#path.push(name);
    if (this.#capture) return;
    if (parent === 'gpx' && (name === 'wpt' || name === 'rte' || name === 'trk')) {
      this.#begin(name, attributes);
      return;
    }
    const feature = this.#feature;
    if (!feature) return;
    if (parent === feature.kind && (textFields.has(name) || numericFields.has(name))) {
      this.#capture = {
        depth: this.#path.length - 1,
        field: name,
        text: new TextCapture(maximumFieldCharacters, () => this.ingest.location),
      };
    } else if (name === 'rtept' && parent === 'rte') {
      if (feature.lines.length === 0) feature.lines.push([]);
      this.#addPoint(feature, feature.lines[0], attributes);
    } else if (name === 'trkseg' && parent === 'trk') {
      this.#spendPosition(feature);
      feature.lines.push([]);
    } else if (name === 'trkpt' && parent === 'trkseg') {
      this.#addPoint(feature, feature.lines[feature.lines.length - 1], attributes);
    } else if ((name === 'ele' || name === 'time') && (parent === 'rtept' || parent === 'trkpt')) {
      this.#pointDetailIgnored = true;
    }
  };

  readonly close = (): void => {
    const name = this.#path.pop() ?? '';
    const capture = this.#capture;
    if (capture && this.#path.length === capture.depth) {
      this.#capture = null;
      this.#store(capture.field, capture.text.value());
      return;
    }
    if (capture) return;
    const feature = this.#feature;
    if (feature && this.#path.length === 1 && name === feature.kind) this.#finishFeature(feature);
  };

  readonly text = (fragment: string): void => {
    this.#capture?.text.write(fragment);
  };

  finish(): void {
    if (this.#pointDetailIgnored) {
      this.ingest.warn('Elevation and time on GPX route and track points were ignored.');
    }
  }

  #begin(kind: GpxFeature['kind'], attributes: ReadonlyMap<string, string>): void {
    this.#counts[kind] += 1;
    this.ingest.location = `${locations[kind]} ${this.#counts[kind]}`;
    this.#feature = {
      kind,
      lines: [],
      point: kind === 'wpt' ? this.#position(attributes) : null,
      positions: 0,
      properties: Object.create(null) as Record<string, unknown>,
    };
  }

  #store(field: string, value: string): void {
    if (value === '' || !this.#feature) return;
    if (numericFields.has(field)) {
      const number = Number(value);
      if (Number.isFinite(number)) this.#feature.properties[field] = number;
      return;
    }
    this.#feature.properties[field] = value;
  }

  #addPoint(
    feature: GpxFeature,
    line: number[][] | undefined,
    attributes: ReadonlyMap<string, string>,
  ): void {
    if (!line) throw this.#invalid('a track point sits outside a track segment');
    this.#spendPosition(feature);
    line.push(this.#position(attributes));
  }

  /** Positions and segments count alike: an empty segment costs memory too. */
  #spendPosition(feature: GpxFeature): void {
    feature.positions += 1;
    if (feature.positions > maximumFeaturePositions) throw featureTooLarge(this.ingest.location);
  }

  #position(attributes: ReadonlyMap<string, string>): number[] {
    const lon = attributes.get('lon')?.trim();
    const lat = attributes.get('lat')?.trim();
    if (!lon || !lat) throw this.#invalid('a point needs both lat and lon attributes');
    return [Number(lon), Number(lat)];
  }

  #finishFeature(feature: GpxFeature): void {
    this.#feature = null;
    if (feature.kind === 'wpt') {
      this.ingest.add({coordinates: feature.point, type: 'Point'}, feature.properties);
    } else if (feature.kind === 'rte') {
      this.ingest.add(
        {coordinates: feature.lines[0] ?? [], type: 'LineString'},
        feature.properties,
      );
    } else {
      this.ingest.add({coordinates: feature.lines, type: 'MultiLineString'}, feature.properties);
    }
  }

  #invalid(reason: string): TilesetBuildError {
    return new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `${this.ingest.location}: ${reason}.`,
    );
  }
}
