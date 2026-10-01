import {resolveTileflowNativeManifestUrl} from '@tileflow/core/native';
import {hasReservedNativeContext} from './native-admission-url';
import {NativeDocumentError} from './native-document-contract';

export function nativeDocumentOrigin(url: string): string {
  const origin = /^(https?:\/\/[^/?#]+)\//u.exec(url)?.[1];
  if (!origin) throw new NativeDocumentError('NATIVE_DOCUMENT_INVALID');
  return origin;
}

export function cleanNativeDocumentUrl(value: unknown, developmentOrigin?: string): string {
  if (
    typeof value !== 'string' ||
    resolveTileflowNativeManifestUrl(value, {developmentOrigin}) !== value ||
    hasReservedNativeContext(value) ||
    /tf_native_|tf_public_/iu.test(decodeURIComponent(value))
  )
    throw new NativeDocumentError('NATIVE_DOCUMENT_INVALID');
  return value;
}
