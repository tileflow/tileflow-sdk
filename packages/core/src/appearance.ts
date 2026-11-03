import {resolveTileflowRuntimeTheme, type TileflowRuntimeManifestMap} from './runtime';
import {isTileflowTimeOfDay, type TileflowTimeOfDay} from './time-of-day';

export type TileflowAppearanceSelection = Readonly<
  {palette?: string} & (
    | {mode: 'fixed'; moment?: TileflowTimeOfDay}
    | {mode: 'system'; light: TileflowTimeOfDay; dark: TileflowTimeOfDay}
    | {
        mode: 'clock';
        schedule: readonly Readonly<{hour: number; moment: TileflowTimeOfDay}>[];
        blend?: boolean;
      }
  )
>;

/** Resolve artistic time presets. Device dark mode and local clock are independent inputs. */
export function resolveTileflowAppearance(
  map: TileflowRuntimeManifestMap,
  selection: TileflowAppearanceSelection,
  context: {date: Date; colorScheme: 'light' | 'dark'},
): Readonly<{themes: readonly string[]; position: number}> {
  const theme = (moment?: TileflowTimeOfDay) => {
    if (moment !== undefined && !isTileflowTimeOfDay(moment))
      throw new TypeError('Invalid appearance moment.');
    return resolveTileflowRuntimeTheme(map, selection.palette, context.colorScheme, moment).name;
  };
  if (selection.mode === 'fixed') return {themes: [theme(selection.moment)], position: 0};
  if (selection.mode === 'system')
    return {themes: [theme(selection[context.colorScheme])], position: 0};
  if (selection.mode !== 'clock')
    throw new TypeError('Expected fixed, system, or clock appearance.');
  const schedule = [...selection.schedule].sort((a, b) => a.hour - b.hour);
  if (
    schedule.length < 2 ||
    schedule.length > 24 ||
    schedule.some(
      (stop, index) =>
        !Number.isFinite(stop.hour) ||
        stop.hour < 0 ||
        stop.hour >= 24 ||
        !isTileflowTimeOfDay(stop.moment) ||
        (index > 0 && stop.hour === schedule[index - 1]!.hour),
    )
  )
    throw new TypeError('A clock schedule needs 2–24 distinct hours from 0 to less than 24.');
  if (!Number.isFinite(context.date.getTime())) throw new TypeError('Invalid appearance date.');
  const hour =
    context.date.getHours() + context.date.getMinutes() / 60 + context.date.getSeconds() / 3600;
  let lower = -1;
  schedule.forEach((stop, index) => {
    if (stop.hour <= hour) lower = index;
  });
  if (lower < 0) lower = schedule.length - 1;
  const from = schedule[lower]!;
  const to = schedule[(lower + 1) % schedule.length]!;
  if (!selection.blend) return {themes: [theme(from.moment)], position: 0};
  const span = (to.hour - from.hour + 24) % 24;
  const themes = [theme(from.moment), theme(to.moment)];
  return themes[0] === themes[1]
    ? {themes: [themes[0]!], position: 0}
    : {themes, position: ((hour - from.hour + 24) % 24) / span};
}
