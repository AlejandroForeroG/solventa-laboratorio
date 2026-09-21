import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverRead, RetryBudget, type ReadRecovery, type ReadAttempt } from '../shared/read-recovery';
import { databaseSession, databaseReadSession, type DatabaseTimings } from '../shared/database';
import { DatabaseFailure } from '../shared/dependency-error';
import { execute } from '../application/execute';
import { CircuitBreaker } from '../domain/breaker';
import { makeRun } from '../../experimentos/plan';
const policy = (signal = new AbortController().signal): ReadRecovery => ({ signal, deadlineAt: Date.now() + 500, firstAttemptMs: 25, retryDelayMs: 1, takeRetry: () => true });
const never = () => new Promise<never>(() => { });
test('second connection cancellation never inherits completed timing fields from the first attempt', async () => {
    const outer = new AbortController(), updates: DatabaseTimings[] = [];
    let clients = 0;
    const timer = setTimeout(() => outer.abort(Error('hard_deadline')), 150);
    try {
        await assert.rejects(databaseReadSession(() => {
            const id = ++clients;
            return { connect: never, end: async () => { if (id === 1)
                    await new Promise(r => setTimeout(r, 5)); } };
        }, never, { signal: outer.signal, timings: { stage: 'connect', startedAt: Date.now() }, onProgress: t => updates.push({ ...t }) }, policy(outer.signal)));
    }
    finally {
        clearTimeout(timer);
    }
    const next = updates.find(x => x.attempt === 2 && x.stage === 'connect' && x.cancelledAt === undefined);
    assert.ok(next);
    for (const key of ['connectMs', 'queryMs', 'closeMs', 'finishedAt', 'cancelledAt', 'cancelledStage'] as const)
        assert.equal(next[key], undefined, key);
    assert.equal(clients, 2);
});
test('stalled SELECT closes its connection before a fresh read and preserves both attempts', async () => {
    const lifecycle: string[] = [];
    const events: ReadAttempt[] = [];
    const result = await recoverRead((signal, attempt) => databaseSession({
        connect: async () => { lifecycle.push('connect' + attempt); }, end: async () => { lifecycle.push('close' + attempt); },
    }, async () => attempt === 1 ? never() : { allowed: false }, { signal }), { ...policy(), onAttempt: x => events.push(x) });
    assert.deepEqual(result, { allowed: false });
    assert.deepEqual(lifecycle, ['connect1', 'close1', 'connect2', 'close2']);
    assert.equal(events.find(x => x.attempt === 1 && x.finishedAt)?.code, 'SQL_ATTEMPT_TIMEOUT');
    assert.equal(events.at(-1)?.outcome, 'ok');
});
test('revocation after the failed first read remains denied with no protected access', async () => {
    for (const operation of ['quote', 'profile'] as const) {
        const run = makeRun('E08', { phase: 'diagnostic', sqlReadRetry: true });
        let calls = 0;
        const result = await execute(run, operation, 'revocation', {
            consent: { check: () => recoverRead(async (_signal, attempt) => {
                    if (attempt === 1)
                        throw new DatabaseFailure('connect', { code: 'ECONNRESET' });
                    return { allowed: false, reference: 'fresh-revoked', checkedAt: Date.now() };
                }, policy()) },
            provider: { read: async () => { calls++; throw Error('forbidden'); } },
            snapshots: { read: async () => { calls++; return null; } },
        }, { breaker: new CircuitBreaker(), inFlight: 0 });
        assert.equal(result.classification, 'denied');
        assert.equal(calls, 0);
        assert.equal(result.definitiveOffer, false);
    }
});
test('authentication, missing fixture, database overload and unknown failures are never retried', async () => {
    for (const error of [{ code: '28P01' }, { code: '42501' }, { code: '53300' }, Error('fixture_not_seeded'), Error('unknown')]) {
        let calls = 0;
        await assert.rejects(recoverRead(async () => { calls++; throw new DatabaseFailure('query', error); }, policy()));
        assert.equal(calls, 1);
    }
});
test('persistent failure makes at most two reads and cannot authorize consent', async () => {
    let calls = 0;
    const p = policy();
    await assert.rejects(recoverRead(async () => { calls++; throw new DatabaseFailure('query', { code: 'ECONNRESET' }); }, p));
    assert.equal(calls, 2);
});
test('outer deadline aborts active SQL without starting a retry', async () => {
    const outer = new AbortController();
    let calls = 0, closed = 0;
    const timer = setTimeout(() => outer.abort(Error('hard_deadline')), 10);
    try {
        await assert.rejects(recoverRead(signal => { calls++; return databaseSession({ connect: async () => { }, end: async () => { closed++; } }, never, { signal }); }, policy(outer.signal)), /hard_deadline/);
    }
    finally {
        clearTimeout(timer);
    }
    assert.equal(calls, 1);
    assert.equal(closed, 1);
});
test('retry admission and remaining deadline constrain amplification', async () => {
    for (const settings of [{ takeRetry: () => false }, { deadlineAt: Date.now() + 30 }]) {
        let calls = 0;
        await assert.rejects(recoverRead(async () => { calls++; throw new DatabaseFailure('connect', { code: 'ECONNRESET' }); }, { ...policy(), ...settings }));
        assert.equal(calls, 1);
    }
    const budget = new RetryBudget(), now = Date.now();
    assert.equal(budget.take(now), true);
    assert.equal(budget.take(now), true);
    assert.equal(budget.take(now), false);
    assert.equal(budget.take(now + 200), true);
});
test('cancellation during backoff clears the delay and does not start another SELECT', async () => {
    const outer = new AbortController();
    let calls = 0;
    await assert.rejects(recoverRead(async () => { calls++; setTimeout(() => outer.abort(Error('hard_deadline')), 10); throw new DatabaseFailure('connect', { code: 'ECONNRESET' }); }, { ...policy(outer.signal), retryDelayMs: 100 }), /hard_deadline/);
    assert.equal(calls, 1);
});
