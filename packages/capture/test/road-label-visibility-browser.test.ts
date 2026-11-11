import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'tsup';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'road visibility tests depth asynchronously and changes complete names without replacing placement',
  {
    skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1',
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'tileflow-road-visibility-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    await build({
      entry: {
        fixture: fileURLToPath(
          new URL('../../core/src/road-label-visibility-browser.ts', import.meta.url),
        ),
      },
      outDir: directory,
      format: ['iife'],
      globalName: 'RoadVisibility',
      platform: 'browser',
      dts: false,
      silent: true,
    });
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<canvas width="128" height="128" style="width:128px;height:128px"></canvas>',
      );
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      await page.addScriptTag({
        content: await readFile(join(directory, 'fixture.global.js'), 'utf8'),
      });
      const observed = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            RoadVisibility: typeof import('../../core/src/road-label-visibility-browser');
          }
        ).RoadVisibility;
        const canvas = document.querySelector('canvas')!;
        const gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true})!;
        if (!gl) throw new Error('WebGL2 required');
        const listeners = new Map<string, Set<() => void>>();
        type Layer = {
          id: string;
          onAdd(map: unknown, gl: WebGL2RenderingContext): void;
          render(gl: WebGL2RenderingContext, args: unknown): void;
          onRemove(): void;
          inspect(): {pending: number; visible: number};
        };
        let layer: Layer | undefined;
        const values = new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0, 0]);
        const array = {uint32: values, length: values.length};
        let uploads = 0,
          repaints = 0,
          pitch = 30,
          terrain = false,
          tileActive = true;
        const upload = (_array: {uint32: Uint32Array; length: number}) => {
          uploads++;
        };
        const gpu = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu);
        gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
        const buffer = {buffer: gpu, updateData: upload};
        const symbols = [-0.5, 0.5, -0.7].map((anchorX) => ({
          anchorX,
          anchorY: -0.6,
          numHorizontalGlyphVertices: 8,
          numVerticalGlyphVertices: 0,
        }));
        const bucket = {
          symbolInstances: {length: symbols.length, get: (index: number) => symbols[index]!},
          text: {opacityVertexArray: array, opacityVertexBuffer: buffer},
        };
        const tileID = {canonical: {x: 0, y: 0, z: 0}, wrap: 0};
        const tile = {tileID, getBucket: () => bucket};
        const map = {
          style: {
            tileManagers: {
              roads: {
                getRenderableIds: () => (tileActive ? ['tile'] : []),
                getTileByID: () => tile,
              },
            },
          },
          getLayer: (id: string) => (id === 'names' ? {source: 'roads'} : layer),
          getPitch: () => pitch,
          getTerrain: () => (terrain ? {source: 'elevation'} : null),
          getCanvas: () => canvas,
          triggerRepaint: () => {
            repaints++;
          },
          addLayer(value: object) {
            layer = value as Layer;
            layer.onAdd(map, gl);
          },
          removeLayer() {
            layer?.onRemove();
            layer = undefined;
          },
          on(event: string, listener: () => void) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(listener);
          },
          off(event: string, listener: () => void) {
            listeners.get(event)?.delete(listener);
          },
        };
        const visibility = api.createRoadLabelVisibility(map);
        visibility.sync(['names']);
        const args = {
          getProjectionData: () => ({
            mainMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            projectionTransition: 0,
          }),
        };
        const frame = () => {
          gl.depthMask(true);
          gl.clearDepth(1);
          gl.disable(gl.SCISSOR_TEST);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          // A building covers only the right anchor; the whole two-glyph name must disappear.
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(64, 0, 64, 128);
          gl.clearDepth(0.25);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.disable(gl.SCISSOR_TEST);
          layer!.render(gl, args);
        };
        const settle = async () => {
          frame();
          for (let i = 0; layer!.inspect().pending && i < 40; i++) {
            await new Promise(requestAnimationFrame);
            frame();
          }
          if (layer!.inspect().pending) throw new Error('Depth queries did not settle');
        };
        await settle();
        const occluded = [...values],
          idleRepaints = repaints;
        // A renderer placement update suppresses the first name; our saved base must follow it.
        values.fill(0);
        buffer.updateData(array);
        for (const fn of listeners.get('move') ?? []) fn();
        pitch = 0;
        await settle();
        const collision = [...values];
        values.set([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0, 0]);
        buffer.updateData(array);
        await settle();
        const flat = [...values];
        pitch = 70;
        symbols[0]!.anchorY = 0.5;
        for (const fn of listeners.get('move') ?? []) fn();
        await settle();
        const distant = [...values];
        terrain = true;
        await settle();
        const terrainFallback = [...values];
        terrain = false;
        await settle();
        symbols[0]!.numHorizontalGlyphVertices = 12;
        await settle();
        const unknownLayoutFallback = [...values];
        symbols[0]!.numHorizontalGlyphVertices = 8;
        await settle();
        // Tiles can be destroyed before the next custom render. Cleanup must not write
        // to that deleted GPU buffer, or disturb another layer's current binding.
        gl.deleteBuffer(gpu);
        const anotherBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, anotherBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 16, gl.STATIC_DRAW);
        tileActive = false;
        await settle();
        const bindingPreserved = gl.getParameter(gl.ARRAY_BUFFER_BINDING) === anotherBuffer;
        visibility.dispose();
        visibility.dispose();
        return {
          occluded,
          collision,
          flat,
          distant,
          terrainFallback,
          unknownLayoutFallback,
          bindingPreserved,
          restored: [...values],
          idleRepaints,
          uploads,
          restoredMethod: buffer.updateData === upload,
          listeners: [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
          error: gl.getError(),
        };
      });
      assert.deepEqual(observed.occluded, [0xffffffff, 0xffffffff, 0, 0, 0, 0]);
      assert.deepEqual(observed.collision, [0, 0, 0, 0, 0, 0]);
      assert.deepEqual(observed.flat, [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0, 0]);
      assert.deepEqual(observed.distant, [0, 0, 0, 0, 0, 0]);
      assert.deepEqual(observed.terrainFallback, observed.flat);
      assert.deepEqual(observed.unknownLayoutFallback, observed.flat);
      assert.equal(observed.bindingPreserved, true);
      assert.deepEqual(observed.restored, observed.flat);
      assert.ok(observed.idleRepaints > 0 && observed.idleRepaints < 40);
      assert.equal(observed.restoredMethod, true);
      assert.equal(observed.listeners, 0);
      assert.equal(observed.error, 0);
    } finally {
      await browser.close();
    }
  },
);
