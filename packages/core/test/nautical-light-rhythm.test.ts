import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type TileflowLightCharacteristic,
  type TileflowLightRhythm,
  tileflowLightRhythm,
  tileflowLightRhythmConventions,
  tileflowLightStateAt,
} from '../src/nautical-light-rhythm';

const fixed = tileflowLightRhythmConventions.fixedIntensity;

/** Phases as `light` and `(eclipse)` durations, like the `sequence` field. */
function phasesOf(light: TileflowLightCharacteristic): string | undefined {
  const rhythm = tileflowLightRhythm(light);
  return rhythm ? describe(rhythm) : undefined;
}

function describe(rhythm: TileflowLightRhythm): string {
  return rhythm.phases
    .map(({colour, duration, intensity}) => {
      const text =
        intensity === 1 ? `${duration}` : intensity === 0 ? `(${duration})` : `[${duration}]`;
      return colour === 0 ? text : `${text}#${colour}`;
    })
    .join('+');
}

test('a published sequence wins over the character and keeps its phases', () => {
  assert.equal(
    phasesOf({character: 'Fl', group: '3', period_s: 9, sequence: '0.5+(1.5)+0.5+(1.5)+0.5+(4.5)'}),
    '0.5+(1.5)+0.5+(1.5)+0.5+(4.5)',
  );
  assert.equal(phasesOf({character: 'Oc', period_s: 6, sequence: '4.3+(1.7)'}), '4.3+(1.7)');
  // A sequence may start with an eclipse.
  assert.equal(phasesOf({character: 'Oc', group: '2', sequence: '(5)+1+(1)+1'}), '(5)+1+(1)+1');
  // Equal neighbours merge, including across the end of the cycle.
  assert.equal(phasesOf({character: 'Fl', sequence: '(1)+0.5+(3.5)'}), '(4.5)+0.5');
  const rhythm = tileflowLightRhythm({character: 'Fl', sequence: ' 1.5 + ( 1.5 ) '})!;
  assert.equal(rhythm.period, 3);
  assert.equal(rhythm.key, '1500:1:0,1500:0:0');
});

test('malformed sequences fall back to the characteristic', () => {
  for (const sequence of [
    '',
    '1+',
    '1+(2',
    '1+((2))',
    '-1+(2)',
    '0+(2)',
    'a+(2)',
    '1+2',
    '(1)+(2)',
    `${'1+(1)+'.repeat(200)}1`,
    42,
  ]) {
    assert.equal(
      phasesOf({character: 'Fl', period_s: 5, sequence}),
      '1+(4)',
      JSON.stringify(sequence),
    );
  }
});

test('flashing lights derive a conventional flash and eclipse from their period', () => {
  assert.equal(phasesOf({character: 'Fl', period_s: 5}), '1+(4)');
  assert.equal(phasesOf({character: 'Fl', period_s: 2}), '0.6+(1.4)');
  assert.equal(phasesOf({character: 'Fl', group: '2', period_s: 10}), '1+(2)+1+(6)');
  assert.equal(phasesOf({character: 'Fl', group: '3', period_s: 15}), '1+(2)+1+(2)+1+(8)');
  // Short periods shorten the flash and its gaps.
  assert.equal(
    phasesOf({character: 'Fl', group: '3', period_s: 9}),
    '0.9+(1.26)+0.9+(1.26)+0.9+(3.78)',
  );
  // Numeric groups and periods given as text are accepted.
  assert.equal(phasesOf({character: 'Fl', group: 2, period_s: '10'}), '1+(2)+1+(6)');
});

test('composite groups separate their groups by a longer eclipse', () => {
  assert.equal(phasesOf({character: 'Fl', group: '2+1', period_s: 15}), '1+(2)+1+(4)+1+(6)');
  assert.equal(phasesOf({character: 'Oc', group: '2+1', period_s: 12}), '(1)+1.5+(1)+3+(1)+4.5');
});

test('long flashes last two seconds', () => {
  assert.equal(phasesOf({character: 'LFl', period_s: 8}), '2+(6)');
  assert.equal(phasesOf({character: 'LFl', group: '2', period_s: 15}), '2+(2.75)+2+(8.25)');
  // A period too short for a two-second flash keeps the light shorter than the eclipse.
  assert.equal(phasesOf({character: 'LFl', period_s: 3}), '0.9+(2.1)');
});

test('quick lights flash 60, 120 and 240 times a minute, continuously or in groups', () => {
  assert.equal(phasesOf({character: 'Q'}), '0.3+(0.7)');
  assert.equal(phasesOf({character: 'VQ'}), '0.15+(0.35)');
  assert.equal(phasesOf({character: 'UQ'}), '0.075+(0.175)');
  assert.equal(
    phasesOf({character: 'Q', group: '3', period_s: 10}),
    '0.3+(0.7)+0.3+(0.7)+0.3+(7.7)',
  );
  // Cardinal marks without a published period use the IALA periods.
  assert.equal(tileflowLightRhythm({character: 'Q', group: '9'})?.period, 15);
  assert.equal(tileflowLightRhythm({character: 'VQ', group: '3'})?.period, 5);
  assert.equal(phasesOf({character: 'Q', group: '1'}), '0.3+(0.7)');
  // A group that does not fit its period is not drawn.
  assert.equal(phasesOf({character: 'Q', group: '9', period_s: 5}), undefined);
  assert.equal(phasesOf({character: 'Q', group: '4'}), undefined);
});

test('interrupted quick lights flash for most of the period, then pause', () => {
  const rhythm = tileflowLightRhythm({character: 'IQ', period_s: 10})!;
  assert.equal(rhythm.phases.filter(({intensity}) => intensity === 1).length, 6);
  assert.equal(rhythm.phases.at(-1)?.duration, 4.7);
  assert.equal(rhythm.period, 10);
  assert.equal(
    tileflowLightRhythm({character: 'IVQ', period_s: 10})!.phases.filter(
      ({intensity}) => intensity === 1,
    ).length,
    12,
  );
  assert.equal(phasesOf({character: 'IQ'}), undefined);
});

test('isophase and occulting lights keep their light at least as long as the eclipse', () => {
  assert.equal(phasesOf({character: 'Iso', period_s: 4}), '2+(2)');
  assert.equal(phasesOf({character: 'Oc', period_s: 4}), '(1)+3');
  assert.equal(phasesOf({character: 'Oc', period_s: 10}), '(2.5)+7.5');
  assert.equal(phasesOf({character: 'Oc', group: '2', period_s: 12}), '(1.5)+2.25+(1.5)+6.75');
  assert.equal(phasesOf({character: 'Oc+Fl', period_s: 10}), '(2.5)+7.5');
  assert.equal(phasesOf({character: 'Iso'}), undefined);
});

test('Morse lights spell their letter with dots, dashes and gaps', () => {
  // U is dot, dot, dash.
  assert.equal(
    phasesOf({character: 'Mo', group: 'U', period_s: 15}),
    '0.5+(0.5)+0.5+(0.5)+1.5+(11.5)',
  );
  // A is dot, dash; without a period, a seven-unit eclipse follows.
  assert.equal(phasesOf({character: 'Mo', group: 'a'}), '0.5+(0.5)+1.5+(3.5)');
  // Two letters are separated by three units.
  assert.equal(phasesOf({character: 'Mo', group: 'ET', period_s: 6}), '0.5+(1.5)+1.5+(2.5)');
  // A short period shortens the unit so the letter fits.
  assert.equal(
    phasesOf({character: 'Mo', group: 'U', period_s: 5}),
    '0.5+(0.5)+0.5+(0.5)+1.5+(1.5)',
  );
  assert.equal(
    phasesOf({character: 'Mo', group: 'D', period_s: 4}),
    '1.2+(0.4)+0.4+(0.4)+0.4+(1.2)',
  );
  for (const group of ['', '?', 'ABCDE']) {
    assert.equal(phasesOf({character: 'Mo', group, period_s: 15}), undefined, group);
  }
});

test('fixed-and-flashing lights stay lit between brighter flashes', () => {
  assert.equal(phasesOf({character: 'FFl', period_s: 30}), '1+[29]');
  assert.equal(phasesOf({character: 'FFl', group: '3', period_s: 30}), '1+[2]+1+[2]+1+[23]');
  assert.equal(phasesOf({character: 'F+LFl', period_s: 10}), '2+[8]');
  // A published sequence keeps the fixed light during its parenthesised phases.
  const rhythm = tileflowLightRhythm({character: 'FFl', sequence: '1+(9)'})!;
  assert.equal(rhythm.phases[1]?.intensity, fixed);
});

test('quick or flashing groups followed by a long flash', () => {
  assert.equal(
    phasesOf({character: 'Q+LFl', group: '6', period_s: 15}),
    '0.3+(0.7)+0.3+(0.7)+0.3+(0.7)+0.3+(0.7)+0.3+(0.7)+0.3+(0.7)+2+(7)',
  );
  // South cardinal marks without a group or period use six flashes and the IALA period.
  assert.equal(tileflowLightRhythm({character: 'VQ+LFl'})?.period, 10);
  assert.equal(phasesOf({character: 'Fl+LFl', group: '2', period_s: 15}), '1+(2)+1+(2)+2+(7)');
  assert.equal(phasesOf({character: 'Fl+LFl'}), undefined);
  assert.equal(phasesOf({character: 'Q+LFl', group: '6', period_s: 8}), undefined);
});

test('alternating lights alternate the colours of color per lit phase', () => {
  // Al.Fl WR: one flash per period, so the colours alternate over two periods.
  assert.equal(phasesOf({character: 'Al.Fl', color: 'white,red', period_s: 4}), '1+(3)+1#1+(3)');
  // Al alone shows each colour for an equal share of the period.
  assert.equal(phasesOf({character: 'Al', color: 'green,white', period_s: 5}), '2.5+2.5#1');
  assert.equal(
    phasesOf({character: 'Al.Oc', color: 'white,red,green', period_s: 4}),
    '(1)+3+(1)+3#1+(1)+3#2',
  );
  // A sequence alternates the same way.
  assert.equal(
    phasesOf({character: 'Al.Fl', color: 'white,red', group: '2', sequence: '1+(1)+1+(5)'}),
    '1+(1)+1#1+(5)',
  );
  // One colour, or no period for Al alone, leaves nothing to alternate.
  assert.equal(phasesOf({character: 'Al.Fl', color: 'white', period_s: 4}), '1+(3)');
  assert.equal(phasesOf({character: 'Al', color: 'white,green'}), undefined);
  // Lights that only list several colours, such as sectors, keep their first colour.
  assert.equal(phasesOf({character: 'Fl', color: 'white,red', period_s: 4}), '1+(3)');
});

test('fixed lights and unusable characteristics stay steady', () => {
  for (const light of [
    {},
    {character: 'F'},
    {character: 'F', period_s: 5},
    {character: 'Fl'},
    {character: 'Fl', period_s: 0},
    {character: 'Fl', period_s: -4},
    {character: 'Fl', period_s: Number.NaN},
    {character: 'Fl', group: '0', period_s: 5},
    {character: 'Fl', group: '2+x', period_s: 5},
    {character: 'Fl', group: '40', period_s: 500},
    {character: 'Fl', group: '9', period_s: 0.5},
    {character: 'Blink', period_s: 5},
    {character: 42, period_s: 5},
    {character: 'Fl', period_s: 1_000},
    {sequence: '5'},
    {sequence: '(5)'},
  ] satisfies TileflowLightCharacteristic[]) {
    assert.equal(tileflowLightRhythm(light), undefined, JSON.stringify(light));
  }
});

test('equal rhythms share a key and differ from other rhythms', () => {
  const derived = tileflowLightRhythm({character: 'Fl', group: '2', period_s: 10})!;
  const published = tileflowLightRhythm({character: 'Fl', sequence: '1+(2)+1+(6)'})!;
  assert.equal(derived.key, published.key);
  assert.notEqual(derived.key, tileflowLightRhythm({character: 'Fl', period_s: 10})!.key);
  assert.ok(Object.isFrozen(derived) && Object.isFrozen(derived.phases));
});

test('reads the state at any moment and the time left in its phase', () => {
  const rhythm = tileflowLightRhythm({character: 'Fl', group: '2', period_s: 10})!;
  assert.deepEqual(tileflowLightStateAt(rhythm, 0), {colour: 0, intensity: 1, remaining: 1});
  assert.deepEqual(tileflowLightStateAt(rhythm, 0.25), {colour: 0, intensity: 1, remaining: 0.75});
  assert.deepEqual(tileflowLightStateAt(rhythm, 1), {colour: 0, intensity: 0, remaining: 2});
  assert.deepEqual(tileflowLightStateAt(rhythm, 3.5), {colour: 0, intensity: 1, remaining: 0.5});
  assert.deepEqual(tileflowLightStateAt(rhythm, 9.999), {
    colour: 0,
    intensity: 0,
    remaining: 0.001,
  });
  // The cycle repeats from a shared epoch, also before it.
  assert.deepEqual(tileflowLightStateAt(rhythm, 13.5), tileflowLightStateAt(rhythm, 3.5));
  assert.deepEqual(tileflowLightStateAt(rhythm, -6.5), tileflowLightStateAt(rhythm, 3.5));
  assert.deepEqual(tileflowLightStateAt(rhythm, Number.NaN), tileflowLightStateAt(rhythm, 0));

  const alternating = tileflowLightRhythm({character: 'Al', color: 'red,green', period_s: 2})!;
  assert.equal(tileflowLightStateAt(alternating, 0.5).colour, 0);
  assert.equal(tileflowLightStateAt(alternating, 1.5).colour, 1);
});
