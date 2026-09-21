import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../application/execute';
import { CircuitBreaker } from '../domain/breaker';
import { makeRun } from '../../experimentos/plan';
import { consentFixture, snapshotFixture } from '../shared/fixtures';
import { executionTelemetry, telemetrySnapshot } from '../shared/telemetry';
import { withinDeadline } from '../shared/deadline';
import { databaseSession, type DatabaseTimings } from '../shared/database';
import app from '../acquisition/index';
import { z } from 'zod';
const never = () => new Promise<never>(() => { });
test('every scenario stops after cancelled consent and never queries provider or snapshot', async () => {
    for (const caseId of ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10'] as const) {
        const run = makeRun(caseId), t = executionTelemetry(), state = { breaker: new CircuitBreaker(), inFlight: 0 };
        let calls = 0;
        await assert.rejects(withinDeadline(5, signal => execute(run, 'quote', 'cancel', {
            consent: { check: never }, provider: { read: async () => { calls++; throw Error('unexpected'); } }, snapshots: { read: async () => { calls++; return null; } },
        }, state, Date.now, t, signal)), /hard_deadline/);
        assert.equal(calls, 0, caseId);
        assert.equal(t.providerAttempt, false);
        assert.equal(t.snapshotRead, false);
        assert.equal(t.activeStage, 'consent');
    }
});
test('global cancellation during provider retains attempt and releases bulkhead without fallback', async () => {
    for (const operation of ['quote', 'profile'] as const) {
        const run = makeRun('E01'), t = executionTelemetry(), state = { breaker: new CircuitBreaker(), inFlight: 0 };
        let snapshots = 0;
        await assert.rejects(withinDeadline(10, signal => execute(run, operation, 'received', {
            consent: { check: async () => consentFixture(run) }, provider: { read: async () => { t.providerDispatched = true; t.providerDispatchedAt = Date.now(); return never(); } },
            snapshots: { read: async () => { snapshots++; return snapshotFixture(run); } },
        }, state, Date.now, t, signal)), /hard_deadline/);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(state.inFlight, 0);
        assert.equal(snapshots, 0);
        assert.equal(t.providerAttempt, true);
        assert.equal(t.providerDispatched, true);
        assert.equal(t.providerAbortCause, 'hard_deadline');
        assert.ok(telemetrySnapshot(t, Date.now()).providerMs >= 0);
    }
});
test('cancelled fallback keeps the failed provider attempt for expired and absent E07', async () => {
    for (const fixture of ['expired', 'absent'] as const) {
        const run = makeRun('E07', { fixture }), t = executionTelemetry();
        await assert.rejects(withinDeadline(10, signal => execute(run, 'profile', 'fallback', {
            consent: { check: async () => consentFixture(run) }, provider: { read: async () => { throw Error('provider_error'); } }, snapshots: { read: never },
        }, { breaker: new CircuitBreaker(), inFlight: 0 }, Date.now, t, signal)), /hard_deadline/);
        assert.equal(t.providerAttempt, true);
        assert.equal(t.snapshotRead, true);
        assert.equal(t.activeStage, 'snapshot');
    }
});
test('all operational deadlines cut a port that ignores cancellation', async () => {
    for (const deadlineMs of [80, 120, 160] as const) {
        const run = makeRun('E03', { deadlineMs }), t = executionTelemetry(), state = { breaker: new CircuitBreaker(), inFlight: 0 };
        const result = await execute(run, 'quote', 'slow', { consent: { check: async () => consentFixture(run) }, provider: { read: never }, snapshots: { read: async () => snapshotFixture(run) } }, state, Date.now, t);
        assert.equal(result.classification, 'degraded');
        assert.equal(result.reason, 'deadline');
        assert.equal(state.inFlight, 0);
        assert.equal(t.providerAbortCause, 'deadline');
    }
});
test('normal, provider errors and E07/E08 retain expected decisions in both endpoints', async () => {
    for (const operation of ['quote', 'profile'] as const)
        for (const caseId of ['E01', 'E02', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10'] as const) {
            for (const fixture of caseId === 'E07' ? ['expired', 'absent'] as const : [caseId === 'E08' ? 'revoked' : 'valid'] as const) {
                const run = makeRun(caseId, { fixture }), t = executionTelemetry();
                let provider = 0, snapshot = 0;
                const result = await execute(run, operation, 'matrix', {
                    consent: { check: async () => consentFixture(run) },
                    provider: { read: async () => { provider++; if (['E04', 'E05', 'E07', 'E09'].includes(caseId))
                            throw Error('provider_error'); return { ...snapshotFixture(run)!, source: 'open-finance' }; } },
                    snapshots: { read: async () => { snapshot++; return snapshotFixture(run); } },
                }, { breaker: new CircuitBreaker(), inFlight: 0 }, Date.now, t);
                if (caseId === 'E08') {
                    assert.equal(result.classification, 'denied');
                    assert.equal(provider, 0);
                    assert.equal(snapshot, 0);
                }
                else if (['E04', 'E05', 'E07', 'E09'].includes(caseId)) {
                    assert.equal(result.classification, 'degraded');
                    assert.equal(t.snapshotRead, true);
                }
                else
                    assert.equal(result.classification, 'normal');
                if (caseId === 'E07') {
                    assert.equal(result.definitiveOffer, false);
                    assert.equal(result.source, null);
                }
            }
        }
});
test('SQL cancellation records the exact stage and closes only once', async () => {
    for (const stage of ['connect', 'query', 'close'] as const) {
        const t: DatabaseTimings = { stage: 'connect', startedAt: Date.now() }, controller = new AbortController();
        let closes = 0, queries = 0;
        const session = { connect: async () => stage === 'connect' ? never() : undefined, end: async () => { closes++; if (stage === 'close')
                await new Promise(resolve => setTimeout(resolve, 15)); } };
        const timer = setTimeout(() => controller.abort(), 5);
        const work = databaseSession(session, async () => { queries++; return stage === 'query' ? never() : 42; }, { signal: controller.signal, timings: t });
        if (stage === 'close')
            await work;
        else
            await assert.rejects(work, /database_failure/);
        clearTimeout(timer);
        assert.equal(t.cancelledStage, stage);
        assert.equal(closes, 1);
        assert.equal(queries, stage === 'connect' ? 0 : 1);
        assert.equal(t.stage, 'completed');
        assert.ok(t.finishedAt);
    }
});
test('Acquisition error response and stored API event keep cancellation context', async () => {
    const run = makeRun('E01', { startAt: Date.now() - 100, warmupMs: 0 }), events: Record<string, unknown>[] = [];
    const pending: Promise<unknown>[] = [];
    const testToken = 'synthetic-test-token-no-secret-00001';
    const env = { BANK_TOKEN: testToken, BANK_MODE: 'local-memory', IDENTITY: { fetch: async () => Response.json(consentFixture(run)) }, SIMULATOR: { fetch: async (input: string, init: RequestInit) => {
                if (input.includes('/record')) {
                    const item = JSON.parse(String(init.body));
                    if (item.kind === 'api')
                        events.push(item.event);
                    return Response.json({ recorded: true });
                }
                return never();
            } } };
    env.IDENTITY.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 650)); return Response.json(consentFixture(run)); };
    const response = await app.request('/v1/quote', { method: 'POST', headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ run, requestId: 'quote-cancel', emittedAt: Date.now() }) }, env, { waitUntil: p => pending.push(p), passThroughOnException: () => { }, props: {} });
    const body = z.record(z.string(), z.unknown()).parse(await response.json());
    await Promise.all(pending);
    assert.equal(response.status, 503);
    assert.equal(body.reason, 'hard_deadline');
    assert.equal(body.providerAttempt, true);
    assert.equal(body.providerDispatched, true);
    assert.equal(body.cancelledStage, 'provider');
    assert.equal(body.snapshotRead, false);
    assert.ok(body.emittedAt);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], body);
});
