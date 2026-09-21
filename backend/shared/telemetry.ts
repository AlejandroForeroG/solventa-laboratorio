export type ExecutionStage = 'consent' | 'provider' | 'snapshot' | 'completed';
export interface ExecutionTelemetry {
    instrumentationVersion: 2;
    activeStage: ExecutionStage;
    providerAttempt: boolean;
    providerDispatched: boolean;
    snapshotRead: boolean;
    probe: boolean;
    consentStartedAt?: number;
    consentFinishedAt?: number;
    providerStartedAt?: number;
    providerDispatchedAt?: number;
    providerResponseAt?: number;
    providerFinishedAt?: number;
    providerAbortAt?: number;
    providerAbortCause?: 'deadline' | 'hard_deadline';
    snapshotStartedAt?: number;
    snapshotFinishedAt?: number;
    cancelledAt?: number;
    cancelledStage?: ExecutionStage;
    technicalDependencyFailure?: boolean;
    snapshotFailure?: {
        stage: string;
        code: string;
    };
}
export function executionTelemetry(): ExecutionTelemetry {
    return { instrumentationVersion: 2, activeStage: 'consent', providerAttempt: false, providerDispatched: false, snapshotRead: false, probe: false };
}
export function telemetrySnapshot(t: ExecutionTelemetry, at: number) {
    return { ...t, providerMs: t.providerStartedAt === undefined ? 0 : (t.providerFinishedAt ?? at) - t.providerStartedAt,
        consentMs: t.consentStartedAt === undefined ? 0 : (t.consentFinishedAt ?? at) - t.consentStartedAt,
        snapshotMs: t.snapshotStartedAt === undefined ? 0 : (t.snapshotFinishedAt ?? at) - t.snapshotStartedAt };
}
