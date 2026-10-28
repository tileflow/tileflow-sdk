import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  createHostedNativeSessionController,
  HostedNativeSessionError,
} from '../src/session-controller';
import {
  apiOrigin,
  createClock,
  createIds,
  credential,
  mapId,
  response,
  success,
} from './session-fixture';

type Step = {
  op: string;
  milliseconds?: number;
  requests?: number;
  identity?: string;
  error?: string;
};
type Reply = {status: number; body?: unknown; headers?: Record<string, string>};
const scenarios = JSON.parse(
  readFileSync(new URL('./fixtures/native-session-sequences.json', import.meta.url), 'utf8'),
).scenarios as Array<{name: string; responses: Reply[]; steps: Step[]}>;
const errorCodes: Record<string, string> = {
  credentialRejected: 'NATIVE_SESSION_CREDENTIAL_REJECTED',
  accessDenied: 'NATIVE_SESSION_MAP_MISMATCH',
  quotaExceeded: 'NATIVE_SESSION_QUOTA_EXCEEDED',
  rateLimited: 'NATIVE_SESSION_RATE_LIMITED',
  sessionUnavailable: 'NATIVE_SESSION_UNAVAILABLE',
  invalidSessionResponse: 'NATIVE_SESSION_RESPONSE_INVALID',
};

for (const scenario of scenarios) {
  test(`shared session sequence: ${scenario.name}`, async () => {
    const clock = createClock();
    const requests: Array<{sessionId: string}> = [];
    const controller = createHostedNativeSessionController({
      binding: {kind: 'hosted', apiOrigin, credential, mapId, surfaceId: 'store-locator'},
      now: clock.now,
      sessionIdFactory: createIds(),
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body) as {sessionId: string};
        requests.push(body);
        // Each bootstrap takes the next reply; the last one repeats.
        const reply = scenario.responses[Math.min(requests.length, scenario.responses.length) - 1];
        const headers = {'cache-control': 'no-store', ...reply.headers};
        if (reply.status !== 201 || reply.body !== undefined) {
          return response(reply.status, reply.body ?? null, {headers});
        }
        return response(
          reply.status,
          success({
            sessionId: body.sessionId,
            issuedAt: clock.now().toISOString(),
            serverTime: clock.now().toISOString(),
            expiresAt: new Date(clock.value + 900_000).toISOString(),
          }),
          {headers},
        );
      },
    });
    const identities = new Map<string, string>();
    try {
      for (const step of scenario.steps) {
        if (step.op === 'advance') {
          clock.advance(step.milliseconds!);
          continue;
        }
        if (step.op === 'retry') {
          controller.retry!();
          continue;
        }
        if (step.error) {
          assert.ok(errorCodes[step.error], step.error);
          await assert.rejects(
            controller.acquire(),
            (error: unknown) =>
              error instanceof HostedNativeSessionError && error.code === errorCodes[step.error!],
          );
        } else {
          const authority = await controller.acquire();
          assert.ok(authority?.grant);
          assert.ok(controller.transportBudget(authority) > 0);
        }
        assert.equal(requests.length, step.requests);
        if (step.identity) {
          const id = requests.at(-1)!.sessionId;
          if (identities.has(step.identity)) assert.equal(id, identities.get(step.identity));
          else {
            assert.ok(![...identities.values()].includes(id));
            identities.set(step.identity, id);
          }
        }
      }
    } finally {
      controller.dispose();
    }
  });
}
