const codes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', '53300', '57P01', '40001', '42501', '28P01', '23505']);
export type FailureStage = 'connect' | 'query' | 'close' | 'http' | 'unknown';
export function safeErrorCode(error: unknown): string {
    const value = error as {
        code?: unknown;
        message?: unknown;
        name?: unknown;
    } | null;
    if (typeof value?.message === 'string' && /^remote wall time is too far ahead .* to be trustworthy$/.test(value.message))
        return 'CLOCK_OFFSET';
    if (typeof value?.code === 'string' && (codes.has(value.code) || /^[0-9]{2}[A-Z0-9]{3}$/.test(value.code)))
        return value.code;
    if (value?.message === 'fixture_not_seeded')
        return 'FIXTURE_NOT_SEEDED';
    if (typeof value?.message === 'string' && /Connection terminated/i.test(value.message))
        return 'CONNECTION_TERMINATED';
    if (value?.message === 'Query read timeout')
        return 'QUERY_TIMEOUT';
    if (value?.name === 'AbortError')
        return 'ABORTED';
    return 'UNKNOWN';
}
export class DatabaseFailure extends Error {
    readonly code: string;
    constructor(readonly stage: FailureStage, error: unknown) { super('database_failure'); this.code = safeErrorCode(error); }
}
export function safeDatabaseFailure(error: unknown) {
    return error instanceof DatabaseFailure ? { stage: error.stage, code: error.code } : { stage: 'unknown' as const, code: safeErrorCode(error) };
}
export class DependencyFailure extends Error {
    constructor(readonly dependency: 'consent' | 'snapshot' | 'simulator', readonly diagnostic: {
        stage: FailureStage;
        code: string;
    }) { super('bank_dependency_error'); }
}
export function parseRemoteFailure(value: unknown): {
    stage: FailureStage;
    code: string;
} {
    const v = value as {
        stage?: unknown;
        code?: unknown;
    } | null;
    const stage: FailureStage = ['connect', 'query', 'close', 'http'].includes(String(v?.stage)) ? v!.stage as FailureStage : 'unknown';
    const code = typeof v?.code === 'string' && (codes.has(v.code) || /^[0-9]{2}[A-Z0-9]{3}$/.test(v.code) || ['CLOCK_OFFSET', 'QUERY_TIMEOUT', 'ABORTED', 'FIXTURE_NOT_SEEDED', 'CONNECTION_TERMINATED'].includes(v.code)) ? v.code : 'UNKNOWN';
    return { stage, code };
}
