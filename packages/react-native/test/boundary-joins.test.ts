import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  createBoundaryLookup,
  joinBoundaryRows,
  type JoinBoundaryRowsOptions,
  parseBoundaryLookupCsv,
  type TileflowBoundaryLookupRow,
  type TileflowBoundaryRow,
} from '../src/generated/boundary-join';

type Case = {
  name: string;
  rows: TileflowBoundaryRow[];
  options: JoinBoundaryRowsOptions;
  lookup?: string | TileflowBoundaryLookupRow[];
  csv?: string;
  parsed?: TileflowBoundaryLookupRow[];
  expected?: unknown;
  error?: string;
};

const fixture = JSON.parse(
  readFileSync(new URL('../../../platforms/boundary-joins.json', import.meta.url), 'utf8'),
) as {lookups: Record<string, TileflowBoundaryLookupRow[]>; cases: Case[]};

for (const scenario of fixture.cases) {
  test(`boundary join parity: ${scenario.name}`, () => {
    const run = () => {
      const rows =
        scenario.csv === undefined
          ? typeof scenario.lookup === 'string'
            ? fixture.lookups[scenario.lookup]
            : scenario.lookup
          : parseBoundaryLookupCsv(scenario.csv);

      if (scenario.parsed !== undefined) assert.deepEqual(rows, scenario.parsed);

      return joinBoundaryRows(scenario.rows, {
        ...scenario.options,
        ...(rows === undefined ? {} : {lookup: createBoundaryLookup(rows)}),
      });
    };

    if (scenario.error !== undefined) {
      assert.throws(run);
    } else {
      // Compare the JSON values shared by all native bridges, including negative zero.
      assert.deepEqual(JSON.parse(JSON.stringify(run())), scenario.expected);
    }
  });
}
