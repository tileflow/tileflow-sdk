import {z} from 'zod';
import {strictNativeObject} from './native-zod-object';

/**
 * Static preparation profile, not evidence that an application ran on a device.
 *
 * `android` and `ios` are the exact MapLibre Native releases the mobile SDKs ship. Style values
 * are parsed with Tileflow's compiler Style Spec (`validatorStyleSpec`); native support is read
 * from its `sdk-support` tables, updated to `supportStyleSpec` where those tables predate the
 * pinned engines (see `nativeSupportAdditions` in `native-profile.ts`).
 */
export const tileflowNativeProfileSchema = strictNativeObject({
  id: z.literal('native-v1'),
  renderer: z.literal('native'),
  schemaVersion: z.literal(1),
  styleVersion: z.literal(8),
  validatorStyleSpec: z.literal('24.8.5'),
  supportStyleSpec: z.literal('26.5.1'),
  android: z.literal('13.7.1'),
  ios: z.literal('7.0.0'),
});
export type TileflowNativeProfile = z.infer<typeof tileflowNativeProfileSchema>;
export const tileflowNativeProfile: Readonly<TileflowNativeProfile> = Object.freeze({
  id: 'native-v1',
  renderer: 'native',
  schemaVersion: 1,
  styleVersion: 8,
  validatorStyleSpec: '24.8.5',
  supportStyleSpec: '26.5.1',
  android: '13.7.1',
  ios: '7.0.0',
});
export const tileflowNativeProfileIdSchema = z.literal('native-v1');
export const tileflowRendererSchema = z.enum(['web', 'native']);
export type TileflowRenderer = z.infer<typeof tileflowRendererSchema>;
