import {safeContext} from '../layers/model';
import type {Side} from '../types';
import type {Finding} from './audit';
import {auditCategories} from './catalog';
import {type InspectorCheck, type InspectorReport, runInspectorAudit} from './inspector-audit';
import {beaconStyles} from './styles';

export const beaconIcon =
  '<svg viewBox="0 0 96 96" fill="none" aria-hidden="true"><g class="beacon-pulse"><circle cx="48" cy="48" r="40" stroke="currentColor" stroke-width="1.5"/></g><path d="M28 30a26 26 0 0 0 0 36M68 30a26 26 0 0 1 0 36" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".45"/><path d="M35 37a15 15 0 0 0 0 22M61 37a15 15 0 0 1 0 22" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".75"/><circle cx="48" cy="48" r="8" fill="currentColor"/></svg>';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
};
const button = (text: string, action: () => void, cls = '') => {
  const node = el('button', cls, text);
  node.type = 'button';
  node.onclick = action;
  return node;
};
type Options = {
  active: () => Side;
  reveal: (side: Side, finding: Finding) => void;
  network: () => void;
  overlay: (kind: 'overdraw' | 'collision') => void;
  beforeRun: () => void;
};
export class BeaconPanel {
  private run?: AbortController;
  private report?: InspectorReport;
  private owner?: {side: Side; map: Side['map']; epoch: number; signature: string};
  private device: InspectorReport['device'] = 'desktop';
  private scope: InspectorReport['scope'] = 'tour';
  private content = el('div', 'dt-scroll beacon-content');
  private status = el('div', 'beacon-status');
  private stale = el('p', 'beacon-stale');
  private disposed = false;
  private styleDirty = false;
  private observedSignature = '';
  private invalidateStyle = () => {
    this.styleDirty = true;
  };
  private styleSignature(side: Side) {
    const style = side.map?.getStyle();
    return JSON.stringify(
      style && {
        ...style,
        layers: style.layers.filter((l) => !l.id.startsWith('__tileflow-devtools-')),
        sources: Object.fromEntries(
          Object.entries(style.sources).filter(([id]) => !id.startsWith('__tileflow-devtools-')),
        ),
      },
    );
  }
  constructor(
    root: HTMLElement,
    private options: Options,
  ) {
    const style = el('style');
    style.nonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce || '';
    style.textContent = beaconStyles;
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.stale.hidden = true;
    root.append(style, this.stale, this.content, this.status);
    this.landing();
  }
  private isStale() {
    const side = this.options.active();
    return (
      !!this.report &&
      (!this.owner ||
        side !== this.owner.side ||
        side.map !== this.owner.map ||
        side.loadEpoch !== this.owner.epoch ||
        side.artifactGeneration !== this.report.generation ||
        this.observedSignature !== this.owner.signature)
    );
  }
  refresh() {
    if (this.styleDirty && !this.run && this.owner) {
      this.styleDirty = false;
      this.observedSignature = this.styleSignature(this.owner.side);
    }
    this.stale.hidden = !!this.run || !this.isStale();
    this.stale.textContent =
      'This report belongs to an earlier map. Run again to inspect current findings.';
    for (const b of this.content.querySelectorAll<HTMLButtonElement>('[data-run-audit]'))
      b.disabled = !this.options.active().map || !!this.run;
  }
  cancel() {
    this.run?.abort();
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.owner?.map?.off('styledata', this.invalidateStyle);
  }
  private logo() {
    const logo = el('div', 'beacon-logo');
    logo.innerHTML = beaconIcon;
    return logo;
  }
  private landing() {
    const hero = el('div', 'beacon-hero'),
      categories = el('div', 'beacon-scope');
    for (const cat of auditCategories) {
      const card = el('div');
      const title = el('strong', '', cat.title);
      title.append(el('span', '', String(cat.checks.length)));
      card.append(title, el('small', '', cat.description));
      categories.append(card);
    }
    const actions = el('div', 'beacon-actions'),
      devices = el('div', 'dt-segments'),
      scopes = el('div', 'dt-segments');
    for (const [id, label] of [
      ['desktop', 'Desktop'],
      ['mobile', 'Mobile'],
    ] as const) {
      const b = button(label, () => {
        this.device = id;
        this.landing();
      });
      b.setAttribute('aria-pressed', String(id === this.device));
      devices.append(b);
    }
    for (const [id, label] of [
      ['tour', 'Active tour'],
      ['view', 'Quick check'],
      ['sweep', 'All zooms'],
    ] as const) {
      const b = button(label, () => {
        this.scope = id;
        this.landing();
      });
      b.setAttribute('aria-pressed', String(id === this.scope));
      scopes.append(b);
    }
    const run = button('Run audit', () => void this.start(), 'beacon-run');
    run.dataset.runAudit = '';
    actions.append(devices, scopes, run);
    const variants = window.__tileflowScene?.variants().length || 1;
    hero.append(
      this.logo(),
      el('h1', '', 'Beacon'),
      el(
        'p',
        'beacon-lead',
        'Beacon sends a signal through the map you are looking at and reports back: what slows it down, what people can’t read, what breaks when you zoom and what you pay for but never draw.',
      ),
      categories,
      actions,
      el(
        'p',
        'beacon-note',
        this.scope === 'tour'
          ? 'Around 45–60 seconds · current view, London, New York, Tokyo, Nairobi and São Paulo · current theme'
          : this.scope === 'view'
            ? '48 checks · current view · around 3 seconds'
            : `48 checks · z0–22 at this centre · ${variants} concrete themes and times of day · duration depends on loading`,
      ),
    );
    this.content.replaceChildren(hero);
    this.refresh();
  }
  private async start() {
    if (this.run || !this.options.active().map) return;
    this.options.beforeRun();
    const controller = new AbortController(),
      side = this.options.active(),
      map = side.map!,
      epoch = side.loadEpoch;
    this.run = controller;
    this.stale.hidden = true;
    this.status.textContent = '';
    const running = el('div', 'beacon-hero beacon-running'),
      progress = el('progress'),
      steps = el('ul', 'beacon-steps');
    progress.max = 1;
    progress.setAttribute('aria-label', 'Audit progress');
    for (const category of auditCategories) {
      const row = el('li', '', category.title);
      row.append(el('small', '', `${category.checks.length} checks`));
      steps.append(row);
    }
    running.append(
      this.logo(),
      el(
        'h1',
        '',
        this.scope === 'tour'
          ? 'Running active tour…'
          : this.scope === 'sweep'
            ? 'Auditing all zooms…'
            : 'Auditing this view…',
      ),
      progress,
      steps,
      button('Cancel', () => this.cancel()),
    );
    this.content.replaceChildren(running);
    try {
      this.report = await runInspectorAudit({
        side,
        device: this.device,
        scope: this.scope,
        signal: controller.signal,
        isCurrent: () => !this.disposed && this.options.active() === side,
        progress: (fraction, message) => {
          progress.value = fraction;
          this.status.textContent = message;
        },
      });
      if (this.disposed) return;
      this.owner?.map?.off('styledata', this.invalidateStyle);
      this.observedSignature = this.styleSignature(side);
      this.owner = {side, map, epoch, signature: this.observedSignature};
      map.on('styledata', this.invalidateStyle);
      this.styleDirty = false;
      this.renderReport();
      this.status.textContent = `Completed in ${(this.report.duration / 1000).toFixed(1)} s`;
    } catch (error) {
      if (this.disposed) return;
      this.status.textContent = error instanceof Error ? error.message : 'Audit could not finish.';
      if (this.report) this.renderReport();
      else this.landing();
    } finally {
      this.run = undefined;
      if (!this.disposed) this.refresh();
    }
  }
  private gauge(score: number | null, title: string, size = 64) {
    const result = el('span', 'beacon-gauge');
    result.style.width = result.style.height = `${size}px`;
    result.dataset.tone =
      score === null ? 'unknown' : score >= 90 ? 'good' : score >= 50 ? 'average' : 'poor';
    result.style.setProperty('--score', `${(score ?? 0) * 3.6}deg`);
    result.append(el('b', '', score === null ? '—' : String(score)));
    result.setAttribute('aria-label', `${title}: ${score ?? 'not scored'}`);
    return result;
  }
  private reveal(finding: Finding) {
    if (!this.owner || this.isStale()) {
      this.status.textContent = 'Run a new audit before inspecting findings from this map.';
      return;
    }
    const current = this.owner.map?.getStyle().layers.some((l) => l.id === finding.layer);
    if (!current) {
      this.status.textContent =
        'This layer belongs to another sampled theme. Select that theme and run again to inspect it.';
      return;
    }
    this.options.reveal(this.owner.side, finding);
  }
  private renderReport() {
    const report = this.report!,
      all = report.categories.flatMap((c) => c.checks),
      summary = el('div', 'beacon-summary'),
      heading = el('div', 'beacon-report-title'),
      copy = el('div');
    copy.append(
      el('h2', '', 'Measured score'),
      el(
        'p',
        'beacon-counts',
        `${all.filter((c) => c.status === 'fail').length} failed · ${all.filter((c) => c.status === 'warn').length} to review · ${all.filter((c) => c.status === 'pass').length} passed · ${all.filter((c) => ['info', 'unavailable'].includes(c.status)).length} notes`,
      ),
      el(
        'small',
        '',
        `48 checks · ${report.device} · ${report.scope === 'tour' ? `Active tour · ${report.scenarios.length}/${report.plannedViews} views` : report.scope === 'view' ? 'z' + report.camera.zoom.toFixed(2) : 'z0–22'} · ${new Date(report.date).toLocaleTimeString()}`,
      ),
    );
    const actions = el('div', 'beacon-report-actions');
    actions.append(
      button('Copy report for agent', () => void this.copyReport()),
      button('Run again', () => void this.start()),
      button('New audit', () => {
        this.status.textContent = '';
        this.landing();
      }),
    );
    heading.append(this.gauge(report.score, 'Measured score', 72), copy, actions);
    summary.append(heading);
    const gauges = el('div', 'beacon-scores');
    for (const cat of report.categories) {
      const diagnostic = cat.checks.every((c) => c.assessment === 'diagnostic');
      const observed = cat.checks.filter((c) => c.status !== 'unavailable').length;
      const b = button(
        '',
        () =>
          this.content
            .querySelector(`[data-category="${cat.id}"]`)
            ?.scrollIntoView({block: 'start'}),
        'beacon-score',
      );
      const issues = cat.checks.filter((c) => ['warn', 'fail'].includes(c.status)).length;
      b.append(
        diagnostic ? el('span', 'beacon-diagnostic', 'Review') : this.gauge(cat.score, cat.title),
        el('strong', '', cat.title),
        el(
          'small',
          '',
          diagnostic
            ? `${observed}/${cat.checks.length} observed`
            : `${cat.checks.filter((c) => c.score !== undefined).length}/${cat.checks.length} scored${issues ? ` · ${issues} to review` : ''}`,
        ),
      );
      if (cat.scoreBasis) {
        const sample = cat.checks.find((c) => c.sample)?.sample;
        b.append(el('small', '', `${cat.scoreBasis} · ${sample?.total ?? 0} samples`));
      }
      gauges.append(b);
    }
    summary.append(
      gauges,
      el('p', 'beacon-legend', '0–49 poor · 50–89 needs work · 90–100 good · — not scored'),
      el(
        'p',
        'beacon-legend',
        'Scores cover the stated checks and samples. Legibility uses a text-size budget; Cartography uses size-rule continuity. Diagnostics remain unscored. A high score does not establish overall visual quality.',
      ),
    );
    if (report.scope === 'tour') {
      const tour = el('details', 'beacon-tour');
      tour.open = true;
      tour.append(el('summary', '', 'Tour measurements'));
      const notes = el(
        'p',
        '',
        `${report.protocol} · ${(report.duration / 1000).toFixed(1)}s · ${report.scenarios.filter((s) => s.loaded).length}/${report.scenarios.length} views ready before sampling${report.budgetExhausted ? ' · Time budget reached; coverage is partial' : ''}`,
      );
      const table = el('table', 'dt-table'),
        head = el('thead'),
        header = el('tr');
      for (const name of [
        'Location / zoom',
        'Moving p95',
        'Settled p95',
        'Frames',
        'Tile wait',
        'Total readiness',
      ])
        header.append(el('th', '', name));
      head.append(header);
      table.append(head);
      const body = el('tbody');
      for (const sample of report.scenarios) {
        const row = el('tr');
        for (const text of [
          `${sample.location} · z${sample.zoom.toFixed(1)}`,
          sample.motion?.p95Ms === undefined ? '—' : `${sample.motion.p95Ms.toFixed(1)} ms`,
          !sample.loaded || sample.settled.p95Ms === undefined
            ? '—'
            : `${sample.settled.p95Ms.toFixed(1)} ms`,
          `${sample.motion?.frames ?? 0} / ${sample.settled.frames}`,
          sample.loaded ? `${(sample.tileWaitMs / 1000).toFixed(2)} s` : 'Timed out',
          sample.loaded ? `${(sample.readyMs / 1000).toFixed(1)} s` : 'Timed out',
        ])
          row.append(el('td', '', text));
        row.title = `Frame intervals: moving / settled. Settled frames over 50ms: ${sample.settled.longFrameRate === undefined ? 'unavailable' : (sample.settled.longFrameRate * 100).toFixed(1) + '%'}. Maximum: ${sample.settled.maxMs?.toFixed(1) ?? '—'} ms.`;
        body.append(row);
      }
      table.append(body);
      const scroll = el('div', 'beacon-tour-table');
      scroll.append(table);
      tour.append(
        notes,
        scroll,
        el(
          'p',
          '',
          'Moving and settled windows are separate. At least 30 frame intervals are required per p95. Tile wait excludes scripted navigation; total readiness includes it. Timed-out views do not receive a settled performance score. Cache and computer load affect comparisons.',
        ),
      );
      summary.append(tour);
    }
    const groups = el('div', 'beacon-groups'),
      priority = all
        .filter((c) => ['warn', 'fail'].includes(c.status))
        .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
        .slice(0, 3);
    if (priority.length) {
      const section = el('section', 'beacon-category');
      section.append(el('div', 'dt-section-heading', 'Fix first'));
      for (const check of priority) section.append(this.checkRow(check, true));
      groups.append(section);
    }
    for (const cat of report.categories) {
      const diagnostic = cat.checks.every((c) => c.assessment === 'diagnostic');
      const measured = cat.checks.filter((c) => c.score !== undefined).length;
      const section = el('section', 'beacon-category');
      section.dataset.category = cat.id;
      const title = el('div', 'dt-section-heading', cat.title);
      title.append(
        el(
          'span',
          '',
          diagnostic
            ? `Diagnostics · ${cat.checks.filter((c) => c.status !== 'unavailable').length}/${cat.checks.length} observed`
            : `${cat.score ?? '—'} · ${cat.checks.filter((c) => c.status === 'pass').length}/${measured} scored checks passed`,
        ),
      );
      section.append(title);
      if (cat.scoreBasis)
        section.append(
          el('p', '', `Score basis: ${cat.scoreBasis}. Other checks are diagnostic observations.`),
        );
      for (const check of [...cat.checks].sort(
        (a, b) =>
          ({fail: 0, warn: 1, unavailable: 2, info: 3, pass: 4})[a.status] -
          {fail: 0, warn: 1, unavailable: 2, info: 3, pass: 4}[b.status],
      ))
        section.append(this.checkRow(check));
      groups.append(section);
    }
    const method = el('details', 'beacon-method');
    method.append(el('summary', '', 'Measurement coverage'));
    for (const text of report.coverage) method.append(el('p', '', text));
    method.append(
      el(
        'p',
        '',
        `${report.scenarios.length} observations. Scores average measured checks only; notes and unavailable measurements never count as passes.`,
      ),
    );
    this.content.replaceChildren(summary, groups, method);
  }
  private checkRow(check: InspectorCheck, open = false) {
    const row = el('details', 'beacon-check');
    row.dataset.status = check.status;
    row.open = open;
    const title = el('summary'),
      indicator = el(
        'span',
        'beacon-indicator',
        {pass: '✓', warn: '!', fail: '×', unavailable: '—', info: 'i'}[check.status],
      );
    indicator.setAttribute('aria-label', check.status);
    title.append(
      indicator,
      el('span', 'beacon-check-title', check.title),
      el('span', 'beacon-check-value', check.value),
    );
    const body = el('div', 'beacon-check-detail'),
      values = el('dl', 'dt-kv');
    values.append(
      el('dt', '', 'Measured'),
      el('dd', '', check.value),
      el('dt', '', check.assessment === 'diagnostic' ? 'Reference' : 'Target'),
      el('dd', '', check.target),
    );
    if (check.assessment === 'diagnostic')
      body.append(
        el(
          'p',
          'beacon-note',
          'Diagnostic · not scored. Review the evidence before changing the map.',
        ),
      );
    body.append(values, el('p', '', check.what), el('p', 'beacon-evidence', check.evidence));
    if (check.fix && check.status !== 'pass')
      body.append(
        el(
          'p',
          'beacon-fix',
          `${check.assessment === 'diagnostic' ? 'Investigate' : 'How to fix'}. ${check.fix}`,
        ),
      );
    const links = el('div', 'beacon-links');
    for (const finding of check.findings) {
      if (finding.layer) {
        const link = button(finding.layer, () => this.reveal(finding), 'dt-tile-chip');
        link.title = finding.message;
        links.append(link);
      } else links.append(el('code', '', finding.message));
    }
    if (check.overlay === 'tiles') links.append(button('Open in Tiles →', this.options.network));
    if (check.overlay === 'overdraw' || check.overlay === 'collision') {
      const overlay = check.overlay;
      links.append(button(`Show ${overlay} overlay →`, () => this.options.overlay(overlay)));
    }
    body.append(links);
    row.append(title, body);
    return row;
  }
  async copyReport() {
    if (!this.report) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(safeContext(this.report, 12000).value, null, 2),
      );
      this.status.textContent = 'Report copied for agent.';
    } catch {
      this.status.textContent = 'Clipboard access failed. Try copying again.';
    }
  }
}
