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
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  type PreparedStaticMapRequest,
  prepareStaticMapRequest,
  stableStringify,
  type StaticMapResult,
  validateStaticMapIdempotencyKey,
} from '@tileflow/static/client';
import type {StaticSceneInput} from '@tileflow/static/scene';
import {resolveStaticMap} from './static-map-request';

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
  idempotencyKey?: never;
  imageUrl: string;
};

type StaticMapCreateProps = {
  createUrl: string;
  idempotencyKey: string;
  imageUrl?: never;
};

export type StaticMapProps = StaticMapBaseProps & (StaticMapCreateProps | StaticMapImageProps);

export function StaticMap({
  alt = '',
  camera,
  className,
  captureId,
  createUrl,
  format,
  imageStyle,
  imageUrl,
  idempotencyKey,
  keepPreviousImage = false,
  loading = 'lazy',
  map,
  onError,
  onImageLoad,
  onReady,
  overlays,
  size,
  style,
  theme,
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
  const sceneInputKey = stableStringify({camera, format, map, overlays, size, theme});
  const preparedSceneCandidate = useMemo(
    () => prepareSceneRequest({camera, format, map, overlays, size, theme}),
    [camera, format, map, overlays, size, theme],
  );
  const preparedScene = useStablePreparedSceneRequest(preparedSceneCandidate);
  const sceneKey = preparedScene.ok ? preparedScene.request.sceneKey : `invalid:${sceneInputKey}`;
  const intentKey = imageUrl
    ? `image:${imageUrl}:${sceneKey}`
    : `create:${createUrl}:${idempotencyKey ?? ''}:${sceneKey}`;
  const visibleResult = preparedScene.ok ? result : null;
  const visibleError = preparedScene.ok ? error : preparedScene.error;
  const effectiveCaptureState = preparedScene.ok ? captureState : 'error';

  useLayoutEffect(() => {
    imageLoadRunRef.current += 1;
    setCaptureState('loading');
    const image = imageRef.current;
    if (image?.complete) {
      if (image.naturalWidth === 0) setCaptureState('error');
      else void markImageReady(image);
    }
  }, [intentKey]);

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
    let cancelled = false;

    if (!preparedScene.ok) {
      if (!keepPreviousImage) setResult(null);
      setError(preparedScene.error);
      imageLoadRunRef.current += 1;
      setCaptureState('error');
      onErrorRef.current?.(preparedScene.error);
      return;
    }

    if (imageUrl) {
      const nextResult = imageResult(imageUrl);

      setResult(nextResult);
      setError(null);
      onReadyRef.current?.(nextResult);
      return;
    }

    if (!createUrl) {
      return;
    }

    const validation = validateStaticMapIdempotencyKey(idempotencyKey ?? '');
    if (!validation.ok) {
      const keyError = new Error(`Invalid Static Maps idempotency key: ${validation.error}`);
      if (!keepPreviousImage) setResult(null);
      setError(keyError);
      imageLoadRunRef.current += 1;
      setCaptureState('error');
      onErrorRef.current?.(keyError);
      return;
    }

    if (!keepPreviousImage) {
      setResult(null);
    }

    setError(null);
    const requestController = new AbortController();

    resolveStaticMap({
      createUrl,
      idempotencyKey: validation.key,
      request: preparedScene.request,
      signal: requestController.signal,
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
      requestController.abort();
    };
  }, [createUrl, idempotencyKey, imageUrl, keepPreviousImage, preparedScene]);

  return (
    <div
      aria-busy={!visibleResult && !visibleError}
      className={className}
      data-tileflow-capture-id={resolvedCaptureId}
      data-tileflow-map={map}
      data-tileflow-theme={preparedScene.ok ? theme : undefined}
      data-tileflow-state={effectiveCaptureState}
      style={{
        aspectRatio: `${size.width} / ${size.height}`,
        background: '#f4f4f2',
        overflow: 'hidden',
        width: '100%',
        ...style,
      }}
    >
      {visibleResult ? (
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
          src={visibleResult.imageUrl}
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

type PreparedSceneRequest =
  | {error: Error; ok: false}
  | {ok: true; request: PreparedStaticMapRequest};

function prepareSceneRequest(scene: StaticSceneInput): PreparedSceneRequest {
  try {
    return {ok: true, request: prepareStaticMapRequest(scene)};
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error : new Error('Invalid Tileflow static scene'),
      ok: false,
    };
  }
}

function useStablePreparedSceneRequest(value: PreparedSceneRequest): PreparedSceneRequest {
  const valueRef = useRef(value);
  const current = valueRef.current;
  const equivalent =
    current.ok === value.ok &&
    (current.ok && value.ok
      ? current.request.sceneKey === value.request.sceneKey
      : !current.ok && !value.ok && current.error.message === value.error.message);

  if (!equivalent) {
    valueRef.current = value;
  }

  return valueRef.current;
}

function imageResult(imageUrl: string): StaticMapResult {
  return {
    cached: true,
    hash: '',
    imageUrl,
    operationId: null,
    remainingUnits: null,
    status: 'ready',
    unitCost: 0,
  };
}
