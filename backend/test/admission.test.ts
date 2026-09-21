import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../acquisition/index';
import { makeRun } from '../../experimentos/plan';
test('late and outside-window requests retain a correlated API event without accessing protected data', async () => {
    for (const scenario of ['late', 'pending', 'finished']) {
        const now = Date.now(), events: Record<string, unknown>[] = [], pending: Promise<unknown>[] = [];
        const run = makeRun('E01', { startAt: scenario === 'pending' ? now + 1000 : now - 10000, warmupMs: 0, measuredMs: scenario === 'finished' ? 1000 : 20000 });
        const token = 'synthetic-admission-test-token-000001';
        let dependencyCalls = 0;
        const env = { BANK_TOKEN: token, BANK_MODE: 'local-memory', IDENTITY: { fetch: async () => { dependencyCalls++; throw Error('unexpected'); } }, SIMULATOR: { fetch: async (path: string, init: RequestInit) => {
                    assert.ok(path.endsWith('/record'));
                    events.push(JSON.parse(String(init.body)).event);
                    return Response.json({ recorded: true });
                } } };
        const response = await app.request('/v1/quote', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ run, requestId: 'quote-' + scenario, emittedAt: scenario === 'late' ? now - 6000 : now }) }, env, { waitUntil: p => pending.push(p), passThroughOnException: () => { }, props: {} });
        const body = await response.json();
        await Promise.all(pending);
        assert.equal(response.status, 409);
        assert.equal(dependencyCalls, 0);
        assert.equal(events.length, 1);
        assert.deepEqual(events[0], body);
        assert.equal(events[0].providerAttempt, false);
        assert.equal(events[0].snapshotRead, false);
        assert.equal(events[0].activeStage, 'admission');
    }
});
