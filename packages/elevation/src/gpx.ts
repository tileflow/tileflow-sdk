/**
 * Tracks and routes of a GPX 1.0 or 1.1 document as one GeoJSON MultiLineString: one line per track
 * segment and per route, in document order, positions `[longitude, latitude]` or, where the point
 * has `<ele>`, `[longitude, latitude, elevation]` in metres. Waypoints are not lines and are left
 * out. The reader needs no DOM, so it runs in browsers, workers and servers alike.
 */

export type GpxTrack = Readonly<{
  /** The first track or route name, when the document has one. */
  name: string | null;
  line: {type: 'MultiLineString'; coordinates: number[][][]};
}>;

/** Points kept from one document: about ten days of one-second samples. */
const maximumGpxPoints = 1_000_000;

const tag = (name: string) => `(?:[A-Za-z_][\\w.-]*:)?${name}`;
const segmentPattern = new RegExp(
  `<(${tag('trkseg')}|${tag('rte')})\\b[^>]*>([\\s\\S]*?)</\\1\\s*>`,
  'gu',
);
const pointPattern = new RegExp(
  `<(${tag('trkpt')}|${tag('rtept')})\\b([^>]*?)(?:/>|>([\\s\\S]*?)</\\1\\s*>)`,
  'gu',
);
const elevationPattern = new RegExp(`<${tag('ele')}\\b[^>]*>([^<]*)</${tag('ele')}\\s*>`, 'u');
const namePattern = new RegExp(
  `<${tag('(?:trk|rte)')}\\b[^>]*>\\s*(?:<!--[\\s\\S]*?-->\\s*)*<${tag('name')}\\b[^>]*>([^<]*)</${tag('name')}\\s*>`,
  'u',
);

function attribute(attributes: string, name: string) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'u').exec(attributes);
  return match ? (match[2] ?? match[3] ?? '') : null;
}

function decodeText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(
      /&(lt|gt|quot|apos|amp);/gu,
      (_entity, name: string) => ({lt: '<', gt: '>', quot: '"', apos: "'", amp: '&'})[name]!,
    )
    .trim();
}

/** The tracks and routes of a GPX document; throws when it has no line of at least two points. */
export function readGpx(text: string): GpxTrack {
  if (typeof text !== 'string' || !/<(?:[A-Za-z_][\w.-]*:)?gpx\b/u.test(text))
    throw new Error('Not a GPX document');
  const source = text.replace(/<!--[\s\S]*?-->/gu, '');
  const coordinates: number[][][] = [];
  let points = 0;
  for (const segment of source.matchAll(segmentPattern)) {
    const line: number[][] = [];
    for (const point of segment[2]!.matchAll(pointPattern)) {
      if (++points > maximumGpxPoints) throw new Error('The GPX document has too many points');
      const lat = Number(attribute(point[2]!, 'lat'));
      const lon = Number(attribute(point[2]!, 'lon'));
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        throw new Error('The GPX document has an invalid point');
      const elevation = point[3] ? elevationPattern.exec(point[3]) : null;
      const height = elevation ? Number(decodeText(elevation[1]!)) : Number.NaN;
      line.push(Number.isFinite(height) ? [lon, lat, height] : [lon, lat]);
    }
    if (line.length >= 2) coordinates.push(line);
  }
  if (coordinates.length === 0) throw new Error('The GPX document has no track or route');
  const name = namePattern.exec(source);
  return Object.freeze({
    name: name ? decodeText(name[1]!) || null : null,
    line: {type: 'MultiLineString' as const, coordinates},
  });
}
