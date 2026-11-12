import assert from 'node:assert/strict';
import test from 'node:test';
import {createRenderer, h, nextTick, ref} from 'vue';
import {TileflowMap, type TileflowMapRef} from '../src/index.js';

class Node {
  parent: Node | null = null;
  children: Node[] = [];
  ownerDocument = {
    defaultView: {
      cancelAnimationFrame() {},
      requestAnimationFrame: () => 0,
    },
  };
  complete = false;
  naturalWidth = 0;
  addEventListener() {}
  removeEventListener() {}
  constructor(
    readonly tag: string,
    public text = '',
  ) {}
  querySelector(tag: string): Node | undefined {
    return this.children.find((child) => child.tag === tag);
  }
}

test('the mounted Vue reference exposes asynchronous methods and rejects image-mode commands', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      version: 1,
      maps: {
        main: {
          defaultTheme: 'light',
          themes: {light: {styleUrl: 'https://refs.example/light.json'}},
        },
      },
    });
  const renderer = createRenderer<Node, Node>({
    createElement: (tag) => new Node(tag),
    createText: (text) => new Node('#text', text),
    createComment: (text) => new Node('#comment', text),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[(node.parent?.children.indexOf(node) ?? -1) + 1] ?? null,
    patchProp() {},
    insert(node, parent, anchor) {
      if (node.parent)
        node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = parent;
      parent.children.splice(
        anchor ? parent.children.indexOf(anchor) : parent.children.length,
        0,
        node,
      );
    },
    remove(node) {
      if (node.parent)
        node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = null;
    },
  });
  const map = ref<TileflowMapRef | null>(null);
  const app = renderer.createApp({
    render: () =>
      h(TileflowMap, {
        ref: map,
        source: {map: 'main', manifestUrl: 'https://refs.example/manifest.json'},
        mode: 'image',
        imageUrl: 'data:image/png;base64,AA==',
      }),
  });
  let mounted = false;
  try {
    app.mount(new Node('root'));
    mounted = true;
    await nextTick();
    const current = map.value!;
    for (const name of [
      'addSource',
      'removeSource',
      'addLayer',
      'moveLayer',
      'removeLayer',
    ] as const) {
      assert.equal(typeof current[name], 'function');
    }
    await assert.rejects(current.addSource('points', {type: 'geojson'}), (error: unknown) => {
      assert.equal((error as {code: string}).code, 'invalidRequest');
      assert.equal((error as {context: {reason: string}}).context.reason, 'unsupportedMode');
      return true;
    });
    app.unmount();
    mounted = false;
    await assert.rejects(current.removeLayer('points'), {code: 'disposed'});
  } finally {
    if (mounted) app.unmount();
    globalThis.fetch = previousFetch;
  }
});
