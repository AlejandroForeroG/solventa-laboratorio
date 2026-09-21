import { deliverEvidence } from '../shared/evidence-delivery';
import { requestTrace } from '../shared/request-trace';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { execute, type IsolateOperation } from '../application/execute';
import { CircuitBreaker } from '../domain/breaker';
import { requestSchema, runSchema, signalsSchema, operationSchema, phaseAt, type Run, type Operation } from '../shared/contracts';
import { snapshotFixture } from '../shared/fixtures';
import { withDatabase, withDatabaseRead, type DatabaseTimings } from '../shared/database';
import { RetryBudget } from '../shared/read-recovery';
import { uniform } from '../shared/contracts';
import { executionTelemetry, telemetrySnapshot } from '../shared/telemetry';
import { authorized } from '../shared/security';
import { withinDeadline } from '../shared/deadline';
import { DependencyFailure, parseRemoteFailure, safeDatabaseFailure } from '../shared/dependency-error';
let instanceId: string;
const states = new Map<string, {
    operations: Map<Operation, IsolateOperation>;
    expires: number;
    config: string;
}>();
const readRetryBudget = new RetryBudget();
const app = new Hono<{
    Bindings: AcquisitionEnv;
}>();
app.use('*', async (_c, next) => { instanceId ??= crypto.randomUUID(); await next(); });
app.use('*', bodyLimit({ maxSize: 8192 }));
app.get('/health', c => c.json({ service: 'solventa-experimental-bank', mode: c.env.BANK_MODE, instanceId, serverNow: Date.now(), capabilities: ['sql-read-recovery-v2', 'snapshot-failure-degrade-v1'] }));
app.use('*', async (c, next) => {
    if (!authorized(c.req.header('authorization'), c.env.BANK_TOKEN))
        return c.json({ error: 'unauthorized' }, 401);
    await next();
});
app.use('*', requestTrace('acquisition'));
function headers(env: AcquisitionEnv) { return { authorization: `Bearer ${env.BANK_TOKEN}`, 'content-type': 'application/json' }; }
async function internal(service: Fetcher, path: string, env: AcquisitionEnv, body?: unknown, signal?: AbortSignal) {
    const response = await service.fetch('https://bank.internal' + path, { method: body === undefined ? 'GET' : 'POST', headers: headers(env), ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as {
            diagnostic?: unknown;
        } | null;
        throw new DependencyFailure(path.startsWith('/consent/') ? 'consent' : 'simulator', parseRemoteFailure(payload?.diagnostic));
    }
    return response;
}
app.post('/bank/prepare', async (c) => {
    const run = runSchema.parse(await c.req.json());
    await internal(c.env.SIMULATOR, '/register', c.env, run);
    const consent = await (await internal(c.env.IDENTITY, '/consent/seed', c.env, run)).json();
    const revocation = run.fixture === 'revoked' ? await (await internal(c.env.IDENTITY, '/consent/revoke', c.env, run)).json() : null;
    const verifiedConsent = await (await internal(c.env.IDENTITY, '/consent/check', c.env, run)).json();
    const snapshot = snapshotFixture(run);
    if (c.env.BANK_MODE !== 'local-memory' && snapshot)
        await withDatabase(c.env.RISK_DB.connectionString, async (db) => {
            await db.query('INSERT INTO risk_exp.snapshots(run_id,payload) VALUES($1,$2)', [run.runId, JSON.stringify(snapshot)]);
        });
    return c.json({ prepared: true, mode: c.env.BANK_MODE, consent, revocation, verifiedConsent, snapshotPresent: Boolean(snapshot) });
});
app.get('/bank/evidence/:runId', async (c) => {
    const id = runSchema.shape.runId.parse(c.req.param('runId'));
    const after = z.coerce.number().int().min(0).parse(c.req.query('after') ?? 0);
    return internal(c.env.SIMULATOR, `/export/${id}?after=${after}`, c.env);
});
app.get('/bank/stats/:runId', async (c) => internal(c.env.SIMULATOR, `/stats/${runSchema.shape.runId.parse(c.req.param('runId'))}`, c.env));
app.post('/v1/:operation', async (c) => {
    const { run, requestId, emittedAt } = requestSchema.parse(await c.req.json());
    const operation = operationSchema.parse(c.req.param('operation'));
    const startedAt = Date.now(), phase = phaseAt(run, emittedAt);
    const record = (kind: 'api' | 'isolate', event: Record<string, unknown>) => {
        console.log(JSON.stringify({ kind, runId: run.runId, ...event }));
        const eventId = kind === 'isolate' ? `isolate/${instanceId}` : `api/${operation}/${requestId}`;
        const payload = JSON.stringify({ runId: run.runId, kind, event, eventId });
        c.executionCtx.waitUntil(deliverEvidence(async () => {
            const response = await c.env.SIMULATOR.fetch('https://bank.internal/record', { method: 'POST', headers: headers(c.env), body: payload, signal: AbortSignal.timeout(5000) });
            if (!response.ok) {
                const body = await response.json().catch(() => null) as {
                    diagnostic?: {
                        retryable?: boolean;
                        overloaded?: boolean;
                        remote?: boolean;
                    };
                } | null;
                throw Object.assign(new Error('evidence_http_error'), { status: response.status, retryable: body?.diagnostic?.retryable === true, overloaded: body?.diagnostic?.overloaded === true, remote: body?.diagnostic?.remote === true });
            }
            await response.body?.cancel();
        }, { runId: run.runId, eventKind: kind, traceId: requestId, operation, stage: 'record_service' }));
    };
    const rejectAdmission = (reason: string, status: 409 | 429) => {
        const body = { classification: 'technical_error' as const, traceId: requestId, reason, operation, phase, emittedAt, startedAt, finishedAt: Date.now(), instanceId,
            instrumentationVersion: 2, activeStage: 'admission', providerAttempt: false, providerDispatched: false, snapshotRead: false, probe: false, source: null, definitiveOffer: false, mode: c.env.BANK_MODE };
        record('api', body);
        return c.json(body, status);
    };
    if (Math.abs(startedAt - emittedAt) > 5000)
        return rejectAdmission('clock_skew_or_delayed_request', 409);
    if (['pending', 'finished'].includes(phase))
        return rejectAdmission('outside_run_window', 409);
    for (const [key, value] of states)
        if (value.expires < Date.now())
            states.delete(key);
    if (!states.has(run.runId)) {
        if (states.size >= 32)
            return rejectAdmission('too_many_active_runs', 429);
        states.set(run.runId, { operations: new Map(), expires: run.startAt + run.warmupMs + run.conditioningMs + run.measuredMs + 60000, config: JSON.stringify(run) });
        record('isolate', { instanceId, at: startedAt, run });
    }
    const current = states.get(run.runId)!;
    if (current.config !== JSON.stringify(run))
        return rejectAdmission('configuration_changed', 409);
    if (!current.operations.has(operation))
        current.operations.set(operation, { inFlight: 0, breaker: new CircuitBreaker() });
    const state = current.operations.get(operation)!;
    const before = state.breaker.state;
    const telemetry = executionTelemetry();
    let consentSql: DatabaseTimings | undefined;
    const snapshotSql: DatabaseTimings = { stage: 'connect', startedAt: startedAt };
    const common = () => ({ ...telemetrySnapshot(telemetry, Date.now()), consentSql, snapshotSql: telemetry.snapshotRead && c.env.BANK_MODE !== 'local-memory' ? { ...snapshotSql } : undefined,
        traceId: requestId, instanceId, operation, phase, emittedAt, startedAt, finishedAt: Date.now(), breakerBefore: before, breakerAfter: state.breaker.state, breakerEvents: state.breaker.drainEvents(), inFlight: state.inFlight, mode: c.env.BANK_MODE });
    try {
        const result = await withinDeadline(700, hardSignal => {
            hardSignal.addEventListener('abort', () => { telemetry.cancelledAt = Date.now(); telemetry.cancelledStage = telemetry.activeStage; }, { once: true });
            const work = execute(run, operation, requestId, {
                consent: { check: async (r) => {
                        const response = await c.env.IDENTITY.fetch('https://bank.internal/consent/check', { method: 'POST', headers: { ...headers(c.env), 'x-run-id': run.runId, 'x-request-id': requestId, 'x-operation': operation, 'x-hard-deadline-at': String(startedAt + 700) }, body: JSON.stringify(r), signal: hardSignal });
                        const payload = await response.json() as {
                            databaseTiming?: DatabaseTimings;
                            diagnostic?: unknown;
                        };
                        consentSql = payload.databaseTiming;
                        if (!response.ok)
                            throw new DependencyFailure('consent', parseRemoteFailure(payload.diagnostic));
                        return z.object({ allowed: z.boolean(), reference: z.string(), checkedAt: z.number() }).parse(payload);
                    } },
                snapshots: { read: async (r) => {
                        hardSignal.throwIfAborted();
                        if (c.env.BANK_MODE === 'local-memory')
                            return snapshotFixture(r);
                        snapshotSql.startedAt = Date.now();
                        const degradedBudget = run.phase === 'diagnostic' && run.snapshotFailureDegrade;
                        const deadlineAt = startedAt + (degradedBudget ? 600 : 700);
                        const read = (readSignal: AbortSignal) => {
                            const recovery = run.phase === 'diagnostic' && run.sqlReadRetry ? { signal: readSignal, deadlineAt, firstAttemptMs: 200, retryDelayMs: 10 + Math.floor(uniform(run.seed, requestId + 'snapshot-retry') * 16), takeRetry: () => readRetryBudget.take() } : undefined;
                            const work = withDatabaseRead(c.env.RISK_DB.connectionString, async (db, attempt) => {
                                if (run.phase === 'diagnostic' && run.snapshotReadFault) {
                                    console.log(JSON.stringify({ kind: 'fault_injection', dependency: 'snapshot', runId: run.runId, traceId: requestId, attempt, fault: 'sql_sleep_1s' }));
                                    await db.query('SELECT pg_sleep(1)');
                                }
                                const value = await db.query('SELECT payload FROM risk_exp.snapshots WHERE run_id=$1', [r.runId]);
                                return value.rows[0] ? signalsSchema.parse(value.rows[0].payload) : null;
                            }, { signal: readSignal, timings: snapshotSql, onProgress: t => console.log(JSON.stringify({ kind: 'database', dependency: 'snapshot', runId: run.runId, traceId: requestId, operation, ...t })) }, recovery);
                            c.executionCtx.waitUntil(work.then(() => { }, () => { }));
                            return work;
                        };
                        try {
                            return await (degradedBudget ? withinDeadline(Math.max(0, deadlineAt - Date.now()), signal => read(AbortSignal.any([hardSignal, signal]))) : read(hardSignal));
                        }
                        catch (error) {
                            throw new DependencyFailure('snapshot', error instanceof Error && error.message === 'hard_deadline' ? { stage: snapshotSql.stage === 'completed' ? 'unknown' : snapshotSql.stage, code: 'SNAPSHOT_BUDGET' } : safeDatabaseFailure(error));
                        }
                    } },
                provider: { read: async (r, op, id, signal) => {
                        const combined = AbortSignal.any([signal, hardSignal]);
                        combined.throwIfAborted();
                        telemetry.providerDispatched = true;
                        telemetry.providerDispatchedAt = Date.now();
                        console.log(JSON.stringify({ kind: 'request_trace', traceVersion: 1, service: 'acquisition', runId: r.runId, traceId: id, operation: op, stage: 'provider_dispatch', at: Date.now() }));
                        const response = await c.env.SIMULATOR.fetch(`https://bank.internal/provider/${op}`, { method: 'POST', headers: { ...headers(c.env), 'x-instance-id': instanceId, 'x-run-id': r.runId, 'x-request-id': id, 'x-operation': op }, body: JSON.stringify({ run: r, requestId: id, emittedAt }), signal: combined });
                        telemetry.providerResponseAt = Date.now();
                        if (!response.ok) {
                            await response.body?.cancel();
                            throw new Error('provider_error');
                        }
                        const parsed = signalsSchema.safeParse(await response.json());
                        if (!parsed.success)
                            throw new Error('invalid_payload');
                        return parsed.data;
                    } },
            }, state, Date.now, telemetry, hardSignal);
            c.executionCtx.waitUntil(work.then(() => { }, () => { }));
            return work;
        });
        const body = { ...result, ...common() };
        record('api', body);
        return c.json(body, result.classification === 'denied' ? 403 : 200);
    }
    catch (error) {
        const body = { classification: 'technical_error' as const, reason: error instanceof Error && error.message === 'hard_deadline' ? 'hard_deadline' : 'bank_dependency_error', ...(error instanceof DependencyFailure ? { dependency: error.dependency, diagnostic: error.diagnostic } : {}), ...common() };
        record('api', body);
        return c.json(body, 503);
    }
});
app.onError((e, c) => c.json({ classification: 'technical_error', reason: e instanceof z.ZodError ? 'invalid_request' : 'internal_error' }, e instanceof z.ZodError ? 400 : 500));
export default app;
