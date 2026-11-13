import type {
  TileflowAnnotation,
  TileflowAnnotationMarkerState,
  TileflowAnnotationViewContext,
  TileflowInteractionViewContext,
} from '@tileflow/interactions';
import type {
  TileflowMapLibreDomRenderTarget,
  TileflowMapLibreSemanticDomRenderTarget,
} from '@tileflow/interactions/maplibre';

/**
 * What a view renderer may return: `update` receives the next context instead of the view being
 * rendered again from an empty element, and `destroy` runs when the view leaves the map.
 */
export type TileflowMapViewInstance<TContext> = Readonly<{
  destroy?: () => void;
  update?: (context: TContext) => void;
}>;

/**
 * Fills `element` with a view. It runs when the view appears and again, on an emptied element,
 * whenever its context changes, unless it returned an `update`.
 */
export type TileflowMapViewRenderer<TContext> = (
  element: HTMLElement,
  context: TContext,
) => TileflowMapViewInstance<TContext> | void;

/** Views drawn into marker, popup and tooltip elements. Each kind left out keeps the default view. */
export type TileflowMapViews<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<{
    marker?: TileflowMapViewRenderer<TileflowAnnotationViewContext<TAnnotation>>;
    popup?: TileflowMapViewRenderer<TileflowInteractionViewContext<TAnnotation>>;
    tooltip?: TileflowMapViewRenderer<TileflowInteractionViewContext<TAnnotation>>;
  }>;

export type TileflowMapRenderTargetList<TAnnotation extends TileflowAnnotation> = Readonly<{
  annotations: readonly TileflowMapLibreDomRenderTarget<TAnnotation>[];
  semantic: readonly TileflowMapLibreSemanticDomRenderTarget[];
}>;

type MountedView = {
  context: unknown;
  detachPointer?: () => void;
  element: HTMLElement;
  instance: TileflowMapViewInstance<unknown> | void;
  pointer: {focused: boolean; hovered: boolean};
  renderer: TileflowMapViewRenderer<unknown>;
  selected: boolean;
  target: unknown;
};

export type TileflowMapViewHost<TAnnotation extends TileflowAnnotation> = Readonly<{
  dispose(): void;
  /** True from a change to the set of views until two frames after it was drawn. */
  isSettled(): boolean;
  sync(
    targets: TileflowMapRenderTargetList<TAnnotation>,
    views: TileflowMapViews<TAnnotation>,
  ): void;
}>;

/** The context a marker, popup or tooltip of an annotation is drawn with. */
export function tileflowAnnotationViewContext<TAnnotation extends TileflowAnnotation>(
  target: TileflowMapLibreDomRenderTarget<TAnnotation>,
  state?: TileflowAnnotationMarkerState,
): TileflowAnnotationViewContext<TAnnotation> {
  const {annotation} = target;
  const content =
    target.kind === 'marker'
      ? annotation.marker?.content
      : target.kind === 'tooltip'
        ? annotation.tooltip?.content
        : annotation.popup?.content;
  return {
    annotation,
    close: target.close,
    ...(content ? {content} : {}),
    target: {annotation, coordinate: annotation.coordinate, kind: 'annotation'},
    ...(content?.kind === 'view' ? {viewName: content.name} : {}),
    ...(target.kind === 'marker' && state ? {state} : {}),
  };
}

/** The context a popup or tooltip of a map feature is drawn with. */
export function tileflowSemanticViewContext<TAnnotation extends TileflowAnnotation>(
  target: TileflowMapLibreSemanticDomRenderTarget,
): TileflowInteractionViewContext<TAnnotation> {
  return {
    close: target.close,
    content: target.content,
    target: target.target,
    ...(target.viewName ? {viewName: target.viewName} : {}),
  } as TileflowInteractionViewContext<TAnnotation>;
}

/**
 * Draws application views into the elements the interaction runtimes hand out, and keeps marker
 * hover, focus and selection current without drawing the other markers again.
 */
export function createTileflowMapViewHost<TAnnotation extends TileflowAnnotation>(options: {
  onChange: () => void;
  onError: (error: unknown) => void;
  window: Window;
}): TileflowMapViewHost<TAnnotation> {
  const mounted = new Map<string, MountedView>();
  let signature = '[]';
  let settledSignature = '[]';
  let frames: number[] = [];
  let disposed = false;

  const cancelFrames = () => {
    for (const frame of frames) options.window.cancelAnimationFrame(frame);
    frames = [];
  };

  const draw = (view: MountedView, context: unknown) => {
    view.context = context;
    try {
      if (view.instance && view.instance.update) {
        view.instance.update(context);
        return;
      }
      view.instance?.destroy?.();
      view.element.replaceChildren();
      view.instance = view.renderer(view.element, context);
    } catch (error) {
      view.instance = undefined;
      options.onError(error);
    }
  };

  const unmount = (view: MountedView) => {
    view.detachPointer?.();
    try {
      view.instance?.destroy?.();
    } catch (error) {
      options.onError(error);
    }
  };

  const markerContext = (view: MountedView) =>
    tileflowAnnotationViewContext(view.target as TileflowMapLibreDomRenderTarget<TAnnotation>, {
      ...view.pointer,
      selected: view.selected,
    });

  const watchPointer = (view: MountedView) => {
    const element = view.element.closest<HTMLElement>('[data-tileflow-interaction="marker"]');
    if (!element) return undefined;
    const set = (patch: Partial<MountedView['pointer']>) => {
      const next = {...view.pointer, ...patch};
      if (next.focused === view.pointer.focused && next.hovered === view.pointer.hovered) return;
      view.pointer = next;
      draw(view, markerContext(view));
    };
    const enter = () => set({hovered: true});
    const leave = () => set({hovered: false});
    const focus = () => set({focused: true});
    const blur = () => set({focused: false});
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', blur);
    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', blur);
    };
  };

  return {
    dispose() {
      disposed = true;
      cancelFrames();
      for (const view of mounted.values()) unmount(view);
      mounted.clear();
    },
    isSettled: () => settledSignature === signature,
    sync(targets, views) {
      if (disposed) return;
      const selected = new Set(
        targets.annotations
          .filter((target) => target.kind === 'popup')
          .map((target) => target.annotation.id),
      );
      const next = new Map<
        string,
        {
          kind: 'annotation' | 'semantic';
          target:
            TileflowMapLibreDomRenderTarget<TAnnotation> | TileflowMapLibreSemanticDomRenderTarget;
        }
      >();
      for (const target of targets.annotations) {
        next.set(`annotation:${target.key}`, {kind: 'annotation', target});
      }
      for (const target of targets.semantic) {
        next.set(`semantic:${target.key}`, {kind: 'semantic', target});
      }

      for (const [key, view] of mounted) {
        if (next.has(key)) continue;
        unmount(view);
        mounted.delete(key);
      }

      for (const [key, entry] of next) {
        const viewKind = entry.target.kind;
        const renderer = views[viewKind] as TileflowMapViewRenderer<unknown> | undefined;
        const isMarker = entry.kind === 'annotation' && viewKind === 'marker';
        const isSelected =
          isMarker &&
          selected.has(
            (entry.target as TileflowMapLibreDomRenderTarget<TAnnotation>).annotation.id,
          );
        const existing = mounted.get(key);
        if (!renderer) {
          if (existing) {
            unmount(existing);
            mounted.delete(key);
          }
          continue;
        }
        if (
          existing &&
          existing.renderer === renderer &&
          existing.target === entry.target &&
          existing.selected === isSelected
        ) {
          continue;
        }
        if (existing && existing.renderer !== renderer) {
          unmount(existing);
          mounted.delete(key);
        }
        const view: MountedView = mounted.get(key) ?? {
          context: undefined,
          element: entry.target.container,
          instance: undefined,
          pointer: {focused: false, hovered: false},
          renderer,
          selected: isSelected,
          target: entry.target,
        };
        view.element = entry.target.container;
        view.selected = isSelected;
        view.target = entry.target;
        if (!mounted.has(key)) {
          mounted.set(key, view);
          if (isMarker) view.detachPointer = watchPointer(view);
        }
        draw(
          view,
          entry.kind === 'semantic'
            ? tileflowSemanticViewContext(entry.target as TileflowMapLibreSemanticDomRenderTarget)
            : isMarker
              ? markerContext(view)
              : tileflowAnnotationViewContext(
                  entry.target as TileflowMapLibreDomRenderTarget<TAnnotation>,
                ),
        );
      }

      const nextSignature = JSON.stringify([...mounted.keys()].sort());
      if (nextSignature === signature) return;
      signature = nextSignature;
      cancelFrames();
      // Two frames: the drawn views have been laid out and painted with the map.
      const first = options.window.requestAnimationFrame(() => {
        const second = options.window.requestAnimationFrame(() => {
          frames = [];
          if (disposed) return;
          settledSignature = nextSignature;
          options.onChange();
        });
        frames = [second];
      });
      frames = [first];
    },
  };
}
