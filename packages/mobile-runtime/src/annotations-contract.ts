import {z} from 'zod';
import {protocol} from './contract';
import {styleIdentifier} from './style-contract';

// Annotations: application layers that people tap, hold and drag, and points whose screen
// positions the host follows frame by frame to place native views over the map.

const finite = z.number().finite();

/**
 * The application layers whose features are annotations. Taps and long presses report the
 * annotations under the touch, topmost first, and a pan that starts on a feature whose `draggable`
 * property is true drags it instead of the map.
 */
export const annotationLayersSchema = z.strictObject({
  layers: z
    .array(styleIdentifier)
    .max(protocol.limits.maximumAnnotationLayers)
    .refine((layers) => new Set(layers).size === layers.length),
});
export type AnnotationLayers = z.infer<typeof annotationLayersSchema>;

/**
 * Points whose screen positions the renderer reports after each frame that moves them, in this
 * order. `revision` names the set; positions carry it, so the host matches them to its points.
 */
export const trackedPointsSchema = z.strictObject({
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  points: z
    .array(z.tuple([finite.min(-180).max(180), finite.min(-90).max(90)]))
    .max(protocol.limits.maximumTrackedPoints),
});
export type TrackedPoints = z.infer<typeof trackedPointsSchema>;
