import type {BoundaryValues} from './contract';
import {joinBoundaryRows} from './generated/boundary-join';
import {TileflowMapError} from './map-error';
import type {JsonObject} from './native-map-contract';

/** Adapt joined rows to the existing native whole-set replacement contract. */
export function boundaryValuesInput(values: BoundaryValues | null | undefined): JsonObject | null {
  if (values == null) return null;
  const metadata = {
    ...(values.labels === undefined ? {} : {labels: values.labels}),
    ...(values.state === undefined ? {} : {state: values.state}),
  };
  if (!('rows' in values)) {
    if (values.ids !== undefined) return {ids: values.ids, ...metadata};
    if (values.refs !== undefined) return {refs: values.refs, ...metadata};
    throw invalid();
  }

  if (values.joinBy !== 'id' && values.joinBy !== 'ref') throw invalid();
  const joined = joinBoundaryRows(values.rows, {joinBy: values.joinBy, to: values.joinBy});
  if (joined.unmatched.length) throw invalid();

  return {
    [values.joinBy === 'id' ? 'ids' : 'refs']: Object.fromEntries(
      joined.rows.filter((row) => row.value !== null).map((row) => [String(row.key), row.value]),
    ),
    ...metadata,
  };
}

function invalid() {
  return new TileflowMapError({
    code: 'invalidRequest',
    message: 'Boundary state requires rows joined to valid IDs or references.',
    recoverable: false,
  });
}
