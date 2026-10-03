import {z} from 'zod';

/** Strict object schema without Zod's environment-sensitive classic object JIT probe. */
export function strictNativeObject<Shape extends z.core.$ZodShape>(shape: Shape) {
  const object = new z.core.$ZodObject({
    type: 'object',
    shape,
    catchall: z.never(),
  }) as z.core.$ZodObject<Shape, z.core.$strict>;

  // The lazy classic wrapper retains parse/safeParse/parseAsync and refinement APIs.
  return z.lazy(() => object);
}
