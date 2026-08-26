export type TileflowLandmarkAxisConvention = 'ENU_Z_UP' | 'EUN_Y_UP' | 'EUS_Y_UP';

export type TileflowLandmarkArchive = {
  bytes: number;
  id: string;
  sha256: string;
  url: string;
};

export type TileflowLandmarkModel = {
  archive: TileflowLandmarkArchive;
  archiveId: string;
  axisConvention: TileflowLandmarkAxisConvention;
  bytes: number;
  key: string;
  minzoom: number;
  sha256: string;
  x: number;
  y: number;
  z: number;
};

export type TileflowLandmark = {
  bounds: [number, number, number, number];
  center: [number, number];
  id: string;
  models: TileflowLandmarkModel[];
  priority: number;
};

export type TileflowLandmarkManifestV2 = {
  archives: TileflowLandmarkArchive[];
  id: string;
  landmarks: TileflowLandmark[];
  maximumCachedModels: number;
  maximumVisibleModels: number;
  minzoom: number;
  schemaVersion: 2;
};

/** Reads a response without ever buffering more than the declared bound. */
export async function readBoundedTileflowResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('invalid response byte limit');
  }
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
    await response.body?.cancel('response exceeds byte limit');
    throw new Error('response exceeds byte limit');
  }
  if (!response.body) throw new Error('response body is unavailable');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (byteLength + value.byteLength > maximumBytes) {
        await reader.cancel('response exceeds byte limit');
        throw new Error('response exceeds byte limit');
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Reads and strictly decodes a bounded UTF-8 JSON response. */
export async function readBoundedTileflowJsonResponse(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const bytes = await readBoundedTileflowResponse(response, maximumBytes);
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

/**
 * Validates the browser preview's bounded v2 PMTiles landmark contract. Keep this function
 * self-contained: the preview serializes it into its isolated browser document.
 */
export function normalizeTileflowLandmarkManifest(
  candidate: unknown,
  manifestUrl: string,
): TileflowLandmarkManifestV2 {
  const value = candidate as Record<string, unknown> | null;
  const portableId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  const sha256 = /^[a-f0-9]{64}$/;
  const axisConventions = new Set(['EUN_Y_UP', 'EUS_Y_UP', 'ENU_Z_UP']);

  if (
    value?.schemaVersion !== 2 ||
    typeof value.id !== 'string' ||
    !portableId.test(value.id) ||
    !Array.isArray(value.archives) ||
    value.archives.length > 64 ||
    !Array.isArray(value.landmarks) ||
    value.landmarks.length > 4_096 ||
    !Number.isInteger(value.minzoom) ||
    (value.minzoom as number) < 0 ||
    (value.minzoom as number) > 24 ||
    !Number.isInteger(value.maximumVisibleModels) ||
    (value.maximumVisibleModels as number) < 1 ||
    (value.maximumVisibleModels as number) > 64
  ) {
    throw new Error('invalid landmark manifest');
  }

  const minzoom = value.minzoom as number;
  const maximumVisibleModels = value.maximumVisibleModels as number;
  const maximumCachedModels =
    value.maximumCachedModels === undefined
      ? Math.min(128, Math.max(maximumVisibleModels, maximumVisibleModels * 2))
      : value.maximumCachedModels;
  if (
    !Number.isInteger(maximumCachedModels) ||
    (maximumCachedModels as number) < maximumVisibleModels ||
    (maximumCachedModels as number) > 128
  ) {
    throw new Error('invalid landmark cache limit');
  }

  const archiveIds = new Set<string>();
  const archiveMap = new Map<string, TileflowLandmarkArchive>();
  for (const input of value.archives) {
    const archive = input as Record<string, unknown> | null;
    if (
      typeof archive?.id !== 'string' ||
      !portableId.test(archive.id) ||
      archiveIds.has(archive.id) ||
      typeof archive.url !== 'string' ||
      archive.url.length < 1 ||
      archive.url.length > 2_048 ||
      !Number.isSafeInteger(archive.bytes) ||
      (archive.bytes as number) < 1 ||
      (archive.bytes as number) > 8 * 1024 * 1024 * 1024 ||
      typeof archive.sha256 !== 'string' ||
      !sha256.test(archive.sha256)
    ) {
      throw new Error('invalid landmark archive');
    }
    const url = new URL(archive.url, manifestUrl);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new Error('invalid landmark archive URL');
    }
    const normalized: TileflowLandmarkArchive = {
      bytes: archive.bytes as number,
      id: archive.id,
      sha256: archive.sha256,
      url: url.toString(),
    };
    archiveIds.add(archive.id);
    archiveMap.set(archive.id, normalized);
  }

  const landmarkIds = new Set<string>();
  const landmarks: TileflowLandmark[] = value.landmarks.map((input) => {
    const landmark = input as Record<string, unknown> | null;
    const center = landmark?.center;
    const bounds = landmark?.bounds;
    if (
      typeof landmark?.id !== 'string' ||
      !portableId.test(landmark.id) ||
      landmarkIds.has(landmark.id) ||
      !Array.isArray(center) ||
      center.length !== 2 ||
      !center.every(Number.isFinite) ||
      (center[0] as number) < -180 ||
      (center[0] as number) > 180 ||
      (center[1] as number) < -90 ||
      (center[1] as number) > 90 ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite) ||
      (bounds[0] as number) < -180 ||
      (bounds[2] as number) > 180 ||
      (bounds[1] as number) < -90 ||
      (bounds[3] as number) > 90 ||
      (bounds[0] as number) > (bounds[2] as number) ||
      (bounds[1] as number) > (bounds[3] as number) ||
      (center[0] as number) < (bounds[0] as number) ||
      (center[0] as number) > (bounds[2] as number) ||
      (center[1] as number) < (bounds[1] as number) ||
      (center[1] as number) > (bounds[3] as number) ||
      (landmark.priority !== undefined && !Number.isFinite(landmark.priority)) ||
      !Array.isArray(landmark.models) ||
      landmark.models.length < 1 ||
      landmark.models.length > 8
    ) {
      throw new Error('invalid landmark entry');
    }
    landmarkIds.add(landmark.id);

    const models: TileflowLandmarkModel[] = landmark.models.map((inputModel) => {
      const model = inputModel as Record<string, unknown> | null;
      if (!model) throw new Error('invalid landmark model');
      const archive =
        typeof model.archiveId === 'string' ? archiveMap.get(model.archiveId) : undefined;
      if (
        !archive ||
        !Number.isInteger(model?.minzoom) ||
        (model.minzoom as number) < minzoom ||
        (model.minzoom as number) > 24 ||
        !Number.isInteger(model.z) ||
        (model.z as number) < 0 ||
        (model.z as number) > 26 ||
        !Number.isInteger(model.x) ||
        (model.x as number) < 0 ||
        (model.x as number) >= 2 ** (model.z as number) ||
        !Number.isInteger(model.y) ||
        (model.y as number) < 0 ||
        (model.y as number) >= 2 ** (model.z as number) ||
        !Number.isSafeInteger(model.bytes) ||
        (model.bytes as number) < 1 ||
        (model.bytes as number) > 64 * 1024 * 1024 ||
        typeof model.sha256 !== 'string' ||
        !sha256.test(model.sha256) ||
        typeof model.axisConvention !== 'string' ||
        !axisConventions.has(model.axisConvention)
      ) {
        throw new Error('invalid landmark model');
      }
      return {
        archive,
        archiveId: model.archiveId as string,
        axisConvention: model.axisConvention as TileflowLandmarkAxisConvention,
        bytes: model.bytes as number,
        key: [archive.sha256, model.z, model.x, model.y, model.sha256].join(':'),
        minzoom: model.minzoom as number,
        sha256: model.sha256,
        x: model.x as number,
        y: model.y as number,
        z: model.z as number,
      };
    });
    models.sort((left, right) => left.minzoom - right.minzoom || left.key.localeCompare(right.key));
    if (new Set(models.map((model) => model.minzoom)).size !== models.length) {
      throw new Error('duplicate landmark LOD zoom');
    }
    if (models[0]!.minzoom !== minzoom) {
      throw new Error('landmark requires a base model');
    }

    return {
      bounds: bounds as [number, number, number, number],
      center: center as [number, number],
      id: landmark.id,
      models,
      priority: (landmark.priority as number | undefined) ?? 0,
    };
  });

  return {
    archives: [...archiveMap.values()],
    id: value.id,
    landmarks,
    maximumCachedModels: maximumCachedModels as number,
    maximumVisibleModels,
    minzoom,
    schemaVersion: 2,
  };
}
