import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';

export type Dock = 'bottom' | 'right' | 'left';
export type Panel =
  'inspect' | 'layers' | 'network' | 'scene' | 'assets' | 'performance' | 'diagnostics' | 'beacon';
export type ResourceRecord = {
  id: number;
  url: string;
  name: string;
  kind: string;
  transport: 'resource' | 'protocol';
  start: number;
  duration?: number;
  bytes?: number;
  transferred?: number;
  status: string;
  error?: string;
};
export type TileRecord = {
  key: string;
  source: string;
  z: number;
  x: number;
  y: number;
  overscaledZ: number;
  state: string;
  bytes?: number;
  wrap?: number;
};
export type PreviewObserver = {
  mapReadyMs?: number;
  records: ResourceRecord[];
  revision: number;
  dropped: number;
  recording: boolean;
  attach: (map: MapLibreMap) => void;
  clear: () => void;
  dispose: () => void;
};
export type PreviewWindow = Window & {
  __tileflowRuntimeVisibility?: (id: string, visible?: boolean) => boolean | undefined;
  __tileflowDevtoolsObserver?: PreviewObserver;
  __tileflowInspectModels?: () => {
    id: string;
    module: string;
    format: string;
    vertices: number;
    triangles: number;
    bytes: number;
    lods: number;
    instances?: number;
    positions: number[];
    indices: number[];
    colors?: string[];
  }[];
  __tileflowDescribeRuntimeLayers?: () => Record<string, RuntimeLayerObservation>;
};
export type RuntimeLayerObservation = {
  controller: string;
  state: Record<string, unknown>;
  stats?: Record<string, unknown>;
};
export type LayerContribution = {
  owner: string;
  target: string;
  slot?: string;
  operations?: {kind: string; owner: string; target: string}[];
  authoringPaths?: string[];
  themeTokens?: string[];
};
export type Side = {
  id: string;
  definition: {label: string; basePath: string};
  map?: MapLibreMap;
  frame: HTMLIFrameElement;
  loadEpoch: number;
  artifactGeneration: number;
  artifactStatus: string;
  runtimeErrors: string[];
  sidecar?: {
    map?: string;
    theme?: string;
    layers: {id: string; contributions: LayerContribution[]}[];
  };
  inspectRenderedFeature?: (feature: MapGeoJSONFeature, coordinate: [number, number]) => void;
  getInspectedFeature?: () => MapGeoJSONFeature | undefined;
  highlightFeature?: (index: number) => void;
  hoverFeature?: (index: number) => void;
};
export type Selection = {
  side: Side;
  coordinate: [number, number];
  featureIndex: number;
  features: {
    layerId: string;
    id: number | string | null;
    geometryType: string;
    properties: Record<string, unknown>;
  }[];
};
export type DevtoolsHost = {
  schemaVersion: 1;
  sides: () => Side[];
  active: () => Side;
  selection: () => Selection | undefined;
  selectFeature: (index: number) => void;
  inspect: (enabled: boolean) => void;
  inspecting: () => boolean;
  controls: () => Promise<void>;
  sprites: () => Promise<void>;
  loadSidecar?: (side: Side) => Promise<Side['sidecar']>;
  clearFeatureSelection?: () => void;
};
export type DevtoolsUI = {
  feedback: (message: string) => void;
  show: (panel: Panel) => void;
  selectionChanged: () => void;
  inspectionChanged: (enabled: boolean) => void;
  controls: (open: boolean) => void;
  hasChanges: (side: Side) => boolean;
  layerContext?: () => Record<string, unknown> | undefined;
};
export type SceneVariant = {theme: string; palette: string; timeOfDay?: string};
export type SceneSnapshot = {
  side: string;
  theme: string;
  controls: Record<string, unknown>;
  buildings3d: boolean;
  animation: string;
  style?: import('maplibre-gl').StyleSpecification;
};
export type SceneBridge = {
  readonly history: {undo: number; redo: number; changed: boolean};
  undo(): Promise<void>;
  redo(): Promise<void>;
  reset(): Promise<void>;
  audit(active: boolean): void;
  variants(): SceneVariant[];
  snapshot(): SceneSnapshot;
  style(theme: string, signal?: AbortSignal): Promise<import('maplibre-gl').StyleSpecification>;
  apply(theme: string, signal?: AbortSignal): Promise<void>;
  restore(snapshot: SceneSnapshot): Promise<void>;
};
declare global {
  interface Window {
    __tileflowScene?: SceneBridge;
    __tileflowDevtoolsHost?: DevtoolsHost;
    __tileflowDevtoolsUI?: DevtoolsUI;
  }
}
