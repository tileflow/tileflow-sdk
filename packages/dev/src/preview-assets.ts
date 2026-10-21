import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {isPathWithin} from './path-safety';

const localRequire = createRequire(import.meta.url);
const localMapLibreAssets = new Map<string, string>();
let localTileflowBrowserJavaScript: string | undefined;
let localThreeCoreJavaScript: string | undefined;
let localThreeModuleJavaScript: string | undefined;

export function getTileflowPreviewRuntimeResponse(path: string): Response | undefined {
  if (path === '/__runtime/devtools-observer.js') {
    return textAssetResponse(
      readFileSync(new URL('../dist/devtools-observer.js', import.meta.url), 'utf8'),
      'text/javascript; charset=utf-8',
    );
  }
  if (path === '/__runtime/maplibre-gl.mjs') {
    return textAssetResponse(
      getLocalMapLibreAsset('maplibre-gl.mjs'),
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
  if (path.startsWith('/__runtime/three-addons/')) {
    return textAssetResponse(
      getLocalThreeAddonAsset(path.slice('/__runtime/three-addons/'.length)),
      'text/javascript; charset=utf-8',
    );
  }
  return undefined;
}

function getLocalMapLibreAsset(
  fileName: 'maplibre-gl.css' | 'maplibre-gl.mjs' | 'maplibre-gl-worker.mjs',
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

function textAssetResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
    },
  });
}
