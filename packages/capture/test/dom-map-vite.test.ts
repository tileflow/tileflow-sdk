import assert from 'node:assert/strict';
import test from 'node:test';
import {withMapApp} from './map-app-harness';

type AppWindow = typeof window & {
  __destroyedViews: string[];
  __loaded: boolean;
  __map: {
    destroy(): void;
    getMap(): {getStyle(): {layers: {id: string; paint?: Record<string, unknown>}[]}} | null;
    getStatus(): {readiness: string; theme: string | undefined};
    setTheme(theme: string): void;
  };
  __states: unknown[];
};

// A page with no framework: one element, one map, views written with plain DOM calls.
const app = `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre, createTileflowMap} from '@tileflow/dom';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});
const container = document.createElement('div');
container.style.cssText = 'height: 320px; position: relative';
document.getElementById('root').append(container);
window.__destroyedViews = [];
window.__loaded = false;
window.__states = [];
window.__map = createTileflowMap(container, {
  annotations: [{
    ariaLabel: 'Madrid',
    coordinate: [-3.7038, 40.4168],
    id: 'madrid',
    kind: 'marker',
    popup: {content: {kind: 'view', name: 'city'}},
  }],
  center: [-3.7038, 40.4168],
  onInteractionStateChange: (state) => window.__states.push(state),
  onLoad: () => { window.__loaded = true; },
  source: {manifestUrl: '/tileflow-fixture/manifest.json', map: 'main'},
  theme: 'light',
  views: {
    marker(element, {annotation, state}) {
      const label = document.createElement('span');
      label.dataset.markerView = annotation.id;
      label.dataset.selected = String(state?.selected === true);
      label.textContent = annotation.ariaLabel;
      element.append(label);
    },
    popup(element, context) {
      const button = document.createElement('button');
      button.dataset.popupView = context.viewName;
      button.textContent = 'Close ' + context.annotation.id;
      button.addEventListener('click', context.close);
      element.append(button);
      return {destroy: () => window.__destroyedViews.push('popup')};
    },
  },
  zoom: 5,
}, {captureId: 'dom'});
`;

test(
  'a framework-free page mounts a map, opens a marker popup, switches theme and tears it down',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  () =>
    withMapApp('dom', app, async (open) => {
      const {consoleErrors, page, pageErrors} = await open();
      const frame = page.locator('[data-tileflow-capture-id="dom"]');
      await frame.and(page.locator('[data-tileflow-state="idle"]')).waitFor({timeout: 30_000});
      assert.equal(await frame.getAttribute('data-tileflow-map'), 'main');
      assert.equal(await frame.getAttribute('data-tileflow-theme'), 'light');
      assert.equal(await page.evaluate(() => (window as AppWindow).__loaded), true);

      // The marker is the application's view, inside the accessible marker button.
      const marker = page.locator('[data-tileflow-interaction="marker"]');
      await marker.locator('[data-marker-view="madrid"][data-selected="false"]').waitFor();
      assert.equal(await marker.getAttribute('title'), 'Madrid');

      await marker.click();
      const closeButton = page.locator('[data-popup-view="city"]');
      await closeButton.waitFor();
      await marker.locator('[data-selected="true"]').waitFor();
      assert.deepEqual(await page.evaluate(() => (window as AppWindow).__states), [
        {popup: {id: 'madrid', kind: 'annotation'}},
      ]);
      await frame.and(page.locator('[data-tileflow-state="idle"]')).waitFor();

      await closeButton.click();
      await closeButton.waitFor({state: 'detached'});
      assert.deepEqual(await page.evaluate(() => (window as AppWindow).__destroyedViews), [
        'popup',
      ]);

      await page.evaluate(() => (window as AppWindow).__map.setTheme('dark'));
      await frame.and(page.locator('[data-tileflow-theme="dark"]')).waitFor();
      await frame.and(page.locator('[data-tileflow-state="idle"]')).waitFor();
      const background = await page.evaluate(
        () =>
          (window as AppWindow).__map
            .getMap()
            ?.getStyle()
            .layers.find((layer) => layer.id === 'background')?.paint?.['background-color'],
      );
      assert.equal(background, '#101820');

      await page.evaluate(() => (window as AppWindow).__map.destroy());
      assert.equal(await page.locator('.maplibregl-canvas').count(), 0);
      assert.equal(await page.locator('[data-tileflow-interaction="marker"]').count(), 0);
      assert.equal(await page.locator('[data-tileflow-state]').count(), 0);
      assert.equal(await page.evaluate(() => (window as AppWindow).__map.getMap()), null);

      assert.deepEqual(pageErrors, []);
      assert.deepEqual(consoleErrors, []);
    }),
);
