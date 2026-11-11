import type {StreetsLightPreset} from './streets-theme-colors';

type Colors = Readonly<Record<string, string>>;
type Color = {rgb: number[]; alpha: number};

function parse(value: string): Color {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expanded = hex.length < 5 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return {
      rgb: [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16)),
      alpha: expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1,
    };
  }
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unsupported Streets color: ${value}`);
  return {rgb: channels.slice(0, 3), alpha: channels[3] ?? 1};
}

const gray = (rgb: number[]) => rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;

// A relative exposure change, bounded at black and white. Unlike an additive offset,
// this retains differences between materials and tree species near the night endpoint.
function transfer(value: number, from: number, to: number) {
  return to < from
    ? value * (to / from)
    : from < 255
      ? value + (255 - value) * ((to - from) / (255 - from))
      : value;
}

function referenceRole(role: string): string {
  if (/^buildings\.(?:raised\.|model(?:Surface|Glass|Secondary|Roof|Accent)$)/.test(role))
    return 'buildings.extrusion';
  if (role.startsWith('buildings.flat.'))
    return role.endsWith('Outline') ? 'buildings.outline' : 'buildings.extrusion';
  if (role === 'buildings.modelWater') return 'hydro.water';
  if (role === 'buildings.modelVegetation') return 'vegetation.tree.broadleaf.b';
  if (role === 'buildings.modelWood') return 'vegetation.tree.bark';
  if (role === 'vegetation.tree.outline') return 'surface.park';
  if (role.startsWith('roads.overview.'))
    return role.includes('casing') ? 'roads.detail.casing' : 'roads.motorway';
  if (role === 'roads.accessOverview') return 'roads.default';
  if (role === 'roads.path.ground' || role === 'roads.path.green') return 'roads.path';
  if (role === 'surface.background.transition') return 'surface.background';
  if (role === 'landcover.orchard' || role === 'landcover.nursery') return 'landcover.greenspace';
  return role;
}

// Warm stone and paving catch the sun; roads, water and greens keep their daylight hue.
// At dusk, a little warmth remains in the stone against cooler ambient light.
const timeGrades = {
  day: {exposure: 1, ambient: [1, 1, 1], stone: [1, 1, 1]},
  dawn: {exposure: 0.35, ambient: [1.008, 1, 0.995], stone: [1.025, 1, 0.95]},
  dusk: {exposure: 1, ambient: [0.975, 1, 1.06], stone: [1.025, 1, 1.02]},
  night: {exposure: 1, ambient: [0.94, 0.99, 1.05], stone: [0.98, 1, 1.08]},
} as const;

function isStone(role: string, anchor: string): boolean {
  if (role === 'buildings.modelGlass') return false;
  return (
    anchor.startsWith('buildings.') ||
    /^surface\.(?:background|land|building)(?:\.|$)/.test(anchor) ||
    /^landuse\.(?!cemetery|recreation)/.test(anchor) ||
    /^landcover\.(?:barren|rock|sand|global\.(?:barren|urban))$/.test(anchor) ||
    /^land\.(?:fence|wall)$/.test(anchor) ||
    /^roads\.(?:path|parkPath|pedestrian)(?:\.|$)/.test(anchor) ||
    role === 'roads.accessOverview'
  );
}

/** Grade Streets' daylight materials using the reference's relative exposure. */
export function streetsTimeColors(
  day: Colors,
  referenceDay: Colors,
  referenceTime: Colors,
  monochrome: boolean,
  preset: StreetsLightPreset,
): Record<string, string> {
  const grade = timeGrades[preset];
  return Object.fromEntries(
    Object.entries(day).map(([role, value]) => {
      // Sky and emitted light have their own time-dependent physical profiles. Sign artwork
      // and pavement alpha are fixed inks, independent of the surrounding illumination.
      if (role.startsWith('sky.') || /^(?:buildings\.(?:floodLight|modelEmission))$/.test(role))
        return [role, referenceTime[role] ?? value];
      if (role.startsWith('labels.shield.') || role === 'roads.sidewalk.surface')
        return [role, referenceTime[role] ?? value];
      const anchor = referenceRole(role);
      const from = referenceDay[anchor];
      const to = referenceTime[anchor];
      if (!from || !to) throw new Error(`Missing Streets time-of-day anchor: ${role}`);
      const color = parse(value);
      if (role === 'labels.waterHalo') color.alpha = parse(to).alpha;
      const source = parse(from).rgb;
      const target = parse(to).rgb;
      const sourceLight = gray(source);
      const targetLight = gray(target);
      // Dawn stays close to midday's brightness. Monochrome retains its independently
      // authored exposure; only the colored appearances receive this material grade.
      const exposure = sourceLight + (targetLight - sourceLight) * grade.exposure;
      const temperature = isStone(role, anchor) ? grade.stone : grade.ambient;
      const rgb = monochrome
        ? Array<number>(3).fill(transfer(gray(color.rgb), sourceLight, targetLight))
        : color.rgb.map((channel, i) => transfer(channel, sourceLight, exposure) * temperature[i]!);
      const channels = rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))));
      return [
        role,
        color.alpha < 1
          ? `rgba(${channels.join(', ')}, ${color.alpha})`
          : '#' +
            channels
              .map((channel) => channel.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase(),
      ];
    }),
  );
}
