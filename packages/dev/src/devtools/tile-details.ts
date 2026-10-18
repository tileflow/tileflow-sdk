import type {Map as MapLibreMap} from 'maplibre-gl';
import {inspectTile, type TileContents, tilePolygon} from './tiles';
import type {TileRecord} from './types';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function button(text: string, action: () => void) {
  const node = el('button', '', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function values(entries: Record<string, unknown>) {
  const list = el('dl', 'dt-kv');
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    list.append(el('dt', '', key), el('dd', '', String(value)));
  }
  return list;
}
function size(bytes?: number) {
  return bytes === undefined ? 'Unavailable' : `${bytes.toLocaleString()} B`;
}
const pageSize = 50;

/** Keeps feature browsing intact while the surrounding tile table refreshes. */
export class TileDetailsPanel {
  private tile?: TileRecord;
  private contents?: TileContents;
  private map?: MapLibreMap;
  private signature = '';
  private tab: 'Source layers' | 'Features' | 'Info' = 'Source layers';
  private layer = '';
  private page = 0;
  private body = el('div', 'dt-scroll dt-tile-content');

  constructor(
    private root: HTMLElement,
    private close: () => void,
    private revealLayer: (id: string) => void = () => {},
    private highlight: () => void = () => {},
  ) {
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Tile details');
  }

  update(map: MapLibreMap, tile: TileRecord) {
    const contents = inspectTile(map, tile);
    const signature = JSON.stringify([
      tile,
      contents.type,
      contents.tileSize,
      contents.encoding,
      contents.message,
      contents.terrain,
    ]);
    const differentTile = this.map !== map || this.tile?.key !== tile.key;
    if (
      !differentTile &&
      signature === this.signature &&
      contents.revision === this.contents?.revision
    )
      return;
    if (differentTile) {
      this.tab = 'Source layers';
      this.layer = '';
      this.page = 0;
    }
    this.map = map;
    this.tile = tile;
    this.contents = contents;
    this.signature = signature;
    this.render();
  }

  clear() {
    this.tile = undefined;
    this.contents = undefined;
    this.map = undefined;
    this.signature = '';
    this.root.replaceChildren();
  }

  private render() {
    const tile = this.tile!;
    const header = el('div', 'dt-tools dt-tile-heading');
    header.append(el('strong', '', `Tile ${tile.z}/${tile.x}/${tile.y}`));
    const close = button('×', this.close);
    close.setAttribute('aria-label', 'Close tile details');
    header.append(button('Show on map', this.highlight), close);
    const tabs = el('div', 'dt-subtabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Tile detail views');
    for (const name of ['Source layers', 'Features', 'Info'] as const) {
      const tab = button(name, () => {
        this.tab = name;
        this.render();
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(this.tab === name));
      tab.id = `dt-tile-tab-${name.toLowerCase().replaceAll(' ', '-')}`;
      tab.setAttribute('aria-controls', 'dt-tile-detail-content');
      tab.tabIndex = this.tab === name ? 0 : -1;
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const names = ['Source layers', 'Features', 'Info'] as const;
        this.tab =
          names[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? 2
                : (names.indexOf(this.tab) + (event.key === 'ArrowLeft' ? 2 : 1)) % 3
          ];
        this.render();
        this.root.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus();
      });
      tabs.append(tab);
    }
    this.body = el('div', 'dt-scroll dt-tile-content');
    this.body.setAttribute('role', 'tabpanel');
    this.body.id = 'dt-tile-detail-content';
    this.body.setAttribute(
      'aria-labelledby',
      `dt-tile-tab-${this.tab.toLowerCase().replaceAll(' ', '-')}`,
    );
    this.body.setAttribute('aria-label', `Tile ${this.tab.toLowerCase().replaceAll(' ', '-')}`);
    const count = Object.values(this.contents?.layers ?? {}).reduce((n, l) => n + l.length, 0);
    const status = el(
      'div',
      'dt-tile-status',
      `${tile.state} · ${size(tile.bytes)} raw · ${Object.keys(this.contents?.layers ?? {}).length} source layers · ${count} features`,
    );
    this.root.replaceChildren(header, status, tabs, this.body);
    if (this.tab === 'Features') this.data();
    else this.overview();
  }

  private overview() {
    const tile = this.tile!,
      contents = this.contents!;
    const ring = tilePolygon(tile).coordinates[0];
    if (this.tab === 'Info')
      this.body.append(
        values({
          Source: tile.source,
          Type: contents.type,
          State: tile.state,
          'Display zoom': tile.overscaledZ,
          'World copy': tile.wrap ?? 0,
          'Raw tile bytes': size(tile.bytes),
          'Tile size': contents.tileSize === undefined ? undefined : `${contents.tileSize} px`,
          Encoding: contents.encoding,
          'West / south': `${ring[3][0].toFixed(6)}, ${ring[3][1].toFixed(6)}`,
          'East / north': `${ring[1][0].toFixed(6)}, ${ring[1][1].toFixed(6)}`,
        }),
      );
    if (contents.terrain && this.tab === 'Info') {
      const dem = contents.terrain;
      this.body.append(
        values({
          'Elevation grid': `${dem.size} × ${dem.size}`,
          'Minimum elevation': `${dem.min.toFixed(2)} m`,
          'Maximum elevation': `${dem.max.toFixed(2)} m`,
          'Decoded DEM bytes': size(dem.bytes),
        }),
      );
    }
    if (contents.layers && this.tab === 'Source layers') {
      const layers = Object.entries(contents.layers);
      this.body.append(
        el(
          'p',
          'dt-note',
          `${layers.length} source layers · ${layers.reduce((total, [, layer]) => total + layer.length, 0).toLocaleString()} features`,
        ),
      );
      const table = el('table', 'dt-table');
      const head = el('thead'),
        header = el('tr');
      for (const title of ['Source layer', 'Features', 'Used by'])
        header.append(el('th', '', title));
      head.append(header);
      const body = el('tbody');
      for (const [name, layer] of layers) {
        const row = el('tr'),
          cell = el('td');
        const link = button(name, () => {
          this.layer = name;
          this.page = 0;
          this.tab = 'Features';
          this.render();
        });
        link.className = 'dt-cell-button';
        cell.append(link);
        const used = el('td');
        const consumers = this.map!.getStyle().layers.filter(
          (l) =>
            'source' in l &&
            l.source === tile.source &&
            'source-layer' in l &&
            l['source-layer'] === name,
        );
        for (const l of consumers) {
          const link = button(l.id, () => this.revealLayer(l.id));
          link.className = 'dt-tile-chip';
          used.append(link);
        }
        if (!consumers.length) used.textContent = 'Unused · no style layer references this data';
        row.append(cell, el('td', 'dt-number', layer.length.toLocaleString()), used);
        body.append(row);
      }
      table.append(head, body);
      const card = el('div', 'dt-card dt-card-table');
      card.append(table);
      this.body.append(card);
    }
    if (contents.message) this.body.append(el('p', 'dt-note', contents.message));
  }

  private data() {
    const contents = this.contents!;
    if (!contents.layers) {
      this.body.append(
        el(
          'p',
          'dt-note',
          contents.message ??
            'This tile contains an elevation grid, not vector features. See Info for its terrain data.',
        ),
      );
      return;
    }
    const names = Object.keys(contents.layers);
    if (!names.length) {
      this.body.append(el('p', 'dt-note', 'This vector tile contains no source layers.'));
      return;
    }
    if (!names.includes(this.layer)) {
      this.layer = names[0];
      this.page = 0;
    }
    const toolbar = el('div', 'dt-tools'),
      select = el('select');
    select.setAttribute('aria-label', 'Tile source layer');
    for (const name of names)
      select.append(new Option(`${name} (${contents.layers[name].length.toLocaleString()})`, name));
    select.value = this.layer;
    select.addEventListener('change', () => {
      this.layer = select.value;
      this.page = 0;
      this.render();
    });
    select.hidden = true;
    toolbar.append(select);
    toolbar.className = 'dt-tile-chip-list';
    for (const name of names) {
      const chip = button(`${name} · ${contents.layers[name].length}`, () => {
        this.layer = name;
        this.page = 0;
        this.render();
      });
      chip.className = 'dt-tile-chip';
      chip.setAttribute('aria-pressed', String(this.layer === name));
      toolbar.append(chip);
    }
    const layer = contents.layers[this.layer];
    this.page = Math.min(this.page, Math.max(0, Math.ceil(layer.length / pageSize) - 1));
    const start = this.page * pageSize,
      end = Math.min(start + pageSize, layer.length);
    const previous = button('Previous', () => {
      this.page--;
      this.render();
    });
    previous.disabled = this.page === 0;
    const next = button('Next', () => {
      this.page++;
      this.render();
    });
    next.disabled = end >= layer.length;
    const paging = el('div', 'dt-tools dt-tile-paging');
    paging.append(
      previous,
      el('span', '', `${layer.length ? start + 1 : 0}–${end} of ${layer.length.toLocaleString()}`),
      next,
    );
    this.body.append(
      toolbar,
      el('p', 'dt-note', `Whole tile · MVT v${layer.version} · extent ${layer.extent}`),
      paging,
    );
    for (let index = start; index < end; index++) {
      try {
        const feature = layer.feature(index);
        const name =
          feature.properties.name ?? feature.properties['name:en'] ?? feature.properties.class;
        const kind = ['Unknown', 'Point', 'LineString', 'Polygon'][feature.type];
        const row = el('details', 'dt-tile-feature');
        row.append(
          el(
            'summary',
            '',
            `#${index + 1} · ${kind}${feature.id === undefined ? '' : ` · ID ${feature.id}`}${name === undefined ? '' : ` · ${name}`}`,
          ),
        );
        row.addEventListener('toggle', () => {
          if (!row.open || row.childElementCount > 1) return;
          const properties = el('pre', '', JSON.stringify(feature.properties, null, 2));
          properties.setAttribute('aria-label', 'Feature properties');
          const tile = this.tile!;
          const geo = feature.toGeoJSON(tile.x, tile.y, tile.z);
          const copy = button('Copy GeoJSON', () => {
            void navigator.clipboard.writeText(JSON.stringify(geo, null, 2)).then(
              () => (copy.textContent = 'Copied'),
              () => (copy.textContent = 'Copy unavailable'),
            );
          });
          row.append(properties, copy);
          const geometry = el('details');
          geometry.append(el('summary', '', 'Geometry (GeoJSON)'));
          geometry.addEventListener('toggle', () => {
            if (!geometry.open || geometry.childElementCount > 1) return;
            try {
              const tile = this.tile!;
              geometry.append(
                el(
                  'pre',
                  '',
                  JSON.stringify(feature.toGeoJSON(tile.x, tile.y, tile.z).geometry, null, 2),
                ),
              );
            } catch {
              geometry.append(el('p', 'dt-note', 'This feature geometry could not be decoded.'));
            }
          });
          row.append(geometry);
        });
        this.body.append(row);
      } catch {
        this.body.append(el('p', 'dt-note', `Feature #${index + 1} could not be decoded.`));
      }
    }
  }
}
