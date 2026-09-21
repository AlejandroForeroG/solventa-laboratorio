import { DatabaseFailure } from './dependency-error';
import { untilAborted } from './deadline';
export interface ReadAttempt {
    attempt: number;
    startedAt: number;
    finishedAt?: number;
    outcome?: 'ok' | 'error';
    code?: string;
}
export interface ReadRecovery {
    signal: AbortSignal;
    deadlineAt: number;
    firstAttemptMs: number;
    retryDelayMs: number;
    takeRetry: () => boolean;
    onAttempt?: (attempt: ReadAttempt) => void;
    onDecision?: (decision: 'retried' | 'budget_exhausted' | 'non_transient' | 'deadline') => void;
}
export class RetryBudget {
    private tokens = 2;
    private updated = Date.now();
    take(now = Date.now()) {
        this.tokens = Math.min(2, this.tokens + Math.max(0, now - this.updated) * 5 / 1000);
        this.updated = now;
        if (this.tokens < 1)
            return false;
        this.tokens--;
        return true;
    }
}
const transient = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'CONNECTION_TERMINATED', '57P01']);
export async function recoverRead<T>(read: (signal: AbortSignal, attempt: number) => Promise<T>, policy: ReadRecovery): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt++) {
        policy.signal.throwIfAborted();
        const remaining = policy.deadlineAt - Date.now();
        if (remaining <= 0)
            throw new Error('hard_deadline');
        const controller = new AbortController();
        const timeout = Math.min(remaining, attempt === 1 ? policy.firstAttemptMs : remaining);
        const timer = setTimeout(() => controller.abort(new Error('sql_attempt_timeout')), timeout);
        const signal = AbortSignal.any([policy.signal, controller.signal]);
        const event: ReadAttempt = { attempt, startedAt: Date.now() };
        policy.onAttempt?.({ ...event });
        let failure: unknown;
        try {
            const value = await read(signal, attempt);
            signal.throwIfAborted();
            event.outcome = 'ok';
            return value;
        }
        catch (error) {
            failure = error;
            event.outcome = 'error';
            event.code = controller.signal.aborted ? 'SQL_ATTEMPT_TIMEOUT' : error instanceof DatabaseFailure ? error.code : 'UNKNOWN';
        }
        finally {
            clearTimeout(timer);
            event.finishedAt = Date.now();
            policy.onAttempt?.({ ...event });
        }
        if (policy.signal.aborted) {
            policy.onDecision?.('deadline');
            policy.signal.throwIfAborted();
        }
        if (attempt === 2)
            throw failure;
        if (!controller.signal.aborted && !transient.has(event.code!)) {
            policy.onDecision?.('non_transient');
            throw failure;
        }
        if (policy.deadlineAt - Date.now() < policy.retryDelayMs + 50) {
            policy.onDecision?.('deadline');
            throw failure;
        }
        if (!policy.takeRetry()) {
            policy.onDecision?.('budget_exhausted');
            throw failure;
        }
        let delayTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await untilAborted(new Promise<void>(resolve => { delayTimer = setTimeout(resolve, policy.retryDelayMs); }), policy.signal);
        }
        finally {
            if (delayTimer !== undefined)
                clearTimeout(delayTimer);
        }
        policy.onDecision?.('retried');
    }
    throw new Error('unreachable');
}
