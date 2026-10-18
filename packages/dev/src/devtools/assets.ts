import {isExpression} from '@maplibre/maplibre-gl-style-spec';
import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {FontPreviews} from './font-preview';
import {type IconSource, SpriteCatalog} from './sprite-catalog';
import {themeLabel, themeVariantLabel} from './theme-labels';
import type {PreviewWindow, Side} from './types';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** Includes every atlas namespace and runtime image, without extracting pixel data. */
export function spriteNames(map: Pick<MapLibreMap, 'listImages'>, filter = '') {
  const query = filter.trim().toLocaleLowerCase();
  return map
    .listImages()
    .filter((id) => id.toLocaleLowerCase().includes(query))
    .sort();
}

/** Preview SDF coverage in a neutral ink; never modify the map's source pixels. */
export function spritePreviewPixels(
  data: Uint8Array | Uint8ClampedArray,
  sdf: boolean,
  ratio: number,
) {
  const pixels = new Uint8ClampedArray(data);
  if (!sdf) return pixels;
  const gamma = 0.105 / Math.max(1, ratio);
  for (let i = 0; i < pixels.length; i += 4) {
    const t = Math.max(0, Math.min(1, (pixels[i + 3] / 255 - (0.75 - gamma)) / (2 * gamma)));
    pixels[i] = 45;
    pixels[i + 1] = 55;
    pixels[i + 2] = 72;
    pixels[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return pixels;
}

type Category = 'Sprites' | 'Glyphs' | 'Fonts' | 'Models';

/** Follow corresponding expression outputs; class labels and suffix conventions are not variants. */
export function iconVariant(
  name: string,
  from: StyleSpecification,
  to: StyleSpecification,
): string | undefined {
  const found = new Set<string>();
  const visit = (a: unknown, b: unknown) => {
    if (typeof a === 'string' && a === name && typeof b === 'string') {
      found.add(b);
      return;
    }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a[0] !== b[0]) return;
    const op = a[0];
    if (op === 'match' || op === 'step') {
      if (JSON.stringify(a[1]) !== JSON.stringify(b[1])) return;
      const start = op === 'match' ? 3 : 2;
      for (let i = start; i < a.length; i += 2)
        if (i === 2 || JSON.stringify(a[i - 1]) === JSON.stringify(b[i - 1])) visit(a[i], b[i]);
      if (op === 'match') visit(a.at(-1), b.at(-1));
    } else if (op === 'case') {
      for (let i = 2; i < a.length; i += 2)
        if (JSON.stringify(a[i - 1]) === JSON.stringify(b[i - 1])) visit(a[i], b[i]);
      visit(a.at(-1), b.at(-1));
    } else if (op === 'coalesce' || op === 'image')
      for (let i = 1; i < a.length; i++) visit(a[i], b[i]);
  };
  for (const layer of from.layers) {
    const target = to.layers.find((l) => l.id === layer.id);
    if (layer.type === 'symbol' && target?.type === 'symbol')
      visit(layer.layout?.['icon-image'], target.layout?.['icon-image']);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

export class AssetsPanel {
  private catalog = new SpriteCatalog();
  private iconSource?: IconSource;
  private iconStyle?: StyleSpecification;
  private iconTheme = '';
  private palette = el('select');
  private moment = el('select');
  private assetRun?: AbortController;
  private variantRun?: AbortController;
  private category: Category = 'Sprites';
  private tabs = new Map<Category, HTMLButtonElement>();
  private selectedSprite = '';
  private selectedModel = '';
  private sample = 'Streets, parks and cafés.';
  private sampleInput = el('input');
  private fontTimer?: ReturnType<typeof setTimeout>;
  private assetAside = el('aside', 'dt-asset-aside');
  private revealLayer: (id: string) => void;
  private search = el('input');
  private toolbar = el('div', 'dt-tools');
  private content = el('div', 'dt-scroll dt-assets-content');
  private status = el('div', 'dt-footer');
  private map?: MapLibreMap;
  private style?: StyleSpecification;
  private dirty = true;
  private signature = '';
  private names: string[] = [];
  private frame?: number;
  private previews?: IntersectionObserver;
  private fonts = new FontPreviews();
  private fontRun?: AbortController;
  private invalidate = () => {
    this.dirty = true;
  };

  constructor(
    root: HTMLElement,
    private active: () => Side,
    revealLayer: (id: string) => void = () => {},
  ) {
    this.revealLayer = revealLayer;
    const tabs = el('div', 'dt-subtabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Asset categories');
    for (const category of ['Sprites', 'Models', 'Fonts'] as const) {
      const tab = el(
        'button',
        '',
        category === 'Sprites' ? 'Icons' : category === 'Models' ? '3D models' : category,
      );
      tab.type = 'button';
      tab.id = `dt-assets-${category.toLowerCase()}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'dt-assets-content');
      tab.addEventListener('click', () => this.select(category));
      tab.addEventListener('keydown', (event) => {
        const names = [...this.tabs.keys()];
        let next = names.indexOf(this.category);
        if (event.key === 'ArrowRight') next = (next + 1) % names.length;
        else if (event.key === 'ArrowLeft') next = (next + names.length - 1) % names.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = names.length - 1;
        else return;
        event.preventDefault();
        this.select(names[next]);
        this.tabs.get(names[next])!.focus();
      });
      this.tabs.set(category, tab);
      tabs.append(tab);
    }
    this.search.type = 'search';
    this.search.placeholder = 'Filter icons';
    this.search.setAttribute('aria-label', 'Filter icons');
    this.search.addEventListener('input', () => this.render());
    this.sampleInput.value = this.sample;
    this.sampleInput.placeholder = 'Type to preview…';
    this.sampleInput.setAttribute('aria-label', 'Font preview text');
    this.sampleInput.addEventListener('input', () => {
      this.sample = this.sampleInput.value;
      clearTimeout(this.fontTimer);
      this.fontTimer = setTimeout(() => this.render(), 180);
    });
    this.palette.setAttribute('aria-label', 'Icon theme');
    this.moment.setAttribute('aria-label', 'Icon time of day');
    const changeVariant = () => {
      const variants = window.__tileflowScene?.variants() ?? [],
        variant =
          variants.find(
            (v) => v.palette === this.palette.value && v.timeOfDay === this.moment.value,
          ) || variants.find((v) => v.palette === this.palette.value);
      if (variant) void this.loadIconTheme(variant.theme);
    };
    this.palette.onchange = changeVariant;
    this.moment.onchange = changeVariant;
    this.toolbar.append(this.search, this.sampleInput, this.palette, this.moment);
    this.content.id = 'dt-assets-content';
    this.content.setAttribute('role', 'tabpanel');
    this.status.setAttribute('role', 'status');
    root.append(tabs, this.toolbar, this.content, this.status);
    this.select('Sprites');
  }

  refresh() {
    const side = this.active(),
      map = side.map;
    if (map !== this.map) {
      this.map?.off('styledata', this.invalidate);
      this.map = map;
      map?.on('styledata', this.invalidate);
      this.dirty = true;
      this.signature = '';
      this.iconSource = undefined;
    }
    try {
      const names = map ? spriteNames(map) : [];
      const runtime =
        this.category === 'Models'
          ? (side.frame.contentWindow as PreviewWindow | null)?.__tileflowDescribeRuntimeLayers?.()
          : undefined;
      const signature = JSON.stringify([side.loadEpoch, side.artifactGeneration, names, runtime]);
      if (!this.dirty && signature === this.signature) return;
      this.style = map?.getStyle();
      this.syncIconFilters();
      this.names = names;
      this.signature = signature;
      this.dirty = false;
      this.render();
    } catch {
      // listImages is unavailable while a replacement style is loading. Retry next tick.
      this.dirty = true;
      this.style = undefined;
      this.names = [];
      this.render();
    }
  }

  reveal(category: Category, filter = '') {
    this.search.value = filter;
    this.select(category);
  }

  private select(category: Category) {
    this.category = category;
    for (const [name, tab] of this.tabs) {
      tab.setAttribute('aria-selected', String(name === category));
      tab.tabIndex = name === category ? 0 : -1;
    }
    this.content.setAttribute('aria-labelledby', this.tabs.get(category)!.id);
    this.toolbar.hidden = category === 'Models';
    this.palette.hidden = this.moment.hidden = category !== 'Sprites';
    this.search.hidden = category !== 'Sprites';
    this.sampleInput.hidden = category !== 'Fonts';
    this.render();
  }

  private render() {
    this.cancel();
    this.content.replaceChildren();
    this.content.scrollTop = 0;
    this.status.textContent = '';
    this.status.title = '';
    if (!this.style || !this.map) {
      this.content.append(el('p', 'dt-empty', 'Waiting for map assets…'));
      return;
    }
    if (this.category === 'Sprites') {
      this.renderSprites(this.iconSource ?? this.map);
      return;
    }
    if (this.category === 'Models') {
      this.renderModels();
      return;
    }
    const values = el('dl', 'dt-kv');
    if (this.category === 'Glyphs') {
      values.append(
        el('dt', '', 'Glyph URL'),
        el('dd', '', this.style.glyphs || 'Generated from font faces'),
      );
      this.status.textContent = 'Glyphs provide the characters used by map labels.';
    } else {
      const faces = this.style['font-faces'] ?? {};
      const fonts = [
        ...new Set([
          ...Object.keys(faces),
          ...this.style.layers.flatMap((layer) => {
            if (layer.type !== 'symbol') return [];
            const font = layer.layout?.['text-font'];
            const value = Array.isArray(font) && font[0] === 'literal' ? font[1] : font;
            return Array.isArray(value) &&
              !isExpression(value) &&
              value.every((part) => typeof part === 'string')
              ? value
              : [];
          }),
        ]),
      ].sort();
      const list = el('div', 'dt-font-list');
      this.fontRun = new AbortController();
      const {signal} = this.fontRun;
      for (const font of fonts) {
        const card = el('figure', 'dt-font-card');
        const preview = el('div', 'dt-font-sample');
        preview.append(el('span', 'dt-font-loading', 'Loading preview…'));
        card.append(el('figcaption', '', font), preview);
        const entries = (this.map as any).style?.glyphManager?.entries;
        const entry = entries?.[font],
          ranges = Object.keys(entry?.ranges ?? {});
        const resources =
          (
            this.active().frame.contentWindow as PreviewWindow | null
          )?.__tileflowDevtoolsObserver?.records.filter((record) => record.kind === 'Font') ?? [];
        const matching = resources.filter((record) => {
          try {
            return decodeURIComponent(record.url).includes(font);
          } catch {
            return false;
          }
        });
        const stats = el('div', 'dt-font-ranges');
        for (const range of ranges)
          stats.append(
            el(
              'code',
              'dt-filter-chip',
              /^\d+$/u.test(range) ? `${Number(range) * 256}–${Number(range) * 256 + 255}` : range,
            ),
          );
        stats.append(
          el(
            'small',
            '',
            matching.some((record) => (record.bytes ?? 0) > 0)
              ? `${Math.round(matching.reduce((sum, r) => sum + (r.bytes ?? 0), 0) / 1024)} KB observed font responses`
              : 'Font bytes unavailable in Resource Timing',
          ),
        );
        card.append(stats);
        const uses = el('div', 'dt-tile-chip-list');
        for (const layer of this.style.layers)
          if (
            layer.type === 'symbol' &&
            JSON.stringify(layer.layout?.['text-font'] ?? '').includes(font.split(',')[0])
          ) {
            const link = el('button', 'dt-tile-chip', layer.id);
            link.onclick = () => this.revealLayer(layer.id);
            uses.append(link);
          }
        card.append(uses);
        list.append(card);
        void this.fonts
          .render(font, this.style, this.active(), signal, this.sample)
          .then((canvas) => {
            if (!signal.aborted) preview.replaceChildren(canvas);
          })
          .catch((error: unknown) => {
            if (signal.aborted) return;
            preview.replaceChildren(el('span', 'dt-font-loading', 'Preview unavailable'));
            preview.title = error instanceof Error ? error.message : String(error);
          });
      }
      this.content.append(list);
      if (!fonts.length)
        this.content.append(el('p', 'dt-empty', 'No static font stacks in this style.'));
      this.status.textContent = `${fonts.length} font families`;
    }
    this.content.append(values);
  }

  private renderSprites(map: IconSource) {
    const query = this.search.value.trim().toLocaleLowerCase();
    const iconNames = map.listImages();
    const names = iconNames.filter((name) => name.toLocaleLowerCase().includes(query));
    this.status.textContent = query
      ? `${names.length} of ${this.names.length} icons`
      : `${names.length} icons`;
    const sprite = this.style?.sprite;
    this.status.title =
      typeof sprite === 'string'
        ? sprite
        : sprite?.map((entry) => `${entry.id}: ${entry.url}`).join('\n') || '';
    if (!names.length) {
      this.content.append(
        el(
          'p',
          'dt-empty',
          this.names.length
            ? 'No icons match this filter.'
            : 'No sprite images registered in this map.',
        ),
      );
      return;
    }
    const grid = el('div', 'dt-sprite-grid');
    const layout = el('div', 'dt-asset-layout'),
      main = el('div', 'dt-asset-main');
    main.append(grid);
    layout.append(main, this.assetAside);
    this.content.append(layout);
    this.previews = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target as HTMLElement;
          this.previews?.unobserve(card);
          this.drawSprite(map, card);
        }
      },
      {root: this.content, rootMargin: '160px'},
    );
    let cursor = 0;
    const append = () => {
      const fragment = document.createDocumentFragment();
      for (const end = Math.min(cursor + 80, names.length); cursor < end; cursor++) {
        const name = names[cursor],
          card = el('figure', 'dt-sprite-card');
        card.dataset.sprite = name;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', String(this.selectedSprite === name));
        const select = () => {
          this.selectedSprite = name;
          for (const row of grid.children)
            row.setAttribute('aria-pressed', String((row as HTMLElement).dataset.sprite === name));
          this.spriteDetail(map, name);
        };
        card.addEventListener('click', select);
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
          }
        });
        card.title = name;
        card.append(
          el('div', 'dt-sprite-preview'),
          el('figcaption', '', name),
          el('small', 'dt-sprite-size'),
        );
        fragment.append(card);
        this.previews!.observe(card);
      }
      grid.append(fragment);
      this.frame = cursor < names.length ? requestAnimationFrame(append) : undefined;
    };
    append();
    if (!names.includes(this.selectedSprite)) this.selectedSprite = names[0];
    this.spriteDetail(map, this.selectedSprite);
  }

  private spriteDetail(map: IconSource, name: string) {
    this.assetAside.replaceChildren(el('h3', '', name));
    this.variantRun?.abort();
    this.variantRun = new AbortController();
    const signal = this.variantRun.signal;
    const matrix = el('div', 'dt-asset-variants');
    const variants = (window.__tileflowScene?.variants() ?? []).filter(
      (v) => !v.timeOfDay || ['day', 'night'].includes(v.timeOfDay),
    );
    if (!variants.length) {
      const cell = el('div', 'dt-asset-variant');
      cell.dataset.sprite = name;
      cell.append(el('div', 'dt-sprite-preview'), el('code', '', name), el('small'));
      this.drawSprite(map, cell);
      matrix.append(cell);
    }
    for (const variant of variants) {
      const cell = el('div', 'dt-asset-variant');
      cell.dataset.sprite = name;
      cell.dataset.night = String(variant.timeOfDay === 'night');
      cell.append(
        el('div', 'dt-sprite-preview', '…'),
        el('code', '', themeVariantLabel(variant, this.style?.metadata)),
        el('small'),
      );
      matrix.append(cell);
      void this.catalog
        .load(this.active(), variant.theme, signal)
        .then((result) => {
          if (signal.aborted || !cell.isConnected) return;
          const mapped = iconVariant(name, this.iconStyle ?? this.style!, result.style),
            id = mapped ?? name;
          cell.dataset.sprite = id;
          cell.title = mapped
            ? id
            : `${id} · exact atlas ID; no corresponding expression output found`;
          if (!result.icons.getImage(id)) {
            cell.querySelector('.dt-sprite-preview')!.textContent = 'Missing';
            return;
          }
          cell.querySelector('.dt-sprite-preview')!.textContent = '';
          this.drawSprite(result.icons, cell);
        })
        .catch(() => {
          if (!signal.aborted)
            cell.querySelector('.dt-sprite-preview')!.textContent = 'Unavailable';
        });
    }
    this.assetAside.append(matrix);
    const image = map.getImage(name),
      values = el('dl', 'dt-kv');
    for (const [key, value] of Object.entries({
      Width: image?.data?.width,
      Height: image?.data?.height,
      'Pixel ratio': image?.pixelRatio,
      SDF: image?.sdf,
    }))
      values.append(el('dt', '', key), el('dd', '', String(value ?? 'Unavailable')));
    this.assetAside.append(values, el('div', 'dt-section-heading', 'Used by'));
    const matches = (this.iconStyle ?? this.style!).layers.filter(
      (layer) =>
        layer.type === 'symbol' &&
        JSON.stringify(layer.layout?.['icon-image'] ?? '').includes(name),
    );
    for (const layer of matches) {
      const link = el('button', 'dt-tile-chip', layer.id);
      link.onclick = () => this.revealLayer(layer.id);
      this.assetAside.append(link);
    }
    if (!matches.length)
      this.assetAside.append(
        el(
          'p',
          'dt-note',
          'No literal reference. Data-driven icon expressions may select this image.',
        ),
      );
  }
  private syncIconFilters() {
    const variants = window.__tileflowScene?.variants() ?? [],
      current =
        this.iconTheme || (this.style?.metadata as Record<string, string>)?.['tileflow:theme'];
    const selected = variants.find((v) => v.theme === current);
    this.palette.replaceChildren(
      ...[...new Set(variants.map((v) => v.palette))].map(
        (name) => new Option(themeLabel(name, this.style?.metadata), name),
      ),
    );
    if (selected) this.palette.value = selected.palette;
    const times = [
      ...new Set(
        variants
          .filter((v) => v.palette === this.palette.value)
          .map((v) => v.timeOfDay)
          .filter((t): t is string => !!t),
      ),
    ];
    this.moment.replaceChildren(
      ...times.map((time) => new Option(time[0].toUpperCase() + time.slice(1), time)),
    );
    if (selected?.timeOfDay) this.moment.value = selected.timeOfDay;
    this.palette.disabled = !variants.length;
    this.moment.disabled = !times.length;
  }
  private async loadIconTheme(theme: string) {
    this.assetRun?.abort();
    const run = new AbortController();
    this.assetRun = run;
    this.status.textContent = 'Loading icon variants…';
    try {
      const result = await this.catalog.load(this.active(), theme, run.signal);
      if (run.signal.aborted) return;
      this.iconTheme = theme;
      this.iconSource = result.icons;
      this.iconStyle = result.style;
      this.syncIconFilters();
      this.render();
    } catch (error) {
      if (!run.signal.aborted)
        this.status.textContent =
          error instanceof Error ? error.message : 'Could not load sprite variant.';
    }
  }
  private renderModels() {
    const win = this.active().frame.contentWindow as PreviewWindow | null;
    const models = win?.__tileflowInspectModels?.() ?? [];
    if (!models.length) {
      this.content.append(
        el(
          'p',
          'dt-empty',
          'No 3D model assets are loaded. Enable a 3D module or navigate to its coverage.',
        ),
      );
      return;
    }
    const layout = el('div', 'dt-asset-layout'),
      main = el('div', 'dt-asset-main'),
      grid = el('div', 'dt-model-grid');
    if (!models.some((m) => m.id === this.selectedModel)) this.selectedModel = models[0].id;
    const show = (model: (typeof models)[number]) => {
      this.selectedModel = model.id;
      this.assetAside.replaceChildren(el('h3', '', model.id));
      this.assetAside.append(this.modelCanvas(model, 280));
      const values = el('dl', 'dt-kv');
      for (const [key, value] of Object.entries({
        Module: model.module,
        Format: model.format,
        Vertices: model.vertices,
        Triangles: model.triangles,
        Bytes: model.bytes,
        LODs: model.lods,
        'Instances in view': model.instances,
      }))
        values.append(el('dt', '', key), el('dd', '', String(value ?? 'Unavailable')));
      this.assetAside.append(values);
      for (const cell of grid.children)
        cell.setAttribute('aria-pressed', String((cell as HTMLElement).dataset.model === model.id));
    };
    for (const model of models) {
      const card = el('button', 'dt-model-card');
      card.dataset.model = model.id;
      card.append(
        this.modelCanvas(model, 160),
        el('strong', '', model.id),
        el('small', '', `${model.module} · ${model.triangles.toLocaleString()} triangles`),
      );
      card.onclick = () => show(model);
      grid.append(card);
    }
    main.append(grid);
    layout.append(main, this.assetAside);
    this.content.append(layout);
    show(models.find((m) => m.id === this.selectedModel)!);
  }
  private modelCanvas(
    model: NonNullable<ReturnType<NonNullable<PreviewWindow['__tileflowInspectModels']>>>[number],
    size: number,
  ) {
    const canvas = el('canvas');
    canvas.width = size * 2;
    canvas.height = size * 2;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${model.id} mesh preview. Drag to rotate.`);
    let angle = 0.65;
    const draw = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const p = model.positions,
        faces = model.indices;
      if (!p.length) return;
      const xs = [],
        ys = [],
        zs = [];
      for (let i = 0; i < p.length; i += 3) {
        xs.push(p[i]);
        ys.push(p[i + 1]);
        zs.push(p[i + 2]);
      }
      const mid = [
        (Math.min(...xs) + Math.max(...xs)) / 2,
        (Math.min(...ys) + Math.max(...ys)) / 2,
        (Math.min(...zs) + Math.max(...zs)) / 2,
      ];
      const extent = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
        Math.max(...zs) - Math.min(...zs),
        0.01,
      );
      const points: number[][] = [];
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i] - mid[0],
          y = p[i + 1] - mid[1],
          z = p[i + 2] - mid[2];
        points.push([
          ((x * Math.cos(angle) - y * Math.sin(angle)) / extent) * size * 1.4 + size,
          ((-z * 0.9 + (x * Math.sin(angle) + y * Math.cos(angle)) * 0.35) / extent) * size * 1.4 +
            size,
          (x * Math.sin(angle) + y * Math.cos(angle)) * 0.9 + z * 0.35,
        ]);
      }
      const triangles = [];
      for (let i = 0; i < faces.length; i += 3) {
        const corners = faces.slice(i, i + 3).map((j) => points[j]);
        if (corners.length === 3 && corners.every(Boolean))
          triangles.push({corners, depth: corners.reduce((n, c) => n + c[2], 0), i});
      }
      triangles.sort((a, b) => a.depth - b.depth);
      for (const {corners, i} of triangles) {
        ctx.beginPath();
        corners.forEach((c, j) => (j ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
        ctx.closePath();
        ctx.fillStyle =
          model.colors?.[Math.floor(i / 3)] ??
          (model.module === 'Vegetation'
            ? `hsl(103 23% ${38 + (i % 7) * 3}%)`
            : `hsl(30 15% ${49 + (i % 7) * 3}%)`);
        ctx.fill();
      }
    };
    let start = 0,
      prior = 0;
    canvas.onpointerdown = (e) => {
      start = e.clientX;
      prior = angle;
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) {
        angle = prior + (e.clientX - start) * 0.015;
        draw();
      }
    };
    canvas.onpointerup = (e) => canvas.releasePointerCapture(e.pointerId);
    draw();
    return canvas;
  }

  private drawSprite(map: IconSource, card: HTMLElement) {
    const preview = card.querySelector<HTMLElement>('.dt-sprite-preview')!;
    try {
      const image = map.getImage(card.dataset.sprite!);
      if (!image?.data || image.isWebGLImage) throw new Error('Preview unavailable');
      const {width, height, data} = image.data;
      const source = el('canvas'),
        canvas = el('canvas');
      source.width = width;
      source.height = height;
      const context = source.getContext('2d')!;
      const pixels = context.createImageData(width, height);
      pixels.data.set(spritePreviewPixels(data, image.sdf, image.pixelRatio));
      context.putImageData(pixels, 0, 0);
      const scale = Math.min(1 / image.pixelRatio, 48 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(height * scale * devicePixelRatio));
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
      canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', card.dataset.sprite!);
      preview.append(canvas);
      card.querySelector('small')!.textContent = `${width} × ${height}${image.sdf ? ' · SDF' : ''}`;
      source.width = source.height = 0;
    } catch {
      preview.textContent = '—';
      card.querySelector('small')!.textContent = 'Preview unavailable';
    }
  }

  cancel() {
    clearTimeout(this.fontTimer);
    this.fontRun?.abort();
    this.fontRun = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.previews?.disconnect();
    this.previews = undefined;
  }

  show() {
    this.dirty = true;
    this.refresh();
  }

  dispose() {
    this.assetRun?.abort();
    this.variantRun?.abort();
    this.catalog.dispose();
    this.cancel();
    this.map?.off('styledata', this.invalidate);
  }
}
