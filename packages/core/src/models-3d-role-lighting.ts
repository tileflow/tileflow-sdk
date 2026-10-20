import type {TileflowModelRoleLighting} from './building-illumination';
import {tileflowColourChannels} from './theme-blend';

/** Independent, stable samples follow model identity through tiles, LODs and theme blends. */
export function sampleModelRole(profile: TileflowModelRoleLighting | undefined, identity: string) {
  let seed = 2166136261;
  for (let i = 0; i < identity.length; i++)
    seed = Math.imul(seed ^ identity.charCodeAt(i), 16777619);
  const random = (channel: number) => {
    let value = Math.imul(seed ^ channel, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const variation = profile?.colorVariation;
  let color = profile?.color ? tileflowColourChannels(profile.color)?.slice(0, 3) : undefined;
  if (variation) {
    const hsl = [variation.hue, variation.saturation, variation.lightness].map(
      ([low, high], channel) => low + (high - low) * random(channel + 1),
    );
    color = tileflowColourChannels(`hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`)!.slice(0, 3);
    if (variation.space === 'linear')
      color = color.map((c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
  }
  return {
    strength: (profile?.emissiveStrength ?? 0) + (profile?.emissiveVariation ?? 0) * random(0),
    color,
  };
}
