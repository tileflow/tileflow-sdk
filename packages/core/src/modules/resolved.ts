/** Compiler-only state produced by semantic module operations during map resolution. */
export type TileflowResolvedModuleConfig<TModule extends {type: string}> = TModule & {
  readonly enabled?: boolean;
};
