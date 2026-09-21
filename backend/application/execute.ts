import { decide, eligible } from '../domain/decision';
import type { ConsentPort, SnapshotPort, OpenFinancePort } from './ports';
import type { CircuitBreaker } from '../domain/breaker';
import type { Operation, Run } from '../shared/contracts';
import { executionTelemetry, type ExecutionTelemetry } from '../shared/telemetry';
import { untilAborted } from '../shared/deadline';
import { DependencyFailure } from '../shared/dependency-error';
export interface IsolateOperation {
    breaker: CircuitBreaker;
    inFlight: number;
}
export async function execute(run: Run, operation: Operation, requestId: string, ports: {
    consent: ConsentPort;
    snapshots: SnapshotPort;
    provider: OpenFinancePort;
}, state: IsolateOperation, now: () => number = Date.now, telemetry: ExecutionTelemetry = executionTelemetry(), signal?: AbortSignal) {
    signal?.throwIfAborted();
    telemetry.activeStage = 'consent';
    telemetry.consentStartedAt = now();
    const consent = await untilAborted(ports.consent.check(run), signal);
    telemetry.consentFinishedAt = now();
    signal?.throwIfAborted();
    if (!consent.allowed) {
        telemetry.activeStage = 'completed';
        return { ...decide(operation, consent, null, run.fixtureNow, false, 'consent_revoked'), providerAttempt: false, providerMs: 0, probe: false, snapshotRead: false };
    }
    let reason = 'bulkhead_full', providerMs = 0, providerAttempt = false, probe = false;
    if (state.inFlight < run.bulkhead) {
        const ticket = run.breakerEnabled ? state.breaker.acquire(now()) : { generation: 0, probe: false };
        reason = 'circuit_open';
        if (ticket) {
            signal?.throwIfAborted();
            probe = ticket.probe;
            state.inFlight++;
            providerAttempt = true;
            telemetry.activeStage = 'provider';
            telemetry.providerAttempt = true;
            telemetry.probe = probe;
            const controller = new AbortController();
            const start = now();
            telemetry.providerStartedAt = start;
            const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
            const onAbort = () => { telemetry.providerAbortAt = now(); telemetry.providerAbortCause = signal?.aborted ? 'hard_deadline' : 'deadline'; };
            combined.addEventListener('abort', onAbort, { once: true });
            const timer = setTimeout(() => controller.abort(new Error('deadline')), run.deadlineMs);
            try {
                const signals = await untilAborted(ports.provider.read(run, operation, requestId, combined), combined);
                signal?.throwIfAborted();
                providerMs = now() - start;
                if (controller.signal.aborted || providerMs > run.deadlineMs)
                    throw new Error('deadline');
                if (!eligible(signals, consent, run.fixtureNow))
                    throw new Error('invalid_signals');
                if (run.breakerEnabled)
                    state.breaker.complete(ticket, true, now());
                telemetry.activeStage = 'completed';
                return { ...decide(operation, consent, signals, run.fixtureNow, false, 'provider_ok'), providerAttempt, providerMs, probe, snapshotRead: false };
            }
            catch (error) {
                providerMs = now() - start;
                reason = controller.signal.aborted ? 'deadline' : error instanceof Error && ['invalid_signals', 'invalid_payload', 'provider_error', 'deadline'].includes(error.message) ? error.message : 'provider_error';
                if (run.breakerEnabled)
                    state.breaker.complete(ticket, false, now());
                signal?.throwIfAborted();
            }
            finally {
                telemetry.providerFinishedAt = now();
                clearTimeout(timer);
                combined.removeEventListener('abort', onAbort);
                state.inFlight--;
            }
        }
    }
    signal?.throwIfAborted();
    telemetry.activeStage = 'snapshot';
    telemetry.snapshotRead = true;
    telemetry.snapshotStartedAt = now();
    let snapshot;
    try {
        snapshot = await untilAborted(ports.snapshots.read(run), signal);
    }
    catch (error) {
        signal?.throwIfAborted();
        if (run.phase !== 'diagnostic' || !run.snapshotFailureDegrade)
            throw error;
        telemetry.technicalDependencyFailure = true;
        telemetry.snapshotFailure = error instanceof DependencyFailure ? error.diagnostic : { stage: 'unknown', code: 'UNKNOWN' };
        telemetry.snapshotFinishedAt = now();
        telemetry.activeStage = 'completed';
        return { ...decide(operation, consent, null, run.fixtureNow, true, 'snapshot_store_unavailable'), reason: 'snapshot_store_unavailable', providerAttempt, providerMs, probe, snapshotRead: true };
    }
    telemetry.snapshotFinishedAt = now();
    signal?.throwIfAborted();
    telemetry.activeStage = 'completed';
    return { ...decide(operation, consent, snapshot, run.fixtureNow, true, reason), providerAttempt, providerMs, probe, snapshotRead: true };
}
