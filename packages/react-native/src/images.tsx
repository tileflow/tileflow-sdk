import {useLayoutEffect, useState} from 'react';
import {Image} from 'react-native';
import type {ImageEntry} from './contract';
import {useCommittedValue, useMap} from './map-context';
import {TileflowMapError} from './map-error';
import type {NativeImage} from './native-map-contract';

export type ImagesProps = Readonly<{
  images: Readonly<Record<string, ImageEntry | number | Readonly<{uri: string}>>>;
}>;

function uri(source: ImageEntry['source']): string {
  const value = Image.resolveAssetSource(source);
  if (!value?.uri)
    throw new TileflowMapError({
      code: 'invalidRequest',
      message: 'An image requires a URI or bundled asset.',
      recoverable: false,
    });
  return value.uri;
}

export function Images({images}: ImagesProps) {
  const {images: collection} = useMap();
  const [owner] = useState(() => Symbol());
  const values: NativeImage[] = Object.entries(images).map(([id, input]) => {
    const entry: ImageEntry = typeof input === 'number' || 'uri' in input ? {source: input} : input;
    return {
      id,
      uri: uri(entry.source),
      ...(entry.sdf === undefined ? {} : {sdf: entry.sdf}),
      ...(entry.scale === undefined ? {} : {scale: entry.scale}),
      ...(entry.variants
        ? {
            variants: Object.fromEntries(
              Object.entries(entry.variants).map(([key, value]) => [key, uri(value)]),
            ),
          }
        : {}),
    };
  });
  const committed = useCommittedValue(values);
  const signature = JSON.stringify(values);
  useLayoutEffect(() => {
    collection.set(owner, committed.current);
    return () => collection.set(owner);
  }, [collection, owner, signature, committed]);
  return null;
}
