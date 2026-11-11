import assert from 'node:assert/strict';
import test from 'node:test';
import {configurePopupCloseButton, roleVariable} from '../src/surface-style';

test('a role variable falls back to the shared variable, then to the built-in value', () => {
  assert.equal(
    roleVariable('popup', 'foreground', '#111827'),
    'var(--tileflow-interaction-popup-foreground, var(--tileflow-interaction-foreground, #111827))',
  );
  assert.equal(
    roleVariable('cluster', 'ring', roleVariable('cluster', 'border-color', '#ffffff')),
    'var(--tileflow-interaction-cluster-ring, var(--tileflow-interaction-ring, var(--tileflow-interaction-cluster-border-color, var(--tileflow-interaction-border-color, #ffffff))))',
  );
});

class FakeNode {
  readonly attributes = new Map<string, string>();
  readonly children: FakeNode[] = [];
  readonly style: Record<string, string> = {};
  textContent = '';
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

test('the close button shows a hidden cross and keeps its accessible name to the caller', () => {
  const button = new FakeNode();
  configurePopupCloseButton(button as unknown as HTMLButtonElement, {
    createElement: () => new FakeNode() as unknown as HTMLElement,
  });
  assert.equal(button.textContent, '');
  assert.equal(button.children[0]!.textContent, '×');
  assert.equal(button.children[0]!.attributes.get('aria-hidden'), 'true');
  assert.equal(button.style.position, 'absolute');
  assert.equal(button.style.color, 'var(--tileflow-interaction-popup-close-color, inherit)');
});
