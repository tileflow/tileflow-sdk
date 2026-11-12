import {featureTooLarge, maximumFeaturePositions, TilesetBuildError} from './errors';
import type {FeatureIngest, GeometryInput} from './ingest';
import {documentVocabulary, readXml, TextCapture, type XmlHandler} from './read-xml';

type Capture = Readonly<{
  depth: number;
  finish: (value: string) => void;
  text: TextCapture;
}>;

type Placemark = {
  geometries: GeometryInput[];
  polygon: {inner: number[][][]; outer: number[][] | null} | null;
  /** Positions and parts count alike: an empty part costs memory too. */
  positions: number;
  properties: Record<string, unknown>;
  textCharacters: number;
  track: number[][] | null;
};

const maximumFieldCharacters = 8 * 1024 * 1024;
const maximumFeatureTextCharacters = 64 * 1024 * 1024;
const maximumFolderNameCharacters = 1024 * 1024;
const maximumTupleCharacters = 256;
const maximumSchemaFields = 65_536;
const maximumSchemaCharacters = 16 * 1024 * 1024;
const coordinateParents = new Set(['LinearRing', 'LineString', 'Point']);
const placemarkFields = new Set(['address', 'description', 'name', 'phoneNumber']);
const builtInFields = new Set([...placemarkFields, 'begin', 'end', 'folder', 'timestamp']);
const ignoredFeatures = new Set(['GroundOverlay', 'NetworkLink', 'PhotoOverlay', 'ScreenOverlay']);
const trackElements = new Set(['Track', 'gx:Track']);
const coordElements = new Set(['coord', 'gx:coord']);
const numericSchemaTypes = new Set(['double', 'float', 'int', 'short', 'uint', 'ushort']);

/** KML coordinates are WGS84 longitude, latitude and altitude by definition. */
export async function readKml(source: AsyncIterable<Buffer>, ingest: FeatureIngest): Promise<void> {
  const reader = new KmlReader(ingest);
  await readXml(source, reader);
  reader.finish();
}

class KmlReader implements XmlHandler {
  readonly #resolve = documentVocabulary(
    'kml',
    'a KML document',
    new Map([['http://www.google.com/kml/ext/2.2', 'gx']]),
  );
  readonly #path: string[] = [];
  readonly #folders: (string | null)[] = [];
  readonly #schemaFields = new Map<string, string>();
  #schemaId = '';
  #schemaUrl = '';
  #schemaCharacters = 0;
  #dataName: string | null = null;
  #placemark: Placemark | null = null;
  #placemarks = 0;
  #capture: Capture | null = null;
  #tuple: string | null = null;
  #positions: number[][] = [];
  #altitudeIgnored = false;
  #ignoredFeatures = 0;

  constructor(private readonly ingest: FeatureIngest) {}

  readonly open = (raw: string, attributes: ReadonlyMap<string, string>): void => {
    const name = this.#resolve(raw, attributes);
    const parent = this.#path.at(-1) ?? '';
    this.#path.push(name);
    if (this.#capture) return;
    if (this.#placemark) {
      this.#openInPlacemark(name, parent, attributes);
      return;
    }
    if (name === 'Folder') {
      this.#folders.push(null);
    } else if (name === 'name' && parent === 'Folder') {
      this.#captureText((value) => {
        this.#folders[this.#folders.length - 1] = value;
      }, maximumFolderNameCharacters);
    } else if (name === 'Placemark') {
      this.#placemarks += 1;
      this.ingest.location = `Placemark ${this.#placemarks}`;
      const properties = Object.create(null) as Record<string, unknown>;
      const folder = this.#folders.at(-1);
      if (folder) properties.folder = folder;
      this.#placemark = {
        geometries: [],
        polygon: null,
        positions: 0,
        properties,
        textCharacters: 0,
        track: null,
      };
    } else if (name === 'Schema') {
      this.#schemaId = attributes.get('id') ?? '';
    } else if (name === 'SimpleField' && parent === 'Schema') {
      this.#addSchemaField(attributes);
    } else if (ignoredFeatures.has(name)) {
      this.#ignoredFeatures += 1;
    }
  };

  readonly close = (): void => {
    const name = this.#path.pop() ?? '';
    const parent = this.#path.at(-1) ?? '';
    const capture = this.#capture;
    if (capture && this.#path.length === capture.depth) {
      this.#capture = null;
      capture.finish(capture.text.value());
      return;
    }
    if (capture) return;
    if (name === 'Folder' && !this.#placemark) {
      this.#folders.pop();
    } else if (this.#placemark) {
      this.#closeInPlacemark(name, parent);
    }
  };

  readonly text = (fragment: string): void => {
    if (this.#tuple !== null) this.#writeCoordinates(fragment);
    else this.#capture?.text.write(fragment);
  };

  finish(): void {
    if (this.#altitudeIgnored) this.ingest.warn('Altitude values in the KML were ignored.');
    if (this.#ignoredFeatures > 0) {
      this.ingest.warn(
        `${this.#ignoredFeatures} overlays and network links in the KML were ignored; only Placemarks are read, and remote content is never fetched.`,
      );
    }
  }

  #openInPlacemark(name: string, parent: string, attributes: ReadonlyMap<string, string>): void {
    const placemark = this.#placemark as Placemark;
    if (parent === 'Placemark' && placemarkFields.has(name)) {
      this.#captureField(name);
    } else if ((name === 'when' && parent === 'TimeStamp') || parent === 'TimeSpan') {
      if (name === 'when') this.#captureField('timestamp');
      else if (name === 'begin' || name === 'end') this.#captureField(name);
    } else if (name === 'Data' && parent === 'ExtendedData') {
      this.#dataName = attributes.get('name') ?? null;
    } else if (name === 'value' && parent === 'Data' && this.#dataName) {
      this.#captureField(this.#dataName);
    } else if (name === 'SchemaData') {
      this.#schemaUrl = (attributes.get('schemaUrl') ?? '').replace(/^.*#/u, '');
    } else if (name === 'SimpleData' && parent === 'SchemaData') {
      const field = attributes.get('name');
      if (field) this.#captureField(field, this.#schemaFields.get(this.#schemaKey(field)));
    } else if (name === 'coordinates' && coordinateParents.has(parent)) {
      this.#positions = [];
      this.#tuple = '';
    } else if (name === 'Polygon') {
      placemark.polygon = {inner: [], outer: null};
    } else if (trackElements.has(name)) {
      placemark.track = [];
    } else if (coordElements.has(name) && trackElements.has(parent)) {
      this.#captureText((value) => {
        this.#addPosition(value.split(/\s+/u));
      }, maximumTupleCharacters);
    }
  }

  #closeInPlacemark(name: string, parent: string): void {
    const placemark = this.#placemark as Placemark;
    switch (name) {
      case 'coordinates':
        if (this.#tuple) this.#addPosition(this.#tuple.split(','));
        this.#tuple = null;
        break;
      case 'Point':
        if (this.#positions.length > 0) {
          this.#addGeometry({coordinates: this.#positions[0], type: 'Point'});
        }
        this.#positions = [];
        break;
      case 'LineString':
        this.#addGeometry({coordinates: this.#takePositions(), type: 'LineString'});
        break;
      case 'LinearRing': {
        const ring = this.#takePositions();
        if (parent === 'outerBoundaryIs' && placemark.polygon) placemark.polygon.outer = ring;
        else if (parent === 'innerBoundaryIs' && placemark.polygon) {
          this.#spendPosition();
          placemark.polygon.inner.push(ring);
          // Outside a Polygon a ring has no fill, and Google Earth draws it as a line.
        } else this.#addGeometry({coordinates: ring, type: 'LineString'});
        break;
      }
      case 'Polygon':
        if (placemark.polygon?.outer) {
          this.#addGeometry({
            coordinates: [placemark.polygon.outer, ...placemark.polygon.inner],
            type: 'Polygon',
          });
        }
        placemark.polygon = null;
        break;
      case 'Track':
      case 'gx:Track':
        if (placemark.track) this.#addGeometry({coordinates: placemark.track, type: 'LineString'});
        placemark.track = null;
        break;
      case 'Placemark':
        this.ingest.add(combine(placemark.geometries), placemark.properties);
        this.#placemark = null;
        break;
      default:
        break;
    }
  }

  #addGeometry(geometry: GeometryInput): void {
    this.#spendPosition();
    (this.#placemark as Placemark).geometries.push(geometry);
  }

  #spendPosition(): void {
    const placemark = this.#placemark as Placemark;
    placemark.positions += 1;
    if (placemark.positions > maximumFeaturePositions) throw featureTooLarge(this.ingest.location);
  }

  #takePositions(): number[][] {
    const positions = this.#positions;
    this.#positions = [];
    return positions;
  }

  #captureField(field: string, schemaType?: string): void {
    this.#captureText((value) => {
      if (value === '') return;
      const placemark = this.#placemark as Placemark;
      placemark.textCharacters += field.length + value.length;
      if (placemark.textCharacters > maximumFeatureTextCharacters) {
        throw new TilesetBuildError(
          'TF_TILESET_BUILD_INPUT_LIMIT',
          'input',
          `${this.ingest.location}: the attributes hold more than ${maximumFeatureTextCharacters} characters.`,
        );
      }
      if (builtInFields.has(field) && field in placemark.properties) {
        this.ingest.warn(
          `A Placemark gives more than one value for "${field}", counting ExtendedData; the last one was kept.`,
        );
      }
      placemark.properties[field] = typed(value, schemaType);
    });
  }

  #captureText(finish: (value: string) => void, limit = maximumFieldCharacters): void {
    this.#capture = {
      depth: this.#path.length - 1,
      finish,
      text: new TextCapture(limit, () => this.ingest.location),
    };
  }

  #addSchemaField(attributes: ReadonlyMap<string, string>): void {
    const field = attributes.get('name');
    const type = attributes.get('type');
    if (!field || !type) return;
    this.#schemaCharacters += this.#schemaId.length + field.length + type.length;
    if (
      this.#schemaFields.size >= maximumSchemaFields ||
      this.#schemaCharacters > maximumSchemaCharacters
    ) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_LIMIT',
        'input',
        `The KML schemas are too large: the limits are ${maximumSchemaFields} fields and ${maximumSchemaCharacters} characters.`,
      );
    }
    this.#schemaFields.set(`${this.#schemaId}\0${field}`, type);
  }

  #schemaKey(field: string): string {
    return `${this.#schemaUrl}\0${field}`;
  }

  /** Tuples are separated by whitespace; a space after a comma is tolerated, as most tools do. */
  #writeCoordinates(fragment: string): void {
    let tuple = this.#tuple ?? '';
    let start = 0;
    for (let index = 0; index < fragment.length; index += 1) {
      const code = fragment.charCodeAt(index);
      if (code !== 0x20 && code !== 0x0a && code !== 0x09 && code !== 0x0d) continue;
      tuple += fragment.slice(start, index);
      start = index + 1;
      this.#checkTuple(tuple);
      if (tuple !== '' && !tuple.endsWith(',')) {
        this.#addPosition(tuple.split(','));
        tuple = '';
      }
    }
    tuple += fragment.slice(start);
    this.#checkTuple(tuple);
    this.#tuple = tuple;
  }

  #checkTuple(tuple: string): void {
    if (tuple.length > maximumTupleCharacters) {
      throw this.#invalid('coordinates are not longitude,latitude tuples');
    }
  }

  #addPosition(parts: readonly string[]): void {
    const placemark = this.#placemark as Placemark;
    if (parts.length < 2 || parts.length > 3 || parts[0] === '' || parts[1] === '') {
      throw this.#invalid('a position must be longitude,latitude[,altitude]');
    }
    this.#spendPosition();
    if (parts.length === 3 && Number(parts[2]) !== 0) this.#altitudeIgnored = true;
    const position = [Number(parts[0]), Number(parts[1])];
    if (placemark.track) placemark.track.push(position);
    else this.#positions.push(position);
  }

  #invalid(reason: string): TilesetBuildError {
    return new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `${this.ingest.location}: ${reason}.`,
    );
  }
}

/** Text unless a KML Schema declares a type: inferring one per value would give columns mixed types. */
function typed(value: string, schemaType: string | undefined): boolean | number | string {
  if (schemaType && numericSchemaTypes.has(schemaType)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (schemaType === 'bool') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }
  return value;
}

/** A MultiGeometry is flattened as it is read; one type becomes one Multi feature here. */
function combine(geometries: readonly GeometryInput[]): GeometryInput | null {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0];
  const [{type}] = geometries;
  if (!geometries.every((geometry) => geometry.type === type)) {
    return {geometries: [...geometries], type: 'GeometryCollection'};
  }
  return {
    coordinates: geometries.map((geometry) => geometry.coordinates),
    type: `Multi${String(type)}`,
  };
}
