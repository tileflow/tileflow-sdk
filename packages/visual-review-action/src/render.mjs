import {commentMarker, evidenceFile, needsApproval} from './contract.mjs';

/**
 * Encodes anything that could become Markdown or HTML. Report text originates in pull request code,
 * and GitHub finds mentions, issue references and links after decoding entities, so those also get
 * a zero-width space that keeps them readable but inert.
 */
export function escapeText(value) {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/[@#]|:\/\/|www\./gi, (match) => `${match.slice(0, 1)}\u200b${match.slice(1)}`)
    .replace(/[^A-Za-z0-9 .,:/=+-]/gu, (character) => `&#${character.codePointAt(0)};`);
}

export function summarize(report, baselineEdits = []) {
  const pending = report.scenes.filter(needsApproval);
  const noise = report.scenes.filter((scene) => scene.noise);
  if (report.failure) {
    return {state: 'error', verdict: 'error', title: 'Capture failed', pending, noise};
  }
  if (baselineEdits.length > 0) {
    return {
      state: 'failure',
      verdict: 'changed',
      title: 'Baselines edited by hand',
      pending,
      noise,
    };
  }
  if (pending.length > 0) {
    const label = pending.length === 1 ? 'scene needs' : 'scenes need';
    return {
      state: 'failure',
      verdict: 'changed',
      title: `${pending.length} of ${report.scenes.length} ${label} review`,
      pending,
      noise,
    };
  }
  return {
    state: 'success',
    verdict: 'pass',
    title: `${report.scenes.length} ${report.scenes.length === 1 ? 'scene' : 'scenes'} unchanged`,
    pending,
    noise,
  };
}

const statusLabels = {
  changed: 'Changed',
  'missing-baseline': 'New scene',
  'runtime-mismatch': 'Renderer changed',
  'scene-mismatch': 'Scene definition changed',
  unchanged: 'Unchanged',
};

export function renderReport({
  report,
  baselineEdits,
  workflowEdits,
  imageBase,
  runUrl,
  approvable,
}) {
  const summary = summarize(report, baselineEdits);
  const icon = {error: '⚠️', failure: '❌', success: '✅'}[summary.state];
  const lines = [commentMarker, `## ${icon} Tileflow visual review: ${summary.title}`, ''];

  if (report.failure) {
    lines.push(`The capture did not finish: ${escapeText(report.failure)}`, '');
  }
  if (baselineEdits.length > 0) {
    lines.push(
      'This pull request edits baseline files directly. Baselines change only through approval, ',
      `so revert these files: ${baselineEdits.map(escapeText).join(', ')}`,
      '',
    );
  }
  if (workflowEdits.length > 0) {
    lines.push(
      '> [!WARNING]',
      '> This pull request edits workflow files, so this result may not be trustworthy: ',
      `> ${workflowEdits.map(escapeText).join(', ')}`,
      '',
    );
  }

  if (report.scenes.length > 0) {
    lines.push(
      '| Scene | Result | Pixels changed | Perceptually changed |',
      '| --- | --- | ---: | ---: |',
    );
    for (const scene of report.scenes) lines.push(renderSceneRow(scene));
    lines.push('');
  }
  if (summary.noise.length > 0) {
    lines.push(
      'Renderer noise means a few exact pixels moved with no perceptual change, so it does not fail the check.',
      '',
    );
  }

  for (const scene of summary.pending) lines.push(...renderScene(scene, imageBase));
  lines.push(...renderSemantic(report.semantic));

  if (approvable && summary.pending.length > 0) {
    lines.push(
      '### Approve these renders',
      '',
      'If the renders above are intended, a maintainer can accept them for this commit:',
      '',
      '```',
      `/tileflow approve ${report.headSha.slice(0, 12)}`,
      '```',
      '',
      'Baselines update after merge. A new push needs a new approval.',
      '',
    );
  }
  if (report.warnings.length > 0) {
    lines.push(
      '<details><summary>Capture warnings</summary>',
      '',
      ...report.warnings.map((warning) => `- ${escapeText(warning)}`),
      '',
      '</details>',
      '',
    );
  }
  const details = [`Commit ${report.headSha.slice(0, 12)}`];
  if (report.cliVersion) details.push(`tileflow ${escapeText(report.cliVersion)}`);
  if (runUrl) details.push(`[capture run](${runUrl})`);
  lines.push(`<sub>${details.join(' · ')}</sub>`, '');
  return lines.join('\n');
}

function renderSceneRow(scene) {
  const label = scene.noise ? 'Renderer noise' : statusLabels[scene.status];
  return `| ${escapeText(scene.scene)} | ${label} | ${formatPixels(scene.exactPixels, scene.totalPixels)} | ${formatPixels(scene.perceptualPixels, scene.totalPixels)} |`;
}

function formatPixels(pixels, total) {
  if (pixels === null || !total) return 'n/a';
  const percent = (pixels / total) * 100;
  return `${pixels.toLocaleString('en-US')} (${percent < 0.01 && pixels > 0 ? '<0.01' : percent.toFixed(2)}%)`;
}

function renderScene(scene, imageBase) {
  const image = (kind, alt) =>
    scene.images[kind]
      ? `<img alt="${alt}" src="${imageBase}/${evidenceFile(scene.scene, kind)}" width="100%">`
      : '<em>none</em>';
  const lines = [
    `<details open><summary><strong>${escapeText(scene.scene)}</strong> · ${escapeText(scene.map)}</summary>`,
    '',
    '<table><tr><th>Before</th><th>After</th></tr>',
    `<tr><td width="50%">${image('before', 'Before')}</td><td width="50%">${image('after', 'After')}</td></tr>`,
  ];
  if (scene.images.diff) {
    lines.push(`<tr><th colspan="2">Changed pixels</th></tr>`);
    lines.push(`<tr><td colspan="2">${image('diff', 'Changed pixels')}</td></tr>`);
  }
  lines.push('</table>', '', '</details>', '');
  return lines;
}

function renderSemantic(semantic) {
  if (semantic.length === 0) return [];
  const lines = ['### Semantic diff', ''];
  for (const entry of semantic) {
    if (entry.message) {
      lines.push(`**${escapeText(entry.map)}**: ${escapeText(entry.message)}`, '');
    } else if (entry.total === 0) {
      lines.push(`**${escapeText(entry.map)}**: no semantic changes.`, '');
    } else {
      lines.push(
        `**${escapeText(entry.map)}**: ${entry.total} ${entry.total === 1 ? 'change' : 'changes'}`,
        '',
        '| Path | Before | After |',
        '| --- | --- | --- |',
      );
      for (const change of entry.changes) {
        lines.push(
          `| <code>${escapeText(change.path)}</code> | ${formatValue(change.before)} | ${formatValue(change.after)} |`,
        );
      }
      if (entry.total > entry.changes.length) {
        lines.push('', `Showing the first ${entry.changes.length} changes.`);
      }
      lines.push('');
    }
  }
  return lines;
}

function formatValue(value) {
  return value === null ? '' : `<code>${escapeText(value)}</code>`;
}
