import {z} from 'zod';

/** Static preparation profile, not evidence that an application ran on a device. */
export const tileflowNativeProfileSchema = z.object({
  id: z.literal('native-v1'),
  renderer: z.literal('native'),
  schemaVersion: z.literal(1),
  styleVersion: z.literal(8),
  validatorStyleSpec: z.literal('24.8.5'),
  reactNativeStyleSpec: z.literal('26.2.1'),
  maplibreReactNative: z.literal('11.3.10'),
  android: z.literal('13.2.0'),
  ios: z.literal('6.26.0'),
}).strict();
export type TileflowNativeProfile = z.infer<typeof tileflowNativeProfileSchema>;
export const tileflowNativeProfile: Readonly<TileflowNativeProfile> = Object.freeze({
  id: 'native-v1',
  renderer: 'native',
  schemaVersion: 1,
  styleVersion: 8,
  validatorStyleSpec: '24.8.5',
  reactNativeStyleSpec: '26.2.1',
  maplibreReactNative: '11.3.10',
  android: '13.2.0',
  ios: '6.26.0',
});
export const tileflowNativeProfileIdSchema = z.literal('native-v1');
export const tileflowRendererSchema = z.enum(['web', 'native']);
export type TileflowRenderer = z.infer<typeof tileflowRendererSchema>;
