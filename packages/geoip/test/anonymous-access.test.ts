import assert from 'node:assert/strict';
import test from 'node:test';
import {geolocate} from '../src/client';

const anonymousAvailable = {
  location: {countryCode: 'PT'},
  schemaVersion: 1,
  status: 'available',
  usage: {units: 0},
};

test('anonymous options post one empty request to the shared GeoIP endpoint', async () => {
  const requests: Request[] = [];
  await geolocate({
    apiUrl: 'https://api.example.test/root/',
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(anonymousAvailable);
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.example.test/root/v1/geoip');
  assert.deepEqual(await requests[0]?.json(), {});
});

test('rejects a mode or invalid present map ID before anonymous transport', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return Response.json(anonymousAvailable);
  };

  for (const options of [
    {mode: 'anonymous'},
    {mode: 'managed'},
    {mapId: undefined},
    {mapId: null},
    {mapId: 'map_too-short'},
  ]) {
    await assert.rejects(
      geolocate({...options, fetch: fetcher} as never),
      /Invalid Tileflow GeoIP options/u,
    );
  }
  assert.equal(calls, 0);
});
