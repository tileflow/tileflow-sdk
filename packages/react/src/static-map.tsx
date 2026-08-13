'use client';

import {
  type CSSProperties,
  type ImgHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {normalizeTileflowCaptureId} from '@tileflow/core';
import type {StaticMapResult, StaticSceneInput} from '@tileflow/static';

type StaticMapBaseProps = StaticSceneInput & {
  alt?: string;
  className?: string;
  captureId?: string;
  imageStyle?: CSSProperties;
  keepPreviousImage?: boolean;
  loading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  onError?: (error: Error) => void;
  onImageLoad?: ImgHTMLAttributes<HTMLImageElement>['onLoad'];
  onReady?: (result: StaticMapResult) => void;
  style?: CSSProperties;
};

type StaticMapImageProps = {
  createUrl?: never;
  imageUrl: string;
};

type StaticMapCreateProps = {
  createUrl: string;
  imageUrl?: never;
};

export type StaticMapProps = StaticMapBaseProps & (StaticMapCreateProps | StaticMapImageProps);

const inFlightRequests = new Map<string, Promise<StaticMapResult>>();

export function StaticMap({
  alt = '',
  camera,
  className,
  captureId,
  createUrl,
  imageStyle,
  imageUrl,
  keepPreviousImage = false,
  loading = 'lazy',
  map,
  onError,
  onImageLoad,
  onReady,
  overlays,
  size,
  style,
}: StaticMapProps) {
  const [result, setResult] = useState<StaticMapResult | null>(
    imageUrl ? imageResult(imageUrl) : null,
  );
  const [error, setError] = useState<Error | null>(null);
  const [captureState, setCaptureState] = useState<'error' | 'idle' | 'loading'>('loading');
  const imageLoadRunRef = useRef(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const sceneKey = useMemo(
    () => stableStringify({camera, map, overlays, size}),
    [camera, map, overlays, size],
  );
  const requestKey = imageUrl ? `image:${imageUrl}` : `create:${createUrl}:${sceneKey}`;

  useLayoutEffect(() => {
    imageLoadRunRef.current += 1;
    setCaptureState('loading');
    const image = imageRef.current;
    if (image?.complete) {
      if (image.naturalWidth === 0) setCaptureState('error');
      else void markImageReady(image);
    }
  }, [requestKey]);

  async function markImageReady(image: HTMLImageElement) {
    const runId = ++imageLoadRunRef.current;
    try {
      if (typeof image.decode === 'function') await image.decode();
    } catch {
      if (!image.complete || image.naturalWidth === 0) {
        if (runId === imageLoadRunRef.current) setCaptureState('error');
        return;
      }
    }
    if (runId === imageLoadRunRef.current) setCaptureState('idle');
  }

  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  }, [onError, onReady]);

  useEffect(() => {
    if (imageUrl) {
      const nextResult = imageResult(imageUrl);

      setResult(nextResult);
      setError(null);
      onReadyRef.current?.(nextResult);
      return;
    }

    let cancelled = false;

    if (!createUrl) {
      return;
    }

    if (!keepPreviousImage) {
      setResult(null);
    }

    setError(null);

    resolveStaticMap({
      createUrl,
      requestKey,
      scene: JSON.parse(sceneKey) as StaticSceneInput,
    })
      .then((nextResult) => {
        if (cancelled) {
          return;
        }

        setResult(nextResult);
        setError(null);
        onReadyRef.current?.(nextResult);
      })
      .catch((nextError: unknown) => {
        if (cancelled) {
          return;
        }

        const normalizedError =
          nextError instanceof Error ? nextError : new Error('Static map failed');

        if (!keepPreviousImage) {
          setResult(null);
        }

        setError(normalizedError);
        imageLoadRunRef.current += 1;
        setCaptureState('error');
        onErrorRef.current?.(normalizedError);
      });

    return () => {
      cancelled = true;
    };
  }, [createUrl, imageUrl, keepPreviousImage, requestKey, sceneKey]);

  return (
    <div
      aria-busy={!result && !error}
      className={className}
      data-tileflow-capture-id={resolvedCaptureId}
      data-tileflow-map={map}
      data-tileflow-state={captureState}
      style={{
        aspectRatio: `${size.width} / ${size.height}`,
        background: '#f4f4f2',
        overflow: 'hidden',
        width: '100%',
        ...style,
      }}
    >
      {result ? (
        <img
          alt={alt}
          decoding="async"
          loading={loading}
          onError={() => {
            const imageError = new Error('Static map image failed to load');
            setError(imageError);
            imageLoadRunRef.current += 1;
            setCaptureState('error');
            onErrorRef.current?.(imageError);
          }}
          onLoad={(event) => {
            onImageLoad?.(event);
            void markImageReady(event.currentTarget);
          }}
          ref={imageRef}
          src={result.imageUrl}
          style={{
            display: 'block',
            height: '100%',
            objectFit: 'cover',
            width: '100%',
            ...imageStyle,
          }}
        />
      ) : null}
    </div>
  );
}

async function resolveStaticMap(input: {
  createUrl: string;
  requestKey: string;
  scene: StaticSceneInput;
}) {
  const existing = inFlightRequests.get(input.requestKey);

  if (existing) {
    return existing;
  }

  const promise = fetch(input.createUrl, {
    body: JSON.stringify(input.scene),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Static map endpoint failed: ${response.status}`);
      }

      return (await response.json()) as StaticMapResult;
    })
    .finally(() => {
      inFlightRequests.delete(input.requestKey);
    });

  inFlightRequests.set(input.requestKey, promise);
  return promise;
}

function imageResult(imageUrl: string): StaticMapResult {
  return {
    cached: true,
    hash: '',
    imageUrl,
    status: 'ready',
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}
