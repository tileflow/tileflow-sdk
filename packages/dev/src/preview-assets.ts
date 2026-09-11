import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {isPathWithin} from './path-safety';

const localRequire = createRequire(import.meta.url);
const localMapLibreAssets = new Map<string, string>();
let localTileflowBrowserJavaScript: string | undefined;
let localThreeCoreJavaScript: string | undefined;
let localThreeModuleJavaScript: string | undefined;
let localPmtilesJavaScript: string | undefined;
let localFflateJavaScript: string | undefined;

export function getTileflowPreviewRuntimeResponse(path: string): Response | undefined {
  if (path === '/__runtime/maplibre-gl.mjs') {
    return textAssetResponse(
      getLocalMapLibreAsset('maplibre-gl.mjs'),
      'text/javascript; charset=utf-8',
    );
  }
  if (path === '/__runtime/maplibre-gl-shared.mjs') {
    return textAssetResponse(
      getLocalMapLibreAsset('maplibre-gl-shared.mjs'),
      'text/javascript; charset=utf-8',
    );
  }
  if (path === '/__runtime/maplibre-gl-worker.mjs') {
    return textAssetResponse(
      getLocalMapLibreAsset('maplibre-gl-worker.mjs'),
      'text/javascript; charset=utf-8',
    );
  }
  if (path === '/__runtime/maplibre-gl.css') {
    return textAssetResponse(getLocalMapLibreAsset('maplibre-gl.css'), 'text/css; charset=utf-8');
  }
  if (path === '/__runtime/tileflow-browser.js') {
    return textAssetResponse(getLocalTileflowBrowserAsset(), 'text/javascript; charset=utf-8');
  }
  if (path === '/__runtime/three.module.js') {
    return textAssetResponse(getLocalThreeAsset('module'), 'text/javascript; charset=utf-8');
  }
  if (path === '/__runtime/three.core.min.js') {
    return textAssetResponse(getLocalThreeAsset('core'), 'text/javascript; charset=utf-8');
  }
  if (path === '/__runtime/pmtiles.js') {
    return textAssetResponse(getLocalPmtilesAsset(), 'text/javascript; charset=utf-8');
  }
  if (path === '/__runtime/fflate.js') {
    return textAssetResponse(getLocalFflateAsset(), 'text/javascript; charset=utf-8');
  }
  if (path === '/__runtime/three-addons/libs/draco/gltf/draco_decoder.wasm') {
    return binaryAssetResponse(
      getLocalThreeAddonBinaryAsset('libs/draco/gltf/draco_decoder.wasm'),
      'application/wasm',
    );
  }
  if (path.startsWith('/__runtime/three-addons/')) {
    return textAssetResponse(
      getLocalThreeAddonAsset(path.slice('/__runtime/three-addons/'.length)),
      'text/javascript; charset=utf-8',
    );
  }
  return undefined;
}

function getLocalMapLibreAsset(
  fileName:
    | 'maplibre-gl.css'
    | 'maplibre-gl.mjs'
    | 'maplibre-gl-shared.mjs'
    | 'maplibre-gl-worker.mjs',
): string {
  const cached = localMapLibreAssets.get(fileName);
  if (cached !== undefined) return cached;

  const source = readFileSync(localRequire.resolve(`maplibre-gl/dist/${fileName}`), 'utf8');
  localMapLibreAssets.set(fileName, source);
  return source;
}

function getLocalTileflowBrowserAsset(): string {
  if (localTileflowBrowserJavaScript !== undefined) return localTileflowBrowserJavaScript;
  const packagePath = localRequire.resolve('@tileflow/core/package.json');
  localTileflowBrowserJavaScript = readFileSync(
    join(dirname(packagePath), 'dist', 'browser.js'),
    'utf8',
  );
  return localTileflowBrowserJavaScript;
}

function getLocalThreeAsset(kind: 'core' | 'module'): string {
  if (kind === 'core' && localThreeCoreJavaScript !== undefined) return localThreeCoreJavaScript;
  if (kind === 'module' && localThreeModuleJavaScript !== undefined)
    return localThreeModuleJavaScript;
  const commonJsPath = localRequire.resolve('three');
  const source = readFileSync(
    join(dirname(commonJsPath), kind === 'core' ? 'three.core.min.js' : 'three.module.min.js'),
    'utf8',
  );
  if (kind === 'core') localThreeCoreJavaScript = source;
  else localThreeModuleJavaScript = source;
  return source;
}

function getLocalThreeAddonAsset(relativePath: string): string {
  if (!/^[A-Za-z0-9_./-]+\.js$/.test(relativePath) || relativePath.includes('..')) {
    throw new Error('Invalid Three.js addon path.');
  }
  const commonJsPath = localRequire.resolve('three');
  const addonRoot = join(dirname(dirname(commonJsPath)), 'examples', 'jsm');
  const assetPath = join(addonRoot, relativePath);
  if (!isPathWithin(addonRoot, assetPath)) throw new Error('Invalid Three.js addon path.');
  return readFileSync(assetPath, 'utf8');
}

function getLocalThreeAddonBinaryAsset(relativePath: string): Buffer {
  if (!/^[A-Za-z0-9_./-]+\.wasm$/.test(relativePath) || relativePath.includes('..')) {
    throw new Error('Invalid Three.js binary addon path.');
  }
  const commonJsPath = localRequire.resolve('three');
  const addonRoot = join(dirname(dirname(commonJsPath)), 'examples', 'jsm');
  const assetPath = join(addonRoot, relativePath);
  if (!isPathWithin(addonRoot, assetPath)) throw new Error('Invalid Three.js binary addon path.');
  return readFileSync(assetPath);
}

function getLocalPmtilesAsset(): string {
  if (localPmtilesJavaScript !== undefined) return localPmtilesJavaScript;
  const packagePath = localRequire.resolve('pmtiles/package.json');
  localPmtilesJavaScript = readFileSync(
    join(dirname(packagePath), 'dist', 'esm', 'index.js'),
    'utf8',
  );
  return localPmtilesJavaScript;
}

function getLocalFflateAsset(): string {
  if (localFflateJavaScript !== undefined) return localFflateJavaScript;
  const commonJsPath = localRequire.resolve('fflate');
  localFflateJavaScript = readFileSync(
    join(dirname(dirname(commonJsPath)), 'esm', 'browser.js'),
    'utf8',
  );
  return localFflateJavaScript;
}

function textAssetResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
    },
  });
}

function binaryAssetResponse(body: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
    },
  });
}
