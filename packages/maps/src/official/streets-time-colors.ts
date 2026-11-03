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

/** Apply the reference's time-of-day exposure to Streets' own approved daylight materials. */
export function streetsTimeColors(
  day: Colors,
  referenceDay: Colors,
  referenceTime: Colors,
  monochrome: boolean,
  preset: StreetsLightPreset,
): Record<string, string> {
  // Use the reference's exposure, not its material hues. Warm limestone, blue water and
  // green vegetation keep Streets' daylight identity under a gentle shared white balance.
  const temperature = {
    day: [1, 1, 1],
    dawn: [1.035, 1, 0.93],
    dusk: [1.045, 1, 0.97],
    night: [0.92, 0.97, 1.06],
  }[preset];
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
      const rgb = monochrome
        ? Array<number>(3).fill(transfer(gray(color.rgb), gray(source), gray(target)))
        : color.rgb.map(
            (channel, i) => transfer(channel, gray(source), gray(target)) * temperature[i]!,
          );
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
