import type {CoordinateTransform} from './crs';
import {TilesetBuildError} from './errors';
import {FeatureSpool, field, geometryType, headerWords, worldSize} from './spool';

export type FieldSelection = Readonly<{
  exclude: ReadonlySet<string> | null;
  include: ReadonlySet<string> | null;
}>;

export type RankSelection = Readonly<{ascending: boolean; field: string}>;

export type GeometryInput = Readonly<{coordinates?: unknown; geometries?: unknown; type?: unknown}>;

const fieldNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const maximumFields = 512;
const maximumMercatorLatitude = 85.0511287798066;
/** About 100 m: rounding at the edge of the world, not a sign of a wrong CRS. */
const coordinateToleranceDegrees = 0.001;
const sampleCapacity = 1 << 18;
const unranked = -Infinity;
const typeBits = {boolean: 1, number: 2, string: 4} as const;

export type IngestSummary = Readonly<{
  bounds: readonly [number, number, number, number];
  features: number;
  fields: readonly Readonly<{
    name: string;
    sourceName: string;
    type: 'Boolean' | 'Number' | 'String' | 'Mixed';
  }>[];
  geometryTypes: readonly string[];
  skipped: Readonly<{emptyGeometry: number; outsideMercator: number}>;
  warnings: readonly string[];
}>;

/** Validates, projects and spools features in one pass, whatever their source format. */
export class FeatureIngest {
  readonly #keys = new Map<string, number>();
  readonly #keyTypes: number[] = [];
  readonly #transform: CoordinateTransform | null;
  #properties = new Uint8Array(4096);
  #propertiesView = new DataView(this.#properties.buffer);
  #propertyLength = 0;
  #points: number[] = [];
  #parts: number[] = [];
  #warnings = new Set<string>();
  #features = 0;
  #emptyGeometry = 0;
  #outsideMercator = 0;
  #clampedLatitude = 0;
  #wideSegments = 0;
  #nonNumericIds = 0;
  #degenerateParts = 0;
  #nudgedCoordinates = 0;
  #minLon = Infinity;
  #minLat = Infinity;
  #maxLon = -Infinity;
  #maxLat = -Infinity;
  #types = new Set<string>();
  #sampleStride = 1;
  #sampleSeen = 0;
  #rankKeys = new Float64Array(0);
  #currentRank = unranked;
  #ranked = 0;
  #unrankedFeatures = 0;
  /** Bounded, evenly thinned vertex sample used to choose a maximum zoom. */
  sample = new Int32Array(sampleCapacity * 2);
  sampleCount = 0;
  /** Set by readers so that errors name the offending feature. */
  location = 'input';

  constructor(
    private readonly spool: FeatureSpool,
    private readonly selection: FieldSelection,
    transform: CoordinateTransform | null,
    private readonly rank: RankSelection | null = null,
  ) {
    this.#transform = transform;
    if (rank) this.#rankKeys = new Float64Array(1024);
  }

  get featureCount(): number {
    return this.#features;
  }

  get sampleStride(): number {
    return this.#sampleStride;
  }

  warn(message: string): void {
    this.#warnings.add(message);
  }

  add(
    geometry: GeometryInput | null | undefined,
    properties: Record<string, unknown>,
    id?: unknown,
  ): void {
    if (geometry === null || geometry === undefined) {
      this.#emptyGeometry += 1;
      return;
    }
    this.#encodeProperties(properties);
    if (this.rank) this.#readRank(properties[this.rank.field]);
    const numericId = this.#numericId(id);
    this.#addGeometry(geometry, numericId);
  }

  skipEmpty(): void {
    this.#emptyGeometry += 1;
  }

  /** The features in descending priority, or the input order when no rank was requested. */
  rankedSpool(spool: FeatureSpool): FeatureSpool {
    if (!this.rank) return spool;
    return spool.reordered(this.#rankKeys.subarray(0, spool.count));
  }

  #readRank(value: unknown): void {
    if (typeof value === 'number' && Number.isFinite(value)) {
      this.#currentRank = this.rank?.ascending ? -value : value;
      this.#ranked += 1;
    } else {
      this.#currentRank = unranked;
      this.#unrankedFeatures += 1;
    }
  }

  /** Summarize the pass and finalize names that downstream tile consumers accept. */
  finish(): IngestSummary {
    if (this.#keys.size > maximumFields) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_TOO_MANY_FIELDS',
        'input.fields',
        `The input has ${this.#keys.size} attribute fields; the limit is ${maximumFields}. Pick what maps need with --include.`,
      );
    }
    if (this.rank && this.#features > 0 && this.#ranked === 0) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_RANK_INVALID',
        'rankBy',
        `No feature has a numeric value in "${this.rank.field}". --rank-by needs a numeric attribute.`,
      );
    }
    if (this.#unrankedFeatures > 0) {
      this.#warnings.add(
        `${this.#unrankedFeatures} features have no numeric "${this.rank?.field}" and are the first to be thinned.`,
      );
    }
    if (this.#features === 0) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_EMPTY',
        'input',
        `The input has no usable features (${this.#emptyGeometry} without geometry, ${this.#outsideMercator} outside the Web Mercator range).`,
      );
    }
    const taken = new Set<string>();
    const fields = [...this.#keys].map(([sourceName, key]) => {
      const name = safeFieldName(sourceName, key);
      if (taken.has(name)) {
        throw new TilesetBuildError(
          'TF_TILESET_BUILD_FIELD_CONFLICT',
          'input.fields',
          `Field "${sourceName}" becomes "${name}", which another field already uses. Remove one with --exclude.`,
        );
      }
      taken.add(name);
      if (name !== sourceName) {
        this.#warnings.add(`Field "${sourceName}" was renamed to "${name}".`);
      }
      return {name, sourceName, type: fieldType(this.#keyTypes[key])};
    });
    if (this.#clampedLatitude > 0) {
      this.#warnings.add(
        `${this.#clampedLatitude} features extend past latitude ±85.05 and were cut at the Web Mercator limit.`,
      );
    }
    if (this.#outsideMercator > 0) {
      this.#warnings.add(
        `${this.#outsideMercator} points past latitude ±85.05 were skipped; Web Mercator tiles cannot hold them.`,
      );
    }
    if (this.#nudgedCoordinates > 0) {
      this.#warnings.add(
        `${this.#nudgedCoordinates} coordinates up to ${coordinateToleranceDegrees}° past longitude ±180 or latitude ±90 were moved to that limit.`,
      );
    }
    if (this.#wideSegments > 0) {
      this.#warnings.add(
        `${this.#wideSegments} features have segments spanning more than 180° of longitude and will draw across the map. Split them at the antimeridian first.`,
      );
    }
    if (this.#nonNumericIds > 0) {
      this.#warnings.add(
        `${this.#nonNumericIds} feature ids are not non-negative integers and were dropped; vector tiles only store integer ids.`,
      );
    }
    if (this.#degenerateParts > 0) {
      this.#warnings.add(
        `${this.#degenerateParts} rings or lines with too few positions were skipped.`,
      );
    }
    if (this.#emptyGeometry > 0) {
      this.#warnings.add(`${this.#emptyGeometry} features without geometry were skipped.`);
    }
    return {
      bounds: [this.#minLon, this.#minLat, this.#maxLon, this.#maxLat],
      features: this.#features,
      fields,
      geometryTypes: [...this.#types].sort(),
      skipped: {emptyGeometry: this.#emptyGeometry, outsideMercator: this.#outsideMercator},
      warnings: [...this.#warnings],
    };
  }

  keyNames(summary: IngestSummary): string[] {
    return summary.fields.map((item) => item.name);
  }

  #numericId(id: unknown): number {
    if (id === undefined || id === null) return 0;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 && id < 2 ** 53 - 1) {
      return id + 1;
    }
    this.#nonNumericIds += 1;
    return 0;
  }

  #addGeometry(geometry: GeometryInput, id: number): void {
    const {coordinates, type} = geometry;
    switch (type) {
      case 'Point':
        this.#resetGeometry();
        if (isEmptyList(coordinates)) return this.skipEmpty();
        this.#pushPosition(coordinates, true);
        if (this.#points.length === 0) return;
        this.#parts.push(1);
        return this.#commit(geometryType.point, 'Point', id);
      case 'MultiPoint': {
        this.#resetGeometry();
        const positions = this.#list(coordinates);
        if (positions.length === 0) return this.skipEmpty();
        for (const position of positions) this.#pushPosition(position, true);
        if (this.#points.length === 0) return;
        this.#parts.push(this.#points.length / 2);
        return this.#commit(geometryType.point, 'Point', id);
      }
      case 'LineString':
      case 'MultiLineString': {
        this.#resetGeometry();
        const lines = type === 'LineString' ? [coordinates] : this.#list(coordinates);
        for (const line of lines) this.#pushLine(line);
        if (this.#parts.length === 0) return this.skipEmpty();
        return this.#commit(geometryType.line, 'LineString', id);
      }
      case 'Polygon':
      case 'MultiPolygon': {
        this.#resetGeometry();
        const polygons = type === 'Polygon' ? [coordinates] : this.#list(coordinates);
        for (const polygon of polygons) {
          const rings = this.#list(polygon);
          for (let index = 0; index < rings.length; index += 1) {
            this.#pushRing(rings[index], index === 0);
          }
        }
        if (this.#parts.length === 0) return this.skipEmpty();
        return this.#commit(geometryType.polygon, 'Polygon', id);
      }
      case 'GeometryCollection': {
        const geometries = this.#list(geometry.geometries);
        if (geometries.length === 0) return this.skipEmpty();
        for (const child of geometries) this.#addGeometry(child as GeometryInput, id);
        return;
      }
      default:
        throw this.#invalid(`unsupported geometry type ${JSON.stringify(type)}`);
    }
  }

  #resetGeometry(): void {
    this.#points.length = 0;
    this.#parts.length = 0;
    this.#clampedThisFeature = false;
  }

  #list(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw this.#invalid('coordinates are not an array');
    return value;
  }

  #pushLine(line: unknown): void {
    const positions = this.#list(line);
    if (positions.length === 0) return;
    if (positions.length < 2) {
      this.#degenerateParts += 1;
      return;
    }
    const start = this.#points.length;
    for (const position of positions) this.#pushPosition(position);
    this.#checkWideSegments(start);
    this.#parts.push(positions.length);
  }

  #pushRing(ring: unknown, exterior: boolean): void {
    const positions = this.#list(ring);
    if (positions.length === 0) return;
    const start = this.#points.length;
    const clampedBefore = this.#clampedThisFeature;
    for (const position of positions) this.#pushPosition(position);
    this.#checkWideSegments(start);
    const points = this.#points;
    let count = (points.length - start) / 2;
    if (points[start] === points.at(-2) && points[start + 1] === points.at(-1)) {
      count -= 1;
      points.length -= 2;
    }
    if (count < 3) {
      points.length = start;
      this.#clampedThisFeature = clampedBefore;
      this.#degenerateParts += 1;
      return;
    }
    orientRing(points, start, count, exterior);
    this.#parts.push(count);
  }

  #checkWideSegments(start: number): void {
    const points = this.#points;
    for (let index = start + 2; index < points.length; index += 2) {
      if (Math.abs(points[index] - points[index - 2]) > worldSize / 2) {
        this.#wideSegments += 1;
        return;
      }
    }
  }

  #pushPosition(position: unknown, dropPastMercator = false): void {
    if (!Array.isArray(position) || position.length < 2) {
      throw this.#invalid('a position must be [longitude, latitude]');
    }
    this.#pushXY(position[0], position[1], dropPastMercator);
  }

  #pushXY(sourceX: unknown, sourceY: unknown, dropPastMercator: boolean): void {
    if (
      typeof sourceX !== 'number' ||
      typeof sourceY !== 'number' ||
      !Number.isFinite(sourceX) ||
      !Number.isFinite(sourceY)
    ) {
      throw this.#invalid(`coordinate [${String(sourceX)}, ${String(sourceY)}] is not numeric`);
    }
    let longitude = sourceX;
    let latitude = sourceY;
    if (this.#transform) [longitude, latitude] = this.#transform(sourceX, sourceY);
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 + coordinateToleranceDegrees ||
      Math.abs(latitude) > 90 + coordinateToleranceDegrees
    ) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE',
        'input',
        this.#transform
          ? `${this.location}: [${sourceX}, ${sourceY}] did not convert to a valid longitude and latitude. The stated CRS probably does not match the data.`
          : `${this.location}: [${sourceX}, ${sourceY}] is outside WGS84 longitude and latitude. The data looks projected or has swapped axes. State its CRS with --source-crs <crs> --reproject; the build will not guess.`,
      );
    }
    if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
      longitude = Math.max(-180, Math.min(180, longitude));
      latitude = Math.max(-90, Math.min(90, latitude));
      this.#nudgedCoordinates += 1;
    }
    // A point past the limit has nowhere to go, unlike a shape, which is cut there.
    if (dropPastMercator && Math.abs(latitude) > maximumMercatorLatitude) {
      this.#outsideMercator += 1;
      return;
    }
    if (longitude < this.#minLon) this.#minLon = longitude;
    if (longitude > this.#maxLon) this.#maxLon = longitude;
    const clampedLatitude = Math.max(
      -maximumMercatorLatitude,
      Math.min(maximumMercatorLatitude, latitude),
    );
    if (clampedLatitude !== latitude) this.#markClamped();
    if (clampedLatitude < this.#minLat) this.#minLat = clampedLatitude;
    if (clampedLatitude > this.#maxLat) this.#maxLat = clampedLatitude;
    const sine = Math.sin((clampedLatitude * Math.PI) / 180);
    const worldX = ((longitude + 180) / 360) * worldSize;
    const worldY = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize;
    this.#points.push(
      Math.min(worldSize - 1, Math.max(0, Math.round(worldX))),
      Math.min(worldSize - 1, Math.max(0, Math.round(worldY))),
    );
  }

  #clampedThisFeature = false;
  #markClamped(): void {
    this.#clampedThisFeature = true;
  }

  #commit(type: number, typeName: string, id: number): void {
    if (this.#clampedThisFeature) this.#clampedLatitude += 1;
    this.#clampedThisFeature = false;
    if (this.rank) {
      if (this.#features === this.#rankKeys.length) {
        const grown = new Float64Array(this.#rankKeys.length * 2);
        grown.set(this.#rankKeys);
        this.#rankKeys = grown;
      }
      this.#rankKeys[this.#features] = this.#currentRank;
    }

    const points = this.#points;
    const partCount = this.#parts.length;
    const pointCount = points.length / 2;
    const propertyWords = Math.ceil(this.#propertyLength / 4);
    const size = headerWords + partCount + points.length + propertyWords;
    const offset = this.spool.reserve(size);
    const words = this.spool.words;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let target = offset + headerWords + partCount;
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index];
      const y = points[index + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      words[target] = x;
      words[target + 1] = y;
      target += 2;
      this.#sampleVertex(x, y);
    }
    words[offset + field.words] = size;
    words[offset + field.type] = type;
    words[offset + field.minX] = minX;
    words[offset + field.minY] = minY;
    words[offset + field.maxX] = maxX;
    words[offset + field.maxY] = maxY;
    words[offset + field.parts] = partCount;
    words[offset + field.points] = pointCount;
    words[offset + field.propertyBytes] = this.#propertyLength;
    words[offset + field.idLow] = id % 2 ** 32;
    words[offset + field.idHigh] = Math.floor(id / 2 ** 32);
    words[offset + field.kept] = 0;
    for (let index = 0; index < partCount; index += 1) {
      words[offset + headerWords + index] = this.#parts[index];
    }
    if (propertyWords > 0) {
      words[offset + size - 1] = 0;
      new Uint8Array(words.buffer, words.byteOffset + target * 4, this.#propertyLength).set(
        this.#properties.subarray(0, this.#propertyLength),
      );
    }
    this.#features += 1;
    this.#types.add(typeName);
  }

  #sampleVertex(x: number, y: number): void {
    this.#sampleSeen += 1;
    if (this.#sampleSeen % this.#sampleStride !== 0) return;
    if (this.sampleCount === sampleCapacity) {
      for (let index = 0; index < sampleCapacity / 2; index += 1) {
        this.sample[index * 2] = this.sample[index * 4];
        this.sample[index * 2 + 1] = this.sample[index * 4 + 1];
      }
      this.sampleCount = sampleCapacity / 2;
      this.#sampleStride *= 2;
      if (this.#sampleSeen % this.#sampleStride !== 0) return;
    }
    this.sample[this.sampleCount * 2] = x;
    this.sample[this.sampleCount * 2 + 1] = y;
    this.sampleCount += 1;
  }

  #encodeProperties(properties: Record<string, unknown>): void {
    this.#propertyLength = 0;
    const {exclude, include} = this.selection;
    for (const name in properties) {
      if (!Object.hasOwn(properties, name)) continue;
      const value = properties[name];
      if (value === null || value === undefined) continue;
      if (include ? !include.has(name) : exclude?.has(name)) continue;
      this.#encodeProperty(name, value);
    }
  }

  #encodeProperty(name: string, value: unknown): void {
    let key = this.#keys.get(name);
    if (key === undefined) {
      key = this.#keys.size;
      if (key >= 65_535) {
        throw new TilesetBuildError(
          'TF_TILESET_BUILD_TOO_MANY_FIELDS',
          'input.fields',
          `The input has more than ${key} attribute fields. Pick what maps need with --include.`,
        );
      }
      this.#keys.set(name, key);
      this.#keyTypes.push(0);
    }
    const start = this.#propertyLength + 6;
    let end: number;
    if (typeof value === 'number' && Number.isFinite(value)) {
      this.#keyTypes[key] |= typeBits.number;
      end = this.#encodeNumber(start, value);
    } else if (typeof value === 'boolean') {
      this.#keyTypes[key] |= typeBits.boolean;
      this.#ensureProperties(start + 2);
      this.#properties[start] = 0x38;
      this.#properties[start + 1] = value ? 1 : 0;
      end = start + 2;
    } else {
      this.#keyTypes[key] |= typeBits.string;
      end = this.#encodeString(start, typeof value === 'string' ? value : JSON.stringify(value));
    }
    this.#propertiesView.setUint16(this.#propertyLength, key, true);
    this.#propertiesView.setUint32(this.#propertyLength + 2, end - start, true);
    this.#propertyLength = end;
  }

  #encodeNumber(start: number, value: number): number {
    this.#ensureProperties(start + 12);
    if (Number.isSafeInteger(value)) {
      // sint_value: zigzag beyond 32 bits needs arithmetic rather than shifts.
      let remaining = value >= 0 ? value * 2 : -value * 2 - 1;
      let cursor = start;
      this.#properties[cursor] = 0x30;
      cursor += 1;
      while (remaining >= 0x80) {
        this.#properties[cursor] = (remaining % 0x80) | 0x80;
        cursor += 1;
        remaining = Math.floor(remaining / 0x80);
      }
      this.#properties[cursor] = remaining;
      return cursor + 1;
    }
    this.#properties[start] = 0x19;
    this.#propertiesView.setFloat64(start + 1, value, true);
    return start + 9;
  }

  #encodeString(start: number, value: string): number {
    const byteLength = Buffer.byteLength(value);
    this.#ensureProperties(start + 6 + byteLength);
    let cursor = start;
    this.#properties[cursor] = 0x0a;
    cursor += 1;
    let remaining = byteLength;
    while (remaining >= 0x80) {
      this.#properties[cursor] = (remaining & 0x7f) | 0x80;
      cursor += 1;
      remaining >>>= 7;
    }
    this.#properties[cursor] = remaining;
    cursor += 1;
    Buffer.from(this.#properties.buffer).write(value, cursor, 'utf8');
    return cursor + byteLength;
  }

  #ensureProperties(size: number): void {
    if (size <= this.#properties.length) return;
    const grown = new Uint8Array(Math.max(size, this.#properties.length * 2));
    grown.set(this.#properties);
    this.#properties = grown;
    this.#propertiesView = new DataView(grown.buffer);
  }

  #invalid(reason: string): TilesetBuildError {
    return new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `${this.location}: ${reason}.`,
    );
  }
}

function isEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/** Exterior rings get positive area in y-down world coordinates; holes get negative. */
function orientRing(points: number[], start: number, count: number, exterior: boolean): void {
  let area = 0;
  let previousX = points[start + (count - 1) * 2];
  let previousY = points[start + (count - 1) * 2 + 1];
  for (let index = 0; index < count; index += 1) {
    const x = points[start + index * 2];
    const y = points[start + index * 2 + 1];
    area += previousX * y - x * previousY;
    previousX = x;
    previousY = y;
  }
  if (area === 0 || area > 0 === exterior) return;
  for (let low = 0, high = count - 1; low < high; low += 1, high -= 1) {
    const x = points[start + low * 2];
    const y = points[start + low * 2 + 1];
    points[start + low * 2] = points[start + high * 2];
    points[start + low * 2 + 1] = points[start + high * 2 + 1];
    points[start + high * 2] = x;
    points[start + high * 2 + 1] = y;
  }
}

function safeFieldName(name: string, key: number): string {
  if (fieldNamePattern.test(name)) return name;
  const cleaned = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._:-]+/gu, '_')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .slice(0, 192);
  return cleaned || `field_${key + 1}`;
}

function fieldType(bits: number): 'Boolean' | 'Number' | 'String' | 'Mixed' {
  if (bits === typeBits.boolean) return 'Boolean';
  if (bits === typeBits.number) return 'Number';
  if (bits === typeBits.string) return 'String';
  return 'Mixed';
}
