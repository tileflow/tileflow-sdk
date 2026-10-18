/**
 * Writes Streets' POI discs from `streetsPoiPictograms` and `streetsPoiDiscColors`: default and
 * monochrome artwork for the light and dark themes.
 *
 * A pictogram's outline comes from its existing light SVG. A new pictogram needs the pinned Maki
 * release it is adapted from:
 *
 *   pnpm --filter @tileflow/maps exec tsx scripts/generate-streets-poi-icons.ts \
 *     --maki <directory of an extracted @mapbox/maki@8.2.0 package>
 *
 * Run it again after changing a disc color or the POI halo color of a theme.
 */
import {existsSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {streetsPoiDiscColors, streetsPoiPictograms} from '../src/official/streets-poi';
import {streetsThemes} from '../src/official/streets-themes';

const iconDirectory = resolve(import.meta.dirname, '../assets/streets/icons');
const makiIndex = process.argv.indexOf('--maki');
const makiDirectory = makiIndex >= 0 ? process.argv[makiIndex + 1] : undefined;

function color(theme: keyof typeof streetsThemes, role: string): string {
  const value = (streetsThemes[theme].tokens.color as Record<string, unknown>)[role];
  if (typeof value !== 'string') throw new Error(`Streets ${theme} theme has no ${role} color.`);
  return value.toUpperCase();
}

function paletteColor(value: string, palette: 'default' | 'monochrome') {
  if (palette === 'default') return value;
  const match = /^#([\da-f]{6})$/iu.exec(value);
  if (!match) throw new Error(`Expected an opaque hex POI color, received ${value}.`);
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(match[1]!.slice(offset, offset + 2), 16),
  );
  const gray = r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
  const channel = Math.round(gray).toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

function filename(id: string, theme: 'dark' | 'light', palette: 'default' | 'monochrome') {
  const suffix = palette === 'default' ? '' : `-${palette}`;
  return `${id}${suffix}${theme === 'dark' ? '-dark' : ''}.svg`;
}

async function pictogramPath(id: string, maki: string): Promise<string> {
  const existing = resolve(iconDirectory, `${id}.svg`);
  if (existsSync(existing)) {
    const match = /\sd="([^"]+)"/u.exec(await readFile(existing, 'utf8'));
    if (match) return match[1]!;
  }
  if (!makiDirectory) {
    throw new Error(`Pictogram ${id} is new; pass --maki with an extracted @mapbox/maki@8.2.0.`);
  }
  const source = await readFile(resolve(makiDirectory, 'icons', `${maki}.svg`), 'utf8');
  const match = /<path[^>]*\sd="([^"]+)"/u.exec(source);
  if (!match) throw new Error(`Maki icon ${maki} has no single path.`);
  return match[1]!
    .replace(/&#x[0-9A-F]+;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function disc(options: {
  description: string;
  disc: string;
  path: string;
  pictogram: string;
  ring: string;
  title: string;
}): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">',
    `  <title>${options.title}</title>`,
    `  <desc>${options.description}</desc>`,
    `  <circle cx="12" cy="12" r="10" fill="${options.ring}" />`,
    `  <circle cx="12" cy="12" r="8.5" fill="${options.disc}" />`,
    '  <path',
    `    fill="${options.pictogram}"`,
    '    transform="translate(6 6) scale(.8)"',
    `    d="${options.path}"`,
    '  />',
    '</svg>',
    '',
  ].join('\n');
}

for (const [id, pictogram] of Object.entries(streetsPoiPictograms)) {
  const path = await pictogramPath(id, pictogram.maki);
  const description = `Tileflow POI disc with a Maki ${pictogram.maki} pictogram, CC0-1.0.`;
  const role = 'disc' in pictogram ? pictogram.disc : pictogram.category;
  for (const theme of ['light', 'dark'] as const) {
    for (const palette of ['default', 'monochrome'] as const) {
      const categoryColor = paletteColor(streetsPoiDiscColors[theme][role], palette);
      const haloTheme =
        palette === 'monochrome' ? (theme === 'dark' ? 'dark-monochrome' : 'monochrome') : theme;
      const iconColor = paletteColor(color(haloTheme, 'poi.halo'), palette);
      await writeFile(
        resolve(iconDirectory, filename(id, theme, palette)),
        disc({
          description,
          disc: categoryColor,
          path,
          pictogram: iconColor,
          ring: iconColor,
          title: `${palette === 'default' ? '' : `${palette} `}${theme === 'light' ? '' : 'Night '}${pictogram.title}`,
        }),
      );
    }
  }
}
