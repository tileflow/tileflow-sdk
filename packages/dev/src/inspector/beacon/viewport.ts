import type {Map as MapLibreMap} from 'maplibre-gl';

export type ViewportSize = {name: string; width: number; height: number};
/** Resize the actual iframe layout, then scale its presentation to fit the existing map pane. */
export function previewViewport(frame: HTMLIFrameElement, map: MapLibreMap) {
  const properties = [
    'position',
    'width',
    'height',
    'max-width',
    'max-height',
    'left',
    'top',
    'transform',
    'transform-origin',
  ];
  const saved = properties.map((name) => ({
    name,
    value: frame.style.getPropertyValue(name),
    priority: frame.style.getPropertyPriority(name),
  }));
  return {
    set(viewport: ViewportSize) {
      const bounds = frame.parentElement!.getBoundingClientRect();
      const scale = Math.min(1, bounds.width / viewport.width, bounds.height / viewport.height);
      const values: Record<string, string> = {
        position: 'absolute',
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
        'max-width': 'none',
        'max-height': 'none',
        left: '50%',
        top: '50%',
        transform: `translate(-50%, -50%) scale(${scale})`,
        'transform-origin': 'center',
      };
      for (const [name, value] of Object.entries(values)) frame.style.setProperty(name, value);
      map.resize();
    },
    restore(resize = true) {
      for (const {name, value, priority} of saved) {
        if (value) frame.style.setProperty(name, value, priority);
        else frame.style.removeProperty(name);
      }
      if (resize) map.resize();
    },
  };
}
