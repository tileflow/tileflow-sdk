import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type TileflowAnnotation,
  tileflowInteractionJsonValueSchema,
  tileflowInteractionLimits,
  validateTileflowAnnotations,
  validateTileflowInteractionBindings,
} from '../src/index';

function annotation(id: string): TileflowAnnotation<{name: string}> {
  return {
    ariaLabel: `Marker ${id}`,
    coordinate: [0, 0],
    data: {name: id},
    id,
    kind: 'marker',
  };
}

test('returns validated annotations with an empty diagnostic list', () => {
  const input = [annotation('first')];
  const result = validateTileflowAnnotations(input);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.annotations, input);
    assert.deepEqual(result.diagnostics, []);
  }
});

test('reports schema failures as structured JSON-Pointer diagnostics', () => {
  const result = validateTileflowAnnotations([
    {ariaLabel: '', coordinate: [0, 0], id: 'first', kind: 'marker'},
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostics[0]?.code, 'INVALID_ANNOTATION');
    assert.equal(result.diagnostics[0]?.level, 'error');
    assert.equal(result.diagnostics[0]?.path, '/0/ariaLabel');
    assert.ok(result.diagnostics[0]?.message);
  }
});

test('reports every duplicate annotation after its first occurrence', () => {
  const result = validateTileflowAnnotations([
    annotation('duplicate'),
    annotation('other'),
    annotation('duplicate'),
    annotation('duplicate'),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.diagnostics.map(({code, path}) => ({code, path})),
      [
        {code: 'DUPLICATE_ANNOTATION_ID', path: '/2/id'},
        {code: 'DUPLICATE_ANNOTATION_ID', path: '/3/id'},
      ],
    );
  }
});

test('rejects item and byte limits before consumers construct a runtime', () => {
  const tooMany = Array.from({length: tileflowInteractionLimits.maxAnnotations + 1}, (_, index) =>
    annotation(`marker-${index}`),
  );
  const itemResult = validateTileflowAnnotations(tooMany);
  assert.equal(itemResult.ok, false);
  if (!itemResult.ok) assert.equal(itemResult.diagnostics[0]?.code, 'LIMIT_EXCEEDED');

  const byteResult = validateTileflowAnnotations([
    {
      ...annotation('large'),
      data: {value: 'x'.repeat(tileflowInteractionLimits.maxDocumentBytes)},
    },
  ]);
  assert.equal(byteResult.ok, false);
  if (!byteResult.ok) assert.equal(byteResult.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
});

test('bounds 5000 levels iteratively in both the validator and public JSON schema', () => {
  let deep: unknown = {leaf: true};
  for (let index = 0; index < 5000; index += 1) deep = {next: deep};

  let validation: ReturnType<typeof validateTileflowAnnotations> | undefined;
  assert.doesNotThrow(() => {
    validation = validateTileflowAnnotations([{...annotation('deep'), data: deep}]);
  });
  assert.equal(validation?.ok, false);
  if (validation && !validation.ok) {
    assert.equal(validation.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
  }

  let parsed: ReturnType<typeof tileflowInteractionJsonValueSchema.safeParse> | undefined;
  assert.doesNotThrow(() => {
    parsed = tileflowInteractionJsonValueSchema.safeParse(deep);
  });
  assert.equal(parsed?.success, false);
});

test('rejects huge sparse arrays from bounded metadata without iterating their holes', () => {
  const sparse: unknown[] = [];
  sparse.length = 0xffff_ffff;

  let validation: ReturnType<typeof validateTileflowAnnotations> | undefined;
  assert.doesNotThrow(() => {
    validation = validateTileflowAnnotations(sparse);
  });
  assert.equal(validation?.ok, false);
  if (validation && !validation.ok) {
    assert.equal(validation.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
  }

  let parsed: ReturnType<typeof tileflowInteractionJsonValueSchema.safeParse> | undefined;
  assert.doesNotThrow(() => {
    parsed = tileflowInteractionJsonValueSchema.safeParse(sparse);
  });
  assert.equal(parsed?.success, false);
});

test('rejects a hostile shared DAG on repeated identity without expanding it', () => {
  let shared: Record<string, unknown> = {leaf: true};
  for (let index = 0; index < 5000; index += 1) {
    shared = {left: shared, right: shared};
  }

  let validation: ReturnType<typeof validateTileflowAnnotations> | undefined;
  assert.doesNotThrow(() => {
    validation = validateTileflowAnnotations([{...annotation('dag'), data: shared}]);
  });
  assert.equal(validation?.ok, false);
  if (validation && !validation.ok) {
    assert.equal(validation.diagnostics[0]?.code, 'INVALID_DOCUMENT');
  }

  let parsed: ReturnType<typeof tileflowInteractionJsonValueSchema.safeParse> | undefined;
  assert.doesNotThrow(() => {
    parsed = tileflowInteractionJsonValueSchema.safeParse(shared);
  });
  assert.equal(parsed?.success, false);
});

test('catches a final schema parser RangeError instead of leaking it', () => {
  const input = new Proxy([annotation('parse-trap')], {
    get(target, property, receiver) {
      if (property === '0') throw new RangeError('hostile parser access');
      return Reflect.get(target, property, receiver);
    },
  });

  let result: ReturnType<typeof validateTileflowAnnotations> | undefined;
  assert.doesNotThrow(() => {
    result = validateTileflowAnnotations(input);
  });
  assert.equal(result?.ok, false);
  if (result && !result.ok) assert.equal(result.diagnostics[0]?.code, 'INVALID_DOCUMENT');
});

test('rejects cyclic and otherwise non-JSON documents without reflecting their content', () => {
  const cyclic: Record<string, unknown> = {secret: 'do-not-reflect'};
  cyclic.self = cyclic;
  const result = validateTileflowAnnotations(cyclic);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.diagnostics, [
      {
        code: 'INVALID_DOCUMENT',
        level: 'error',
        message: 'Annotations must be a finite, acyclic JSON document.',
        path: '',
      },
    ]);
    assert.doesNotMatch(result.diagnostics[0]!.message, /do-not-reflect/u);
  }
});

test('rejects class instances, accessor properties, and prototype-mutating structures', () => {
  class ApplicationModel {
    value = 1;
  }
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      throw new Error('must not run');
    },
  });
  const mutatedPrototype = {safe: true};
  Object.setPrototypeOf(mutatedPrototype, {polluted: true});
  const base = {
    ariaLabel: 'Safe marker',
    coordinate: [0, 0],
    id: 'safe-marker',
    kind: 'marker',
  } as const;

  for (const data of [new ApplicationModel(), accessor, mutatedPrototype]) {
    const result = validateTileflowAnnotations([{...base, data}]);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.diagnostics[0]?.code, 'INVALID_DOCUMENT');
  }

  const mutatedArray = [1, 2];
  Object.setPrototypeOf(mutatedArray, {polluted: true});
  const arrayWithExtraKey = [1, 2] as number[] & {extra?: boolean};
  arrayWithExtraKey.extra = true;
  for (const data of [mutatedArray, arrayWithExtraKey]) {
    const result = validateTileflowAnnotations([{...base, data}]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0]?.code, 'INVALID_DOCUMENT');
  }
});

test('validates interaction bindings atomically and rejects duplicate IDs', () => {
  const valid = {
    id: 'poi-card',
    popup: {content: {kind: 'view', name: 'poi-card'}},
    target: {domain: 'poi', kind: 'semantic-feature'},
  } as const;
  const accepted = validateTileflowInteractionBindings([valid]);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.deepEqual(accepted.bindings, [valid]);

  const duplicate = validateTileflowInteractionBindings([
    valid,
    {
      ...valid,
      popup: {content: {...valid.popup.content}},
      target: {...valid.target},
    },
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.diagnostics[0]?.code, 'INVALID_DOCUMENT');
    assert.equal(duplicate.diagnostics[0]?.path, '/1/id');
  }
});
