import type {GeoJSONSource, MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import {mapValue} from './map-value';

type Geometry = {
  type: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon';
  coordinates: any[];
};
type Vertex = {coordinate: number[]; path: number[]};

export function geometryVertices(geometry: Geometry): Vertex[] {
  const result: Vertex[] = [];
  function visit(value: any[], path: number[]) {
    if (typeof value[0] === 'number') result.push({coordinate: value as number[], path});
    else for (let i = 0; i < value.length; i++) visit(value[i], [...path, i]);
  }
  visit(geometry.coordinates, []);
  return result;
}

export function validateGeometry(input: unknown): asserts input is Geometry {
  if (!input || typeof input !== 'object') throw new Error('Enter a GeoJSON geometry object.');
  const geometry = input as Geometry;
  const depth = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  }[geometry.type];
  if (depth === undefined)
    throw new Error('Use a Point, LineString, Polygon or their Multi variants.');
  let count = 0;
  function check(value: unknown, level: number) {
    if (!Array.isArray(value)) throw new Error('Coordinates must be arrays.');
    if (level === 0) {
      if (++count > 2000) throw new Error('Geometry editing is limited to 2,000 vertices.');
      if (
        value.length < 2 ||
        value.length > 3 ||
        !value.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
        Math.abs(value[0]) > 180 ||
        Math.abs(value[1]) > 85.051129
      )
        throw new Error('Use finite longitude / latitude coordinates within the Mercator map.');
    } else {
      if (!value.length) throw new Error('Geometry cannot be empty.');
      for (const part of value) check(part, level - 1);
    }
  }
  check(geometry.coordinates, depth);
  const lines =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
  for (const line of lines)
    if (line.length < 2) throw new Error('A line requires at least two vertices.');
  const rings =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.flat()
        : [];
  for (const ring of rings)
    if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
      throw new Error('Polygon rings require at least four coordinates and must be closed.');
}

/** Scratch data remains separate from authored and tiled sources. */
export class GeometryEditor {
  geometry: Geometry;
  private original: Geometry;
  private undoStack: Geometry[] = [];
  private redoStack: Geometry[] = [];
  private handles: HTMLDivElement;
  private source = `__tileflow-devtools-geometry-${Math.random().toString(36).slice(2)}`;
  private drag?: {
    before: Geometry;
    path: number[];
    move: (event: PointerEvent) => void;
    end: () => void;
    enabled: boolean;
  };
  constructor(
    readonly map: MapLibreMap,
    feature: MapGeoJSONFeature,
    readonly changed: () => void,
  ) {
    const geometry = structuredClone(feature.geometry);
    validateGeometry(geometry);
    this.geometry = geometry;
    this.original = structuredClone(geometry);
    map.addSource(this.source, mapValue(map, {type: 'geojson', data: this.data()}));
    map.addLayer(
      mapValue(map, {
        id: this.source + '-fill',
        type: 'fill',
        source: this.source,
        filter: ['==', '$type', 'Polygon'],
        paint: {'fill-color': '#1a73e8', 'fill-opacity': 0.16},
      }),
    );
    map.addLayer(
      mapValue(map, {
        id: this.source + '-line',
        type: 'line',
        source: this.source,
        paint: {'line-color': '#1a73e8', 'line-width': 2},
      }),
    );
    map.addLayer(
      mapValue(map, {
        id: this.source + '-point',
        type: 'circle',
        source: this.source,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-color': '#1a73e8',
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      }),
    );
    this.handles = map.getContainer().ownerDocument.createElement('div');
    this.handles.className = 'dt-geometry-handles';
    // The handles belong to the iframe and must not rely on the shell's styles.
    this.handles.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden';
    map.getContainer().append(this.handles);
    map.on('move', this.draw);
    map.on('resize', this.draw);
    this.draw();
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  private data() {
    return mapValue(this.map, {
      type: 'Feature' as const,
      properties: {},
      geometry: this.geometry as GeoJSON.Geometry,
    });
  }
  set(input: unknown) {
    validateGeometry(input);
    this.undoStack.push(structuredClone(this.geometry));
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
    this.geometry = structuredClone(input);
    this.refresh();
  }
  undo() {
    const value = this.undoStack.pop();
    if (!value) return;
    this.redoStack.push(structuredClone(this.geometry));
    this.geometry = value;
    this.refresh();
  }
  redo() {
    const value = this.redoStack.pop();
    if (!value) return;
    this.undoStack.push(structuredClone(this.geometry));
    this.geometry = value;
    this.refresh();
  }
  reset() {
    this.set(this.original);
  }
  private refresh() {
    (this.map.getSource(this.source) as GeoJSONSource | undefined)?.setData(this.data());
    this.draw();
    this.changed();
  }
  readonly draw = () => {
    if (this.drag) return;
    this.handles.replaceChildren();
    const vertices = geometryVertices(this.geometry);
    if (vertices.length > 256) return;
    for (const {coordinate, path} of vertices) {
      const point = this.map.project(coordinate as [number, number]);
      const button = this.handles.ownerDocument.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Move vertex ${path.join('.') || '0'}`);
      button.style.cssText = `position:absolute;left:${point.x}px;top:${point.y}px;width:10px;height:10px;min-height:0;padding:0;transform:translate(-50%,-50%);border:2px solid #1a73e8;background:#fff;pointer-events:auto;cursor:move;touch-action:none;border-radius:1px`;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const before = structuredClone(this.geometry),
          enabled = this.map.dragPan.isEnabled();
        this.map.dragPan.disable();
        const win = this.handles.ownerDocument.defaultView!;
        const move = (e: PointerEvent) => {
          const rect = this.map.getContainer().getBoundingClientRect();
          const position = this.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
          let parent = this.geometry.coordinates;
          for (const part of path.slice(0, -1)) parent = parent[part];
          const value = [position.lng, Math.max(-85.051129, Math.min(85.051129, position.lat))];
          if (Math.abs(value[0]) > 180) return;
          if (!path.length) this.geometry.coordinates = value;
          else {
            const index = path.at(-1)!;
            const isRing = this.geometry.type.includes('Polygon');
            parent[index] = value;
            if (isRing && (index === 0 || index === parent.length - 1)) {
              parent[0] = [...value];
              parent[parent.length - 1] = [...value];
            }
          }
          button.style.left = e.clientX - rect.left + 'px';
          button.style.top = e.clientY - rect.top + 'px';
          (this.map.getSource(this.source) as GeoJSONSource).setData(this.data());
        };
        const end = () => {
          win.removeEventListener('pointermove', move);
          win.removeEventListener('pointerup', end);
          win.removeEventListener('pointercancel', end);
          this.drag = undefined;
          if (enabled) this.map.dragPan.enable();
          if (JSON.stringify(before) !== JSON.stringify(this.geometry)) {
            this.undoStack.push(before);
            if (this.undoStack.length > 30) this.undoStack.shift();
            this.redoStack = [];
          }
          this.refresh();
        };
        this.drag = {before, path, move, end, enabled};
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', end);
        win.addEventListener('pointercancel', end);
      });
      this.handles.append(button);
    }
  };
  dispose() {
    if (this.drag) this.drag.end();
    this.map.off('move', this.draw);
    this.map.off('resize', this.draw);
    this.handles.remove();
    for (const suffix of ['-fill', '-line', '-point'])
      if (this.map.getLayer(this.source + suffix)) this.map.removeLayer(this.source + suffix);
    if (this.map.getSource(this.source)) this.map.removeSource(this.source);
  }
}
