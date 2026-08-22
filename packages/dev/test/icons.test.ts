import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  createStyleFromProject,
  diffTileflowIconPackageManifests,
  streets,
  type TileflowProjectConfig,
  tileflowStreetsPoiIconMapping,
} from '@tileflow/core';
import {
  compileTileflowIconPackages,
  prepareTileflowProjectIcons,
  TileflowIconCompilationError,
} from '../src/index';

test('supplies the built-in Streets POI sprite for local and hosted artifacts', async () => {
  await withFixture(async (cwd) => {
    const project: TileflowProjectConfig = {maps: {main: {basemap: streets()}}};
    const compiled = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});

    assert.deepEqual(compiled.watchPaths, []);
    assert.deepEqual(compiled.packages[0]?.manifest.iconNames, [
      'cafe',
      'hospital',
      'hotel',
      'museum',
      'restaurant',
      'school',
      'services',
      'shopping',
      'train',
    ]);
    assert.deepEqual(compiled.bindings, [
      {
        label: 'tileflow-streets',
        mapName: 'main',
        mapping: tileflowStreetsPoiIconMapping,
        packageHash: compiled.packages[0]?.contentHash,
      },
    ]);

    const prepared = await prepareTileflowProjectIcons(project, {assetBaseUrl: '/tileflow', cwd});
    assert.equal(prepared.assets.length, 4);
    assert.deepEqual(prepared.project.maps.main?.icons, {
      mapping: tileflowStreetsPoiIconMapping,
      sprite: '/tileflow/icons/main/sprite',
    });

    const style = createStyleFromProject(prepared.project, 'main');
    assert.equal(style.sprite, '/tileflow/icons/main/sprite');
    assert.ok(style.layers.some((layer) => layer.id === 'streets-poi-food-icon'));
  });
});

test('compiles exact deterministic packages, deduplicates shared sources, and preserves local paths', async () => {
  await withFixture(async (cwd) => {
    await writeSvg(join(cwd, 'icons', 'cafe.svg'), '#ef8354');
    await writeSvg(join(cwd, 'icons', 'airport.svg'), '#4f5d75');
    const project: TileflowProjectConfig = {
      icons: {
        brand: {
          mapping: {restaurant: 'cafe'},
          source: './icons',
        },
      },
      maps: {
        alpha: {icons: 'brand'},
        beta: {icons: {extends: 'brand', mapping: {flight: 'airport'}}},
      },
    };

    const first = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});
    const second = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});

    assert.equal(first.packages.length, 1);
    assert.equal(first.bindings.length, 2);
    assert.deepEqual(
      first.packages[0]?.files.map((file) => file.fileName),
      ['sprite.json', 'sprite.png', 'sprite@2x.json', 'sprite@2x.png'],
    );
    assert.deepEqual(first.packages[0]?.manifest.iconNames, ['airport', 'cafe']);
    assert.deepEqual(
      first.packages[0]?.manifest.renderedIcons.map((entry) => entry.name),
      ['airport', 'cafe'],
    );
    assert.notEqual(
      first.packages[0]?.manifest.renderedIcons[0]?.pixelSha256.oneX,
      first.packages[0]?.manifest.renderedIcons[0]?.pixelSha256.twoX,
    );
    assert.deepEqual(
      first.packages[0]?.manifest.renderedIcons,
      second.packages[0]?.manifest.renderedIcons,
    );
    assert.equal(first.packages[0]?.contentHash, second.packages[0]?.contentHash);
    assert.deepEqual(
      first.packages[0]?.files.map((file) => Buffer.from(file.source).toString('hex')),
      second.packages[0]?.files.map((file) => Buffer.from(file.source).toString('hex')),
    );
    assert.deepEqual(first.bindings[0], {
      label: 'brand',
      mapName: 'alpha',
      mapping: {restaurant: 'cafe'},
      packageHash: first.packages[0]?.contentHash,
    });
    assert.deepEqual(first.bindings[1]?.mapping, {flight: 'airport', restaurant: 'cafe'});

    const prepared = await prepareTileflowProjectIcons(project, {assetBaseUrl: '/tileflow', cwd});
    assert.deepEqual(
      prepared.assets.map((asset) => asset.fileName),
      [
        'icons/alpha/sprite.json',
        'icons/alpha/sprite.png',
        'icons/alpha/sprite@2x.json',
        'icons/alpha/sprite@2x.png',
        'icons/beta/sprite.json',
        'icons/beta/sprite.png',
        'icons/beta/sprite@2x.json',
        'icons/beta/sprite@2x.png',
      ],
    );
    assert.deepEqual(prepared.project.maps.alpha?.icons, {
      mapping: {restaurant: 'cafe'},
      sprite: '/tileflow/icons/alpha/sprite',
    });
  });
});

test('tracks only visible per-icon changes and ignores atlas movement or source-only edits', async () => {
  await withFixture(async (cwd) => {
    for (const [name, color] of [
      ['alpha', '#ef4444'],
      ['bravo', '#22c55e'],
      ['charlie', '#3b82f6'],
      ['delta', '#a855f7'],
    ] as const) {
      await writeSvg(join(cwd, 'icons', `${name}.svg`), color);
    }

    const project = localProject('./icons');
    const original = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});
    const originalPackage = original.packages[0];
    assert.ok(originalPackage);

    await writeFile(
      join(cwd, 'icons', 'alpha.svg'),
      `${simpleSvg('#ef4444')}<!-- source-only metadata -->`,
    );
    const sourceOnly = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});
    assert.deepEqual(
      sourceOnly.packages[0]?.manifest.renderedIcons,
      originalPackage.manifest.renderedIcons,
    );

    await writeSvg(join(cwd, 'icons', 'bravo.svg'), '#111827');
    const visibleChange = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});
    assert.deepEqual(
      diffTileflowIconPackageManifests(
        originalPackage.manifest,
        visibleChange.packages[0]?.manifest ?? null,
      ),
      {
        added: [],
        afterBytes: visibleChange.packages[0]?.files.reduce(
          (total, file) => total + file.source.byteLength,
          0,
        ),
        beforeBytes: originalPackage.files.reduce(
          (total, file) => total + file.source.byteLength,
          0,
        ),
        modified: ['bravo'],
        removed: [],
        unchangedCount: 3,
      },
    );

    await writeSvg(join(cwd, 'icons', 'echo.svg'), '#f59e0b');
    const withNeighbor = await compileTileflowIconPackages(project, {cwd, target: 'hosted'});
    const neighborDiff = diffTileflowIconPackageManifests(
      visibleChange.packages[0]?.manifest ?? null,
      withNeighbor.packages[0]?.manifest ?? null,
    );
    assert.deepEqual(neighborDiff.added, ['echo']);
    assert.deepEqual(neighborDiff.modified, []);
    assert.equal(neighborDiff.unchangedCount, 4);
    assert.notDeepEqual(
      visibleChange.packages[0]?.manifest.sprites,
      withNeighbor.packages[0]?.manifest.sprites,
    );
  });
});

test('accepts every documented source format', async () => {
  await withFixture(async (cwd) => {
    await writeSvg(join(cwd, 'icons', 'vector.svg'), '#22c55e');
    await writeRaster(join(cwd, 'icons', 'pixel.png'), 'png');
    await writeRaster(join(cwd, 'icons', 'photo.jpg'), 'jpeg');
    await writeRaster(join(cwd, 'icons', 'photo-alt.jpeg'), 'jpeg');
    await writeRaster(join(cwd, 'icons', 'web.webp'), 'webp');

    const result = await compileTileflowIconPackages(localProject('./icons'), {
      cwd,
      target: 'hosted',
    });

    assert.deepEqual(result.packages[0]?.manifest.iconNames, [
      'photo',
      'photo-alt',
      'pixel',
      'vector',
      'web',
    ]);
  });
});

test('keeps intrinsic dimensions for pattern-marked sprite sources', async () => {
  await withFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'), {recursive: true});
    await writeFile(
      join(cwd, 'icons', 'tunnel-32.pattern.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="32"><path d="M0 8 8 0" stroke="#94A3B8"/></svg>',
    );
    const result = await compileTileflowIconPackages(localProject('./icons'), {
      cwd,
      target: 'hosted',
    });
    const compiled = result.packages[0]!;
    const oneX = JSON.parse(
      new TextDecoder().decode(
        compiled.files.find((file) => file.fileName === 'sprite.json')!.source,
      ),
    ) as Record<string, {height: number; pixelRatio: number; width: number}>;
    const twoX = JSON.parse(
      new TextDecoder().decode(
        compiled.files.find((file) => file.fileName === 'sprite@2x.json')!.source,
      ),
    ) as Record<string, {height: number; pixelRatio: number; width: number}>;

    assert.deepEqual(compiled.manifest.iconNames, ['tunnel-32']);
    assert.deepEqual(oneX['tunnel-32'], {
      height: 32,
      pixelRatio: 1,
      width: 8,
      x: 0,
      y: 0,
    });
    assert.deepEqual(twoX['tunnel-32'], {
      height: 64,
      pixelRatio: 2,
      width: 16,
      x: 0,
      y: 0,
    });
  });
});

test('rejects non-seamless intrinsic line-pattern widths', async () => {
  await withFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'), {recursive: true});
    await writeFile(
      join(cwd, 'icons', 'broken.pattern.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="32"/>',
    );

    await assert.rejects(
      compileTileflowIconPackages(localProject('./icons'), {cwd, target: 'hosted'}),
      /pattern width must be a power of two from 2 through 512 pixels/,
    );
  });
});

test('reports missing, empty, duplicate, malformed, and unsafe hosted sources structurally', async () => {
  await withFixture(async (cwd) => {
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./missing'), {cwd, target: 'local'}),
      'maps.main.icons.source',
      'not found',
    );

    await mkdir(join(cwd, 'empty'));
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./empty'), {cwd, target: 'local'}),
      'maps.main.icons.source',
      'No supported',
    );

    await writeSvg(join(cwd, 'duplicates', 'pin.svg'), '#000000');
    await writeRaster(join(cwd, 'duplicates', 'pin.png'), 'png');
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./duplicates'), {cwd, target: 'hosted'}),
      'maps.main.icons.source/pin.svg',
      'Duplicate icon basename',
    );

    await mkdir(join(cwd, 'malformed'));
    await writeFile(join(cwd, 'malformed', 'broken.png'), 'not an image');
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./malformed'), {cwd, target: 'local'}),
      'maps.main.icons.source',
      'unsupported image format',
    );
  });
});

test('keeps broad local names but enforces hosted identifiers and repository containment', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-icons-parent-'));
  const cwd = join(parent, 'repo');
  const outside = join(parent, 'outside');

  try {
    await mkdir(cwd);
    await writeSvg(join(outside, 'coffee shop.svg'), '#ef4444');
    const project = localProject('../outside');
    const local = await compileTileflowIconPackages(project, {cwd, target: 'local'});

    assert.deepEqual(local.packages[0]?.manifest.iconNames, ['coffee shop']);
    await assertIconIssue(
      () => compileTileflowIconPackages(project, {cwd, target: 'hosted'}),
      'maps.main.icons.source',
      'inside the selected working tree',
    );

    await writeSvg(join(cwd, 'unsafe', 'coffee shop.svg'), '#ef4444');
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./unsafe'), {cwd, target: 'hosted'}),
      'maps.main.icons.source/coffee shop.svg',
      'Hosted icon IDs',
    );
  } finally {
    await rm(parent, {force: true, recursive: true});
  }
});

test('rejects symlink escapes, nested directories, unsafe SVG content, and source limits', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-icons-security-'));
  const cwd = join(parent, 'repo');
  const outside = join(parent, 'secret.svg');

  try {
    await mkdir(join(cwd, 'icons'), {recursive: true});
    await writeSvg(outside, '#111827');
    await symlink(outside, join(cwd, 'icons', 'escaped.svg'));
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./icons'), {cwd, target: 'hosted'}),
      'maps.main.icons.source/escaped.svg',
      'symlink escapes',
    );

    await rm(join(cwd, 'icons'), {force: true, recursive: true});
    await writeSvg(join(cwd, 'icons', 'safe.svg'), '#111827');
    await mkdir(join(cwd, 'icons', 'nested'));
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./icons'), {cwd, target: 'hosted'}),
      'maps.main.icons.source/nested',
      'Nested directories',
    );

    for (const [name, svg, expected] of [
      [
        'doctype',
        '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>',
        'document type',
      ],
      [
        'script',
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        'scripts',
      ],
      [
        'external',
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" /></svg>',
        'local fragments',
      ],
    ] as const) {
      const directory = join(cwd, name);
      await mkdir(directory);
      await writeFile(join(directory, 'icon.svg'), svg);
      await assertIconIssue(
        () => compileTileflowIconPackages(localProject(`./${name}`), {cwd, target: 'hosted'}),
        'maps.main.icons.source/icon.svg',
        expected,
      );
    }

    const manyDirectory = join(cwd, 'many');
    await mkdir(manyDirectory);
    await Promise.all(
      Array.from({length: 257}, (_, index) =>
        writeFile(
          join(manyDirectory, `icon-${String(index).padStart(3, '0')}.svg`),
          simpleSvg('#0f172a'),
        ),
      ),
    );
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./many'), {cwd, target: 'hosted'}),
      'maps.main.icons.source',
      'more than 256 icons',
    );

    const largeDirectory = join(cwd, 'large');
    await mkdir(largeDirectory);
    await writeFile(join(largeDirectory, 'large.svg'), ' '.repeat(1024 * 1024 + 1));
    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./large'), {cwd, target: 'hosted'}),
      'maps.main.icons.source/large.svg',
      'exceeds 1048576 bytes',
    );
  } finally {
    await rm(parent, {force: true, recursive: true});
  }
});

test('rejects images over the decoded pixel limit before atlas creation', async () => {
  await withFixture(async (cwd) => {
    await writeFile(
      join(cwd, 'icons', 'huge.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="3000"><rect width="3000" height="3000" /></svg>',
    );

    await assertIconIssue(
      () => compileTileflowIconPackages(localProject('./icons'), {cwd, target: 'hosted'}),
      'maps.main.icons.source',
      'pixel limit',
    );
  });
});

function localProject(source: string): TileflowProjectConfig {
  return {
    maps: {
      main: {
        icons: {source},
      },
    },
  };
}

async function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icons-'));

  try {
    await mkdir(join(cwd, 'icons'), {recursive: true});
    await run(cwd);
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
}

async function writeSvg(path: string, color: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, simpleSvg(color));
}

function simpleSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}" /></svg>`;
}

async function writeRaster(path: string, format: 'jpeg' | 'png' | 'webp'): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  const pipeline = sharp({
    create: {background: '#2563eb', channels: 4, height: 8, width: 8},
  });
  const output =
    format === 'jpeg' ? pipeline.jpeg() : format === 'webp' ? pipeline.webp() : pipeline.png();

  await output.toFile(path);
}

async function assertIconIssue(
  run: () => Promise<unknown>,
  path: string,
  message: string,
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof TileflowIconCompilationError);
    assert.ok(
      error.issues.some(
        (issue) =>
          issue.path === path && issue.message.toLowerCase().includes(message.toLowerCase()),
      ),
      `Expected ${path} to contain ${message}; got ${JSON.stringify(error.issues)}`,
    );
    return true;
  });
}
