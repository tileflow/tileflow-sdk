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

test('the private marker stays transparent while each current barrier arms and requests explicit repaint', async () => {
  const renderer = await source('src/native-renderer-owner.ts');
  assert.match(renderer, /type: 'background',[\s\S]*'background-color': 'rgba\(0,0,0,0\)'/u);
  assert.match(renderer, /'background-opacity': 1/u);

  const ios = await source('ios/TileflowNativeSurface.mm');
  assert.match(ios, /if \(!surface\.style\) TFSurfaceInvalid\(\);/u);
  assert.match(ios, /\[surface\.state request:token\];\s*\[surface\.map triggerRepaint\];/u);
  assert.doesNotMatch(ios, /surface\.repaint = !surface\.repaint/u);
  assert.doesNotMatch(ios, /backgroundOpacity = \[NSExpression expressionForConstantValue:surface\.repaint/u);

  const android = await source(
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeSurfaceModule.kt',
  );
  assert.match(android, /surface\.style\(\) \?: invalid\(\)/u);
  assert.match(android, /surface\.state\.request\(token\)\s*surface\.sdk\.triggerRepaint\(\)/u);
  assert.doesNotMatch(android, /surface\.repaint = !surface\.repaint/u);
  assert.doesNotMatch(android, /backgroundOpacity\(if \(surface\.repaint\)/u);
});
