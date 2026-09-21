import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../application/execute';
import { executionTelemetry } from '../shared/telemetry';
import { DependencyFailure } from '../shared/dependency-error';
import { CircuitBreaker } from '../domain/breaker';
import { makeRun } from '../../experimentos/plan';
test('snapshot store failure may yield explicitly marked no-data degradation after fresh consent only', async () => {
    for (const operation of ['quote', 'profile'] as const) {
        const run = makeRun('E07', { phase: 'diagnostic', snapshotFailureDegrade: true });
        const telemetry = executionTelemetry();
        const result = await execute(run, operation, 'outage', {
            consent: { check: async () => ({ allowed: true, reference: 'fresh', checkedAt: Date.now() }) },
            provider: { read: async () => { throw Error('provider_error'); } },
            snapshots: { read: async () => { throw new DependencyFailure('snapshot', { stage: 'connect', code: 'SNAPSHOT_BUDGET' }); } },
        }, { breaker: new CircuitBreaker(), inFlight: 0 }, Date.now, telemetry);
        assert.equal(result.classification, 'degraded');
        assert.equal(result.reason, 'snapshot_store_unavailable');
        assert.equal(result.source, null);
        assert.equal(result.score, undefined);
        assert.equal(result.premiumCop, undefined);
        assert.equal(result.definitiveOffer, false);
        assert.equal(telemetry.technicalDependencyFailure, true);
        assert.deepEqual(telemetry.snapshotFailure, { stage: 'connect', code: 'SNAPSHOT_BUDGET' });
    }
});
test('snapshot policy never converts failed or revoked consent into permissive degradation', async () => {
    for (const denied of [true, false]) {
        const run = makeRun('E08', { phase: 'diagnostic', snapshotFailureDegrade: true });
        let accesses = 0;
        const work = execute(run, 'quote', 'consent', {
            consent: { check: async () => { if (!denied)
                    throw Error('consent_unavailable'); return { allowed: false, reference: 'revoked', checkedAt: Date.now() }; } },
            provider: { read: async () => { accesses++; throw Error('forbidden'); } }, snapshots: { read: async () => { accesses++; return null; } },
        }, { breaker: new CircuitBreaker(), inFlight: 0 });
        if (denied)
            assert.equal((await work).classification, 'denied');
        else
            await assert.rejects(work, /consent_unavailable/);
        assert.equal(accesses, 0);
    }
});
test('formal runs and absent opt-in retain original snapshot failure; global deadline is never converted', async () => {
    for (const variant of ['formal', 'disabled', 'global'] as const) {
        const run = makeRun('E07', { phase: variant === 'formal' ? 'initial' : 'diagnostic', snapshotFailureDegrade: variant !== 'disabled' });
        const controller = new AbortController();
        const telemetry = executionTelemetry();
        await assert.rejects(execute(run, 'profile', 'failure', {
            consent: { check: async () => ({ allowed: true, reference: 'fresh', checkedAt: Date.now() }) },
            provider: { read: async () => { throw Error('provider_error'); } },
            snapshots: { read: async () => { if (variant === 'global')
                    controller.abort(Error('hard_deadline')); throw Error('store_failed'); } },
        }, { breaker: new CircuitBreaker(), inFlight: 0 }, Date.now, telemetry, controller.signal));
        assert.equal(telemetry.technicalDependencyFailure, undefined);
    }
});
