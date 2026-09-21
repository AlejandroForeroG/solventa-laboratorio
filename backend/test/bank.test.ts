import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../domain/breaker';
import { decide } from '../domain/decision';
import { execute } from '../application/execute';
import { consentFixture, snapshotFixture } from '../shared/fixtures';
import { providerCondition, measuredStart, signalsSchema } from '../shared/contracts';
import { makeRun } from '../../experimentos/plan';
import { withinDeadline } from '../shared/deadline';
test('hard deadline cancels transport and does not wait for an unresponsive dependency', async () => {
    let aborted = false;
    await assert.rejects(withinDeadline(20, signal => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); })), /hard_deadline/);
    assert.equal(aborted, true);
});
test('breaker opens only after minimum samples, rejects late completions and respects rolling probe cap', () => {
    const b = new CircuitBreaker();
    const stale = b.acquire(0)!;
    for (let i = 0; i < 9; i++) {
        const t = b.acquire(i)!;
        b.complete(t, false, i);
    }
    assert.equal(b.state, 'closed');
    b.complete(b.acquire(10)!, false, 10);
    assert.equal(b.state, 'open');
    b.complete(stale, true, 11);
    assert.equal(b.state, 'open');
    assert.equal(b.acquire(30009), null);
    const first = b.acquire(30010)!;
    assert.equal(first.probe, true);
    assert.equal(b.acquire(30011), null);
    b.complete(first, true, 30020);
    const second = b.acquire(30021)!;
    b.complete(second, true, 30030);
    assert.equal(b.acquire(30031), null);
    for (const now of [60010, 60021, 90010]) {
        const t = b.acquire(now)!;
        b.complete(t, true, now);
    }
    assert.equal(b.state, 'closed');
});
test('failed half-open probe restarts consecutive success count', () => {
    const b = new CircuitBreaker();
    for (let i = 0; i < 10; i++)
        b.complete(b.acquire(i)!, false, i);
    b.complete(b.acquire(30010)!, true, 30010);
    b.complete(b.acquire(30011)!, false, 30011);
    assert.equal(b.state, 'open');
    for (const now of [60011, 60012, 90011, 90012])
        b.complete(b.acquire(now)!, true, now);
    assert.equal(b.state, 'half_open');
    b.complete(b.acquire(120011)!, true, 120011);
    assert.equal(b.state, 'closed');
});
test('samples older than thirty seconds do not trigger opening', () => {
    const b = new CircuitBreaker();
    for (let i = 0; i < 9; i++)
        b.complete(b.acquire(i)!, false, i);
    b.complete(b.acquire(40000)!, false, 40000);
    assert.equal(b.state, 'closed');
});
test('expired, absent and revoked signals never create an offer', () => {
    for (const fixture of ['expired', 'absent', 'revoked'] as const) {
        const r = makeRun('E07', { fixture });
        const result = decide('quote', consentFixture(r), snapshotFixture(r), r.fixtureNow, true, 'deadline');
        assert.equal(result.definitiveOffer, false);
        assert.equal(result.source, null);
        assert.equal(result.score, undefined);
    }
});
test('E08 does not query snapshots or provider; audit classification is denied', async () => {
    const r = makeRun('E08');
    const result = await execute(r, 'quote', 'one', {
        consent: { check: async () => consentFixture(r) },
        snapshots: { read: async () => { throw new Error('must not read snapshot'); } },
        provider: { read: async () => { throw new Error('must not call provider'); } },
    }, { breaker: new CircuitBreaker(), inFlight: 0 });
    assert.equal(result.classification, 'denied');
    assert.equal(result.providerAttempt, false);
    assert.equal(result.snapshotRead, false);
});
test('deadline aborts provider, releases bulkhead and uses only eligible fallback', async () => {
    const r = makeRun('E03', { deadlineMs: 80 });
    let aborted = false;
    const state = { breaker: new CircuitBreaker(), inFlight: 0 };
    const result = await execute(r, 'quote', 'one', {
        consent: { check: async () => consentFixture(r) }, snapshots: { read: async () => snapshotFixture(r) },
        provider: { read: async (_r, _op, _id, signal) => new Promise((_ok, fail) => signal.addEventListener('abort', () => { aborted = true; fail(new Error('aborted')); }, { once: true })) },
    }, state);
    assert.equal(aborted, true);
    assert.equal(state.inFlight, 0);
    assert.equal(result.classification, 'degraded');
    assert.equal(result.reason, 'deadline');
    assert.equal(result.definitiveOffer, false);
});
test('bulkhead rejects without queue or outgoing call', async () => {
    const r = makeRun('E01', { bulkhead: 1 });
    let calls = 0;
    const result = await execute(r, 'quote', 'one', { consent: { check: async () => consentFixture(r) }, snapshots: { read: async () => snapshotFixture(r) }, provider: { read: async () => { calls++; throw new Error('unexpected'); } } }, { breaker: new CircuitBreaker(), inFlight: 1 });
    assert.equal(calls, 0);
    assert.equal(result.reason, 'bulkhead_full');
});
test('provider payload rejects external schema drift', () => {
    assert.equal(signalsSchema.safeParse({ invalid: true }).success, false);
    const run = makeRun('E01');
    const s = snapshotFixture(run)!;
    assert.equal(signalsSchema.safeParse({ ...s, score: 101 }).success, false);
});
test('failure and recovery schedules use real elapsed time without resetting the breaker', () => {
    const r = makeRun('E06');
    assert.equal(providerCondition(r, r.startAt).errorRate, 0);
    assert.equal(providerCondition(r, r.startAt + r.warmupMs).errorRate, 1);
    assert.equal(providerCondition(r, measuredStart(r)).errorRate, 0);
    const outage = makeRun('E05');
    assert.equal(providerCondition(outage, outage.startAt).errorRate, 0);
    assert.equal(providerCondition(outage, measuredStart(outage)).errorRate, 1);
});
