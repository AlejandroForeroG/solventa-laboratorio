import { Client } from 'pg';
import { DatabaseFailure } from './dependency-error';
import { untilAborted } from './deadline';
import { recoverRead, type ReadRecovery, type ReadAttempt } from './read-recovery';
export interface DatabaseTimings {
    stage: 'connect' | 'query' | 'close' | 'completed';
    startedAt: number;
    connectMs?: number;
    queryMs?: number;
    closeMs?: number;
    finishedAt?: number;
    cancelledAt?: number;
    cancelledStage?: 'connect' | 'query' | 'close' | 'completed';
    attempt?: number;
    readAttempts?: ReadAttempt[];
    retryDecision?: string;
}
interface DatabaseOptions {
    signal?: AbortSignal;
    timings?: DatabaseTimings;
    onProgress?: (timings: DatabaseTimings) => void;
}
interface Session {
    connect(): Promise<unknown>;
    end(): Promise<unknown>;
}
export async function databaseSession<T, C extends Session>(client: C, action: (client: C) => Promise<T>, options: DatabaseOptions = {}) {
    const timing = options.timings ?? { stage: 'connect', startedAt: Date.now() };
    const { signal } = options;
    let failed = false;
    let closing: Promise<unknown> | undefined;
    const close = () => closing ??= (async () => { await client.end(); })();
    const report = () => options.onProgress?.({ ...timing });
    const onAbort = () => {
        timing.cancelledAt = Date.now();
        timing.cancelledStage = timing.stage;
        report();
        close().catch(() => { });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        signal?.throwIfAborted();
        timing.stage = 'connect';
        const start = Date.now();
        report();
        try {
            await untilAborted(client.connect(), signal);
        }
        finally {
            timing.connectMs = Date.now() - start;
        }
        signal?.throwIfAborted();
        timing.stage = 'query';
        const queryStart = Date.now();
        report();
        try {
            return await untilAborted(action(client), signal);
        }
        finally {
            timing.queryMs = Date.now() - queryStart;
        }
    }
    catch (error) {
        failed = true;
        throw new DatabaseFailure(timing.stage === 'completed' ? 'close' : timing.stage, error);
    }
    finally {
        timing.stage = 'close';
        const closeStart = Date.now();
        report();
        try {
            await close();
        }
        catch (error) {
            if (!failed)
                throw new DatabaseFailure('close', error);
        }
        finally {
            timing.closeMs = Date.now() - closeStart;
            timing.finishedAt = Date.now();
            timing.stage = 'completed';
            signal?.removeEventListener('abort', onAbort);
            report();
        }
    }
}
export async function withDatabase<T>(connectionString: string, action: (client: Client) => Promise<T>, options: DatabaseOptions = {}): Promise<T> {
    return databaseSession(new Client({ connectionString, connectionTimeoutMillis: 1000, query_timeout: 1000 }), action, options);
}
export async function databaseReadSession<T, C extends Session>(createClient: () => C, action: (client: C, attempt: number) => Promise<T>, options: DatabaseOptions, recovery?: ReadRecovery): Promise<T> {
    if (!recovery)
        return databaseSession(createClient(), db => action(db, 1), options);
    const attempts: ReadAttempt[] = [];
    const outer = options.timings ?? { stage: 'connect', startedAt: Date.now() } as DatabaseTimings;
    let decision: string | undefined;
    const report = (publish = false) => { outer.readAttempts = attempts.map(x => ({ ...x })); outer.retryDecision = decision; if (publish)
        options.onProgress?.({ ...outer }); };
    return recoverRead((signal, attempt) => {
        const timings: DatabaseTimings = { stage: 'connect', startedAt: Date.now(), attempt };
        for (const key of ['connectMs', 'queryMs', 'closeMs', 'finishedAt', 'cancelledAt', 'cancelledStage'] as const)
            delete outer[key];
        return databaseSession(createClient(), db => action(db, attempt), { signal, timings, onProgress: t => {
                delete outer.cancelledAt;
                delete outer.cancelledStage;
                Object.assign(outer, t);
                report(true);
            } });
    }, { ...recovery, onAttempt: event => { attempts[event.attempt - 1] = event; report(); }, onDecision: value => { decision = value; report(); } });
}
export async function withDatabaseRead<T>(connectionString: string, action: (client: Client, attempt: number) => Promise<T>, options: DatabaseOptions, recovery?: ReadRecovery): Promise<T> {
    return databaseReadSession(() => new Client({ connectionString, connectionTimeoutMillis: 1000, query_timeout: 1000 }), action, options, recovery);
}
