import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFile(new URL(path, root), 'utf8');

test('iOS finds exactly one owned Fabric camera through the bounded native hierarchy', async () => {
  const ios = await source('ios/TileflowNativeSurface.mm');
  assert.match(ios, /static MLRNCamera \*TFSurfaceCamera\(UIView \*root, MLRNMapView \*map\)/u);
  assert.match(ios, /if \(\+\+visited > 1024\) TFSurfaceInvalid\(\)/u);
  assert.match(ios, /if \(found\) TFSurfaceInvalid\(\); found = \(MLRNCamera \*\)view;/u);
  assert.match(ios, /id registered = map\.reactCamera;/u);
  assert.match(ios, /registered != found/u);
  assert.match(ios, /\(\(MLRNCamera \*\)registered\)\.map != map/u);
  assert.match(ios, /MLRNCamera \*camera = TFSurfaceCamera\(surface\.root, surface\.map\);/u);
  assert.doesNotMatch(ios, /reactSubviews/u);
});

test('the private frame marker is visible-but-fully-transparent and the first request mutates it on both platforms', async () => {
  const renderer = await source('src/native-renderer-owner.ts');
  assert.match(renderer, /type: 'background',[\s\S]*'background-color': 'rgba\(0,0,0,0\)'/u);
  assert.match(renderer, /'background-opacity': 0/u);
  assert.doesNotMatch(renderer, /visibility:\s*'none'/u);

  const ios = await source('ios/TileflowNativeSurface.mm');
  assert.match(ios, /surface\.repaint = !surface\.repaint;/u);
  assert.match(
    ios,
    /backgroundOpacity = \[NSExpression expressionForConstantValue:surface\.repaint \? @0\.0001 : @0\]/u,
  );
  assert.doesNotMatch(ios, /backgroundColor = .*surface\.repaint/u);

  const android = await source(
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeSurfaceModule.kt',
  );
  assert.match(android, /surface\.repaint = !surface\.repaint/u);
  assert.match(
    android,
    /PropertyFactory\.backgroundOpacity\(if \(surface\.repaint\) 0\.0001f else 0\.0f\)/u,
  );
  assert.doesNotMatch(android, /backgroundColor\(if \(surface\.repaint\)/u);
});
